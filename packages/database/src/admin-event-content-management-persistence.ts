import type {
  AdminEventAuditContext,
  AdminEventContentBlockRecord,
  AdminEventContentManagementRepository
} from "@ticket-platform/application";
import type {
  SqlConnection,
  SqlConnectionPool
} from "./postgres.js";

interface EventGateRow {
  readonly id: string;
  readonly status: string;
  readonly lock_version: number;
}

interface ContentBlockRow {
  readonly id: string;
  readonly event_id: string;
  readonly block_type: string;
  readonly title: string | null;
  readonly content_schema_version: number;
  readonly content: unknown;
  readonly sort_order: number;
  readonly is_visible: boolean;
}

type EventGate =
  | { readonly status: "ready" }
  | {
      readonly status:
        | "event_not_found"
        | "not_draft"
        | "version_conflict";
    };

export class PostgresAdminEventContentManagementRepository
implements AdminEventContentManagementRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  createContentBlock(
    input: Parameters<
      AdminEventContentManagementRepository["createContentBlock"]
    >[0]
  ) {
    return this.write(async (connection) => {
      const gate = await lockDraftEvent(
        connection,
        input.eventId,
        input.expectedLockVersion
      );
      if (gate.status !== "ready") {
        return gate;
      }
      if (
        await sortOrderExists(
          connection,
          input.eventId,
          input.contentBlock.sortOrder,
          null
        )
      ) {
        return { status: "sort_order_conflict" as const };
      }
      await connection.query(
        `insert into public.event_content_blocks (
           id, event_id, block_type, title, content_schema_version,
           content, sort_order, is_visible, created_at, updated_at
         ) values (
           $1, $2, $3, $4, $5,
           $6::jsonb, $7, $8, $9, $9
         )`,
        contentBlockValues(
          input.contentBlockId,
          input.eventId,
          input.contentBlock,
          input.audit.occurredAt
        )
      );
      const lockVersion = await bumpEventVersion(
        connection,
        input.eventId,
        input.audit.occurredAt
      );
      await appendContentAudit(
        connection,
        input.audit,
        "event.content_block_created",
        input.contentBlockId,
        null,
        contentBlockSnapshot(
          input.eventId,
          input.contentBlock,
          lockVersion
        )
      );
      return { status: "created" as const, lockVersion };
    });
  }

  updateContentBlock(
    input: Parameters<
      AdminEventContentManagementRepository["updateContentBlock"]
    >[0]
  ) {
    return this.write(async (connection) => {
      const gate = await lockDraftEvent(
        connection,
        input.eventId,
        input.expectedLockVersion
      );
      if (gate.status !== "ready") {
        return gate;
      }
      const existing = await connection.query<ContentBlockRow>(
        `${CONTENT_BLOCK_SELECT}
         where id = $1 and event_id = $2
         for update`,
        [input.contentBlockId, input.eventId]
      );
      const row = existing.rows[0];
      if (!row) {
        return { status: "content_block_not_found" as const };
      }
      if (
        await sortOrderExists(
          connection,
          input.eventId,
          input.contentBlock.sortOrder,
          input.contentBlockId
        )
      ) {
        return { status: "sort_order_conflict" as const };
      }
      await connection.query(
        `update public.event_content_blocks
         set block_type = $3,
             title = $4,
             content_schema_version = $5,
             content = $6::jsonb,
             sort_order = $7,
             is_visible = $8,
             updated_at = $9
         where id = $1 and event_id = $2`,
        contentBlockValues(
          input.contentBlockId,
          input.eventId,
          input.contentBlock,
          input.audit.occurredAt
        )
      );
      const lockVersion = await bumpEventVersion(
        connection,
        input.eventId,
        input.audit.occurredAt
      );
      await appendContentAudit(
        connection,
        input.audit,
        "event.content_block_updated",
        input.contentBlockId,
        contentBlockRowSnapshot(row, input.expectedLockVersion),
        contentBlockSnapshot(
          input.eventId,
          input.contentBlock,
          lockVersion
        )
      );
      return { status: "updated" as const, lockVersion };
    });
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

export function createAdminEventContentManagementPersistence(
  pool: SqlConnectionPool
): AdminEventContentManagementRepository {
  return new PostgresAdminEventContentManagementRepository(pool);
}

async function lockDraftEvent(
  connection: SqlConnection,
  eventId: string,
  expectedLockVersion: number
): Promise<EventGate> {
  await connection.query(
    "select pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`event-sales:${eventId}`]
  );
  const event = await connection.query<EventGateRow>(
    `select id, status, lock_version
     from public.events
     where id = $1
     for update`,
    [eventId]
  );
  const row = event.rows[0];
  if (!row) {
    return { status: "event_not_found" };
  }
  if (row.status !== "draft") {
    return { status: "not_draft" };
  }
  if (row.lock_version !== expectedLockVersion) {
    return { status: "version_conflict" };
  }
  return { status: "ready" };
}

async function sortOrderExists(
  connection: SqlConnection,
  eventId: string,
  sortOrder: number,
  exceptContentBlockId: string | null
): Promise<boolean> {
  const result = await connection.query<{ readonly exists: boolean }>(
    `select exists(
       select 1 from public.event_content_blocks
       where event_id = $1
         and sort_order = $2
         and ($3::uuid is null or id <> $3::uuid)
     ) as exists`,
    [eventId, sortOrder, exceptContentBlockId]
  );
  return result.rows[0]?.exists === true;
}

async function bumpEventVersion(
  connection: SqlConnection,
  eventId: string,
  occurredAt: Date
): Promise<number> {
  const result = await connection.query<{ readonly lock_version: number }>(
    `update public.events
     set lock_version = lock_version + 1,
         updated_at = $2
     where id = $1
     returning lock_version`,
    [eventId, occurredAt]
  );
  const lockVersion = result.rows[0]?.lock_version;
  if (!lockVersion) {
    throw new Error("Administrator event content update lost its locked event");
  }
  return lockVersion;
}

async function appendContentAudit(
  connection: SqlConnection,
  audit: AdminEventAuditContext,
  action: string,
  contentBlockId: string,
  before: Readonly<Record<string, unknown>> | null,
  after: Readonly<Record<string, unknown>>
): Promise<void> {
  await connection.query(
    `insert into public.audit_log (
       id, actor_admin_id, actor_role, action, target_type, target_id,
       reason, before_masked, after_masked, request_id,
       ip_address, user_agent, created_at
     ) values (
       $1, $2, $3, $4, 'event_content_block', $5,
       $6, $7::jsonb, $8::jsonb, $9,
       $10, $11, $12
     )`,
    [
      audit.auditId,
      audit.actorAdminId,
      audit.actorRole,
      action,
      contentBlockId,
      audit.reason,
      before === null ? null : JSON.stringify(before),
      JSON.stringify(after),
      audit.requestId,
      audit.ipAddress,
      audit.userAgent,
      audit.occurredAt
    ]
  );
}

function contentBlockValues(
  contentBlockId: string,
  eventId: string,
  contentBlock: AdminEventContentBlockRecord,
  occurredAt: Date
): readonly unknown[] {
  return [
    contentBlockId,
    eventId,
    contentBlock.blockType,
    contentBlock.title,
    contentBlock.contentSchemaVersion,
    JSON.stringify(contentBlock.content),
    contentBlock.sortOrder,
    contentBlock.isVisible,
    occurredAt
  ];
}

function contentBlockSnapshot(
  eventId: string,
  contentBlock: AdminEventContentBlockRecord,
  eventLockVersion: number
): Readonly<Record<string, unknown>> {
  return {
    eventId,
    blockType: contentBlock.blockType,
    title: contentBlock.title,
    contentSchemaVersion: contentBlock.contentSchemaVersion,
    content: contentBlock.content,
    sortOrder: contentBlock.sortOrder,
    isVisible: contentBlock.isVisible,
    eventLockVersion
  };
}

function contentBlockRowSnapshot(
  row: ContentBlockRow,
  eventLockVersion: number
): Readonly<Record<string, unknown>> {
  return {
    eventId: row.event_id,
    blockType: row.block_type,
    title: row.title,
    contentSchemaVersion: row.content_schema_version,
    content: readJson(row.content),
    sortOrder: row.sort_order,
    isVisible: row.is_visible,
    eventLockVersion
  };
}

function readJson(value: unknown): unknown {
  return typeof value === "string" ? JSON.parse(value) as unknown : value;
}

const CONTENT_BLOCK_SELECT = `
  select id, event_id, block_type, title, content_schema_version,
         content, sort_order, is_visible
  from public.event_content_blocks`;
