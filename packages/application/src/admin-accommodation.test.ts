import type { AdminRequestActor } from "@ticket-platform/contracts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AdminAccommodationService,
  buildSummary,
  type AccommodationEventRow,
  type AccommodationGroupRow,
  type AccommodationOrderItemRow,
  type AdminAccommodationRepository
} from "./admin-accommodation.js";

const ADMIN_ID = "019c7a20-0000-7000-8000-0000000000aa";
const EVENT_ID = "019c7a20-0000-7000-8000-000000000001";

const EVENT: AccommodationEventRow = {
  id: EVENT_ID,
  title: "Бизнес-Пикник",
  timezone: "Europe/Moscow",
  startsAt: new Date("2026-08-08T12:00:00+03:00"),
  endsAt: new Date("2026-08-09T20:00:00+03:00")
};

function actor(permission: AdminRequestActor["permission"]): AdminRequestActor {
  return {
    adminId: ADMIN_ID,
    authSubject: "auth-subject",
    roleCodes: ["super_admin"],
    permission
  };
}

function vipAdult(orderId: string, orderNumber: string, quantity: number): AccommodationOrderItemRow {
  return {
    orderId,
    orderNumber,
    buyerName: `Покупатель ${orderNumber}`,
    productId: "product-vip",
    productTitle: "Все включено",
    quantity,
    bundleComposition: [{ role: "adult", quantity: 1 }],
    inventoryUnitsPerItem: 1,
    includesSleepingPlace: true
  };
}

function vipFamily(orderId: string, orderNumber: string): AccommodationOrderItemRow {
  return {
    orderId,
    orderNumber,
    buyerName: `Семья ${orderNumber}`,
    productId: "product-family-vip",
    productTitle: "Семейный Все включено",
    quantity: 1,
    bundleComposition: [
      { role: "adult", quantity: 2 },
      { role: "child", quantity: 1 }
    ],
    inventoryUnitsPerItem: 3,
    includesSleepingPlace: true
  };
}

function standardAdult(orderId: string, orderNumber: string, quantity: number): AccommodationOrderItemRow {
  return {
    orderId,
    orderNumber,
    buyerName: `Покупатель ${orderNumber}`,
    productId: "product-standard",
    productTitle: "Стандарт",
    quantity,
    bundleComposition: [{ role: "adult", quantity: 1 }],
    inventoryUnitsPerItem: 1,
    includesSleepingPlace: false
  };
}

function childTicket(orderId: string, orderNumber: string): AccommodationOrderItemRow {
  return {
    orderId,
    orderNumber,
    buyerName: `Покупатель ${orderNumber}`,
    productId: "product-child",
    productTitle: "Детский билет",
    quantity: 1,
    bundleComposition: [{ role: "child", quantity: 1 }],
    inventoryUnitsPerItem: 1,
    includesSleepingPlace: false
  };
}

function summaryOf(
  items: readonly AccommodationOrderItemRow[],
  groups: readonly AccommodationGroupRow[] = []
) {
  return buildSummary({
    event: EVENT,
    items,
    groups,
    lastPlan: null,
    canManage: true,
    calculatedAt: new Date("2026-07-31T09:00:00Z")
  });
}

describe("buildSummary", () => {
  it("counts guests from the bundle composition, not from ticket count", () => {
    const summary = summaryOf([vipFamily("order-1", "A-1"), standardAdult("order-2", "A-2", 2)]);

    assert.deepEqual(summary.headcount, { guests: 5, adults: 4, children: 1 });
  });

  it("feeds everyone for every day of the event", () => {
    // Пикник 8 августа 12:00 — 9 августа 20:00: это два дня питания, а не полтора.
    const summary = summaryOf([vipFamily("order-1", "A-1")]);

    assert.equal(summary.eventDays, 2);
    assert.equal(summary.mealsAdult, 4);
    assert.equal(summary.mealsChild, 2);
  });

  it("counts a sleeping place only for tickets that include one", () => {
    const summary = summaryOf([
      vipAdult("order-1", "A-1", 2),
      standardAdult("order-2", "A-2", 5)
    ]);

    assert.equal(summary.requiredBerths, 2);
    assert.equal(summary.headcount.guests, 7);
  });

  it("counts a child in a family VIP ticket as a full sleeping place", () => {
    const summary = summaryOf([vipFamily("order-1", "A-1")]);

    assert.equal(summary.requiredBerths, 3);
    assert.deepEqual(summary.tents, [{ capacity: 3, count: 1 }]);
  });

  it("keeps parties apart per order and never merges them on its own", () => {
    const summary = summaryOf([
      vipAdult("order-1", "A-1", 1),
      vipAdult("order-2", "A-2", 1),
      vipAdult("order-3", "A-3", 1)
    ]);

    assert.equal(summary.parties.length, 3);
    assert.equal(summary.singles.length, 3);
    assert.equal(summary.totalTents, 3);
    assert.deepEqual(summary.mergeSuggestion, {
      singleParties: 3,
      tentsNow: 3,
      tentsIfMerged: 1
    });
  });

  it("treats a manually merged group as one party", () => {
    const summary = summaryOf(
      [
        vipAdult("019c7a20-0000-7000-8000-000000000101", "A-1", 1),
        vipAdult("019c7a20-0000-7000-8000-000000000102", "A-2", 1)
      ],
      [
        {
          groupId: "019c7a20-0000-7000-8000-0000000001ff",
          note: "Муж и жена, разные заказы",
          orderIds: [
            "019c7a20-0000-7000-8000-000000000101",
            "019c7a20-0000-7000-8000-000000000102"
          ]
        }
      ]
    );

    assert.equal(summary.parties.length, 1);
    assert.equal(summary.parties[0]?.merged, true);
    assert.equal(summary.parties[0]?.berths, 2);
    assert.deepEqual(summary.tents, [{ capacity: 2, count: 1 }]);
    assert.equal(summary.singles.length, 0);
  });

  it("survives a group whose orders were all refunded", () => {
    const summary = summaryOf([vipAdult("019c7a20-0000-7000-8000-000000000101", "A-1", 1)], [
      {
        groupId: "019c7a20-0000-7000-8000-0000000001ff",
        note: "",
        orderIds: ["019c7a20-0000-7000-8000-0000000009ff"]
      }
    ]);

    assert.equal(summary.parties.length, 1);
    assert.equal(summary.parties[0]?.merged, false);
  });

  it("flags a child who sleeps over without a place of their own", () => {
    // Родители взяли два VIP и отдельный детский билет — ночёвка в него не входит.
    const summary = summaryOf([
      vipAdult("order-1", "A-1", 2),
      childTicket("order-1", "A-1")
    ]);

    assert.equal(summary.requiredBerths, 2);
    assert.equal(summary.childrenWithoutBerth, 1);
  });

  it("stays quiet about children in orders where nobody sleeps over", () => {
    const summary = summaryOf([
      standardAdult("order-1", "A-1", 2),
      childTicket("order-1", "A-1")
    ]);

    assert.equal(summary.childrenWithoutBerth, 0);
  });

  it("leaves day guests out of the tent list entirely", () => {
    const summary = summaryOf([standardAdult("order-1", "A-1", 4)]);

    assert.equal(summary.parties.length, 0);
    assert.equal(summary.totalTents, 0);
    assert.equal(summary.headcount.guests, 4);
  });

  it("breaks the numbers down by product", () => {
    const summary = summaryOf([
      vipFamily("order-1", "A-1"),
      standardAdult("order-2", "A-2", 2)
    ]);

    assert.deepEqual(summary.products, [
      {
        productId: "product-family-vip",
        title: "Семейный Все включено",
        ticketsSold: 1,
        guests: 3,
        adults: 2,
        children: 1,
        sleepingPlaces: 3
      },
      {
        productId: "product-standard",
        title: "Стандарт",
        ticketsSold: 2,
        guests: 2,
        adults: 2,
        children: 0,
        sleepingPlaces: 0
      }
    ]);
  });

  it("shows how many berths arrived after the plan was fixed", () => {
    const summary = buildSummary({
      event: EVENT,
      items: [vipAdult("order-1", "A-1", 5)],
      groups: [],
      lastPlan: {
        id: "plan-1",
        fixedAt: "2026-08-05T09:00:00.000Z",
        fixedByAdminName: "Любовь",
        note: "",
        requiredBerths: 3,
        totalTents: 1,
        tents: [{ capacity: 3, count: 1 }]
      },
      canManage: true,
      calculatedAt: new Date("2026-08-06T09:00:00Z")
    });

    assert.equal(summary.berthsSinceLastPlan, 2);
  });
});

class FakeRepository implements AdminAccommodationRepository {
  readonly createdGroups: unknown[] = [];
  readonly deletedGroups: unknown[] = [];
  readonly insertedPlans: unknown[] = [];

  constructor(
    private readonly items: readonly AccommodationOrderItemRow[] = [],
    private readonly canManage = true,
    private readonly event: AccommodationEventRow | null = EVENT
  ) {}

  findEvent(): Promise<AccommodationEventRow | null> {
    return Promise.resolve(this.event);
  }

  listPaidOrderItems(): Promise<readonly AccommodationOrderItemRow[]> {
    return Promise.resolve(this.items);
  }

  listGroups(): Promise<readonly AccommodationGroupRow[]> {
    return Promise.resolve([]);
  }

  findLastPlan(): Promise<null> {
    return Promise.resolve(null);
  }

  hasManagePermission(): Promise<boolean> {
    return Promise.resolve(this.canManage);
  }

  createGroup(input: unknown): Promise<void> {
    this.createdGroups.push(input);
    return Promise.resolve();
  }

  deleteGroup(eventId: string, groupId: string): Promise<void> {
    this.deletedGroups.push({ eventId, groupId });
    return Promise.resolve();
  }

  insertPlan(input: unknown): Promise<void> {
    this.insertedPlans.push(input);
    return Promise.resolve();
  }
}

function serviceWith(repository: AdminAccommodationRepository): AdminAccommodationService {
  let sequence = 0;
  return new AdminAccommodationService(
    repository,
    { now: () => new Date("2026-07-31T09:00:00Z") },
    { newId: () => `019c7a20-0000-7000-8000-00000000f${(sequence += 1).toString().padStart(3, "0")}` }
  );
}

describe("AdminAccommodationService", () => {
  it("refuses a summary request made with the wrong permission", async () => {
    const service = serviceWith(new FakeRepository());

    await assert.rejects(
      service.summary({ actor: actor("orders.read"), eventId: EVENT_ID }),
      /accommodation permission is invalid/
    );
  });

  it("tells the panel whether this administrator may merge parties", async () => {
    const readOnly = serviceWith(new FakeRepository([], false));

    const summary = await readOnly.summary({
      actor: actor("accommodation.read"),
      eventId: EVENT_ID
    });

    assert.equal(summary.canManage, false);
  });

  it("reports a missing event instead of an empty plan", async () => {
    const service = serviceWith(new FakeRepository([], true, null));

    await assert.rejects(
      service.summary({ actor: actor("accommodation.read"), eventId: EVENT_ID }),
      /Event was not found/
    );
  });

  it("requires the manage permission to merge parties", async () => {
    const service = serviceWith(new FakeRepository());

    await assert.rejects(
      service.mergeParties({
        actor: actor("accommodation.read"),
        eventId: EVENT_ID,
        orderIds: [
          "019c7a20-0000-7000-8000-000000000101",
          "019c7a20-0000-7000-8000-000000000102"
        ],
        note: ""
      }),
      /accommodation permission is invalid/
    );
  });

  it("rejects a merge of fewer than two orders", async () => {
    const service = serviceWith(new FakeRepository());

    await assert.rejects(
      service.mergeParties({
        actor: actor("accommodation.manage"),
        eventId: EVENT_ID,
        orderIds: ["019c7a20-0000-7000-8000-000000000101"],
        note: ""
      }),
      /merge selection is invalid/
    );
  });

  it("rejects a merge that lists the same order twice", async () => {
    const service = serviceWith(new FakeRepository());

    await assert.rejects(
      service.mergeParties({
        actor: actor("accommodation.manage"),
        eventId: EVENT_ID,
        orderIds: [
          "019c7a20-0000-7000-8000-000000000101",
          "019c7a20-0000-7000-8000-000000000101"
        ],
        note: ""
      }),
      /merge selection is invalid/
    );
  });

  it("stores the plan as an immutable snapshot with its totals", async () => {
    const repository = new FakeRepository([vipFamily("order-1", "A-1")]);
    const service = serviceWith(repository);

    await service.fixPlan({
      actor: actor("accommodation.manage"),
      eventId: EVENT_ID,
      note: "Грузим в пятницу"
    });

    assert.equal(repository.insertedPlans.length, 1);
    const plan = repository.insertedPlans[0] as {
      requiredBerths: number;
      totalTents: number;
      note: string;
      snapshot: { tents: unknown };
    };
    assert.equal(plan.requiredBerths, 3);
    assert.equal(plan.totalTents, 1);
    assert.equal(plan.note, "Грузим в пятницу");
    assert.deepEqual(plan.snapshot.tents, [{ capacity: 3, count: 1 }]);
  });
});
