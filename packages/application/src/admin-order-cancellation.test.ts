import type { AdminRequestActor } from "@ticket-platform/contracts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AdminCancelOrderService,
  type AdminOrderCancellationRepository,
  type CancellableOrder,
  type CancelOrderInput
} from "./admin-order-cancellation.js";

const ADMIN_ID = "019c7a20-0000-7000-8000-0000000000aa";
const ORDER_ID = "019c7a20-0000-7000-8000-000000000101";
const now = new Date("2026-08-01T10:00:00.000Z");

function actor(permission: AdminRequestActor["permission"]): AdminRequestActor {
  return {
    adminId: ADMIN_ID,
    authSubject: "auth-subject",
    roleCodes: ["super_admin"],
    permission
  };
}

function order(overrides: Partial<CancellableOrder> = {}): CancellableOrder {
  return {
    id: ORDER_ID,
    number: "BP-20260801-TEST",
    userId: "019c7a20-0000-7000-8000-0000000000bb",
    eventId: "019c7a20-0000-7000-8000-000000000001",
    status: "awaiting_payment",
    walletApplied: 10_000n,
    ...overrides
  };
}

function harness(overrides: Partial<AdminOrderCancellationRepository> = {}) {
  const cancelled: CancelOrderInput[] = [];
  const outbox: unknown[] = [];
  let sequence = 0;
  const repository: AdminOrderCancellationRepository = {
    async findCancellableOrder() { return order(); },
    async cancelOrder(input) {
      cancelled.push(input);
      return { walletReleased: input.order.walletApplied };
    },
    ...overrides
  };
  const service = new AdminCancelOrderService(
    repository,
    { append: async (event) => { outbox.push(event); } },
    { transact: async (work) => work() },
    { newId: () => `019c7a20-0000-7000-8000-00000000f${(sequence += 1).toString().padStart(3, "0")}` }
  );
  return { service, cancelled, outbox };
}

describe("AdminCancelOrderService", () => {
  it("releases the wallet hold together with the order", async () => {
    const { service, cancelled } = harness();

    const result = await service.execute({
      actor: actor("orders.cancel"),
      orderId: ORDER_ID,
      reason: "Клиент передумал",
      now
    });

    assert.equal(result.walletReleasedKopecks, "10000");
    assert.equal(cancelled[0]?.reason, "Клиент передумал");
    assert.equal(cancelled[0]?.adminId, ADMIN_ID);
  });

  it("announces the cancellation so the rest of the system can react", async () => {
    const { service, outbox } = harness();

    await service.execute({
      actor: actor("orders.cancel"),
      orderId: ORDER_ID,
      reason: "Дубль заказа",
      now
    });

    const event = outbox[0] as {
      eventType: string;
      payload: { walletReleasedKopecks: string; cancelledByAdminId: string };
    };
    assert.equal(event.eventType, "OrderCancelledByAdmin");
    assert.equal(event.payload.walletReleasedKopecks, "10000");
    assert.equal(event.payload.cancelledByAdminId, ADMIN_ID);
  });

  it("refuses a paid order — there are real money in it", async () => {
    // Машина состояний разрешает из paid только возвраты, и опираться надо на неё:
    // свой список статусов однажды с ней разойдётся.
    const { service } = harness({
      async findCancellableOrder() {
        return order({ status: "paid" as CancellableOrder["status"] });
      }
    });

    await assert.rejects(
      service.execute({
        actor: actor("orders.cancel"),
        orderId: ORDER_ID,
        reason: "Ошиблись",
        now
      }),
      /Order in status paid cannot be cancelled/
    );
  });

  it("refuses an order whose payment is already in flight", async () => {
    const { service } = harness({
      async findCancellableOrder() {
        return order({ status: "payment_processing" as CancellableOrder["status"] });
      }
    });

    await assert.rejects(
      service.execute({
        actor: actor("orders.cancel"),
        orderId: ORDER_ID,
        reason: "Ошиблись",
        now
      }),
      /Order in status payment_processing cannot be cancelled/
    );
  });

  it("reports a missing order instead of pretending it was cancelled", async () => {
    const { service, cancelled } = harness({
      async findCancellableOrder() { return null; }
    });

    await assert.rejects(
      service.execute({
        actor: actor("orders.cancel"),
        orderId: ORDER_ID,
        reason: "Ошиблись",
        now
      }),
      /Order was not found/
    );
    assert.equal(cancelled.length, 0);
  });

  it("demands a reason: in six months nobody remembers why", async () => {
    const { service } = harness();

    await assert.rejects(
      service.execute({
        actor: actor("orders.cancel"),
        orderId: ORDER_ID,
        reason: "  ",
        now
      }),
      /reason is invalid/
    );
  });

  it("does not accept an actor scoped to another permission", async () => {
    const { service } = harness();

    await assert.rejects(
      service.execute({
        actor: actor("orders.read"),
        orderId: ORDER_ID,
        reason: "Клиент передумал",
        now
      }),
      /permission is invalid/
    );
  });

  it("keeps the outbox event out when the cancellation itself failed", async () => {
    const { service, outbox } = harness({
      async cancelOrder() {
        throw new Error("Wallet hold requires reconciliation for order");
      }
    });

    await assert.rejects(
      service.execute({
        actor: actor("orders.cancel"),
        orderId: ORDER_ID,
        reason: "Клиент передумал",
        now
      }),
      /requires reconciliation/
    );
    assert.equal(outbox.length, 0);
  });

  it("handles an order that never held any bonuses", async () => {
    const { service } = harness({
      async findCancellableOrder() { return order({ walletApplied: 0n }); }
    });

    const result = await service.execute({
      actor: actor("orders.cancel"),
      orderId: ORDER_ID,
      reason: "Брошенная корзина",
      now
    });

    assert.equal(result.walletReleasedKopecks, "0");
  });
});
