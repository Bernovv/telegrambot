import type {
  ClaimOutboxBatchOptions,
  ClaimedOutboxEvent,
  OutboxDispatchRepository
} from "@ticket-platform/application";
import type { SqlConnectionPool, SqlQueryResult } from "./postgres.js";

interface OutboxRow {
  readonly event_id: string;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly event_type: string;
  readonly schema_version: number;
  readonly payload: unknown;
  readonly occurred_at: Date;
  readonly retry_count: number;
}

export interface WorkerHeartbeatInput {
  readonly workerId: string;
  readonly serviceName: string;
  readonly queues: readonly string[];
  readonly version: string;
  readonly startedAt: Date;
  readonly currentJobId: string | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export class LostOutboxLockError extends Error {
  constructor() {
    super("Outbox event lock is no longer owned by this worker");
    this.name = "LostOutboxLockError";
  }
}

export class InvalidOutboxPayloadError extends Error {
  constructor() {
    super("Outbox event payload must be a JSON object");
    this.name = "InvalidOutboxPayloadError";
  }
}

export class PostgresOutboxDispatchRepository implements OutboxDispatchRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  async claimBatch(options: ClaimOutboxBatchOptions): Promise<readonly ClaimedOutboxEvent[]> {
    const result = await this.query<OutboxRow>(
      `with candidates as (
         select event_id
           from public.outbox_events
          where processed_at is null
            and (
              locked_at is null
              or (
                locked_by is not null
                and locked_at <= clock_timestamp() - make_interval(secs => $3::integer)
              )
              or (
                locked_by is null
                and locked_at <= clock_timestamp() - make_interval(
                  secs => least(
                    $5::integer,
                    ($4::numeric * power(
                      2::numeric,
                      least(greatest(retry_count - 1, 0), 16)
                    ))::integer
                  )
                )
              )
            )
          order by occurred_at, event_id
          for update skip locked
          limit $2
       )
       update public.outbox_events as event
          set locked_at = clock_timestamp(),
              locked_by = $1
         from candidates
        where event.event_id = candidates.event_id
      returning event.event_id,
                event.aggregate_type,
                event.aggregate_id,
                event.event_type,
                event.schema_version,
                event.payload,
                event.occurred_at,
                event.retry_count`,
      [
        options.workerId,
        options.batchSize,
        options.lockLeaseSeconds,
        options.retryBaseSeconds,
        options.retryMaxSeconds
      ]
    );

    return result.rows.map(mapOutboxRow);
  }

  async markPublished(eventId: string, workerId: string): Promise<void> {
    const result = await this.query(
      `update public.outbox_events
          set processed_at = clock_timestamp(),
              locked_at = null,
              locked_by = null,
              last_error = null
        where event_id = $1
          and locked_by = $2
          and processed_at is null`,
      [eventId, workerId]
    );
    assertOwned(result);
  }

  async markFailed(eventId: string, workerId: string, errorType: string): Promise<void> {
    const result = await this.query(
      `update public.outbox_events
          set retry_count = retry_count + 1,
              last_error = left($3, 120),
              locked_at = clock_timestamp(),
              locked_by = null
        where event_id = $1
          and locked_by = $2
          and processed_at is null`,
      [eventId, workerId, errorType]
    );
    assertOwned(result);
  }

  private async query<TRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<SqlQueryResult<TRow>> {
    const connection = await this.pool.connect();

    try {
      return await connection.query<TRow>(text, values);
    } finally {
      connection.release();
    }
  }
}

export class PostgresWorkerHeartbeatRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  async record(input: WorkerHeartbeatInput): Promise<void> {
    const connection = await this.pool.connect();

    try {
      await connection.query(
        `insert into public.worker_heartbeats (
           worker_id,
           service_name,
           queues,
           version,
           started_at,
           last_seen_at,
           current_job_id,
           metadata
         ) values ($1, $2, $3, $4, $5, clock_timestamp(), $6, $7::jsonb)
         on conflict (worker_id) do update
           set service_name = excluded.service_name,
               queues = excluded.queues,
               version = excluded.version,
               last_seen_at = excluded.last_seen_at,
               current_job_id = excluded.current_job_id,
               metadata = excluded.metadata`,
        [
          input.workerId,
          input.serviceName,
          [...input.queues],
          input.version,
          input.startedAt,
          input.currentJobId,
          JSON.stringify(input.metadata ?? {})
        ]
      );
    } finally {
      connection.release();
    }
  }
}

function mapOutboxRow(row: OutboxRow): ClaimedOutboxEvent {
  if (!row.payload || typeof row.payload !== "object" || Array.isArray(row.payload)) {
    throw new InvalidOutboxPayloadError();
  }

  return {
    eventId: row.event_id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    eventType: row.event_type,
    schemaVersion: row.schema_version,
    payload: row.payload as Readonly<Record<string, unknown>>,
    occurredAt: row.occurred_at,
    retryCount: row.retry_count
  };
}

function assertOwned(result: SqlQueryResult<unknown>): void {
  if (result.rowCount !== 1) {
    throw new LostOutboxLockError();
  }
}
