import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  AdminEventAuditContext,
  AdminEventContentBlockRecord
} from "@ticket-platform/application";
import { createAdminEventContentManagementPersistence } from "./admin-event-content-management-persistence.js";
import type {
  SqlConnection,
  SqlConnectionPool,
  SqlQueryResult
} from "./postgres.js";

interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

describe("PostgreSQL administrator event content management", () => {
  it("creates a content block under the event sales lock and audits it", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.events") && text.includes("for update")) {
        return rows([eventGateRow]);
      }
      if (text.includes("select exists(")) {
        return rows([{ exists: false }]);
      }
      if (text.includes("update public.events")) {
        return rows([{ lock_version: 4 }]);
      }
      return affected();
    });
    const repository = createAdminEventContentManagementPersistence(
      new FakePool(connection)
    );

    const result = await repository.createContentBlock({
      eventId: EVENT_ID,
      contentBlockId: CONTENT_BLOCK_ID,
      expectedLockVersion: 3,
      contentBlock,
      audit
    });

    assert.deepEqual(result, { status: "created", lockVersion: 4 });
    assert.equal(
      findQuery(connection, "pg_advisory_xact_lock").values[0],
      `event-sales:${EVENT_ID}`
    );
    const insert = findQuery(connection, "insert into public.event_content_blocks");
    assert.equal(insert.values[5], JSON.stringify(contentBlock.content));
    const auditInsert = findQuery(connection, "insert into public.audit_log");
    assert.equal(auditInsert.values[3], "event.content_block_created");
    assert.equal(connection.queries.at(-1)?.text, "commit");
  });

  it("updates only a block owned by the event with before and after audit", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.events") && text.includes("for update")) {
        return rows([eventGateRow]);
      }
      if (
        text.includes("from public.event_content_blocks")
        && text.includes("for update")
      ) {
        return rows([contentBlockRow]);
      }
      if (text.includes("select exists(")) {
        return rows([{ exists: false }]);
      }
      if (text.includes("update public.events")) {
        return rows([{ lock_version: 4 }]);
      }
      return affected();
    });
    const repository = createAdminEventContentManagementPersistence(
      new FakePool(connection)
    );

    const result = await repository.updateContentBlock({
      eventId: EVENT_ID,
      contentBlockId: CONTENT_BLOCK_ID,
      expectedLockVersion: 3,
      contentBlock: { ...contentBlock, isVisible: false },
      audit
    });

    assert.deepEqual(result, { status: "updated", lockVersion: 4 });
    const auditInsert = findQuery(connection, "insert into public.audit_log");
    assert.match(String(auditInsert.values[6]), /"isVisible":true/);
    assert.match(String(auditInsert.values[7]), /"isVisible":false/);
  });

  it("rejects a duplicate sort order without writing the child row", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.events") && text.includes("for update")) {
        return rows([eventGateRow]);
      }
      if (text.includes("select exists(")) {
        return rows([{ exists: true }]);
      }
      return affected();
    });
    const repository = createAdminEventContentManagementPersistence(
      new FakePool(connection)
    );

    const result = await repository.createContentBlock({
      eventId: EVENT_ID,
      contentBlockId: CONTENT_BLOCK_ID,
      expectedLockVersion: 3,
      contentBlock,
      audit
    });

    assert.deepEqual(result, { status: "sort_order_conflict" });
    assert.equal(
      connection.queries.some((query) =>
        query.text.includes("insert into public.event_content_blocks")
      ),
      false
    );
  });

  it("rolls back the content mutation when audit persistence fails", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.events") && text.includes("for update")) {
        return rows([eventGateRow]);
      }
      if (text.includes("select exists(")) {
        return rows([{ exists: false }]);
      }
      if (text.includes("update public.events")) {
        return rows([{ lock_version: 4 }]);
      }
      if (text.includes("insert into public.audit_log")) {
        throw new Error("audit unavailable");
      }
      return affected();
    });
    const repository = createAdminEventContentManagementPersistence(
      new FakePool(connection)
    );

    await assert.rejects(
      repository.createContentBlock({
        eventId: EVENT_ID,
        contentBlockId: CONTENT_BLOCK_ID,
        expectedLockVersion: 3,
        contentBlock,
        audit
      }),
      /audit unavailable/
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
const CONTENT_BLOCK_ID = "00000000-0000-4000-8000-000000000401";
const occurredAt = new Date("2026-07-26T12:00:00.000Z");

const eventGateRow = {
  id: EVENT_ID,
  status: "draft",
  lock_version: 3
};

const contentBlock: AdminEventContentBlockRecord = {
  blockType: "program",
  title: "Программа",
  contentSchemaVersion: 1,
  content: { items: [{ time: "12:00", title: "Открытие" }] },
  sortOrder: 20,
  isVisible: true
};

const contentBlockRow = {
  id: CONTENT_BLOCK_ID,
  event_id: EVENT_ID,
  block_type: contentBlock.blockType,
  title: contentBlock.title,
  content_schema_version: contentBlock.contentSchemaVersion,
  content: contentBlock.content,
  sort_order: contentBlock.sortOrder,
  is_visible: contentBlock.isVisible
};

const audit: AdminEventAuditContext = {
  auditId: "00000000-0000-4000-8000-000000000901",
  actorAdminId: "00000000-0000-4000-8000-000000000010",
  actorRole: "content_manager",
  reason: "Manage content",
  requestId: "request-content-1",
  ipAddress: "127.0.0.1",
  userAgent: "admin-web-test",
  occurredAt
};
