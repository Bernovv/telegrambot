import type {
  AdminEventAuditContext,
  AdminEventOfferManagementRepository,
  AdminEventOfferVersionRecord
} from "@ticket-platform/application";
import type { SqlConnection, SqlConnectionPool } from "./postgres.js";

interface EventGateRow {
  readonly id: string;
  readonly status: string;
  readonly lock_version: number;
}

interface OfferDocumentRow {
  readonly id: string;
  readonly event_id: string | null;
  readonly title: string;
  readonly source_type: string;
  readonly source_url: string | null;
  readonly status: string;
}

interface ActiveOfferRow {
  readonly id: string;
  readonly offer_document_id: string;
  readonly version_number: number;
  readonly public_url: string;
  readonly storage_path: string;
  readonly content_type: string;
  readonly sha256: string;
  readonly source_revision_id: string | null;
  readonly display_text_snapshot: string;
  readonly published_at: Date | string;
}

type EventGate =
  | { readonly status: "ready" }
  | {
      readonly status:
        | "event_not_found"
        | "not_draft"
        | "version_conflict";
    };

export class PostgresAdminEventOfferManagementRepository
implements AdminEventOfferManagementRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  prepareOfferVersion(
    input: Parameters<
      AdminEventOfferManagementRepository["prepareOfferVersion"]
    >[0]
  ) {
    return this.read(async (connection) => {
      const event = await connection.query<EventGateRow>(
        `select id, status, lock_version
         from public.events
         where id = $1`,
        [input.eventId]
      );
      const row = event.rows[0];
      if (!row) {
        return { status: "event_not_found" as const };
      }
      if (row.status !== "draft") {
        return { status: "not_draft" as const };
      }
      if (row.lock_version !== input.expectedLockVersion) {
        return { status: "version_conflict" as const };
      }
      const documents = await listOfferDocuments(connection, input.eventId);
      if (documents.length > 1) {
        return { status: "ambiguous_offer_document" as const };
      }
      return {
        status: "ready" as const,
        offerDocumentId: documents[0]?.id ?? null
      };
    });
  }

  publishOfferVersion(
    input: Parameters<
      AdminEventOfferManagementRepository["publishOfferVersion"]
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
      const documents = await listOfferDocuments(
        connection,
        input.eventId,
        true
      );
      if (documents.length > 1) {
        return { status: "ambiguous_offer_document" as const };
      }
      const existingDocument = documents[0];
      const offerDocumentId = existingDocument?.id ?? input.offerDocumentId;
      if (
        existingDocument
        && existingDocument.id !== input.offerDocumentId
      ) {
        return { status: "version_conflict" as const };
      }
      if (existingDocument) {
        await connection.query(
          `update public.offer_documents
           set title = $2,
               source_type = $3,
               source_url = $4,
               status = 'published',
               updated_at = $5
           where id = $1 and event_id = $6`,
          [
            offerDocumentId,
            input.version.documentTitle,
            input.version.sourceType,
            input.version.sourceUrl,
            input.audit.occurredAt,
            input.eventId
          ]
        );
      } else {
        await connection.query(
          `insert into public.offer_documents (
             id, event_id, title, source_type, source_url, status,
             created_at, updated_at
           ) values ($1, $2, $3, $4, $5, 'published', $6, $6)`,
          [
            offerDocumentId,
            input.eventId,
            input.version.documentTitle,
            input.version.sourceType,
            input.version.sourceUrl,
            input.audit.occurredAt
          ]
        );
      }
      const versionNumber = await nextVersionNumber(
        connection,
        offerDocumentId
      );
      await connection.query(
        `update public.offer_versions
         set is_active = false
         where offer_document_id = $1 and is_active`,
        [offerDocumentId]
      );
      await connection.query(
        `insert into public.offer_versions (
           id, offer_document_id, version_number, public_url, storage_path,
           content_type, sha256, published_at, published_by_admin_id,
           is_active, source_revision_id, display_text_snapshot, created_at
         ) values (
           $1, $2, $3, $4, $5,
           $6, $7, $8, $9,
           true, $10, $11, $8
         )`,
        [
          input.offerVersionId,
          offerDocumentId,
          versionNumber,
          input.version.publicUrl,
          input.version.storagePath,
          input.version.contentType,
          input.version.sha256,
          input.audit.occurredAt,
          input.audit.actorAdminId,
          input.version.sourceRevisionId,
          input.version.displayTextSnapshot
        ]
      );
      const lockVersion = await setActiveOffer(
        connection,
        input.eventId,
        input.offerVersionId,
        input.audit.occurredAt
      );
      await appendOfferAudit(
        connection,
        input.audit,
        "event.offer_version_published",
        input.offerVersionId,
        null,
        offerSnapshot(
          input.eventId,
          offerDocumentId,
          input.offerVersionId,
          versionNumber,
          input.version,
          true,
          lockVersion
        )
      );
      return { status: "published" as const, lockVersion };
    });
  }

  deactivateOffer(
    input: Parameters<
      AdminEventOfferManagementRepository["deactivateOffer"]
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
      const current = await connection.query<ActiveOfferRow>(
        `select versions.id, versions.offer_document_id,
                versions.version_number, versions.public_url,
                versions.storage_path, versions.content_type, versions.sha256,
                versions.source_revision_id,
                versions.display_text_snapshot, versions.published_at
         from public.events events
         join public.offer_versions versions
           on versions.id = events.active_offer_version_id
         join public.offer_documents documents
           on documents.id = versions.offer_document_id
          and documents.event_id = events.id
         where events.id = $1 and versions.is_active
         for update of versions`,
        [input.eventId]
      );
      const active = current.rows[0];
      if (!active) {
        return { status: "offer_not_active" as const };
      }
      await connection.query(
        `update public.offer_versions
         set is_active = false
         where id = $1 and is_active`,
        [active.id]
      );
      const lockVersion = await setActiveOffer(
        connection,
        input.eventId,
        null,
        input.audit.occurredAt
      );
      const before = activeOfferSnapshot(input.eventId, active, true);
      await appendOfferAudit(
        connection,
        input.audit,
        "event.offer_version_deactivated",
        active.id,
        { ...before, eventLockVersion: input.expectedLockVersion },
        { ...before, isActive: false, eventLockVersion: lockVersion }
      );
      return {
        status: "deactivated" as const,
        offerVersionId: active.id,
        lockVersion
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

export function createAdminEventOfferManagementPersistence(
  pool: SqlConnectionPool
): AdminEventOfferManagementRepository {
  return new PostgresAdminEventOfferManagementRepository(pool);
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

async function listOfferDocuments(
  connection: SqlConnection,
  eventId: string,
  lock = false
): Promise<readonly OfferDocumentRow[]> {
  const result = await connection.query<OfferDocumentRow>(
    `select id, event_id, title, source_type, source_url, status
     from public.offer_documents
     where event_id = $1 and status <> 'archived'
     order by created_at, id
     ${lock ? "for update" : ""}`,
    [eventId]
  );
  return result.rows;
}

async function nextVersionNumber(
  connection: SqlConnection,
  offerDocumentId: string
): Promise<number> {
  const result = await connection.query<{
    readonly next_version_number: number;
  }>(
    `select coalesce(max(version_number), 0) + 1 as next_version_number
     from public.offer_versions
     where offer_document_id = $1`,
    [offerDocumentId]
  );
  const next = result.rows[0]?.next_version_number;
  if (!Number.isSafeInteger(next) || !next || next < 1) {
    throw new Error("Administrator offer version sequence is invalid");
  }
  return next;
}

async function setActiveOffer(
  connection: SqlConnection,
  eventId: string,
  offerVersionId: string | null,
  occurredAt: Date
): Promise<number> {
  const result = await connection.query<{ readonly lock_version: number }>(
    `update public.events
     set active_offer_version_id = $2,
         lock_version = lock_version + 1,
         updated_at = $3
     where id = $1
     returning lock_version`,
    [eventId, offerVersionId, occurredAt]
  );
  const lockVersion = result.rows[0]?.lock_version;
  if (!lockVersion) {
    throw new Error("Administrator offer update lost its locked event");
  }
  return lockVersion;
}

async function appendOfferAudit(
  connection: SqlConnection,
  audit: AdminEventAuditContext,
  action: string,
  offerVersionId: string,
  before: Readonly<Record<string, unknown>> | null,
  after: Readonly<Record<string, unknown>>
): Promise<void> {
  await connection.query(
    `insert into public.audit_log (
       id, actor_admin_id, actor_role, action, target_type, target_id,
       reason, before_masked, after_masked, request_id,
       ip_address, user_agent, created_at
     ) values (
       $1, $2, $3, $4, 'offer_version', $5,
       $6, $7::jsonb, $8::jsonb, $9,
       $10, $11, $12
     )`,
    [
      audit.auditId,
      audit.actorAdminId,
      audit.actorRole,
      action,
      offerVersionId,
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

function offerSnapshot(
  eventId: string,
  offerDocumentId: string,
  offerVersionId: string,
  versionNumber: number,
  version: AdminEventOfferVersionRecord,
  isActive: boolean,
  eventLockVersion: number
): Readonly<Record<string, unknown>> {
  return {
    eventId,
    offerDocumentId,
    offerVersionId,
    documentTitle: version.documentTitle,
    sourceType: version.sourceType,
    sourceUrl: version.sourceUrl,
    versionNumber,
    publicUrl: version.publicUrl,
    storagePath: version.storagePath,
    contentType: version.contentType,
    sha256: version.sha256,
    sourceRevisionId: version.sourceRevisionId,
    isActive,
    eventLockVersion
  };
}

function activeOfferSnapshot(
  eventId: string,
  version: ActiveOfferRow,
  isActive: boolean
): Readonly<Record<string, unknown>> {
  return {
    eventId,
    offerDocumentId: version.offer_document_id,
    offerVersionId: version.id,
    versionNumber: version.version_number,
    publicUrl: version.public_url,
    storagePath: version.storage_path,
    contentType: version.content_type,
    sha256: version.sha256,
    sourceRevisionId: version.source_revision_id,
    publishedAt:
      version.published_at instanceof Date
        ? version.published_at.toISOString()
        : version.published_at,
    isActive
  };
}
