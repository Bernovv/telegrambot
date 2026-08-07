import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminRequestActor, EventParticipant } from "@ticket-platform/contracts";
import {
  AdminEventParticipantsService,
  ParticipantsEventNotFoundError,
  buildParticipantsView,
  type AdminEventParticipantsRepository,
  type ParticipantOrderItemRow
} from "./admin-event-participants.js";

const ADULT = [{ role: "adult", quantity: 1 }] as const;
const CHILD = [{ role: "child", quantity: 1 }] as const;

const EVENT_ID = "019c0123-4567-789a-bcde-f0123456789a";
const ADMIN_ID = "019c0123-4567-789a-bcde-f0123456789b";
const ORDER_ID = "019c0123-4567-789a-bcde-f0123456789c";
const OTHER_ORDER_ID = "019c0123-4567-789a-bcde-f0123456789d";

describe("buildParticipantsView", () => {
  it("collapses the items of one order into a single row", () => {
    const view = buildParticipantsView({
      event: { id: EVENT_ID, title: "Бизнес-Пикник" },
      items: [
        item({
          productTitle: "Все включено",
          quantity: 1,
          bundleComposition: [{ role: "adult", quantity: 2 }],
          inventoryUnitsPerItem: 2,
          includesSleepingPlace: true
        }),
        item({ productTitle: "Детский", quantity: 3, bundleComposition: CHILD }),
        // Тот же тариф второй строкой заказа: в подписи он должен остаться один.
        item({ productTitle: "Детский", quantity: 1, bundleComposition: CHILD })
      ],
      participants: [],
      excludedOrders: 0,
      canManageParticipants: true,
      calculatedAt: new Date("2026-08-10T09:00:00.000Z")
    });

    assert.equal(view.rows.length, 1);
    const row = view.rows[0];
    assert.equal(row?.key, `order:${ORDER_ID}`);
    assert.equal(row?.ticketTitle, "Все включено, Детский");
    assert.equal(row?.adults, 2);
    assert.equal(row?.children, 4);
    assert.equal(row?.sleepingPlaces, 2);
    assert.equal(row?.channel, "telegram");
  });

  it("names a buyer by their order when the profile has no name at all", () => {
    const view = buildParticipantsView({
      event: { id: EVENT_ID, title: "Бизнес-Пикник" },
      items: [item({ buyerName: null, orderNumber: "BP-0042" })],
      participants: [],
      excludedOrders: 0,
      canManageParticipants: false,
      calculatedAt: new Date("2026-08-10T09:00:00.000Z")
    });

    assert.equal(view.rows[0]?.displayName, "Заказ BP-0042");
  });

  it("adds up money as kopecks in bigint, not as floating point rubles", () => {
    const view = buildParticipantsView({
      event: { id: EVENT_ID, title: "Бизнес-Пикник" },
      items: [
        item({ totalKopecks: "9007199254740993" }),
        item({ orderId: OTHER_ORDER_ID, totalKopecks: "1" })
      ],
      participants: [],
      excludedOrders: 0,
      canManageParticipants: false,
      calculatedAt: new Date("2026-08-10T09:00:00.000Z")
    });

    assert.equal(view.totals.amountKopecks, "9007199254740994");
  });

  it("keeps manual participants next to buyers and counts both in the totals", () => {
    const view = buildParticipantsView({
      event: { id: EVENT_ID, title: "Бизнес-Пикник" },
      items: [item({
        bundleComposition: [{ role: "adult", quantity: 2 }],
        inventoryUnitsPerItem: 2,
        includesSleepingPlace: true,
        totalKopecks: "498000"
      })],
      participants: [participant({ adults: 1, children: 2, sleepingPlaces: 3 })],
      excludedOrders: 2,
      canManageParticipants: true,
      calculatedAt: new Date("2026-08-10T09:00:00.000Z")
    });

    assert.deepEqual(view.totals, {
      people: 2,
      guests: 5,
      adults: 3,
      children: 2,
      sleepingPlaces: 5,
      amountKopecks: "748000",
      fromOrders: 2,
      fromManual: 3
    });
    assert.equal(view.rows[1]?.channel, "max");
    assert.equal(view.rows[1]?.origin, "manual");
    assert.equal(view.excludedOrders, 2);
  });
});

describe("AdminEventParticipantsService", () => {
  it("refuses an actor that arrived with someone else's permission", async () => {
    const service = new AdminEventParticipantsService(repository(), clock);

    await assert.rejects(
      () => service.list({ actor: actorWith("orders.read"), eventId: EVENT_ID }),
      /permission is invalid/
    );
  });

  it("reports a missing event instead of an empty list", async () => {
    const service = new AdminEventParticipantsService(
      repository({ async findEvent() { return null; } }),
      clock
    );

    await assert.rejects(
      () => service.list({ actor: actorWith("accommodation.read"), eventId: EVENT_ID }),
      ParticipantsEventNotFoundError
    );
  });

  it("reports whether the administrator may edit manual participants", async () => {
    const readOnly = new AdminEventParticipantsService(
      repository({ async hasPermission() { return false; } }),
      clock
    );

    const view = await readOnly.list({
      actor: actorWith("accommodation.read"),
      eventId: EVENT_ID
    });

    assert.equal(view.canManageParticipants, false);
    assert.equal(view.eventTitle, "Бизнес-Пикник");
  });
});

const clock = { now: () => new Date("2026-08-10T09:00:00.000Z") };

function actorWith(permission: string): AdminRequestActor {
  return { adminId: ADMIN_ID, permission } as AdminRequestActor;
}

function repository(
  overrides: Partial<AdminEventParticipantsRepository> = {}
): AdminEventParticipantsRepository {
  return {
    async findEvent() {
      return { id: EVENT_ID, title: "Бизнес-Пикник" };
    },
    async listPaidOrderItems() {
      return [item({})];
    },
    async listParticipants() {
      return [];
    },
    async countExcludedOrders() {
      return 0;
    },
    async hasPermission() {
      return true;
    },
    ...overrides
  };
}

function item(
  overrides: Partial<ParticipantOrderItemRow>
): ParticipantOrderItemRow {
  return {
    orderId: ORDER_ID,
    orderNumber: "BP-0001",
    buyerName: "Иван",
    phone: "+79000000000",
    telegramUsername: "ivan",
    paidAt: new Date("2026-08-01T10:00:00.000Z"),
    totalKopecks: "249000",
    productTitle: "Стандарт",
    quantity: 1,
    bundleComposition: ADULT,
    inventoryUnitsPerItem: 1,
    includesSleepingPlace: false,
    ...overrides
  };
}

function participant(overrides: Partial<EventParticipant>): EventParticipant {
  return {
    id: "019c0123-4567-789a-bcde-f0123456789e",
    displayName: "Мария",
    phone: null,
    source: "max",
    ticketTitle: "Все включено",
    adults: 1,
    children: 0,
    sleepingPlaces: 0,
    note: "оплатила переводом",
    outreachContactId: null,
    amountKopecks: "250000",
    paidAt: "2026-08-02T10:00:00.000Z",
    paymentMethod: "перевод",
    customFields: [],
    createdAt: "2026-08-02T10:00:00.000Z",
    ...overrides
  };
}
