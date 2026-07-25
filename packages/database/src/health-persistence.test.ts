import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  SqlConnection,
  SqlConnectionPool,
  SqlQueryResult
} from "./postgres.js";
import { createPostgresHealthProbes } from "./health-persistence.js";

describe("createPostgresHealthProbes", () => {
  it("reports healthy dependencies for the expected schema state", async () => {
    const probes = createPostgresHealthProbes(poolForHealthyState(), options());

    const results = await Promise.all(probes.map((probe) => probe.check()));

    assert.deepEqual(results.map((result) => result.status), [
      "healthy",
      "healthy",
      "healthy",
      "healthy",
      "healthy"
    ]);
  });

  it("classifies stale workers and delayed outbox events", async () => {
    const probes = createPostgresHealthProbes(poolWithRows({
      workerAgeSeconds: 45,
      pendingCount: 3,
      outboxAgeSeconds: 301
    }), options());

    assert.deepEqual(await probes[3]?.check(), {
      status: "degraded",
      message: "worker_heartbeat_stale",
      runbook: "docs/runbooks/health-readiness.md#worker-heartbeat"
    });
    assert.deepEqual(await probes[4]?.check(), {
      status: "failed",
      message: "outbox_lag_critical",
      runbook: "docs/runbooks/health-readiness.md#outbox-lag"
    });
  });

  it("fails closed for an invalid schema identifier", () => {
    assert.throws(
      () => createPostgresHealthProbes(poolForHealthyState(), options({
        pgBossSchema: "pgboss; drop schema public"
      })),
      /Invalid PostgreSQL schema identifier/
    );
  });
});

function options(overrides: Partial<Parameters<typeof createPostgresHealthProbes>[1]> = {}) {
  return {
    expectedMigrationVersion: "20260722230000",
    pgBossSchema: "pgboss",
    expectedPgBossVersion: 37,
    workerHeartbeatDegradedSeconds: 30,
    workerHeartbeatFailedSeconds: 60,
    outboxLagDegradedSeconds: 60,
    outboxLagFailedSeconds: 300,
    ...overrides
  };
}

function poolForHealthyState(): SqlConnectionPool {
  return poolWithRows({
    workerAgeSeconds: 5,
    pendingCount: 0,
    outboxAgeSeconds: null
  });
}

function poolWithRows(state: {
  readonly workerAgeSeconds: number | null;
  readonly pendingCount: number;
  readonly outboxAgeSeconds: number | null;
}): SqlConnectionPool {
  return {
    async connect() {
      return new StubConnection((text) => {
        if (text.includes("schema_migrations")) {
          return rows([{ version: "20260722230000" }]);
        }
        if (text.includes(".queue")) {
          return rows([{ schema_version: 37, queue_count: 2, dispatch_linked: true }]);
        }
        if (text.includes("worker_heartbeats")) {
          return rows([{ age_seconds: state.workerAgeSeconds }]);
        }
        if (text.includes("outbox_events")) {
          return rows([{
            pending_count: state.pendingCount,
            oldest_age_seconds: state.outboxAgeSeconds
          }]);
        }

        return rows([{ ok: 1 }]);
      });
    }
  };
}

class StubConnection implements SqlConnection {
  constructor(
    private readonly handler: (text: string) => SqlQueryResult<unknown>
  ) {}

  async query<TRow>(text: string): Promise<SqlQueryResult<TRow>> {
    return this.handler(text) as SqlQueryResult<TRow>;
  }

  release(): void {}
}

function rows<TRow>(value: readonly TRow[]): SqlQueryResult<TRow> {
  return { rows: value, rowCount: value.length };
}
