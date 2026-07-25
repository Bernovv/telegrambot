import type {
  HealthProbe,
  HealthProbeResult
} from "@ticket-platform/application";
import type {
  SqlConnectionPool,
  SqlQueryResult
} from "./postgres.js";

const OUTBOX_DISPATCH_QUEUE = "outbox-dispatch";
const OUTBOX_DEAD_LETTER_QUEUE = "outbox-dispatch-dead-letter";

export interface PostgresHealthProbeOptions {
  readonly expectedMigrationVersion: string;
  readonly pgBossSchema: string;
  readonly expectedPgBossVersion: number;
  readonly workerHeartbeatDegradedSeconds: number;
  readonly workerHeartbeatFailedSeconds: number;
  readonly outboxLagDegradedSeconds: number;
  readonly outboxLagFailedSeconds: number;
}

export function createPostgresHealthProbes(
  pool: SqlConnectionPool,
  options: PostgresHealthProbeOptions
): readonly HealthProbe[] {
  const schema = quotePostgresIdentifier(options.pgBossSchema);

  return [
    probe("database", async () => {
      await query(pool, "select 1 as ok");
      return healthy(
        "database_reachable",
        "docs/runbooks/health-readiness.md#database-connectivity"
      );
    }),
    probe("migrations", async () => {
      const result = await query<{ readonly version: string }>(
        pool,
        `select version
           from supabase_migrations.schema_migrations
          order by version desc
          limit 1`
      );
      const currentVersion = result.rows[0]?.version;

      return currentVersion === options.expectedMigrationVersion
        ? healthy("migration_current", "docs/runbooks/health-readiness.md#database-migrations")
        : failed("migration_outdated", "docs/runbooks/health-readiness.md#database-migrations");
    }),
    probe("job_queue", async () => {
      const result = await query<{
        readonly schema_version: number;
        readonly queue_count: number;
        readonly dispatch_linked: boolean | null;
      }>(
        pool,
        `select
           coalesce((select max(version) from ${schema}.version), 0)::integer as schema_version,
           count(*)::integer as queue_count,
           bool_or(name = $1 and dead_letter = $2) as dispatch_linked
         from ${schema}.queue
         where name = any($3::text[])`,
        [
          OUTBOX_DISPATCH_QUEUE,
          OUTBOX_DEAD_LETTER_QUEUE,
          [OUTBOX_DISPATCH_QUEUE, OUTBOX_DEAD_LETTER_QUEUE]
        ]
      );
      const row = result.rows[0];
      const ready = row?.schema_version === options.expectedPgBossVersion
        && row.queue_count === 2
        && row.dispatch_linked === true;

      return ready
        ? healthy("job_queue_ready", "docs/runbooks/health-readiness.md#job-queue")
        : failed("job_queue_invalid", "docs/runbooks/health-readiness.md#job-queue");
    }),
    probe("worker", async () => {
      const result = await query<{ readonly age_seconds: number | null }>(
        pool,
        `select extract(
           epoch from clock_timestamp() - max(last_seen_at)
         )::double precision as age_seconds
           from public.worker_heartbeats
          where service_name = 'worker'
            and queues @> $1::text[]`,
        [[OUTBOX_DISPATCH_QUEUE]]
      );
      const ageSeconds = result.rows[0]?.age_seconds;

      if (ageSeconds === null || ageSeconds === undefined) {
        return failed("worker_missing", "docs/runbooks/health-readiness.md#worker-heartbeat");
      }
      if (ageSeconds > options.workerHeartbeatFailedSeconds) {
        return failed(
          "worker_heartbeat_expired",
          "docs/runbooks/health-readiness.md#worker-heartbeat"
        );
      }
      if (ageSeconds > options.workerHeartbeatDegradedSeconds) {
        return degraded(
          "worker_heartbeat_stale",
          "docs/runbooks/health-readiness.md#worker-heartbeat"
        );
      }

      return healthy(
        "worker_heartbeat_current",
        "docs/runbooks/health-readiness.md#worker-heartbeat"
      );
    }),
    probe("outbox", async () => {
      const result = await query<{
        readonly pending_count: number;
        readonly oldest_age_seconds: number | null;
      }>(
        pool,
        `select
           count(*)::integer as pending_count,
           extract(
             epoch from clock_timestamp() - min(occurred_at)
           )::double precision as oldest_age_seconds
         from public.outbox_events
         where processed_at is null`
      );
      const row = result.rows[0];
      const ageSeconds = row?.oldest_age_seconds;

      if (!row || row.pending_count === 0 || ageSeconds === null || ageSeconds === undefined) {
        return healthy("outbox_clear", "docs/runbooks/health-readiness.md#outbox-lag");
      }
      if (ageSeconds > options.outboxLagFailedSeconds) {
        return failed("outbox_lag_critical", "docs/runbooks/health-readiness.md#outbox-lag");
      }
      if (ageSeconds > options.outboxLagDegradedSeconds) {
        return degraded(
          "outbox_lag_elevated",
          "docs/runbooks/health-readiness.md#outbox-lag"
        );
      }

      return healthy("outbox_lag_normal", "docs/runbooks/health-readiness.md#outbox-lag");
    })
  ];
}

function probe(name: string, check: () => Promise<HealthProbeResult>): HealthProbe {
  return { name, check };
}

function healthy(message: string, runbook: string): HealthProbeResult {
  return { status: "healthy", message, runbook };
}

function degraded(message: string, runbook: string): HealthProbeResult {
  return { status: "degraded", message, runbook };
}

function failed(message: string, runbook: string): HealthProbeResult {
  return { status: "failed", message, runbook };
}

async function query<TRow>(
  pool: SqlConnectionPool,
  text: string,
  values?: readonly unknown[]
): Promise<SqlQueryResult<TRow>> {
  const connection = await pool.connect();

  try {
    return await connection.query<TRow>(text, values);
  } finally {
    connection.release();
  }
}

function quotePostgresIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,49}$/.test(value)) {
    throw new Error("Invalid PostgreSQL schema identifier");
  }

  return `"${value}"`;
}
