import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminEventOfferVersionRecord } from "@ticket-platform/application";
import { createAdminEventOfferManagementPersistence } from "./admin-event-offer-management-persistence.js";
import type {
  SqlConnection,
  SqlConnectionPool,
  SqlQueryResult
} from "./postgres.js";

interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

describe("PostgreSQL administrator event offer management", () => {
  it("prepares only an exact draft version with one offer document", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.events") && !text.includes("for update")) {
        return rows([eventRow]);
      }
      if (text.includes("from public.offer_documents")) {
        return rows([documentRow]);
      }
      return affected();
    });
    const repository = createAdminEventOfferManagementPersistence(
      new FakePool(connection)
    );

    const result = await repository.prepareOfferVersion({
      eventId: EVENT_ID,
      expectedLockVersion: 3
    });

    assert.deepEqual(result, {
      status: "ready",
      offerDocumentId: OFFER_DOCUMENT_ID
    });
    assert.equal(
      connection.queries[0]?.text,
      "begin transaction isolation level repeatable read read only"
    );
    assert.equal(connection.queries.at(-1)?.text, "commit");
  });

  it("publishes a first immutable version and audits the active assignment", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.events") && text.includes("for update")) {
        return rows([eventRow]);
      }
      if (text.includes("from public.offer_documents")) {
        return rows([]);
      }
      if (text.includes("max(version_number)")) {
        return rows([{ next_version_number: 1 }]);
      }
      if (text.includes("returning lock_version")) {
        return rows([{ lock_version: 4 }]);
      }
      return affected();
    });
    const repository = createAdminEventOfferManagementPersistence(
      new FakePool(connection)
    );

    const result = await repository.publishOfferVersion(publishInput);

    assert.deepEqual(result, { status: "published", lockVersion: 4 });
    assert.equal(
      findQuery(connection, "pg_advisory_xact_lock").values[0],
      `event-sales:${EVENT_ID}`
    );
    assert.equal(
      findQuery(connection, "insert into public.offer_documents").values[0],
      OFFER_DOCUMENT_ID
    );
    const versionInsert = findQuery(
      connection,
      "insert into public.offer_versions"
    );
    assert.equal(versionInsert.values[0], OFFER_VERSION_ID);
    assert.equal(versionInsert.values[2], 1);
    assert.equal(versionInsert.values[6], version.sha256);
    const audit = findQuery(connection, "insert into public.audit_log");
    assert.equal(audit.values[3], "event.offer_version_published");
    assert.equal(audit.values[4], OFFER_VERSION_ID);
    assert.equal(connection.queries.at(-1)?.text, "commit");
  });

  it("uses the existing document and rejects ambiguous document state", async () => {
    const ambiguous = new FakeConnection((text) => {
      if (text.includes("from public.events") && text.includes("for update")) {
        return rows([eventRow]);
      }
      if (text.includes("from public.offer_documents")) {
        return rows([
          documentRow,
          { ...documentRow, id: "00000000-0000-4000-8000-000000000399" }
        ]);
      }
      return affected();
    });
    const repository = createAdminEventOfferManagementPersistence(
      new FakePool(ambiguous)
    );

    const result = await repository.publishOfferVersion(publishInput);

    assert.deepEqual(result, { status: "ambiguous_offer_document" });
    assert.equal(
      ambiguous.queries.some((query) =>
        query.text.includes("insert into public.offer_versions")
      ),
      false
    );
  });

  it("deactivates without deleting and rolls back when audit persistence fails", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("insert into public.audit_log")) {
        throw new Error("audit unavailable");
      }
      if (text.includes("join public.offer_versions versions")) {
        return rows([activeOfferRow]);
      }
      if (text.includes("from public.events") && text.includes("for update")) {
        return rows([eventRow]);
      }
      if (text.includes("returning lock_version")) {
        return rows([{ lock_version: 4 }]);
      }
      return affected();
    });
    const repository = createAdminEventOfferManagementPersistence(
      new FakePool(connection)
    );

    await assert.rejects(
      repository.deactivateOffer({
        eventId: EVENT_ID,
        expectedLockVersion: 3,
        audit
      }),
      /audit unavailable/
    );
    assert.equal(
      findQuery(connection, "update public.offer_versions").values[0],
      OFFER_VERSION_ID
    );
    assert.equal(
      connection.queries.some((query) => /\bdelete\b/i.test(query.text)),
      false
    );
    assert.equal(connection.queries.at(-1)?.text, "rollback");
  });
});

class FakePool implements SqlConnectionPool {
  constructor(private readonly connection: SqlConnection) {}

  async connect(): Promise<SqlConnection> {
    return this.connection;
  }
}

class FakeConnection implements SqlConnection {
  readonly queries: RecordedQuery[] = [];

  constructor(
    private readonly respond: (
      text: string,
      values: readonly unknown[]
    ) => SqlQueryResult<unknown>
  ) {}

  async query<TRow>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<SqlQueryResult<TRow>> {
    this.queries.push({ text, values });
    return this.respond(text, values) as SqlQueryResult<TRow>;
  }

  release(): void {}
}

function affected(): SqlQueryResult<never> {
  return { rows: [], rowCount: 1 };
}

function rows<TRow>(resultRows: readonly TRow[]): SqlQueryResult<TRow> {
  return { rows: resultRows, rowCount: resultRows.length };
}

function findQuery(connection: FakeConnection, fragment: string): RecordedQuery {
  const query = connection.queries.find((candidate) =>
    candidate.text.includes(fragment)
  );
  assert.ok(query, `Expected query containing: ${fragment}`);
  return query;
}

const EVENT_ID = "00000000-0000-4000-8000-000000000101";
const OFFER_DOCUMENT_ID = "00000000-0000-4000-8000-000000000301";
const OFFER_VERSION_ID = "00000000-0000-4000-8000-000000000302";
const at = new Date("2026-07-26T13:00:00.000Z");
const eventRow = {
  id: EVENT_ID,
  status: "draft",
  lock_version: 3
};
const documentRow = {
  id: OFFER_DOCUMENT_ID,
  event_id: EVENT_ID,
  title: "Договор оферты",
  source_type: "google_docs",
  source_url: "https://docs.google.com/document/d/test",
  status: "published"
};
const version: AdminEventOfferVersionRecord = {
  documentTitle: "Договор оферты",
  sourceType: "google_docs",
  sourceUrl: "https://docs.google.com/document/d/test",
  publicUrl:
    "https://project.supabase.co/storage/v1/object/public/offers/version.html",
  storagePath: `offers/${EVENT_ID}/${OFFER_VERSION_ID}.html`,
  contentType: "text/html",
  sha256: "a".repeat(64),
  sourceRevisionId: "revision-7",
  displayTextSnapshot: "Согласованный текст оферты"
};
const audit = {
  auditId: "00000000-0000-4000-8000-000000000901",
  actorAdminId: "00000000-0000-4000-8000-000000000010",
  actorRole: "content_manager",
  reason: "Опубликовать редакцию",
  requestId: "request-offer-1",
  ipAddress: "127.0.0.1",
  userAgent: "admin-web-test",
  occurredAt: at
};
const publishInput = {
  eventId: EVENT_ID,
  expectedLockVersion: 3,
  offerDocumentId: OFFER_DOCUMENT_ID,
  offerVersionId: OFFER_VERSION_ID,
  version,
  audit
};
const activeOfferRow = {
  id: OFFER_VERSION_ID,
  offer_document_id: OFFER_DOCUMENT_ID,
  version_number: 2,
  public_url: version.publicUrl,
  storage_path: version.storagePath,
  content_type: version.contentType,
  sha256: version.sha256,
  source_revision_id: version.sourceRevisionId,
  display_text_snapshot: version.displayTextSnapshot,
  published_at: at
};
