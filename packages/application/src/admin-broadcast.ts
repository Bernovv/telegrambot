import type { DomainEvent } from "@ticket-platform/domain";
import type { AdminRequestActor } from "@ticket-platform/contracts";
import type { IdGenerator, OutboxWriter, UnitOfWork } from "./identity.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AdminBroadcastOrderStatus =
  | "draft"
  | "awaiting_offer"
  | "awaiting_payment"
  | "payment_processing"
  | "paid"
  | "cancelled"
  | "expired"
  | "partially_refunded"
  | "refunded";

const ORDER_STATUSES: readonly AdminBroadcastOrderStatus[] = [
  "draft",
  "awaiting_offer",
  "awaiting_payment",
  "payment_processing",
  "paid",
  "cancelled",
  "expired",
  "partially_refunded",
  "refunded"
];

export interface CreateAdminBroadcastInput {
  readonly createdByAdminId: string;
  readonly messageText: string;
  readonly targetEventId: string | null;
  readonly targetOrderStatus: AdminBroadcastOrderStatus | null;
}

export interface AdminBroadcastRepository {
  createBroadcast(input: CreateAdminBroadcastInput & { readonly id: string }): Promise<void>;
}

export interface CreateAdminBroadcastResult {
  readonly broadcastId: string;
}

export class CreateAdminBroadcastService {
  constructor(
    private readonly repository: AdminBroadcastRepository,
    private readonly outboxWriter: OutboxWriter,
    private readonly unitOfWork: UnitOfWork,
    private readonly idGenerator: IdGenerator
  ) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly messageText: string;
    readonly targetEventId?: string;
    readonly targetOrderStatus?: string;
    readonly now: Date;
  }): Promise<CreateAdminBroadcastResult> {
    requireBroadcastPermission(input.actor);
    const messageText = parseMessageText(input.messageText);
    const targetEventId = parseOptionalUuid(input.targetEventId, "Broadcast target event ID is invalid");
    const targetOrderStatus = parseOptionalOrderStatus(input.targetOrderStatus);
    if (Number.isNaN(input.now.getTime())) {
      throw new Error("Broadcast creation time is invalid");
    }

    const broadcastId = this.idGenerator.newId();

    return this.unitOfWork.transact(async () => {
      await this.repository.createBroadcast({
        id: broadcastId,
        createdByAdminId: input.actor.adminId,
        messageText,
        targetEventId,
        targetOrderStatus
      });
      await this.outboxWriter.append(broadcastRequestedEvent(broadcastId, this.idGenerator.newId(), input.now));
      return { broadcastId };
    });
  }
}

function broadcastRequestedEvent(
  broadcastId: string,
  eventId: string,
  occurredAt: Date
): DomainEvent {
  return {
    eventId,
    aggregateType: "admin_broadcast",
    aggregateId: broadcastId,
    eventType: "AdminBroadcastRequested",
    schemaVersion: 1,
    payload: { broadcastId },
    occurredAt
  };
}

function requireBroadcastPermission(actor: AdminRequestActor): void {
  if (actor.permission !== "broadcasts.send" || !UUID_PATTERN.test(actor.adminId)) {
    throw new Error("Administrator broadcast permission is invalid");
  }
}

function parseMessageText(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 3_500) {
    throw new Error("Broadcast message text is invalid");
  }
  return trimmed;
}

function parseOptionalUuid(value: string | undefined, message: string): string | null {
  if (value === undefined) {
    return null;
  }
  if (!UUID_PATTERN.test(value)) {
    throw new Error(message);
  }
  return value;
}

function parseOptionalOrderStatus(value: string | undefined): AdminBroadcastOrderStatus | null {
  if (value === undefined) {
    return null;
  }
  if (!(ORDER_STATUSES as readonly string[]).includes(value)) {
    throw new Error("Broadcast target order status is invalid");
  }
  return value as AdminBroadcastOrderStatus;
}
