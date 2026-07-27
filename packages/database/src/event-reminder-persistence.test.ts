import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SendEventRemindersBatchService, type IdGenerator } from "@ticket-platform/application";
import { createEventReminderPersistence } from "./event-reminder-persistence.js";
import type { SqlConnection, SqlConnectionPool, SqlQueryResult } from "./postgres.js";

interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

const at = new Date("2026-07-29T09:00:00.000Z");

describe("PostgreSQL event reminder persistence", () => {
  it("claims due candidates with SKIP LOCKED, inserts a dedup row per claim, and appends one outbox event each", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.orders o")) {
        return rows([candidateRow, candidateRow2]);
      }
      if (text.includes("insert into public.event_reminder_dispatches")) {
        return affected();
      }
      return affected();
    });
    const idGenerator = sequenceIdGenerator(["dispatch-1", "dispatch-2", "outbox-1", "outbox-2"]);
    const persistence = createEventReminderPersistence(new FakePool(connection), idGenerator);
    const service = new SendEventRemindersBatchService(
      persistence.eventReminderRepository,
      persistence.outboxWriter,
      persistence.unitOfWork,
      idGenerator
    );

    const result = await service.execute({ at, batchSize: 50 });

    assert.deepEqual(result, { claimed: 2 });
    assert.match(findQuery(connection, "from public.orders o").text, /for update of o skip locked/);
    assert.equal(
      findQueries(connection, "insert into public.event_reminder_dispatches").length,
      2
    );
    assert.equal(findQueries(connection, "insert into public.outbox_events").length, 2);
    const firstDispatchInsert = findQueries(connection, "insert into public.event_reminder_dispatches")[0];
    assert.deepEqual(firstDispatchInsert?.values, ["dispatch-1", "order-1", "event-1", "10d", at]);
  });

  it("does not count a candidate whose dispatch row lost the race to another worker", async () => {
    let dispatchInsertCount = 0;
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.orders o")) {
        return rows([candidateRow]);
      }
      if (text.includes("insert into public.event_reminder_dispatches")) {
        dispatchInsertCount += 1;
        return { rows: [], rowCount: 0 };
      }
      return affected();
    });
    const idGenerator = sequenceIdGenerator(["dispatch-1"]);
    const persistence = createEventReminderPersistence(new FakePool(connection), idGenerator);
    const service = new SendEventRemindersBatchService(
      persistence.eventReminderRepository,
      persistence.outboxWriter,
      persistence.unitOfWork,
      idGenerator
    );

    const result = await service.execute({ at, batchSize: 50 });

    assert.deepEqual(result, { claimed: 0 });
    assert.equal(dispatchInsertCount, 1);
    assert.equal(connection.queries.some((q) => q.text.includes("insert into public.outbox_events")), false);
  });
});

const candidateRow = {
  order_id: "order-1",
  event_id: "event-1",
  user_id: "user-1",
  cadence_step: "10d"
};

const candidateRow2 = {
  order_id: "order-2",
  event_id: "event-1",
  user_id: "user-2",
  cadence_step: "day_of"
};

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

function rows<TRow>(resultRows: readonly TRow[]): SqlQueryResult<TRow> {
  return { rows: resultRows, rowCount: resultRows.length };
}

function findQuery(connection: FakeConnection, fragment: string): RecordedQuery {
  const query = connection.queries.find((candidate) => candidate.text.includes(fragment));
  assert.ok(query, `Expected query containing: ${fragment}`);
  return query;
}

function findQueries(connection: FakeConnection, fragment: string): RecordedQuery[] {
  return connection.queries.filter((candidate) => candidate.text.includes(fragment));
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
