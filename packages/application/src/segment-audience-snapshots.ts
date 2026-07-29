import type {
  AdminRequestActor,
  AdminSegmentAudienceSnapshot,
  AdminSegmentAudienceSnapshotSummary,
  AdminSegmentExpression,
  RequestAdminSegmentAudienceSnapshotRequest
} from "@ticket-platform/contracts";
import type { DomainEvent } from "@ticket-platform/domain";
import {
  buildAdminEventAuditContext,
  type AdminEventAuditContext,
  type AdminEventMutationMetadata
} from "./admin-event-management.js";
import type {
  IdGenerator,
  OutboxWriter,
  UnitOfWork
} from "./identity.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface PendingSegmentAudienceSnapshot {
  readonly id: string;
  readonly segmentId: string;
  readonly segmentVersionId: string;
  readonly expression: AdminSegmentExpression;
}

export interface SegmentAudienceSnapshotRepository {
  list(segmentId: string): Promise<readonly AdminSegmentAudienceSnapshotSummary[]>;
  get(input: {
    readonly segmentId: string;
    readonly snapshotId: string;
    readonly sampleLimit: number;
  }): Promise<AdminSegmentAudienceSnapshot | null>;
  request(input: {
    readonly snapshotId: string;
    readonly segmentId: string;
    readonly segmentVersionId: string;
    readonly audit: AdminEventAuditContext;
  }): Promise<
    | {
        readonly status: "created" | "pending_exists";
        readonly value: AdminSegmentAudienceSnapshotSummary;
      }
    | { readonly status: "segment_not_found" | "version_not_published" }
  >;
  claimPending(batchSize: number): Promise<
    readonly PendingSegmentAudienceSnapshot[]
  >;
  materialize(input: {
    readonly snapshot: PendingSegmentAudienceSnapshot;
    readonly capturedAt: Date;
  }): Promise<string>;
}

export class InvalidAdminSegmentAudienceSnapshotError extends Error {
  constructor() {
    super("Administrator segment audience snapshot request is invalid");
    this.name = "InvalidAdminSegmentAudienceSnapshotError";
  }
}

export class AdminSegmentAudienceSnapshotNotFoundError extends Error {
  constructor() {
    super("Administrator segment audience snapshot was not found");
    this.name = "AdminSegmentAudienceSnapshotNotFoundError";
  }
}

export class AdminSegmentAudienceSnapshotVersionUnavailableError extends Error {
  constructor() {
    super("Segment version is not published for the requested snapshot");
    this.name = "AdminSegmentAudienceSnapshotVersionUnavailableError";
  }
}

export class ListAdminSegmentAudienceSnapshotsService {
  constructor(private readonly repository: SegmentAudienceSnapshotRepository) {}

  execute(input: {
    readonly actor: AdminRequestActor;
    readonly segmentId: string;
  }): Promise<readonly AdminSegmentAudienceSnapshotSummary[]> {
    requirePermission(input.actor, "users.read");
    requireUuid(input.segmentId);
    return this.repository.list(input.segmentId);
  }
}

export class GetAdminSegmentAudienceSnapshotService {
  constructor(private readonly repository: SegmentAudienceSnapshotRepository) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly segmentId: string;
    readonly snapshotId: string;
  }): Promise<AdminSegmentAudienceSnapshot> {
    requirePermission(input.actor, "users.read");
    requireUuid(input.segmentId);
    requireUuid(input.snapshotId);
    const snapshot = await this.repository.get({
      segmentId: input.segmentId,
      snapshotId: input.snapshotId,
      sampleLimit: 50
    });
    if (!snapshot) {
      throw new AdminSegmentAudienceSnapshotNotFoundError();
    }
    return snapshot;
  }
}

export class RequestAdminSegmentAudienceSnapshotService {
  constructor(
    private readonly repository: SegmentAudienceSnapshotRepository,
    private readonly idGenerator: IdGenerator
  ) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly segmentId: string;
    readonly request: RequestAdminSegmentAudienceSnapshotRequest;
    readonly metadata: AdminEventMutationMetadata;
  }): Promise<AdminSegmentAudienceSnapshotSummary> {
    requirePermission(input.actor, "broadcasts.send");
    requireUuid(input.segmentId);
    requireUuid(input.request.segmentVersionId);
    const reason = bounded(input.request.reason, 1, 500);
    let audit: AdminEventAuditContext;
    try {
      audit = buildAdminEventAuditContext(
        input.actor,
        reason,
        input.metadata,
        this.idGenerator
      );
    } catch {
      throw new InvalidAdminSegmentAudienceSnapshotError();
    }
    const result = await this.repository.request({
      snapshotId: requireUuid(this.idGenerator.newId()),
      segmentId: input.segmentId,
      segmentVersionId: input.request.segmentVersionId,
      audit
    });
    if (result.status === "segment_not_found") {
      throw new AdminSegmentAudienceSnapshotNotFoundError();
    }
    if (result.status === "version_not_published") {
      throw new AdminSegmentAudienceSnapshotVersionUnavailableError();
    }
    if ("value" in result) {
      return result.value;
    }
    throw new InvalidAdminSegmentAudienceSnapshotError();
  }
}

export interface BuildSegmentAudienceSnapshotsBatchResult {
  readonly claimed: number;
  readonly completed: number;
  readonly capturedMembers: string;
}

export class BuildSegmentAudienceSnapshotsBatchService {
  constructor(
    private readonly repository: SegmentAudienceSnapshotRepository,
    private readonly unitOfWork: UnitOfWork,
    private readonly outboxWriter: OutboxWriter,
    private readonly idGenerator: IdGenerator
  ) {}

  execute(input: {
    readonly at: Date;
    readonly batchSize: number;
  }): Promise<BuildSegmentAudienceSnapshotsBatchResult> {
    if (
      Number.isNaN(input.at.getTime())
      || !Number.isSafeInteger(input.batchSize)
      || input.batchSize < 1
      || input.batchSize > 10
    ) {
      throw new InvalidAdminSegmentAudienceSnapshotError();
    }
    return this.unitOfWork.transact(async () => {
      const snapshots = await this.repository.claimPending(input.batchSize);
      let total = 0n;
      for (const snapshot of snapshots) {
        const count = await this.repository.materialize({
          snapshot,
          capturedAt: input.at
        });
        total += BigInt(count);
        await this.outboxWriter.append(snapshotReadyEvent(
          this.idGenerator.newId(),
          snapshot,
          count,
          input.at
        ));
      }
      return {
        claimed: snapshots.length,
        completed: snapshots.length,
        capturedMembers: total.toString()
      };
    });
  }
}

function snapshotReadyEvent(
  eventId: string,
  snapshot: PendingSegmentAudienceSnapshot,
  totalCount: string,
  occurredAt: Date
): DomainEvent<{
  readonly snapshotId: string;
  readonly segmentId: string;
  readonly segmentVersionId: string;
  readonly totalCount: string;
}> {
  return {
    eventId,
    aggregateType: "segment_audience_snapshot",
    aggregateId: snapshot.id,
    eventType: "SegmentAudienceSnapshotReady",
    schemaVersion: 1,
    payload: {
      snapshotId: snapshot.id,
      segmentId: snapshot.segmentId,
      segmentVersionId: snapshot.segmentVersionId,
      totalCount
    },
    occurredAt
  };
}

function requirePermission(
  actor: AdminRequestActor,
  permission: "users.read" | "broadcasts.send"
): void {
  if (actor.permission !== permission || !UUID_PATTERN.test(actor.adminId)) {
    throw new InvalidAdminSegmentAudienceSnapshotError();
  }
}

function requireUuid(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new InvalidAdminSegmentAudienceSnapshotError();
  }
  return value;
}

function bounded(value: string, minimum: number, maximum: number): string {
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new InvalidAdminSegmentAudienceSnapshotError();
  }
  return normalized;
}
