import type {
  AdminBroadcastRepository,
  AdminEventAuditContext
} from "@ticket-platform/application";
import type {
  AdminBroadcast,
  AdminBroadcastContent,
  AdminBroadcastLifecycleStatus,
  AdminBroadcastSchedule,
  AdminBroadcastSummary,
  AdminBroadcastVersion,
  AdminBroadcastVersionStatus,
  AdminSegmentAudienceSnapshotSummary
} from "@ticket-platform/contracts";
import type { SqlConnection, SqlConnectionPool } from "./postgres.js";
import {
  mapBroadcastTestDelivery,
  type BroadcastTestDeliveryRow
} from "./broadcast-test-delivery-persistence.js";

interface BroadcastRow {
  readonly id: string;
  readonly name: string;
  readonly lock_version: number;
  readonly lifecycle_status: string;
  readonly published_version_id: string | null;
  readonly scheduled_version_id: string | null;
  readonly scheduled_at: Date | string | null;
  readonly schedule_timezone: string | null;
  readonly rate_per_second: number | null;
  readonly prepared_at: Date | string | null;
  readonly send_started_at: Date | string | null;
  readonly completed_at: Date | string | null;
  readonly paused_at: Date | string | null;
  readonly cancelled_at: Date | string | null;
  readonly auto_pause_reason: string | null;
  readonly planned_recipient_count: string | null;
  readonly reachable_recipient_count: string | null;
  readonly skipped_recipient_count: string | null;
  readonly attempted_recipient_count: string;
  readonly sent_recipient_count: string;
  readonly failed_recipient_count: string;
  readonly updated_at: Date | string;
}

interface BroadcastListRow extends BroadcastRow {
  readonly draft_version_number: number | null;
  readonly published_version_number: number | null;
  readonly audience_total_count: string | null;
}

interface BroadcastVersionRow {
  readonly id: string;
  readonly broadcast_id: string;
  readonly version_number: number;
  readonly status: string;
  readonly schema_version: number;
  readonly name: string;
  readonly audience_snapshot_id: string;
  readonly content: unknown;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
  readonly published_at: Date | string | null;
  readonly segment_id: string;
  readonly segment_version_id: string;
  readonly segment_version_number: number;
  readonly snapshot_status: string;
  readonly snapshot_total_count: string | null;
  readonly snapshot_requested_at: Date | string;
  readonly snapshot_completed_at: Date | string | null;
}

export class PostgresAdminBroadcastRepository
implements AdminBroadcastRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  list(): Promise<readonly AdminBroadcastSummary[]> {
    return this.read(async (connection) => {
      const result = await connection.query<BroadcastListRow>(
        `select broadcasts.id, broadcasts.name, broadcasts.lock_version,
                broadcasts.lifecycle_status,
                broadcasts.published_version_id,
                broadcasts.scheduled_version_id,
                broadcasts.scheduled_at, broadcasts.schedule_timezone,
                broadcasts.rate_per_second, broadcasts.prepared_at,
                broadcasts.send_started_at, broadcasts.completed_at,
                broadcasts.paused_at, broadcasts.cancelled_at,
                broadcasts.auto_pause_reason,
                broadcasts.planned_recipient_count::text,
                broadcasts.reachable_recipient_count::text,
                broadcasts.skipped_recipient_count::text,
                broadcasts.attempted_recipient_count::text,
                broadcasts.sent_recipient_count::text,
                broadcasts.failed_recipient_count::text,
                broadcasts.updated_at,
                drafts.version_number as draft_version_number,
                published.version_number as published_version_number,
                snapshots.total_count::text as audience_total_count
         from public.broadcasts broadcasts
         left join public.broadcast_versions drafts
           on drafts.broadcast_id = broadcasts.id and drafts.status = 'draft'
         left join public.broadcast_versions published
           on published.id = broadcasts.published_version_id
         left join public.segment_audience_snapshots snapshots
           on snapshots.id = coalesce(
             drafts.audience_snapshot_id,
             published.audience_snapshot_id
           )
         order by broadcasts.updated_at desc, broadcasts.id`
      );
      return result.rows.map(mapSummary);
    });
  }

  get(broadcastId: string): Promise<AdminBroadcast | null> {
    return this.read((connection) => readBroadcast(connection, broadcastId));
  }

  create(input: Parameters<AdminBroadcastRepository["create"]>[0]) {
    return this.write(async (connection) => {
      if (!await isReadySnapshot(connection, input.audienceSnapshotId)) {
        return { status: "snapshot_not_ready" as const };
      }
      await connection.query(
        `insert into public.broadcasts (
           id, name, lock_version, created_by_admin_id, created_at, updated_at
         ) values ($1, $2, 1, $3, $4, $4)`,
        [
          input.broadcastId,
          input.name,
          input.audit.actorAdminId,
          input.audit.occurredAt
        ]
      );
      await connection.query(
        `insert into public.broadcast_versions (
           id, broadcast_id, version_number, status, schema_version,
           name, audience_snapshot_id, content, created_by_admin_id,
           created_at, updated_at
         ) values (
           $1, $2, 1, 'draft', 3,
           $3, $4, $5::jsonb, $6,
           $7, $7
         )`,
        [
          input.versionId,
          input.broadcastId,
          input.name,
          input.audienceSnapshotId,
          JSON.stringify(input.content),
          input.audit.actorAdminId,
          input.audit.occurredAt
        ]
      );
      await appendAudit(
        connection,
        input.audit,
        "broadcast.draft_created",
        input.broadcastId,
        null,
        {
          broadcastVersionId: input.versionId,
          audienceSnapshotId: input.audienceSnapshotId,
          versionNumber: 1,
          lockVersion: 1
        }
      );
      return {
        status: "created" as const,
        value: requireBroadcast(
          await readBroadcast(connection, input.broadcastId)
        )
      };
    });
  }

  saveDraft(input: Parameters<AdminBroadcastRepository["saveDraft"]>[0]) {
    return this.write(async (connection) => {
      const broadcast = await lockBroadcast(connection, input.broadcastId);
      if (!broadcast) {
        return { status: "not_found" as const };
      }
      if (broadcast.lock_version !== input.expectedLockVersion) {
        return { status: "version_conflict" as const };
      }
      if (broadcast.lifecycle_status !== "draft") {
        return { status: "not_editable" as const };
      }
      if (!await isReadySnapshot(connection, input.audienceSnapshotId)) {
        return { status: "snapshot_not_ready" as const };
      }
      const draftResult = await connection.query<BroadcastVersionRow>(
        `${VERSION_SELECT}
         where versions.broadcast_id = $1 and versions.status = 'draft'
         for update of versions`,
        [input.broadcastId]
      );
      const draft = draftResult.rows[0];
      let versionId: string;
      let versionNumber: number;
      if (draft) {
        versionId = draft.id;
        versionNumber = draft.version_number;
        await connection.query(
          `update public.broadcast_versions
           set name = $2,
               audience_snapshot_id = $3,
               content = $4::jsonb,
               schema_version = 3,
               updated_at = $5
           where id = $1 and status = 'draft'`,
          [
            draft.id,
            input.name,
            input.audienceSnapshotId,
            JSON.stringify(input.content),
            input.audit.occurredAt
          ]
        );
      } else {
        versionId = input.proposedVersionId;
        versionNumber = await nextVersionNumber(
          connection,
          input.broadcastId
        );
        await connection.query(
          `insert into public.broadcast_versions (
             id, broadcast_id, version_number, status, schema_version,
             name, audience_snapshot_id, content, created_by_admin_id,
             created_at, updated_at
           ) values (
             $1, $2, $3, 'draft', 3,
             $4, $5, $6::jsonb, $7,
             $8, $8
           )`,
          [
            versionId,
            input.broadcastId,
            versionNumber,
            input.name,
            input.audienceSnapshotId,
            JSON.stringify(input.content),
            input.audit.actorAdminId,
            input.audit.occurredAt
          ]
        );
      }
      const updated = await connection.query<{
        readonly lock_version: number;
      }>(
        `update public.broadcasts
         set name = $2,
             lock_version = lock_version + 1,
             updated_at = $3
         where id = $1
         returning lock_version`,
        [input.broadcastId, input.name, input.audit.occurredAt]
      );
      const lockVersion = updated.rows[0]?.lock_version;
      if (!lockVersion) {
        throw new Error("Broadcast draft update lost its locked aggregate");
      }
      await appendAudit(
        connection,
        input.audit,
        draft ? "broadcast.draft_updated" : "broadcast.draft_created",
        input.broadcastId,
        draft
          ? {
              broadcastVersionId: draft.id,
              audienceSnapshotId: draft.audience_snapshot_id,
              versionNumber: draft.version_number,
              lockVersion: broadcast.lock_version
            }
          : null,
        {
          broadcastVersionId: versionId,
          audienceSnapshotId: input.audienceSnapshotId,
          versionNumber,
          lockVersion
        }
      );
      return {
        status: "saved" as const,
        value: requireBroadcast(
          await readBroadcast(connection, input.broadcastId)
        )
      };
    });
  }

  publishDraft(
    input: Parameters<AdminBroadcastRepository["publishDraft"]>[0]
  ) {
    return this.write(async (connection) => {
      const broadcast = await lockBroadcast(connection, input.broadcastId);
      if (!broadcast) {
        return { status: "not_found" as const };
      }
      if (broadcast.lock_version !== input.expectedLockVersion) {
        return { status: "version_conflict" as const };
      }
      if (broadcast.lifecycle_status !== "draft") {
        return { status: "not_editable" as const };
      }
      const draftResult = await connection.query<BroadcastVersionRow>(
        `${VERSION_SELECT}
         where versions.broadcast_id = $1 and versions.status = 'draft'
         for update of versions`,
        [input.broadcastId]
      );
      const draft = draftResult.rows[0];
      if (!draft) {
        return { status: "draft_not_found" as const };
      }
      if (draft.snapshot_status !== "ready") {
        return { status: "snapshot_not_ready" as const };
      }
      await connection.query(
        `update public.broadcast_versions
         set status = 'published',
             published_by_admin_id = $2,
             published_at = $3,
             updated_at = $3
         where id = $1 and status = 'draft'`,
        [
          draft.id,
          input.audit.actorAdminId,
          input.audit.occurredAt
        ]
      );
      const updated = await connection.query<{
        readonly lock_version: number;
      }>(
        `update public.broadcasts
         set published_version_id = $2,
             lock_version = lock_version + 1,
             updated_at = $3
         where id = $1
         returning lock_version`,
        [input.broadcastId, draft.id, input.audit.occurredAt]
      );
      const lockVersion = updated.rows[0]?.lock_version;
      if (!lockVersion) {
        throw new Error("Broadcast publication lost its locked aggregate");
      }
      await appendAudit(
        connection,
        input.audit,
        "broadcast.version_published",
        input.broadcastId,
        {
          publishedVersionId: broadcast.published_version_id,
          lockVersion: broadcast.lock_version
        },
        {
          publishedVersionId: draft.id,
          audienceSnapshotId: draft.audience_snapshot_id,
          versionNumber: draft.version_number,
          lockVersion
        }
      );
      await appendPublicationEvent(connection, {
        eventId: input.publicationEventId,
        broadcastId: input.broadcastId,
        broadcastVersionId: draft.id,
        audienceSnapshotId: draft.audience_snapshot_id,
        audienceTotalCount: draft.snapshot_total_count ?? "0",
        occurredAt: input.audit.occurredAt
      });
      return {
        status: "published" as const,
        value: requireBroadcast(
          await readBroadcast(connection, input.broadcastId)
        )
      };
    });
  }

  schedule(input: Parameters<AdminBroadcastRepository["schedule"]>[0]) {
    return this.write(async (connection) => {
      const broadcast = await lockBroadcast(connection, input.broadcastId);
      if (!broadcast) {
        return { status: "not_found" as const };
      }
      if (broadcast.lock_version !== input.expectedLockVersion) {
        return { status: "version_conflict" as const };
      }
      if (broadcast.lifecycle_status !== "draft") {
        return { status: "not_editable" as const };
      }
      const draft = await connection.query<{ readonly id: string }>(
        `select id
         from public.broadcast_versions
         where broadcast_id = $1 and status = 'draft'
         for update`,
        [input.broadcastId]
      );
      if (draft.rows[0]) {
        return { status: "draft_exists" as const };
      }
      if (!broadcast.published_version_id) {
        return { status: "published_not_found" as const };
      }
      const published = await connection.query<BroadcastVersionRow>(
        `${VERSION_SELECT}
         where versions.id = $1
           and versions.broadcast_id = $2
           and versions.status = 'published'
         for share of versions, snapshots`,
        [broadcast.published_version_id, input.broadcastId]
      );
      const version = published.rows[0];
      if (!version) {
        return { status: "published_not_found" as const };
      }
      if (version.snapshot_status !== "ready") {
        return { status: "snapshot_not_ready" as const };
      }
      const updated = await connection.query<{
        readonly lock_version: number;
      }>(
        `update public.broadcasts
         set lifecycle_status = 'scheduled',
             scheduled_version_id = $2,
             scheduled_at = $3,
             schedule_timezone = $4,
             rate_per_second = $5,
             lock_version = lock_version + 1,
             updated_at = $6
         where id = $1
         returning lock_version`,
        [
          input.broadcastId,
          version.id,
          input.scheduledAt,
          input.timezone,
          input.ratePerSecond,
          input.audit.occurredAt
        ]
      );
      const lockVersion = updated.rows[0]?.lock_version;
      if (!lockVersion) {
        throw new Error("Broadcast scheduling lost its locked aggregate");
      }
      await appendAudit(
        connection,
        input.audit,
        "broadcast.scheduled",
        input.broadcastId,
        {
          lifecycleStatus: broadcast.lifecycle_status,
          lockVersion: broadcast.lock_version
        },
        {
          lifecycleStatus: "scheduled",
          scheduledVersionId: version.id,
          scheduledAt: input.scheduledAt.toISOString(),
          timezone: input.timezone,
          ratePerSecond: input.ratePerSecond,
          lockVersion
        }
      );
      await appendScheduleEvent(connection, {
        eventId: input.scheduleEventId,
        broadcastId: input.broadcastId,
        broadcastVersionId: version.id,
        audienceSnapshotId: version.audience_snapshot_id,
        scheduledAt: input.scheduledAt,
        timezone: input.timezone,
        ratePerSecond: input.ratePerSecond,
        occurredAt: input.audit.occurredAt
      });
      return {
        status: "scheduled" as const,
        value: requireBroadcast(
          await readBroadcast(connection, input.broadcastId)
        )
      };
    });
  }

  control(input: Parameters<AdminBroadcastRepository["control"]>[0]) {
    return this.write(async (connection) => {
      const broadcast = await lockBroadcast(connection, input.broadcastId);
      if (!broadcast) {
        return { status: "not_found" as const };
      }
      if (broadcast.lock_version !== input.expectedLockVersion) {
        return { status: "version_conflict" as const };
      }
      const targetStatus = controlTarget(
        input.action,
        broadcast.lifecycle_status
      );
      if (!targetStatus) {
        return { status: "invalid_transition" as const };
      }
      const updated = await connection.query<{
        readonly lock_version: number;
      }>(
        `update public.broadcasts
         set lifecycle_status = $2,
             paused_at = case when $2 = 'paused' then $3 else null end,
             cancelled_at = case when $2 = 'cancelled' then $3
                            else cancelled_at end,
             auto_pause_reason = null,
             lock_version = lock_version + 1,
             updated_at = $3
         where id = $1
         returning lock_version`,
        [input.broadcastId, targetStatus, input.audit.occurredAt]
      );
      const lockVersion = updated.rows[0]?.lock_version;
      if (!lockVersion) {
        throw new Error("Broadcast control lost its locked aggregate");
      }
      await appendAudit(
        connection,
        input.audit,
        `broadcast.${controlPastTense(input.action)}`,
        input.broadcastId,
        {
          lifecycleStatus: broadcast.lifecycle_status,
          lockVersion: broadcast.lock_version
        },
        {
          lifecycleStatus: targetStatus,
          lockVersion
        }
      );
      await appendControlEvent(connection, {
        eventId: input.lifecycleEventId,
        broadcastId: input.broadcastId,
        eventType: controlEventType(input.action),
        previousStatus: broadcast.lifecycle_status,
        lifecycleStatus: targetStatus,
        occurredAt: input.audit.occurredAt
      });
      return {
        status: "controlled" as const,
        value: requireBroadcast(
          await readBroadcast(connection, input.broadcastId)
        )
      };
    });
  }

  private async read<TResult>(
    work: (connection: SqlConnection) => Promise<TResult>
  ): Promise<TResult> {
    const connection = await this.pool.connect();
    try {
      await connection.query(
        "begin transaction isolation level repeatable read read only"
      );
      try {
        const result = await work(connection);
        await connection.query("commit");
        return result;
      } catch (error) {
        await connection.query("rollback");
        throw error;
      }
    } finally {
      connection.release();
    }
  }

  private async write<TResult>(
    work: (connection: SqlConnection) => Promise<TResult>
  ): Promise<TResult> {
    const connection = await this.pool.connect();
    try {
      await connection.query("begin");
      try {
        const result = await work(connection);
        await connection.query("commit");
        return result;
      } catch (error) {
        await connection.query("rollback");
        throw error;
      }
    } finally {
      connection.release();
    }
  }
}

export function createAdminBroadcastPersistence(
  pool: SqlConnectionPool
): AdminBroadcastRepository {
  return new PostgresAdminBroadcastRepository(pool);
}

const BROADCAST_SELECT = `
  select id, name, lock_version, lifecycle_status,
         published_version_id, scheduled_version_id, scheduled_at,
         schedule_timezone, rate_per_second, prepared_at,
         send_started_at, completed_at, paused_at, cancelled_at,
         auto_pause_reason,
         planned_recipient_count::text, reachable_recipient_count::text,
         skipped_recipient_count::text, attempted_recipient_count::text,
         sent_recipient_count::text, failed_recipient_count::text, updated_at
  from public.broadcasts`;

const VERSION_SELECT = `
  select versions.id, versions.broadcast_id, versions.version_number,
         versions.status, versions.schema_version, versions.name,
         versions.audience_snapshot_id, versions.content,
         versions.created_at, versions.updated_at, versions.published_at,
         snapshots.segment_id, snapshots.segment_version_id,
         segment_versions.version_number as segment_version_number,
         snapshots.status as snapshot_status,
         snapshots.total_count::text as snapshot_total_count,
         snapshots.requested_at as snapshot_requested_at,
         snapshots.completed_at as snapshot_completed_at
  from public.broadcast_versions versions
  join public.segment_audience_snapshots snapshots
    on snapshots.id = versions.audience_snapshot_id
  join public.segment_versions segment_versions
    on segment_versions.id = snapshots.segment_version_id`;

async function lockBroadcast(
  connection: SqlConnection,
  broadcastId: string
): Promise<BroadcastRow | undefined> {
  await connection.query(
    "select pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`broadcast:${broadcastId}`]
  );
  const result = await connection.query<BroadcastRow>(
    `${BROADCAST_SELECT} where id = $1 for update`,
    [broadcastId]
  );
  return result.rows[0];
}

async function readBroadcast(
  connection: SqlConnection,
  broadcastId: string
): Promise<AdminBroadcast | null> {
  const aggregate = await connection.query<BroadcastRow>(
    `${BROADCAST_SELECT} where id = $1`,
    [broadcastId]
  );
  const broadcast = aggregate.rows[0];
  if (!broadcast) {
    return null;
  }
  const versions = await connection.query<BroadcastVersionRow>(
    `${VERSION_SELECT}
     where versions.broadcast_id = $1
       and (versions.status = 'draft' or versions.id = $2)
     order by versions.version_number desc`,
    [broadcastId, broadcast.published_version_id]
  );
  const draft = versions.rows.find((row) => row.status === "draft");
  const published = versions.rows.find(
    (row) => row.id === broadcast.published_version_id
  );
  const testDeliveries = await connection.query<BroadcastTestDeliveryRow>(
    `select id, broadcast_id, broadcast_version_id, version_number,
            schema_version, recipient_external_user_id, content,
            personalization_context, status,
            provider_message_id, error_code,
            requested_at, started_at, finished_at
     from public.broadcast_test_deliveries
     where broadcast_id = $1
     order by requested_at desc, id desc
     limit 10`,
    [broadcastId]
  );
  return {
    id: broadcast.id,
    name: broadcast.name,
    lockVersion: broadcast.lock_version,
    lifecycleStatus: readLifecycleStatus(broadcast.lifecycle_status),
    draft: draft ? mapVersion(draft) : null,
    published: published ? mapVersion(published) : null,
    schedule: mapSchedule(broadcast),
    testDeliveries: testDeliveries.rows.map(mapBroadcastTestDelivery),
    updatedAt: asIso(broadcast.updated_at)
  };
}

async function isReadySnapshot(
  connection: SqlConnection,
  snapshotId: string
): Promise<boolean> {
  const result = await connection.query<{ readonly id: string }>(
    `select id
     from public.segment_audience_snapshots
     where id = $1 and status = 'ready'
     for share`,
    [snapshotId]
  );
  return result.rows[0] !== undefined;
}

async function nextVersionNumber(
  connection: SqlConnection,
  broadcastId: string
): Promise<number> {
  const result = await connection.query<{
    readonly next_version_number: number;
  }>(
    `select coalesce(max(version_number), 0) + 1 as next_version_number
     from public.broadcast_versions
     where broadcast_id = $1`,
    [broadcastId]
  );
  const value = result.rows[0]?.next_version_number;
  if (!Number.isSafeInteger(value) || !value || value < 1) {
    throw new Error("Broadcast version sequence is invalid");
  }
  return value;
}

function mapSummary(row: BroadcastListRow): AdminBroadcastSummary {
  return {
    id: row.id,
    name: row.name,
    lockVersion: row.lock_version,
    lifecycleStatus: readLifecycleStatus(row.lifecycle_status),
    draftVersionNumber: row.draft_version_number,
    publishedVersionNumber: row.published_version_number,
    audienceTotalCount: row.audience_total_count,
    schedule: mapSchedule(row),
    updatedAt: asIso(row.updated_at)
  };
}

function readLifecycleStatus(value: string): AdminBroadcastLifecycleStatus {
  const statuses: readonly AdminBroadcastLifecycleStatus[] = [
    "draft",
    "scheduled",
    "preparing",
    "sending",
    "paused",
    "completed",
    "cancelled",
    "failed"
  ];
  if (!statuses.includes(value as AdminBroadcastLifecycleStatus)) {
    throw new Error("Broadcast lifecycle status is invalid");
  }
  return value as AdminBroadcastLifecycleStatus;
}

function mapSchedule(row: BroadcastRow): AdminBroadcastSchedule | null {
  if (row.lifecycle_status === "draft") {
    return null;
  }
  if (
    !row.scheduled_version_id
    || !row.scheduled_at
    || !row.schedule_timezone
    || !row.rate_per_second
  ) {
    throw new Error("Broadcast schedule metadata is incomplete");
  }
  return {
    scheduledVersionId: row.scheduled_version_id,
    scheduledAt: asIso(row.scheduled_at),
    timezone: row.schedule_timezone,
    ratePerSecond: row.rate_per_second,
    preparedAt: row.prepared_at ? asIso(row.prepared_at) : null,
    sendStartedAt: row.send_started_at ? asIso(row.send_started_at) : null,
    completedAt: row.completed_at ? asIso(row.completed_at) : null,
    pausedAt: row.paused_at ? asIso(row.paused_at) : null,
    cancelledAt: row.cancelled_at ? asIso(row.cancelled_at) : null,
    autoPauseReason: row.auto_pause_reason,
    plannedRecipientCount: row.planned_recipient_count,
    reachableRecipientCount: row.reachable_recipient_count,
    skippedRecipientCount: row.skipped_recipient_count,
    attemptedRecipientCount: row.attempted_recipient_count,
    sentRecipientCount: row.sent_recipient_count,
    failedRecipientCount: row.failed_recipient_count
  };
}

function mapVersion(row: BroadcastVersionRow): AdminBroadcastVersion {
  if (
    ![1, 2, 3].includes(row.schema_version)
    || !["draft", "published"].includes(row.status)
  ) {
    throw new Error("Broadcast version metadata is invalid");
  }
  return {
    id: row.id,
    versionNumber: row.version_number,
    status: row.status as AdminBroadcastVersionStatus,
    schemaVersion: row.schema_version as 1 | 2 | 3,
    name: row.name,
    audienceSnapshot: mapSnapshot(row),
    content: readContent(row.content),
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
    publishedAt: row.published_at ? asIso(row.published_at) : null
  };
}

function mapSnapshot(
  row: BroadcastVersionRow
): AdminSegmentAudienceSnapshotSummary {
  if (!["pending", "ready"].includes(row.snapshot_status)) {
    throw new Error("Broadcast audience snapshot status is invalid");
  }
  return {
    id: row.audience_snapshot_id,
    segmentId: row.segment_id,
    segmentVersionId: row.segment_version_id,
    segmentVersionNumber: row.segment_version_number,
    status: row.snapshot_status as "pending" | "ready",
    totalCount: row.snapshot_total_count,
    requestedAt: asIso(row.snapshot_requested_at),
    completedAt: row.snapshot_completed_at
      ? asIso(row.snapshot_completed_at)
      : null
  };
}

function readContent(value: unknown): AdminBroadcastContent {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Broadcast content is invalid");
  }
  return parsed as AdminBroadcastContent;
}

function asIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Broadcast timestamp is invalid");
  }
  return date.toISOString();
}

function appendAudit(
  connection: SqlConnection,
  audit: AdminEventAuditContext,
  action: string,
  broadcastId: string,
  before: unknown,
  after: unknown
): Promise<unknown> {
  return connection.query(
    `insert into public.audit_log (
       id, actor_admin_id, actor_role, action, target_type, target_id,
       reason, before_masked, after_masked, request_id,
       ip_address, user_agent, created_at
     ) values (
       $1, $2, $3, $4, 'broadcast', $5,
       $6, $7::jsonb, $8::jsonb, $9,
       $10::inet, $11, $12
     )`,
    [
      audit.auditId,
      audit.actorAdminId,
      audit.actorRole,
      action,
      broadcastId,
      audit.reason,
      before === null ? null : JSON.stringify(before),
      after === null ? null : JSON.stringify(after),
      audit.requestId,
      audit.ipAddress,
      audit.userAgent,
      audit.occurredAt
    ]
  );
}

function appendPublicationEvent(
  connection: SqlConnection,
  input: {
    readonly eventId: string;
    readonly broadcastId: string;
    readonly broadcastVersionId: string;
    readonly audienceSnapshotId: string;
    readonly audienceTotalCount: string;
    readonly occurredAt: Date;
  }
): Promise<unknown> {
  return connection.query(
    `insert into public.outbox_events (
       event_id, aggregate_type, aggregate_id, event_type,
       schema_version, payload, occurred_at
     ) values (
       $1, 'broadcast', $2, 'BroadcastVersionPublished',
       1, $3::jsonb, $4
     )`,
    [
      input.eventId,
      input.broadcastId,
      JSON.stringify({
        broadcastId: input.broadcastId,
        broadcastVersionId: input.broadcastVersionId,
        audienceSnapshotId: input.audienceSnapshotId,
        audienceTotalCount: input.audienceTotalCount
      }),
      input.occurredAt
    ]
  );
}

function appendScheduleEvent(
  connection: SqlConnection,
  input: {
    readonly eventId: string;
    readonly broadcastId: string;
    readonly broadcastVersionId: string;
    readonly audienceSnapshotId: string;
    readonly scheduledAt: Date;
    readonly timezone: string;
    readonly ratePerSecond: number;
    readonly occurredAt: Date;
  }
): Promise<unknown> {
  return connection.query(
    `insert into public.outbox_events (
       event_id, aggregate_type, aggregate_id, event_type,
       schema_version, payload, occurred_at
     ) values (
       $1, 'broadcast', $2, 'BroadcastScheduled',
       1, $3::jsonb, $4
     )`,
    [
      input.eventId,
      input.broadcastId,
      JSON.stringify({
        broadcastId: input.broadcastId,
        broadcastVersionId: input.broadcastVersionId,
        audienceSnapshotId: input.audienceSnapshotId,
        scheduledAt: input.scheduledAt.toISOString(),
        timezone: input.timezone,
        ratePerSecond: input.ratePerSecond
      }),
      input.occurredAt
    ]
  );
}

function appendControlEvent(
  connection: SqlConnection,
  input: {
    readonly eventId: string;
    readonly broadcastId: string;
    readonly eventType:
      | "BroadcastPaused"
      | "BroadcastResumed"
      | "BroadcastCancelled";
    readonly previousStatus: string;
    readonly lifecycleStatus: string;
    readonly occurredAt: Date;
  }
): Promise<unknown> {
  return connection.query(
    `insert into public.outbox_events (
       event_id, aggregate_type, aggregate_id, event_type,
       schema_version, payload, occurred_at
     ) values ($1, 'broadcast', $2, $3, 1, $4::jsonb, $5)`,
    [
      input.eventId,
      input.broadcastId,
      input.eventType,
      JSON.stringify({
        broadcastId: input.broadcastId,
        previousStatus: input.previousStatus,
        lifecycleStatus: input.lifecycleStatus
      }),
      input.occurredAt
    ]
  );
}

function controlTarget(action: string, status: string): string | null {
  if (action === "pause" && ["preparing", "sending"].includes(status)) {
    return "paused";
  }
  if (action === "resume" && status === "paused") {
    return "sending";
  }
  if (
    action === "cancel"
    && ["scheduled", "preparing", "sending", "paused"].includes(status)
  ) {
    return "cancelled";
  }
  return null;
}

function controlPastTense(action: string): string {
  return action === "pause"
    ? "paused"
    : action === "resume"
      ? "resumed"
      : "cancelled";
}

function controlEventType(
  action: string
): "BroadcastPaused" | "BroadcastResumed" | "BroadcastCancelled" {
  return action === "pause"
    ? "BroadcastPaused"
    : action === "resume"
      ? "BroadcastResumed"
      : "BroadcastCancelled";
}

function requireBroadcast(value: AdminBroadcast | null): AdminBroadcast {
  if (!value) {
    throw new Error("Broadcast was not readable after mutation");
  }
  return value;
}
