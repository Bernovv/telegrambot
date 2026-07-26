import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CreateOrderCommand } from "@ticket-platform/contracts";
import type { DomainEvent, PricingRule } from "@ticket-platform/domain";
import {
  CreateOrderService,
  type OrderReferenceGenerator,
  type OrderSalesContext,
  type OrderSalesRepository,
  type PersistedOrder,
  type PersistOrderInput
} from "./orders.js";

const createdAt = new Date("2026-07-24T12:00:00.000Z");

describe("CreateOrderService", () => {
  it("creates an offer-gated immutable snapshot and applies the available wallet", async () => {
    const fixture = createFixture();

    const result = await fixture.service.execute(command([
      { productId: "standard", quantity: 1 }
    ], { mode: "all" }));

    assert.deepEqual(result, {
      orderId: "id-2",
      orderNumber: "BP-ID-2",
      publicToken: "order_token_id-2",
      offerPublicUrl: "https://example.test/offers/offer-version-1",
      status: "awaiting_offer",
      currency: "RUB",
      totalKopecks: "249000",
      walletAppliedKopecks: "10000",
      externalDueKopecks: "239000",
      expiresAt: "2026-07-24T12:30:00.000Z",
      created: true
    });
    assert.equal(fixture.persistedInputs[0]?.offerVersionId, "offer-version-1");
    assert.deepEqual(fixture.events.map((event) => event.eventType), ["OrderCreated"]);
  });

  it("prices adult quantity independently from child quantity", async () => {
    const fixture = createFixture();

    const result = await fixture.service.execute(command([
      { productId: "standard", quantity: 3 },
      { productId: "child", quantity: 2 }
    ], { mode: "none" }));

    assert.equal(result.totalKopecks, "695000");
    assert.equal(result.externalDueKopecks, "695000");
    assert.deepEqual(
      fixture.persistedInputs[0]?.items.map((item) => item.unitPrice),
      [199_000n, 49_000n]
    );
  });

  it("rejects insufficient event capacity before persistence", async () => {
    const fixture = createFixture({
      context: { ...salesContext, reservedEventInventoryUnits: 98 }
    });

    await assert.rejects(
      fixture.service.execute(command([
        { productId: "standard", quantity: 3 }
      ], { mode: "none" })),
      /Event capacity is insufficient/
    );
    assert.equal(fixture.persistedInputs.length, 0);
    assert.equal(fixture.events.length, 0);
  });

  it("returns an existing order without repeating outbox effects", async () => {
    const fixture = createFixture();
    const createCommand = command([{ productId: "standard", quantity: 1 }], { mode: "none" });

    const first = await fixture.service.execute(createCommand);
    const second = await fixture.service.execute(createCommand);

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.orderId, first.orderId);
    assert.equal(fixture.persistedInputs.length, 1);
    assert.equal(fixture.events.length, 1);
  });

  it("rejects reuse of an idempotency key with a different request", async () => {
    const fixture = createFixture();

    await fixture.service.execute(command([
      { productId: "standard", quantity: 1 }
    ], { mode: "none" }));

    await assert.rejects(
      fixture.service.execute(command([
        { productId: "standard", quantity: 2 }
      ], { mode: "none" })),
      /already used for a different request/
    );
  });
});

function createFixture(options: { readonly context?: OrderSalesContext } = {}) {
  const context = options.context ?? salesContext;
  const persistedInputs: PersistOrderInput[] = [];
  const events: DomainEvent[] = [];
  const orders = new Map<string, PersistedOrder>();
  let id = 0;

  const repository: OrderSalesRepository = {
    async findByIdempotencyKey(idempotencyKey) {
      return orders.get(idempotencyKey) ?? null;
    },
    async lockAndLoadSalesContext() {
      return context;
    },
    async persistOrder(input) {
      persistedInputs.push(input);
      const order: PersistedOrder = {
        id: input.id,
        number: input.number,
        status: input.status,
        currency: input.currency,
        total: input.total,
        walletApplied: input.walletApplied,
        externalDue: input.externalDue,
        expiresAt: input.expiresAt,
        creationRequestHash: input.creationRequestHash,
        offerPublicUrl: input.offerPublicUrl
      };
      orders.set(input.creationIdempotencyKey, order);
      return { created: true, order };
    }
  };
  const referenceGenerator: OrderReferenceGenerator = {
    orderNumber(orderId) {
      return `BP-${orderId.toUpperCase()}`;
    },
    publicToken(orderId) {
      return { token: `order_token_${orderId}`, sha256: "a".repeat(64) };
    }
  };

  return {
    service: new CreateOrderService(
      repository,
      { async append(event) { events.push(event); } },
      { async transact(work) { return work(); } },
      { newId() { id += 1; return `id-${id}`; } },
      referenceGenerator
    ),
    persistedInputs,
    events
  };
}

function command(
  items: CreateOrderCommand["items"],
  wallet: CreateOrderCommand["wallet"]
): CreateOrderCommand {
  return {
    idempotencyKey: "telegram-order:1001",
    userId: "user-1",
    eventId: "event-1",
    currency: "RUB",
    items,
    wallet,
    source: "telegram",
    createdAt
  };
}

function rule(
  id: string,
  productId: string,
  minimumQuantity: number,
  maximumQuantity: number | null,
  unitPrice: bigint
): PricingRule {
  return {
    id,
    productId,
    currency: "RUB",
    unitPrice,
    priority: 10,
    specificity: 1,
    minimumQuantity,
    maximumQuantity,
    validFrom: null,
    validUntil: null,
    explanation: "Business Picnic price"
  };
}

const salesContext: OrderSalesContext = {
  event: {
    id: "event-1",
    slug: "business-picnic",
    title: "Business Picnic",
    timezone: "Europe/Moscow",
    startsAt: new Date("2026-08-20T07:00:00.000Z"),
    endsAt: new Date("2026-08-20T18:00:00.000Z"),
    salesStartsAt: new Date("2026-07-01T00:00:00.000Z"),
    salesEndsAt: new Date("2026-08-20T06:00:00.000Z"),
    status: "published",
    capacity: 100,
    phoneRequiredForPurchase: true,
    offerRequired: true,
    activeOfferVersionId: "offer-version-1",
    activeOfferPublicUrl: "https://example.test/offers/offer-version-1",
    reservationTtlMinutes: 30
  },
  userPhoneStatus: "verified",
  walletAvailable: 10_000n,
  reservedEventInventoryUnits: 0,
  reservedProductInventoryUnits: {},
  products: [
    {
      id: "standard",
      code: "standard",
      productType: "adult_standard",
      title: "Standard",
      currency: "RUB",
      bundleComposition: [],
      inventoryUnitsPerItem: 1,
      capacity: null,
      maximumQuantityPerOrder: 10,
      isActive: true,
      pricingRules: [
        rule("standard-1-2", "standard", 1, 2, 249_000n),
        rule("standard-3-4", "standard", 3, 4, 199_000n),
        rule("standard-5", "standard", 5, null, 171_000n)
      ]
    },
    {
      id: "child",
      code: "child",
      productType: "child",
      title: "Child",
      currency: "RUB",
      bundleComposition: [],
      inventoryUnitsPerItem: 1,
      capacity: null,
      maximumQuantityPerOrder: 10,
      isActive: true,
      pricingRules: [
        rule("child-price", "child", 1, null, 49_000n)
      ]
    }
  ]
};
