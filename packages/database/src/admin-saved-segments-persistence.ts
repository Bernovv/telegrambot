import type {
  AdminEventAuditContext,
  AdminSavedSegmentRepository
} from "@ticket-platform/application";
import type {
  AdminSavedSegment,
  AdminSavedSegmentSummary,
  AdminSegmentExpression,
  AdminSegmentVersion,
  AdminSegmentVersionStatus
} from "@ticket-platform/contracts";
import type { SqlConnection, SqlConnectionPool } from "./postgres.js";

interface SegmentRow {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly lock_version: number;
  readonly published_version_id: string | null;
  readonly updated_at: Date;
}

interface SegmentListRow extends SegmentRow {
  readonly draft_version_number: number | null;
  readonly published_version_number: number | null;
}

interface SegmentVersionRow {
  readonly id: string;
  readonly segment_id: string;
  readonly version_number: number;
  readonly status: string;
  readonly schema_version: number;
  readonly name: string;
  readonly description: string | null;
  readonly expression: unknown;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly published_at: Date | null;
}

export class PostgresAdminSavedSegmentRepository
implements AdminSavedSegmentRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  list(): Promise<readonly AdminSavedSegmentSummary[]> {
    return this.read(async (connection) => {
      const result = await connection.query<SegmentListRow>(
        `select segments.id, segments.name, segments.description,
                segments.lock_version, segments.published_version_id,
                segments.updated_at,
                drafts.version_number as draft_version_number,
                published.version_number as published_version_number
         from public.segments segments
         left join public.segment_versions drafts
           on drafts.segment_id = segments.id and drafts.status = 'draft'
         left join public.segment_versions published
           on published.id = segments.published_version_id
         order by segments.updated_at desc, segments.id`
      );
      return result.rows.map(mapSummary);
    });
  }

  get(segmentId: string): Promise<AdminSavedSegment | null> {
    return this.read((connection) => readSegment(connection, segmentId));
  }

  findUnavailableClassificationCodes(
    input: Parameters<
      AdminSavedSegmentRepository["findUnavailableClassificationCodes"]
    >[0]
  ) {
    return this.read((connection) =>
      findUnavailableClassificationCodes(connection, input)
    );
  }

  create(input: Parameters<AdminSavedSegmentRepository["create"]>[0]) {
    return this.write(async (connection) => {
      await connection.query(
        `insert into public.segments (
           id, name, description, lock_version, created_by_admin_id,
           created_at, updated_at
         ) values ($1, $2, $3, 1, $4, $5, $5)`,
        [
          input.segmentId,
          input.name,
          input.description,
          input.audit.actorAdminId,
          input.audit.occurredAt
        ]
      );
      await connection.query(
        `insert into public.segment_versions (
           id, segment_id, version_number, status, schema_version,
           name, description, expression, created_by_admin_id,
           created_at, updated_at
         ) values (
           $1, $2, 1, 'draft', 1,
           $3, $4, $5::jsonb, $6,
           $7, $7
         )`,
        [
          input.versionId,
          input.segmentId,
          input.name,
          input.description,
          JSON.stringify(input.expression),
          input.audit.actorAdminId,
          input.audit.occurredAt
        ]
      );
      await appendAudit(
        connection,
        input.audit,
        "segment.draft_created",
        input.segmentId,
        null,
        {
          segmentId: input.segmentId,
          segmentVersionId: input.versionId,
          versionNumber: 1,
          lockVersion: 1
        }
      );
      return requireSegment(
        await readSegment(connection, input.segmentId),
        "Created segment was not readable"
      );
    });
  }

  saveDraft(
    input: Parameters<AdminSavedSegmentRepository["saveDraft"]>[0]
  ) {
    return this.write(async (connection) => {
      const segment = await lockSegment(connection, input.segmentId);
      if (!segment) {
        return { status: "not_found" as const };
      }
      if (segment.lock_version !== input.expectedLockVersion) {
        return { status: "version_conflict" as const };
      }
      const draftResult = await connection.query<SegmentVersionRow>(
        `${VERSION_SELECT}
         where segment_id = $1 and status = 'draft'
         for update`,
        [input.segmentId]
      );
      const draft = draftResult.rows[0];
      let versionId: string;
      let versionNumber: number;
      if (draft) {
        versionId = draft.id;
        versionNumber = draft.version_number;
        await connection.query(
          `update public.segment_versions
           set name = $2,
               description = $3,
               expression = $4::jsonb,
               updated_at = $5
           where id = $1 and status = 'draft'`,
          [
            draft.id,
            input.name,
            input.description,
            JSON.stringify(input.expression),
            input.audit.occurredAt
          ]
        );
      } else {
        versionId = input.proposedVersionId;
        versionNumber = await nextVersionNumber(
          connection,
          input.segmentId
        );
        await connection.query(
          `insert into public.segment_versions (
             id, segment_id, version_number, status, schema_version,
             name, description, expression, created_by_admin_id,
             created_at, updated_at
           ) values (
             $1, $2, $3, 'draft', 1,
             $4, $5, $6::jsonb, $7,
             $8, $8
           )`,
          [
            versionId,
            input.segmentId,
            versionNumber,
            input.name,
            input.description,
            JSON.stringify(input.expression),
            input.audit.actorAdminId,
            input.audit.occurredAt
          ]
        );
      }
      const lockVersion = await updateSegment(
        connection,
        input.segmentId,
        input.name,
        input.description,
        input.audit.occurredAt
      );
      await appendAudit(
        connection,
        input.audit,
        draft ? "segment.draft_updated" : "segment.draft_created",
        input.segmentId,
        draft
          ? {
              name: draft.name,
              description: draft.description,
              versionNumber: draft.version_number,
              lockVersion: segment.lock_version
            }
          : null,
        {
          name: input.name,
          description: input.description,
          segmentVersionId: versionId,
          versionNumber,
          lockVersion
        }
      );
      return {
        status: "saved" as const,
        value: requireSegment(
          await readSegment(connection, input.segmentId),
          "Saved segment was not readable"
        )
      };
    });
  }

  publishDraft(
    input: Parameters<AdminSavedSegmentRepository["publishDraft"]>[0]
  ) {
    return this.write(async (connection) => {
      const segment = await lockSegment(connection, input.segmentId);
      if (!segment) {
        return { status: "not_found" as const };
      }
      if (segment.lock_version !== input.expectedLockVersion) {
        return { status: "version_conflict" as const };
      }
      const draftResult = await connection.query<SegmentVersionRow>(
        `${VERSION_SELECT}
         where segment_id = $1 and status = 'draft'
         for update`,
        [input.segmentId]
      );
      const draft = draftResult.rows[0];
      if (!draft) {
        return { status: "draft_not_found" as const };
      }
      const unavailable = await findUnavailableClassificationCodes(
        connection,
        {
          statusCodes: input.statusCodes,
          categoryCodes: input.categoryCodes
        }
      );
      if (
        unavailable.statusCodes.length > 0
        || unavailable.categoryCodes.length > 0
      ) {
        return {
          status: "classification_unavailable" as const,
          ...unavailable
        };
      }
      await connection.query(
        `update public.segment_versions
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
        `update public.segments
         set published_version_id = $2,
             lock_version = lock_version + 1,
             updated_at = $3
         where id = $1
         returning lock_version`,
        [
          input.segmentId,
          draft.id,
          input.audit.occurredAt
        ]
      );
      const lockVersion = updated.rows[0]?.lock_version;
      if (!lockVersion) {
        throw new Error("Segment publication lost its locked aggregate");
      }
      await appendAudit(
        connection,
        input.audit,
        "segment.version_published",
        input.segmentId,
        {
          publishedVersionId: segment.published_version_id,
          lockVersion: segment.lock_version
        },
        {
          publishedVersionId: draft.id,
          versionNumber: draft.version_number,
          lockVersion
        }
      );
      return {
        status: "published" as const,
        value: requireSegment(
          await readSegment(connection, input.segmentId),
          "Published segment was not readable"
        )
      };
    });
  }

  private async read<TResult>(
    work: (connection: SqlConnection) => Promise<TResult>
  ): Promise<TResult> {
    const connection = await this.pool.connect();
    try {
      await connection.query("begin transaction isolation level repeatable read read only");
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

export function createAdminSavedSegmentPersistence(
  pool: SqlConnectionPool
): AdminSavedSegmentRepository {
  return new PostgresAdminSavedSegmentRepository(pool);
}

const SEGMENT_SELECT = `
  select id, name, description, lock_version, published_version_id, updated_at
  from public.segments`;

const VERSION_SELECT = `
  select id, segment_id, version_number, status, schema_version,
         name, description, expression, created_at, updated_at, published_at
  from public.segment_versions`;

async function lockSegment(
  connection: SqlConnection,
  segmentId: string
): Promise<SegmentRow | undefined> {
  await connection.query(
    "select pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`segment:${segmentId}`]
  );
  const result = await connection.query<SegmentRow>(
    `${SEGMENT_SELECT} where id = $1 for update`,
    [segmentId]
  );
  return result.rows[0];
}

async function readSegment(
  connection: SqlConnection,
  segmentId: string
): Promise<AdminSavedSegment | null> {
  const segmentResult = await connection.query<SegmentRow>(
    `${SEGMENT_SELECT} where id = $1`,
    [segmentId]
  );
  const segment = segmentResult.rows[0];
  if (!segment) {
    return null;
  }
  const versions = await connection.query<SegmentVersionRow>(
    `${VERSION_SELECT}
     where segment_id = $1
       and (status = 'draft' or id = $2)
     order by version_number desc`,
    [segmentId, segment.published_version_id]
  );
  const draft = versions.rows.find((row) => row.status === "draft");
  const published = versions.rows.find(
    (row) => row.id === segment.published_version_id
  );
  return {
    id: segment.id,
    name: segment.name,
    description: segment.description,
    lockVersion: segment.lock_version,
    draft: draft ? mapVersion(draft) : null,
    published: published ? mapVersion(published) : null,
    updatedAt: toIso(segment.updated_at)
  };
}

function mapSummary(row: SegmentListRow): AdminSavedSegmentSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    lockVersion: row.lock_version,
    draftVersionNumber: row.draft_version_number,
    publishedVersionNumber: row.published_version_number,
    updatedAt: toIso(row.updated_at)
  };
}

function mapVersion(row: SegmentVersionRow): AdminSegmentVersion {
  if (
    row.schema_version !== 1
    || !["draft", "published"].includes(row.status)
  ) {
    throw new Error("Segment version metadata is invalid");
  }
  return {
    id: row.id,
    versionNumber: row.version_number,
    status: row.status as AdminSegmentVersionStatus,
    schemaVersion: 1,
    name: row.name,
    description: row.description,
    expression: readExpression(row.expression),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    publishedAt: row.published_at ? toIso(row.published_at) : null
  };
}

function readExpression(value: unknown): AdminSegmentExpression {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Segment expression is invalid");
  }
  return parsed as AdminSegmentExpression;
}

function toIso(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error("Segment timestamp is invalid");
  }
  return value.toISOString();
}

async function nextVersionNumber(
  connection: SqlConnection,
  segmentId: string
): Promise<number> {
  const result = await connection.query<{
    readonly next_version_number: number;
  }>(
    `select coalesce(max(version_number), 0) + 1 as next_version_number
     from public.segment_versions
     where segment_id = $1`,
    [segmentId]
  );
  const value = result.rows[0]?.next_version_number;
  if (!Number.isSafeInteger(value) || !value || value < 1) {
    throw new Error("Segment version sequence is invalid");
  }
  return value;
}

async function updateSegment(
  connection: SqlConnection,
  segmentId: string,
  name: string,
  description: string | null,
  occurredAt: Date
): Promise<number> {
  const result = await connection.query<{ readonly lock_version: number }>(
    `update public.segments
     set name = $2,
         description = $3,
         lock_version = lock_version + 1,
         updated_at = $4
     where id = $1
     returning lock_version`,
    [segmentId, name, description, occurredAt]
  );
  const value = result.rows[0]?.lock_version;
  if (!value) {
    throw new Error("Segment draft update lost its locked aggregate");
  }
  return value;
}

async function findUnavailableClassificationCodes(
  connection: SqlConnection,
  input: {
    readonly statusCodes: readonly string[];
    readonly categoryCodes: readonly string[];
  }
): Promise<{
  readonly statusCodes: readonly string[];
  readonly categoryCodes: readonly string[];
}> {
  const statuses = input.statusCodes.length === 0
    ? { rows: [] as readonly { readonly code: string }[] }
    : await connection.query<{ readonly code: string }>(
        `select code
         from public.user_statuses
         where code = any($1::text[]) and is_active = true`,
        [input.statusCodes]
      );
  const categories = input.categoryCodes.length === 0
    ? { rows: [] as readonly { readonly code: string }[] }
    : await connection.query<{ readonly code: string }>(
        `select code
         from public.user_categories
         where code = any($1::text[]) and is_active = true`,
        [input.categoryCodes]
      );
  const availableStatuses = new Set(statuses.rows.map((row) => row.code));
  const availableCategories = new Set(categories.rows.map((row) => row.code));
  return {
    statusCodes: input.statusCodes.filter(
      (code) => !availableStatuses.has(code)
    ),
    categoryCodes: input.categoryCodes.filter(
      (code) => !availableCategories.has(code)
    )
  };
}

function appendAudit(
  connection: SqlConnection,
  audit: AdminEventAuditContext,
  action: string,
  segmentId: string,
  before: unknown,
  after: unknown
): Promise<unknown> {
  return connection.query(
    `insert into public.audit_log (
       id, actor_admin_id, actor_role, action, target_type, target_id,
       reason, before_masked, after_masked, request_id,
       ip_address, user_agent, created_at
     ) values (
       $1, $2, $3, $4, 'segment', $5,
       $6, $7::jsonb, $8::jsonb, $9,
       $10::inet, $11, $12
     )`,
    [
      audit.auditId,
      audit.actorAdminId,
      audit.actorRole,
      action,
      segmentId,
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

function requireSegment(
  value: AdminSavedSegment | null,
  message: string
): AdminSavedSegment {
  if (!value) {
    throw new Error(message);
  }
  return value;
}
