import type { DomainEventJobV1 } from "@ticket-platform/contracts";

export interface ClaimedOutboxEvent {
  readonly eventId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly schemaVersion: number;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
  readonly retryCount: number;
}

export interface ClaimOutboxBatchOptions {
  readonly workerId: string;
  readonly batchSize: number;
  readonly lockLeaseSeconds: number;
  readonly retryBaseSeconds: number;
  readonly retryMaxSeconds: number;
}

export interface OutboxDispatchRepository {
  claimBatch(options: ClaimOutboxBatchOptions): Promise<readonly ClaimedOutboxEvent[]>;
  markPublished(eventId: string, workerId: string): Promise<void>;
  markFailed(eventId: string, workerId: string, errorType: string): Promise<void>;
}

export interface OutboxJobPublisher {
  publish(eventId: string, job: DomainEventJobV1): Promise<void>;
}

export interface DispatchOutboxBatchResult {
  readonly claimed: number;
  readonly published: number;
  readonly failed: number;
}

export class DispatchOutboxBatchService {
  constructor(
    private readonly repository: OutboxDispatchRepository,
    private readonly publisher: OutboxJobPublisher
  ) {}

  async execute(options: ClaimOutboxBatchOptions): Promise<DispatchOutboxBatchResult> {
    const events = await this.repository.claimBatch(options);
    let published = 0;
    let failed = 0;

    for (const event of events) {
      try {
        await this.publisher.publish(event.eventId, toDomainEventJob(event));
        await this.repository.markPublished(event.eventId, options.workerId);
        published += 1;
      } catch (error) {
        await this.repository.markFailed(event.eventId, options.workerId, errorType(error));
        failed += 1;
      }
    }

    return { claimed: events.length, published, failed };
  }
}

export function toDomainEventJob(event: ClaimedOutboxEvent): DomainEventJobV1 {
  return {
    jobType: "domain-event",
    schemaVersion: 1,
    entity: { type: event.aggregateType, id: event.aggregateId },
    idempotencyKey: `outbox:${event.eventId}`,
    correlationId: event.eventId,
    actor: null,
    attempt: event.retryCount + 1,
    createdAt: event.occurredAt.toISOString(),
    event: {
      type: event.eventType,
      schemaVersion: event.schemaVersion,
      payload: event.payload
    }
  };
}

function errorType(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}
