import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CreateAdminBroadcastService, type IdGenerator } from "@ticket-platform/application";
import { createAdminBroadcastPersistence } from "./admin-broadcast-persistence.js";
import type { SqlConnection, SqlConnectionPool, SqlQueryResult } from "./postgres.js";
import type { AdminRequestActor } from "@ticket-platform/contracts";

interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

describe("PostgreSQL admin broadcast persistence", () => {
  it("inserts the campaign row and appends exactly one outbox event in the same transaction", async () => {
    const connection = new FakeConnection(() => affected());
    const idGenerator = sequenceIdGenerator(["broadcast-1", "outbox-1"]);
    const persistence = createAdminBroadcastPersistence(new FakePool(connection));
    const service = new CreateAdminBroadcastService(
      persistence.adminBroadcastRepository,
      persistence.outboxWriter,
      persistence.unitOfWork,
      idGenerator
    );

    const result = await service.execute({
      actor: broadcastActor(),
      messageText: "Скоро старт!",
      targetEventId: "019c0123-4567-789a-bcde-f01234567801",
      targetOrderStatus: "paid",
      now: new Date("2026-07-27T10:00:00.000Z")
    });

    assert.equal(result.broadcastId, "broadcast-1");
    assert.equal(connection.queries[0]?.text, "begin");
    const insert = findQuery(connection, "insert into public.admin_broadcasts");
    assert.deepEqual(insert.values, [
      "broadcast-1",
      "019c0123-4567-789a-bcde-f01234567800",
      "Скоро старт!",
      "019c0123-4567-789a-bcde-f01234567801",
      "paid"
    ]);
    assert.equal(
      findQueries(connection, "insert into public.outbox_events").length,
      1
    );
    assert.ok(connection.queries.some((query) => query.text === "commit"));
  });
});

function findQuery(connection: FakeConnection, fragment: string): RecordedQuery {
  const query = connection.queries.find((candidate) => candidate.text.includes(fragment));
  assert.ok(query, `Expected query containing: ${fragment}`);
  return query;
}

function findQueries(connection: FakeConnection, fragment: string): RecordedQuery[] {
  return connection.queries.filter((candidate) => candidate.text.includes(fragment));
}

class FakePool implements SqlConnectionPool {
  constructor(private readonly connection: SqlConnection) {}

  async connect(): Promise<SqlConnection> {
    return this.connection;
  }
}

class FakeConnection implements SqlConnection {
  readonly queries: RecordedQuery[] = [];

  constructor(
    private readonly respond: (text: string, values: readonly unknown[]) => SqlQueryResult<unknown>
  ) {}

  async query<TRow>(text: string, values: readonly unknown[] = []): Promise<SqlQueryResult<TRow>> {
    this.queries.push({ text, values });
    return this.respond(text, values) as SqlQueryResult<TRow>;
  }

  release(): void {}
}

function affected(): SqlQueryResult<never> {
  return { rows: [], rowCount: 1 };
}

function sequenceIdGenerator(ids: readonly string[]): IdGenerator {
  let index = 0;

  return {
    newId() {
      const id = ids[index];
      index += 1;

      if (!id) {
        throw new Error("No generated ID left in test fixture");
      }

      return id;
    }
  };
}

function broadcastActor(): AdminRequestActor {
  return {
    adminId: "019c0123-4567-789a-bcde-f01234567800",
    authSubject: "admin@example.com",
    roleCodes: ["content_manager"],
    permission: "broadcasts.send"
  };
}
