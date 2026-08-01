import type { AdminRequestActor } from "@ticket-platform/contracts";
import type { DomainEvent, MoneyKopecks, OrderStatus } from "@ticket-platform/domain";
import { assertOrderTransition } from "@ticket-platform/domain";
import type { IdGenerator, OutboxWriter, UnitOfWork } from "./identity.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Отменить руками можно только незавершённый заказ. Оплаченный отменять нельзя — там
 * деньги, для них есть возврат; `payment_processing` тоже нельзя: платёж уже в пути у
 * банка, и отмена разошлась бы с тем, что произойдёт на его стороне.
 */
export type CancellableOrderStatus =
  | "draft"
  | "awaiting_offer"
  | "awaiting_payment";

const CANCELLABLE_STATUSES: ReadonlySet<string> = new Set<CancellableOrderStatus>([
  "draft",
  "awaiting_offer",
  "awaiting_payment"
]);

export interface CancellableOrder {
  readonly id: string;
  readonly number: string;
  readonly userId: string;
  readonly eventId: string;
  readonly status: CancellableOrderStatus;
  readonly walletApplied: MoneyKopecks;
}

export interface CancelOrderInput {
  readonly order: CancellableOrder;
  readonly historyId: string;
  readonly walletTransactionId: string;
  readonly adminId: string;
  readonly reason: string;
  readonly cancelledAt: Date;
}

export interface CancelOrderResult {
  readonly walletReleased: MoneyKopecks;
}

export interface AdminOrderCancellationRepository {
  findCancellableOrder(orderId: string): Promise<CancellableOrder | null>;
  cancelOrder(input: CancelOrderInput): Promise<CancelOrderResult>;
}

export class OrderNotCancellableError extends Error {
  constructor(readonly status: OrderStatus) {
    super(`Order in status ${status} cannot be cancelled`);
    this.name = "OrderNotCancellableError";
  }
}

export class CancellableOrderNotFoundError extends Error {
  constructor() {
    super("Order was not found");
    this.name = "CancellableOrderNotFoundError";
  }
}

export interface CancelOrderCommandResult {
  readonly orderNumber: string;
  readonly walletReleasedKopecks: string;
}

/**
 * Ручная отмена зависшего заказа.
 *
 * Это не просто смена статуса: у неоплаченного заказа могут быть забронированные места и
 * захолдированные бонусы покупателя. Их надо вернуть теми же шагами, что делает истечение
 * брони, иначе места останутся заняты, а бонусы зависнут у человека навсегда.
 */
export class AdminCancelOrderService {
  constructor(
    private readonly repository: AdminOrderCancellationRepository,
    private readonly outboxWriter: OutboxWriter,
    private readonly unitOfWork: UnitOfWork,
    private readonly idGenerator: IdGenerator
  ) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly orderId: string;
    readonly reason: string;
    readonly now: Date;
  }): Promise<CancelOrderCommandResult> {
    if (
      input.actor.permission !== "orders.cancel"
      || !UUID_PATTERN.test(input.actor.adminId)
    ) {
      throw new Error("Administrator order cancellation permission is invalid");
    }
    if (!UUID_PATTERN.test(input.orderId)) {
      throw new Error("Order cancellation request is invalid");
    }
    const reason = input.reason.trim();
    if (reason.length < 3 || reason.length > 500) {
      throw new Error("Order cancellation reason is invalid");
    }

    return this.unitOfWork.transact(async () => {
      const order = await this.repository.findCancellableOrder(input.orderId);
      if (!order) {
        throw new CancellableOrderNotFoundError();
      }
      // Машина состояний разрешает отменить и `payment_processing`, но платёж там уже
      // ушёл в банк: наша отмена разошлась бы с тем, что произойдёт на его стороне.
      // Поэтому список сужен здесь, а не только в запросе к базе.
      if (!CANCELLABLE_STATUSES.has(order.status)) {
        throw new OrderNotCancellableError(order.status);
      }
      assertOrderTransition(order.status, "cancelled");

      const result = await this.repository.cancelOrder({
        order,
        historyId: this.idGenerator.newId(),
        walletTransactionId: this.idGenerator.newId(),
        adminId: input.actor.adminId,
        reason,
        cancelledAt: input.now
      });

      await this.outboxWriter.append(orderCancelledEvent(
        this.idGenerator.newId(),
        order,
        result.walletReleased,
        input.actor.adminId,
        input.now
      ));

      return {
        orderNumber: order.number,
        walletReleasedKopecks: result.walletReleased.toString()
      };
    });
  }
}

function orderCancelledEvent(
  eventId: string,
  order: CancellableOrder,
  walletReleased: MoneyKopecks,
  adminId: string,
  occurredAt: Date
): DomainEvent<{
  orderId: string;
  userId: string;
  eventId: string;
  previousStatus: OrderStatus;
  walletReleasedKopecks: string;
  cancelledByAdminId: string;
}> {
  return {
    eventId,
    aggregateType: "order",
    aggregateId: order.id,
    eventType: "OrderCancelledByAdmin",
    schemaVersion: 1,
    payload: {
      orderId: order.id,
      userId: order.userId,
      eventId: order.eventId,
      previousStatus: order.status,
      walletReleasedKopecks: walletReleased.toString(),
      cancelledByAdminId: adminId
    },
    occurredAt
  };
}
