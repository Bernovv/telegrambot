import type {
  AdminEventAuditContext,
  SegmentAudienceSnapshotRepository
} from "@ticket-platform/application";
import type {
  AdminSegmentAudienceSnapshot,
  AdminSegmentAudienceSnapshotStatus,
  AdminSegmentAudienceSnapshotSummary,
  AdminSegmentExpression,
  AdminSegmentSampleUser
} from "@ticket-platform/contracts";
import { buildAdminSegmentSqlExpression } from "./admin-segments-persistence.js";
import {
  PostgresUnitOfWork,
  TransactionSession,
  type SqlConnection,
  type SqlConnectionPool,
  type SqlExecutor
} from "./postgres.js";
import { PostgresOutboxWriter } from "./telegram-start-persistence.js";

interface SnapshotRow {
  readonly id: string;
  readonly segment_id: string;
  readonly segment_version_id: string;
  readonly version_number: number;
  readonly status: string;
  readonly total_count: string | null;
  readonly requested_at: Date | string;
  readonly completed_at: Date | string | null;
}

interface PendingSnapshotRow {
  readonly id: string;
  readonly segment_id: string;
  readonly segment_version_id: string;
  readonly expression: unknown;
}

interface SampleRow {
  readonly id: string;
  readonly display_name: string | null;
  readonly telegram_username: string | null;
  readonly registered_at: Date | string;
  readonly status_codes: readonly string[];
  readonly category_codes: readonly string[];
}

export class PostgresSegmentAudienceSnapshotRepository
implements SegmentAudienceSnapshotRepository {
  constructor(
    private readonly pool: SqlConnectionPool,
    private readonly session: TransactionSession
  ) {}

  list(segmentId: string): Promise<readonly AdminSegmentAudienceSnapshotSummary[]> {
    return this.read(async (connection) => {
      const result = await connection.query<SnapshotRow>(
        `${SNAPSHOT_SELECT}
         where snapshots.segment_id = $1
         order by snapshots.requested_at desc, snapshots.id`,
        [segmentId]
      );
      return result.rows.map(mapSummary);
    });
  }

  get(input: {
    readonly segmentId: string;
    readonly snapshotId: string;
    readonly sampleLimit: number;
  }): Promise<AdminSegmentAudienceSnapshot | null> {
    return this.read(async (connection) => {
      const snapshot = await readSummary(
        connection,
        input.segmentId,
        input.snapshotId
      );
      if (!snapshot) {
        return null;
      }
      const sample = snapshot.status === "ready"
        ? await connection.query<SampleRow>(
            `select users.id, users.display_name,
                    identity.username as telegram_username,
                    users.registered_at,
                    coalesce(statuses.codes, array[]::text[]) as status_codes,
                    coalesce(categories.codes, array[]::text[]) as category_codes
             from public.segment_audience_snapshot_members members
             join public.users users on users.id = members.user_id
             left join lateral (
               select username
               from public.messenger_identities
               where user_id = users.id and channel = 'telegram'
               order by first_seen_at
               limit 1
             ) identity on true
             left join lateral (
               select array_agg(status_code order by status_code) as codes
               from public.user_status_assignments
               where user_id = users.id and removed_at is null
             ) statuses on true
             left join lateral (
               select array_agg(category_code order by category_code) as codes
               from public.user_category_assignments
               where user_id = users.id and removed_at is null
             ) categories on true
             where members.snapshot_id = $1
             order by members.user_id
             limit $2`,
            [input.snapshotId, input.sampleLimit]
          )
        : { rows: [] as readonly SampleRow[] };
      return {
        ...snapshot,
        sampleUsers: sample.rows.map(mapSample)
      };
    });
  }

  request(
    input: Parameters<SegmentAudienceSnapshotRepository["request"]>[0]
  ) {
    return this.write(async (connection) => {
      await connection.query(
        "select pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`segment-audience:${input.segmentVersionId}`]
      );
      const segment = await connection.query<{ readonly id: string }>(
        "select id from public.segments where id = $1",
        [input.segmentId]
      );
      if (!segment.rows[0]) {
        return { status: "segment_not_found" as const };
      }
      const version = await connection.query<{
        readonly id: string;
        readonly status: string;
      }>(
        `select id, status
         from public.segment_versions
         where id = $1 and segment_id = $2`,
        [input.segmentVersionId, input.segmentId]
      );
      if (version.rows[0]?.status !== "published") {
        return { status: "version_not_published" as const };
      }
      const pending = await connection.query<SnapshotRow>(
        `${SNAPSHOT_SELECT}
         where snapshots.segment_version_id = $1
           and snapshots.status = 'pending'
         for update of snapshots`,
        [input.segmentVersionId]
      );
      const existing = pending.rows[0];
      if (existing) {
        return {
          status: "pending_exists" as const,
          value: mapSummary(existing)
        };
      }
      await connection.query(
        `insert into public.segment_audience_snapshots (
           id, segment_id, segment_version_id, status,
           requested_by_admin_id, request_reason, requested_at
         ) values ($1, $2, $3, 'pending', $4, $5, $6)`,
        [
          input.snapshotId,
          input.segmentId,
          input.segmentVersionId,
          input.audit.actorAdminId,
          input.audit.reason,
          input.audit.occurredAt
        ]
      );
      await appendAudit(connection, input.audit, input.snapshotId, {
        segmentId: input.segmentId,
        segmentVersionId: input.segmentVersionId,
        status: "pending"
      });
      const created = await readSummary(
        connection,
        input.segmentId,
        input.snapshotId
      );
      if (!created) {
        throw new Error("Created audience snapshot was not readable");
      }
      return { status: "created" as const, value: created };
    });
  }

  async claimPending(batchSize: number) {
    const result = await this.session.query<PendingSnapshotRow>(
      `select snapshots.id, snapshots.segment_id,
              snapshots.segment_version_id, versions.expression
       from public.segment_audience_snapshots snapshots
       join public.segment_versions versions
         on versions.id = snapshots.segment_version_id
       where snapshots.status = 'pending'
         and versions.status = 'published'
       order by snapshots.requested_at, snapshots.id
       for update of snapshots skip locked
       limit $1`,
      [batchSize]
    );
    return result.rows.map((row) => ({
      id: row.id,
      segmentId: row.segment_id,
      segmentVersionId: row.segment_version_id,
      expression: readExpression(row.expression)
    }));
  }

  async materialize(
    input: Parameters<SegmentAudienceSnapshotRepository["materialize"]>[0]
  ): Promise<string> {
    const parameters: unknown[] = [
      input.snapshot.id,
      input.capturedAt
    ];
    const predicate = buildAdminSegmentSqlExpression(
      input.snapshot.expression,
      parameters
    );
    const inserted = await this.session.query<{
      readonly total_count: string;
    }>(
      `with inserted as (
         insert into public.segment_audience_snapshot_members (
           snapshot_id, user_id, captured_at
         )
         select $1, users.id, $2
         from public.users users
         where users.is_deleted = false and (${predicate})
         on conflict (snapshot_id, user_id) do nothing
         returning user_id
       )
       select count(*)::text as total_count from inserted`,
      parameters
    );
    const totalCount = inserted.rows[0]?.total_count ?? "0";
    if (!/^(0|[1-9]\d*)$/.test(totalCount)) {
      throw new Error("Audience snapshot count is invalid");
    }
    const updated = await this.session.query(
      `update public.segment_audience_snapshots
       set status = 'ready',
           total_count = $2::bigint,
           completed_at = $3
       where id = $1 and status = 'pending'`,
      [input.snapshot.id, totalCount, input.capturedAt]
    );
    if (updated.rowCount !== 1) {
      throw new Error("Audience snapshot lock was lost");
    }
    return totalCount;
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

export function createSegmentAudienceSnapshotPersistence(
  pool: SqlConnectionPool
) {
  const session = new TransactionSession();
  return {
    repository: new PostgresSegmentAudienceSnapshotRepository(pool, session),
    unitOfWork: new PostgresUnitOfWork(pool, session),
    outboxWriter: new PostgresOutboxWriter(session)
  };
}

const SNAPSHOT_SELECT = `
  select snapshots.id, snapshots.segment_id, snapshots.segment_version_id,
         versions.version_number, snapshots.status,
         snapshots.total_count::text as total_count,
         snapshots.requested_at, snapshots.completed_at
  from public.segment_audience_snapshots snapshots
  join public.segment_versions versions
    on versions.id = snapshots.segment_version_id`;

async function readSummary(
  executor: SqlExecutor,
  segmentId: string,
  snapshotId: string
): Promise<AdminSegmentAudienceSnapshotSummary | null> {
  const result = await executor.query<SnapshotRow>(
    `${SNAPSHOT_SELECT}
     where snapshots.segment_id = $1 and snapshots.id = $2`,
    [segmentId, snapshotId]
  );
  return result.rows[0] ? mapSummary(result.rows[0]) : null;
}

function mapSummary(row: SnapshotRow): AdminSegmentAudienceSnapshotSummary {
  if (!["pending", "ready"].includes(row.status)) {
    throw new Error("Audience snapshot status is invalid");
  }
  return {
    id: row.id,
    segmentId: row.segment_id,
    segmentVersionId: row.segment_version_id,
    segmentVersionNumber: row.version_number,
    status: row.status as AdminSegmentAudienceSnapshotStatus,
    totalCount: row.total_count,
    requestedAt: asIso(row.requested_at),
    completedAt: row.completed_at ? asIso(row.completed_at) : null
  };
}

function mapSample(row: SampleRow): AdminSegmentSampleUser {
  return {
    id: row.id,
    displayName: row.display_name,
    telegramUsername: row.telegram_username,
    registeredAt: asIso(row.registered_at),
    statusCodes: row.status_codes,
    categoryCodes: row.category_codes
  };
}

function readExpression(value: unknown): AdminSegmentExpression {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Audience snapshot expression is invalid");
  }
  return parsed as AdminSegmentExpression;
}

function asIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Audience snapshot timestamp is invalid");
  }
  return date.toISOString();
}

function appendAudit(
  connection: SqlConnection,
  audit: AdminEventAuditContext,
  snapshotId: string,
  after: unknown
): Promise<unknown> {
  return connection.query(
    `insert into public.audit_log (
       id, actor_admin_id, actor_role, action, target_type, target_id,
       reason, before_masked, after_masked, request_id,
       ip_address, user_agent, created_at
     ) values (
       $1, $2, $3, 'segment.audience_snapshot_requested',
       'segment_audience_snapshot', $4,
       $5, null, $6::jsonb, $7,
       $8::inet, $9, $10
     )`,
    [
      audit.auditId,
      audit.actorAdminId,
      audit.actorRole,
      snapshotId,
      audit.reason,
      JSON.stringify(after),
      audit.requestId,
      audit.ipAddress,
      audit.userAgent,
      audit.occurredAt
    ]
  );
}
