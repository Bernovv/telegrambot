import { createHash } from "node:crypto";
import type {
  AcceptTelegramOfferCommand,
  AcceptTelegramOfferResult
} from "@ticket-platform/contracts";
import type {
  DomainEvent,
  MoneyKopecks,
  OrderStatus
} from "@ticket-platform/domain";
import type {
  IdGenerator,
  OutboxWriter,
  UnitOfWork
} from "./identity.js";

export interface OfferAcceptanceOrder {
  readonly id: string;
  readonly number: string;
  readonly userId: string;
  readonly messengerIdentityId: string;
  readonly eventId: string;
  readonly status: OrderStatus;
  readonly currency: string;
  readonly total: MoneyKopecks;
  readonly walletApplied: MoneyKopecks;
  readonly externalDue: MoneyKopecks;
  readonly offerVersionId: string | null;
  readonly offerDisplayTextSnapshot: string | null;
  readonly offerAcceptedAt: Date | null;
  readonly expiresAt: Date;
}

export interface RecordTelegramOfferAcceptanceInput {
  readonly acceptanceId: string;
  readonly historyId: string;
  readonly order: OfferAcceptanceOrder;
  readonly acceptedAt: Date;
  readonly updateId: string;
  readonly callbackQueryId: string;
  readonly messageId: string | null;
}

export interface OfferAcceptanceRepository {
  lockForTelegramAcceptance(
    publicTokenHash: string,
    senderExternalUserId: string
  ): Promise<OfferAcceptanceOrder | null>;
  recordTelegramAcceptance(input: RecordTelegramOfferAcceptanceInput): Promise<void>;
}

export class AcceptTelegramOfferService {
  constructor(
    private readonly repository: OfferAcceptanceRepository,
    private readonly outboxWriter: OutboxWriter,
    private readonly unitOfWork: UnitOfWork,
    private readonly idGenerator: IdGenerator
  ) {}

  execute(command: AcceptTelegramOfferCommand): Promise<AcceptTelegramOfferResult> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(command.publicOrderToken)) {
      return Promise.resolve({ accepted: false, reason: "order_not_found" });
    }

    return this.unitOfWork.transact(async () => {
      const order = await this.repository.lockForTelegramAcceptance(
        hashPublicToken(command.publicOrderToken),
        command.senderExternalUserId
      );
      if (!order) {
        return { accepted: false, reason: "order_not_found" };
      }
      if (order.offerAcceptedAt !== null && order.status === "awaiting_payment") {
        return acceptedResult(order, false);
      }
      if (command.acceptedAt >= order.expiresAt) {
        return { accepted: false, reason: "order_expired" };
      }
      if (order.status !== "awaiting_offer") {
        return { accepted: false, reason: "order_not_acceptable" };
      }
      if (!order.offerVersionId || !order.offerDisplayTextSnapshot) {
        return { accepted: false, reason: "offer_unavailable" };
      }

      await this.repository.recordTelegramAcceptance({
        acceptanceId: this.idGenerator.newId(),
        historyId: this.idGenerator.newId(),
        order,
        acceptedAt: command.acceptedAt,
        updateId: command.updateId,
        callbackQueryId: command.callbackQueryId,
        messageId: command.messageId
      });
      await this.outboxWriter.append(offerAcceptedEvent(
        this.idGenerator.newId(),
        order,
        command.acceptedAt
      ));

      return acceptedResult(order, true);
    });
  }
}

function hashPublicToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function acceptedResult(
  order: OfferAcceptanceOrder,
  newlyAccepted: boolean
): AcceptTelegramOfferResult {
  return {
    accepted: true,
    newlyAccepted,
    orderId: order.id,
    orderNumber: order.number,
    currency: order.currency,
    totalKopecks: order.total.toString(),
    walletAppliedKopecks: order.walletApplied.toString(),
    externalDueKopecks: order.externalDue.toString()
  };
}

function offerAcceptedEvent(
  eventId: string,
  order: OfferAcceptanceOrder,
  occurredAt: Date
): DomainEvent<{
  orderId: string;
  userId: string;
  eventId: string;
  offerVersionId: string;
}> {
  if (!order.offerVersionId) {
    throw new Error("Offer version is required for OfferAccepted");
  }

  return {
    eventId,
    aggregateType: "order",
    aggregateId: order.id,
    eventType: "OfferAccepted",
    schemaVersion: 1,
    payload: {
      orderId: order.id,
      userId: order.userId,
      eventId: order.eventId,
      offerVersionId: order.offerVersionId
    },
    occurredAt
  };
}
