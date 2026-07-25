import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DomainEvent } from "@ticket-platform/domain";
import {
  ExpireOrdersBatchService,
  type ExpirableOrder,
  type ExpireOrderInput,
  type OrderExpiryRepository
} from "./order-expiry.js";

const expiredAt = new Date("2026-07-24T12:30:00.000Z");

describe("ExpireOrdersBatchService", () => {
  it("expires a bounded claimed batch and publishes one event per order", async () => {
    const expiredInputs: ExpireOrderInput[] = [];
    const events: DomainEvent[] = [];
    let id = 0;
    const repository: OrderExpiryRepository = {
      async claimExpiredOrders(at, batchSize) {
        assert.equal(at, expiredAt);
        assert.equal(batchSize, 50);
        return orders;
      },
      async expireOrder(input) {
        expiredInputs.push(input);
        return { walletReleased: input.order.id === "order-1" ? 10_000n : 0n };
      }
    };
    const service = new ExpireOrdersBatchService(
      repository,
      { async append(event) { events.push(event); } },
      { async transact(work) { return work(); } },
      { newId() { id += 1; return `id-${id}`; } }
    );

    const result = await service.execute({ at: expiredAt, batchSize: 50 });

    assert.deepEqual(result, {
      claimed: 2,
      expired: 2,
      walletReleasedKopecks: "10000"
    });
    assert.deepEqual(expiredInputs.map((input) => input.historyId), ["id-1", "id-4"]);
    assert.deepEqual(events.map((event) => event.eventType), ["OrderExpired", "OrderExpired"]);
    assert.equal(events[0]?.payload.walletReleasedKopecks, "10000");
  });

  it("rejects an unbounded batch before opening a transaction", async () => {
    let transactions = 0;
    const service = new ExpireOrdersBatchService(
      {
        async claimExpiredOrders() { return []; },
        async expireOrder() { return { walletReleased: 0n }; }
      },
      { async append() {} },
      { async transact(work) { transactions += 1; return work(); } },
      { newId() { return "unused"; } }
    );

    await assert.rejects(
      service.execute({ at: expiredAt, batchSize: 501 }),
      /between 1 and 500/
    );
    assert.equal(transactions, 0);
  });
});

const orders: readonly ExpirableOrder[] = [
  {
    id: "order-1",
    userId: "user-1",
    eventId: "event-1",
    status: "awaiting_payment",
    expiresAt: new Date("2026-07-24T12:29:00.000Z"),
    walletApplied: 10_000n
  },
  {
    id: "order-2",
    userId: "user-2",
    eventId: "event-1",
    status: "awaiting_offer",
    expiresAt: new Date("2026-07-24T12:29:30.000Z"),
    walletApplied: 0n
  }
];
