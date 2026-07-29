import type { DomainEvent } from "@ticket-platform/domain";
import type { IdGenerator, OutboxWriter, UnitOfWork } from "./identity.js";

export interface PendingBroadcastPreparation {
  readonly broadcastId: string;
  readonly broadcastVersionId: string;
  readonly audienceSnapshotId: string;
  readonly scheduledAt: Date;
}

export interface BroadcastPreparationCounts {
  readonly planned: string;
  readonly reachable: string;
  readonly skipped: string;
}

export interface BroadcastPreparationRepository {
  claimDue(input: {
    readonly at: Date;
    readonly batchSize: number;
  }): Promise<readonly PendingBroadcastPreparation[]>;
  materialize(input: {
    readonly broadcast: PendingBroadcastPreparation;
    readonly preparedAt: Date;
  }): Promise<BroadcastPreparationCounts>;
}

export interface PrepareBroadcastDeliveriesBatchResult {
  readonly claimed: number;
  readonly prepared: number;
  readonly plannedRecipients: string;
  readonly reachableRecipients: string;
  readonly skippedRecipients: string;
}

export class InvalidBroadcastPreparationError extends Error {
  constructor() {
    super("Broadcast preparation batch is invalid");
    this.name = "InvalidBroadcastPreparationError";
  }
}

export class PrepareBroadcastDeliveriesBatchService {
  constructor(
    private readonly repository: BroadcastPreparationRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly outboxWriter: OutboxWriter,
    private readonly idGenerator: IdGenerator
  ) {}

  execute(input: {
    readonly at: Date;
    readonly batchSize: number;
  }): Promise<PrepareBroadcastDeliveriesBatchResult> {
    if (
      Number.isNaN(input.at.getTime())
      || !Number.isSafeInteger(input.batchSize)
      || input.batchSize < 1
      || input.batchSize > 10
    ) {
      throw new InvalidBroadcastPreparationError();
    }
    return this.unitOfWork.transact(async () => {
      const broadcasts = await this.repository.claimDue(input);
      let planned = 0n;
      let reachable = 0n;
      let skipped = 0n;
      for (const broadcast of broadcasts) {
        const counts = await this.repository.materialize({
          broadcast,
          preparedAt: input.at
        });
        planned += count(counts.planned);
        reachable += count(counts.reachable);
        skipped += count(counts.skipped);
        await this.outboxWriter.append(preparedEvent(
          this.idGenerator.newId(),
          broadcast,
          counts,
          input.at
        ));
      }
      return {
        claimed: broadcasts.length,
        prepared: broadcasts.length,
        plannedRecipients: planned.toString(),
        reachableRecipients: reachable.toString(),
        skippedRecipients: skipped.toString()
      };
    });
  }
}

function preparedEvent(
  eventId: string,
  broadcast: PendingBroadcastPreparation,
  counts: BroadcastPreparationCounts,
  occurredAt: Date
): DomainEvent<{
  readonly broadcastId: string;
  readonly broadcastVersionId: string;
  readonly audienceSnapshotId: string;
  readonly plannedRecipientCount: string;
  readonly reachableRecipientCount: string;
  readonly skippedRecipientCount: string;
}> {
  return {
    eventId,
    aggregateType: "broadcast",
    aggregateId: broadcast.broadcastId,
    eventType: "BroadcastPrepared",
    schemaVersion: 1,
    payload: {
      broadcastId: broadcast.broadcastId,
      broadcastVersionId: broadcast.broadcastVersionId,
      audienceSnapshotId: broadcast.audienceSnapshotId,
      plannedRecipientCount: counts.planned,
      reachableRecipientCount: counts.reachable,
      skippedRecipientCount: counts.skipped
    },
    occurredAt
  };
}

function count(value: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new InvalidBroadcastPreparationError();
  }
  return BigInt(value);
}
