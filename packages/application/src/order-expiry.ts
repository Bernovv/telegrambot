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

export type ExpirableOrderStatus =
  | "draft"
  | "awaiting_offer"
  | "awaiting_payment"
  | "payment_processing";

export interface ExpirableOrder {
  readonly id: string;
  readonly userId: string;
  readonly eventId: string;
  readonly status: ExpirableOrderStatus;
  readonly expiresAt: Date;
  readonly walletApplied: MoneyKopecks;
}

export interface ExpireOrderInput {
  readonly order: ExpirableOrder;
  readonly historyId: string;
  readonly walletTransactionId: string;
  readonly expiredAt: Date;
}

export interface ExpireOrderResult {
  readonly walletReleased: MoneyKopecks;
}

export interface OrderExpiryRepository {
  claimExpiredOrders(at: Date, batchSize: number): Promise<readonly ExpirableOrder[]>;
  expireOrder(input: ExpireOrderInput): Promise<ExpireOrderResult>;
}

export interface ExpireOrdersBatchInput {
  readonly at: Date;
  readonly batchSize: number;
}

export interface ExpireOrdersBatchResult {
  readonly claimed: number;
  readonly expired: number;
  readonly walletReleasedKopecks: string;
}

export class ExpireOrdersBatchService {
  constructor(
    private readonly repository: OrderExpiryRepository,
    private readonly outboxWriter: OutboxWriter,
    private readonly unitOfWork: UnitOfWork,
    private readonly idGenerator: IdGenerator
  ) {}

  async execute(input: ExpireOrdersBatchInput): Promise<ExpireOrdersBatchResult> {
    if (!Number.isSafeInteger(input.batchSize) || input.batchSize < 1 || input.batchSize > 500) {
      throw new Error("Order expiry batch size must be an integer between 1 and 500");
    }

    return await this.unitOfWork.transact(async () => {
      const orders = await this.repository.claimExpiredOrders(input.at, input.batchSize);
      let walletReleased = 0n;

      for (const order of orders) {
        const result = await this.repository.expireOrder({
          order,
          historyId: this.idGenerator.newId(),
          walletTransactionId: this.idGenerator.newId(),
          expiredAt: input.at
        });
        walletReleased += result.walletReleased;
        await this.outboxWriter.append(orderExpiredEvent(
          this.idGenerator.newId(),
          order,
          result.walletReleased,
          input.at
        ));
      }

      return {
        claimed: orders.length,
        expired: orders.length,
        walletReleasedKopecks: walletReleased.toString()
      };
    });
  }
}

function orderExpiredEvent(
  eventId: string,
  order: ExpirableOrder,
  walletReleased: MoneyKopecks,
  occurredAt: Date
): DomainEvent<{
  orderId: string;
  userId: string;
  eventId: string;
  previousStatus: OrderStatus;
  walletReleasedKopecks: string;
}> {
  return {
    eventId,
    aggregateType: "order",
    aggregateId: order.id,
    eventType: "OrderExpired",
    schemaVersion: 1,
    payload: {
      orderId: order.id,
      userId: order.userId,
      eventId: order.eventId,
      previousStatus: order.status,
      walletReleasedKopecks: walletReleased.toString()
    },
    occurredAt
  };
}
