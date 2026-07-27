import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CreateOrderCommand, CreateOrderResult } from "@ticket-platform/contracts";
import {
  TelegramPurchaseFlowService,
  type EventCatalogRepository,
  type OrderCreationPort,
  type PublishedEventCatalog,
  type PurchaseDraft,
  type PurchaseDraftRepository
} from "./telegram-purchase-flow.js";

const now = new Date("2026-07-27T10:00:00.000Z");

describe("TelegramPurchaseFlowService", () => {
  it("asks for quantity when a Standard/VIP ticket type is chosen", async () => {
    const fixture = createFixture();

    const result = await fixture.service.selectTicketType("111", "adult_standard", now);

    assert.deepEqual(result, { kind: "ask_quantity", ticketLabel: "Стандарт" });
    assert.equal(fixture.drafts.get("user-111")?.step, "awaiting_quantity");
  });

  it("creates a family order immediately, with no quantity question", async () => {
    const fixture = createFixture();

    const result = await fixture.service.selectTicketType("111", "family_vip", now);

    assert.equal(result.kind, "order_created");
    if (result.kind === "order_created") {
      assert.equal(result.adultQuantity, 2);
      assert.equal(result.childQuantity, 1);
    }
    assert.deepEqual(fixture.executedCommands[0]?.items, [{ productId: "family_vip-id", quantity: 1 }]);
    assert.equal(fixture.drafts.has("user-111"), false);
  });

  it("rejects non-numeric or out-of-range quantity text without touching the draft step", async () => {
    const fixture = createFixture();
    await fixture.service.selectTicketType("111", "adult_vip", now);

    const invalid = await fixture.service.handleQuantityText("111", "не число", now);
    const tooBig = await fixture.service.handleQuantityText("111", "999", now);

    assert.deepEqual(invalid, { kind: "invalid_quantity" });
    assert.deepEqual(tooBig, { kind: "invalid_quantity" });
    assert.equal(fixture.drafts.get("user-111")?.step, "awaiting_quantity");
  });

  it("moves to awaiting_child_quantity and shows an interim summary after a valid quantity", async () => {
    const fixture = createFixture();
    await fixture.service.selectTicketType("111", "adult_vip", now);

    const result = await fixture.service.handleQuantityText("111", "3", now);

    assert.deepEqual(result, { kind: "interim_summary", ticketLabel: "Все включено", adultQuantity: 3 });
    assert.equal(fixture.drafts.get("user-111")?.step, "awaiting_child_quantity");
  });

  it("creates the order with both adult and child items when child tickets are added", async () => {
    const fixture = createFixture();
    await fixture.service.selectTicketType("111", "adult_standard", now);
    await fixture.service.handleQuantityText("111", "3", now);

    const result = await fixture.service.handleChildQuantityText("111", "2", now);

    assert.equal(result.kind, "order_created");
    assert.deepEqual(fixture.executedCommands[0]?.items, [
      { productId: "adult_standard-id", quantity: 3 },
      { productId: "child-id", quantity: 2 }
    ]);
    assert.equal(fixture.drafts.has("user-111"), false);
  });

  it("skips the child ticket line entirely when the user declines it", async () => {
    const fixture = createFixture();
    await fixture.service.selectTicketType("111", "adult_standard", now);
    await fixture.service.handleQuantityText("111", "2", now);

    const result = await fixture.service.skipChildTicket("111", now);

    assert.equal(result.kind, "order_created");
    assert.deepEqual(fixture.executedCommands[0]?.items, [{ productId: "adult_standard-id", quantity: 2 }]);
  });

  it("reports no_active_draft instead of guessing when there is nothing to confirm", async () => {
    const fixture = createFixture();

    const result = await fixture.service.handleQuantityText("111", "2", now);

    assert.deepEqual(result, { kind: "no_active_draft" });
  });

  it("reports catalog_unavailable rather than creating a broken order when the event catalog is missing", async () => {
    const fixture = createFixture({ catalog: null });

    const result = await fixture.service.selectTicketType("111", "family_standard", now);

    assert.deepEqual(result, { kind: "catalog_unavailable" });
  });

  it("gives two separate purchase attempts by the same user two different idempotency keys", async () => {
    const fixture = createFixture();
    await fixture.service.selectTicketType("111", "adult_standard", now);
    await fixture.service.handleQuantityText("111", "1", now);
    await fixture.service.skipChildTicket("111", now);

    await fixture.service.selectTicketType("111", "adult_vip", now);
    await fixture.service.handleQuantityText("111", "1", now);
    await fixture.service.skipChildTicket("111", now);

    assert.equal(fixture.executedCommands.length, 2);
    assert.notEqual(fixture.executedCommands[0]?.idempotencyKey, fixture.executedCommands[1]?.idempotencyKey);
  });

  it("clears the draft after a successful order so a repeat tap reports no_active_draft instead of a second order", async () => {
    const fixture = createFixture();
    await fixture.service.selectTicketType("111", "adult_standard", now);
    await fixture.service.handleQuantityText("111", "1", now);
    await fixture.service.skipChildTicket("111", now);

    const repeat = await fixture.service.skipChildTicket("111", now);

    assert.deepEqual(repeat, { kind: "no_active_draft" });
    assert.equal(fixture.executedCommands.length, 1);
  });
});

interface Fixture {
  readonly service: TelegramPurchaseFlowService;
  readonly drafts: Map<string, PurchaseDraft>;
  readonly executedCommands: CreateOrderCommand[];
}

function createFixture(overrides: { readonly catalog?: PublishedEventCatalog | null } = {}): Fixture {
  const drafts = new Map<string, PurchaseDraft>();
  const executedCommands: CreateOrderCommand[] = [];
  let nextId = 0;

  const draftRepository: PurchaseDraftRepository = {
    async getDraft(userId) {
      return drafts.get(userId) ?? null;
    },
    async setDraft(userId, draft) {
      drafts.set(userId, draft);
    },
    async clearDraft(userId) {
      drafts.delete(userId);
    }
  };

  const catalog: PublishedEventCatalog | null = overrides.catalog === undefined
    ? {
        eventId: "event-1",
        currency: "RUB",
        offerUrl: "https://max-bot.biz-day.ru/offer/business-picnic-2026-v1.pdf",
        products: {
          adult_standard: { id: "adult_standard-id", maximumQuantityPerOrder: 50 },
          adult_vip: { id: "adult_vip-id", maximumQuantityPerOrder: 50 },
          child: { id: "child-id", maximumQuantityPerOrder: 50 },
          family_standard: { id: "family_standard-id", maximumQuantityPerOrder: 20 },
          family_vip: { id: "family_vip-id", maximumQuantityPerOrder: 20 }
        }
      }
    : overrides.catalog;

  const catalogRepository: EventCatalogRepository = {
    async findPublishedCatalog() {
      return catalog;
    }
  };

  const orderCreation: OrderCreationPort = {
    async execute(command) {
      executedCommands.push(command);
      const result: CreateOrderResult = {
        orderId: `order-${executedCommands.length}`,
        orderNumber: `BP-${executedCommands.length}`,
        publicToken: `token-${executedCommands.length}`,
        offerPublicUrl: null,
        status: "awaiting_offer",
        currency: command.currency,
        totalKopecks: "100000",
        walletAppliedKopecks: "0",
        externalDueKopecks: "100000",
        expiresAt: "2026-07-27T10:30:00.000Z",
        created: true
      };
      return result;
    }
  };

  const service = new TelegramPurchaseFlowService(
    draftRepository,
    catalogRepository,
    orderCreation,
    { async resolveUserId(externalUserId) { return `user-${externalUserId}`; } },
    { newId: () => `nonce-${nextId++}` },
    "business-picnic-2026",
    { async transact(work) { return work(); } }
  );

  return { service, drafts, executedCommands };
}
