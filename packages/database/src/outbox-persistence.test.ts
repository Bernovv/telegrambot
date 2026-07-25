import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  SqlConnection,
  SqlConnectionPool,
  SqlQueryResult
} from "./postgres.js";
import {
  InvalidOutboxPayloadError,
  LostOutboxLockError,
  PostgresOutboxDispatchRepository,
  PostgresWorkerHeartbeatRepository
} from "./outbox-persistence.js";

describe("PostgresOutboxDispatchRepository", () => {
  it("claims an ordered batch with SKIP LOCKED, lease, and retry backoff", async () => {
    const connection = new FakeConnection([{ rows: [{
      event_id: "event-1",
      aggregate_type: "user",
      aggregate_id: "user-1",
      event_type: "UserRegistered",
      schema_version: 1,
      payload: { userId: "user-1" },
      occurred_at: new Date("2026-07-22T10:00:00.000Z"),
      retry_count: 2
    }], rowCount: 1 }]);
    const repository = new PostgresOutboxDispatchRepository(new FakePool(connection));

    const events = await repository.claimBatch({
      workerId: "worker-1",
      batchSize: 25,
      lockLeaseSeconds: 60,
      retryBaseSeconds: 5,
      retryMaxSeconds: 300
    });

    assert.match(connection.queries[0]?.text ?? "", /for update skip locked/i);
    assert.match(connection.queries[0]?.text ?? "", /power\(/i);
    assert.deepEqual(connection.queries[0]?.values, ["worker-1", 25, 60, 5, 300]);
    assert.equal(events[0]?.retryCount, 2);
    assert.deepEqual(events[0]?.payload, { userId: "user-1" });
    assert.equal(connection.released, true);
  });

  it("updates only events still owned by the worker", async () => {
    const connection = new FakeConnection([
      { rows: [], rowCount: 1 },
      { rows: [], rowCount: 1 }
    ]);
    const repository = new PostgresOutboxDispatchRepository(new FakePool(connection));

    await repository.markPublished("event-1", "worker-1");
    await repository.markFailed("event-2", "worker-1", "DependencyUnavailableError");

    assert.match(connection.queries[0]?.text ?? "", /processed_at = clock_timestamp/i);
    assert.deepEqual(connection.queries[0]?.values, ["event-1", "worker-1"]);
    assert.match(connection.queries[1]?.text ?? "", /retry_count = retry_count \+ 1/i);
    assert.deepEqual(connection.queries[1]?.values, [
      "event-2",
      "worker-1",
      "DependencyUnavailableError"
    ]);
  });

  it("fails closed for an invalid payload or a lost lock", async () => {
    const invalidPayload = new PostgresOutboxDispatchRepository(new FakePool(new FakeConnection([{
      rows: [{
        event_id: "event-1",
        aggregate_type: "user",
        aggregate_id: "user-1",
        event_type: "UserRegistered",
        schema_version: 1,
        payload: [],
        occurred_at: new Date(),
        retry_count: 0
      }],
      rowCount: 1
    }])));
    const lostLock = new PostgresOutboxDispatchRepository(new FakePool(new FakeConnection([{
      rows: [],
      rowCount: 0
    }])));

    await assert.rejects(
      () => invalidPayload.claimBatch(claimOptions()),
      InvalidOutboxPayloadError
    );
    await assert.rejects(
      () => lostLock.markPublished("event-1", "worker-1"),
      LostOutboxLockError
    );
  });
});

describe("PostgresWorkerHeartbeatRepository", () => {
  it("upserts liveness without replacing the original started_at", async () => {
    const connection = new FakeConnection([{ rows: [], rowCount: 1 }]);
    const repository = new PostgresWorkerHeartbeatRepository(new FakePool(connection));
    const startedAt = new Date("2026-07-22T10:00:00.000Z");

    await repository.record({
      workerId: "worker-1",
      serviceName: "worker",
      queues: ["outbox-dispatch"],
      version: "test",
      startedAt,
      currentJobId: null
    });

    assert.match(connection.queries[0]?.text ?? "", /on conflict \(worker_id\) do update/i);
    assert.doesNotMatch(connection.queries[0]?.text ?? "", /started_at = excluded/i);
    assert.deepEqual(connection.queries[0]?.values, [
      "worker-1",
      "worker",
      ["outbox-dispatch"],
      "test",
      startedAt,
      null,
      "{}"
    ]);
  });
});

class FakePool implements SqlConnectionPool {
  constructor(private readonly connection: FakeConnection) {}

  async connect(): Promise<SqlConnection> {
    return this.connection;
  }
}

class FakeConnection implements SqlConnection {
  readonly queries: { readonly text: string; readonly values?: readonly unknown[] }[] = [];
  released = false;

  constructor(private readonly results: SqlQueryResult<unknown>[]) {}

  async query<TRow>(text: string, values?: readonly unknown[]): Promise<SqlQueryResult<TRow>> {
    this.queries.push({ text, ...(values ? { values } : {}) });
    const result = this.results.shift();
    assert.ok(result, "No fake query result configured");
    return result as SqlQueryResult<TRow>;
  }

  release(): void {
    this.released = true;
  }
}

function claimOptions() {
  return {
    workerId: "worker-1",
    batchSize: 20,
    lockLeaseSeconds: 60,
    retryBaseSeconds: 5,
    retryMaxSeconds: 300
  };
}
