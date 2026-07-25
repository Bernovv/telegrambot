import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import type {
  CreateOrderCommand,
  CreateOrderResult
} from "@ticket-platform/contracts";
import {
  OrdersController,
  type CreateOrderCommandHandler
} from "./orders-api.js";

describe("OrdersController", () => {
  it("validates the boundary and delegates business logic", async () => {
    let received: CreateOrderCommand | undefined;
    const controller = new OrdersController({
      async execute(command) {
        received = command;
        return orderResult;
      }
    });

    const result = await controller.execute({
      userId: "019c0123-4567-789a-bcde-f0123456789a",
      eventId: "019c0123-4567-789a-bcde-f0123456789b",
      currency: "RUB",
      items: [{
        productId: "019c0123-4567-789a-bcde-f0123456789c",
        quantity: 2
      }],
      wallet: { mode: "all" }
    }, "admin-order:1001");

    assert.equal(result, orderResult);
    assert.equal(received?.source, "admin");
    assert.equal(received?.idempotencyKey, "admin-order:1001");
    assert.ok(received?.createdAt instanceof Date);
  });

  it("rejects malformed bodies and missing idempotency keys", async () => {
    const controller = new OrdersController(noopHandler);

    await assert.rejects(
      controller.execute({ currency: "rub" }, "admin-order:1001"),
      BadRequestException
    );
    await assert.rejects(
      controller.execute({
        userId: "019c0123-4567-789a-bcde-f0123456789a",
        eventId: "019c0123-4567-789a-bcde-f0123456789b",
        currency: "RUB",
        items: [{
          productId: "019c0123-4567-789a-bcde-f0123456789c",
          quantity: 2
        }],
        wallet: { mode: "none" }
      }, undefined),
      BadRequestException
    );
  });
});

const noopHandler: CreateOrderCommandHandler = {
  async execute() {
    return orderResult;
  }
};

const orderResult: CreateOrderResult = {
  orderId: "019c0123-4567-789a-bcde-f0123456789d",
  orderNumber: "BP-20260724-4567789ABCDEF0123456789D",
  publicToken: "opaque",
  status: "awaiting_offer",
  currency: "RUB",
  totalKopecks: "498000",
  walletAppliedKopecks: "10000",
  externalDueKopecks: "488000",
  expiresAt: "2026-07-24T12:30:00.000Z",
  created: true
};
