import type { AdminRequestActor, EventParticipant } from "@ticket-platform/contracts";
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

function participant(
  id: string,
  overrides: Partial<EventParticipant> = {}
): EventParticipant {
  return {
    id,
    displayName: `Участник ${id}`,
    phone: null,
    email: null,
    source: "max",
    ticketTitle: "Все включено",
    adults: 1,
    children: 0,
    sleepingPlaces: 1,
    note: "",
    outreachContactId: null,
    amountKopecks: null,
    paidAt: null,
    paymentMethod: null,
    customFields: [],
    createdAt: "2026-07-31T09:00:00.000Z",
    ...overrides
  };
}

function summaryOf(
  items: readonly AccommodationOrderItemRow[],
  groups: readonly AccommodationGroupRow[] = [],
  participants: readonly EventParticipant[] = [],
  privateTentOrderIds: readonly string[] = []
) {
  return buildSummary({
    event: EVENT,
    items,
    participants,
    participantFields: [],
    excludedOrders: 0,
    groups,
    privateTentOrderIds,
    lastPlan: null,
    canManage: true,
    canManageParticipants: true,
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

  // Человек попросил палатку на себя. Подсказка про подселение больше не должна его
  // считать: она предлагала бы то, о чём уже договорились.
  it("stops asking about sharing once a guest is marked as sleeping alone", () => {
    const summary = summaryOf(
      [
        vipAdult("order-1", "A-1", 1),
        vipAdult("order-2", "A-2", 1),
        vipAdult("order-3", "A-3", 1)
      ],
      [],
      [],
      ["order-3"]
    );

    // Палаток по-прежнему три: место в его палатке никуда не делось, оно оплачено осознанно.
    assert.equal(summary.totalTents, 3);
    assert.equal(summary.singles.length, 2);
    assert.deepEqual(summary.mergeSuggestion, {
      singleParties: 2,
      tentsNow: 2,
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
        sleepingPlaces: 3,
        manual: false
      },
      {
        productId: "product-standard",
        title: "Стандарт",
        ticketsSold: 2,
        guests: 2,
        adults: 2,
        children: 0,
        sleepingPlaces: 0,
        manual: false
      }
    ]);
  });

  it("counts guests entered by hand alongside guests who bought through the bot", () => {
    // Ровно тот случай, ради которого это делалось: покупатели из MAX и с сайта
    // в заказах Telegram-бота не существуют.
    const summary = summaryOf(
      [vipAdult("order-1", "A-1", 2)],
      [],
      [
        participant("p1", { adults: 2, children: 1, sleepingPlaces: 3 }),
        participant("p2", { source: "site", adults: 1, sleepingPlaces: 0 })
      ]
    );

    assert.deepEqual(summary.headcount, { guests: 6, adults: 5, children: 1 });
    assert.equal(summary.guestsFromOrders, 2);
    assert.equal(summary.guestsFromParticipants, 4);
    assert.equal(summary.requiredBerths, 5);
  });

  it("treats a hand-entered participant as their own party", () => {
    const summary = summaryOf([], [], [
      participant("p1", { adults: 2, children: 1, sleepingPlaces: 3 })
    ]);

    assert.equal(summary.parties.length, 1);
    assert.equal(summary.parties[0]?.berths, 3);
    assert.deepEqual(summary.tents, [{ capacity: 3, count: 1 }]);
    assert.equal(summary.singles.length, 0);
  });

  it("leaves a day-only hand-entered participant out of the tents", () => {
    const summary = summaryOf([], [], [
      participant("p1", { adults: 2, sleepingPlaces: 0 })
    ]);

    assert.equal(summary.parties.length, 0);
    assert.equal(summary.totalTents, 0);
    assert.equal(summary.headcount.guests, 2);
    assert.equal(summary.mealsAdult, 4);
  });

  it("keeps hand-entered tariffs separate from bot products in the breakdown", () => {
    const summary = summaryOf(
      [vipAdult("order-1", "A-1", 1)],
      [],
      [
        participant("p1", { ticketTitle: "Все включено" }),
        participant("p2", { ticketTitle: "Все включено" }),
        participant("p3", { ticketTitle: "" })
      ]
    );

    const manual = summary.products.filter((product) => product.manual);
    assert.equal(summary.products[0]?.manual, false);
    assert.deepEqual(
      manual.map((product) => [product.title, product.ticketsSold]),
      [["Все включено", 2], ["Без тарифа", 1]]
    );
  });

  it("shows how many berths arrived after the plan was fixed", () => {
    const summary = buildSummary({
      event: EVENT,
      items: [vipAdult("order-1", "A-1", 5)],
      participants: [],
      participantFields: [],
      excludedOrders: 0,
      groups: [],
      privateTentOrderIds: [],
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
      canManageParticipants: true,
      calculatedAt: new Date("2026-08-06T09:00:00Z")
    });

    assert.equal(summary.berthsSinceLastPlan, 2);
  });
});

class FakeRepository implements AdminAccommodationRepository {
  readonly createdGroups: unknown[] = [];
  readonly deletedGroups: unknown[] = [];
  readonly insertedPlans: unknown[] = [];
  readonly createdParticipants: unknown[] = [];
  readonly deletedParticipants: unknown[] = [];
  readonly excludedOrders: unknown[] = [];
  readonly updatedParticipants: unknown[] = [];
  readonly createdFields: unknown[] = [];
  readonly savedFieldValues: unknown[] = [];
  readonly privateTents: unknown[] = [];

  constructor(
    private readonly items: readonly AccommodationOrderItemRow[] = [],
    private readonly canManage = true,
    private readonly event: AccommodationEventRow | null = EVENT,
    private readonly mutationFound = true,
    private readonly participants: readonly EventParticipant[] = []
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

  listPrivateTentOrderIds(): Promise<readonly string[]> {
    return Promise.resolve([]);
  }

  setPrivateTent(input: unknown): Promise<boolean> {
    this.privateTents.push(input);
    return Promise.resolve(this.mutationFound);
  }

  listParticipants(): Promise<readonly EventParticipant[]> {
    return Promise.resolve(this.participants);
  }

  listParticipantFields(): Promise<readonly never[]> {
    return Promise.resolve([]);
  }

  updateParticipant(input: unknown): Promise<boolean> {
    this.updatedParticipants.push(input);
    return Promise.resolve(this.mutationFound);
  }

  createParticipantField(input: unknown): Promise<void> {
    this.createdFields.push(input);
    return Promise.resolve();
  }

  deleteParticipantField(): Promise<boolean> {
    return Promise.resolve(this.mutationFound);
  }

  setParticipantFieldValue(input: unknown): Promise<boolean> {
    this.savedFieldValues.push(input);
    return Promise.resolve(this.mutationFound);
  }

  countExcludedOrders(): Promise<number> {
    return Promise.resolve(0);
  }

  createParticipant(input: unknown): Promise<void> {
    this.createdParticipants.push(input);
    return Promise.resolve();
  }

  deleteParticipant(input: unknown): Promise<boolean> {
    this.deletedParticipants.push(input);
    return Promise.resolve(this.mutationFound);
  }

  excludeOrder(input: unknown): Promise<boolean> {
    this.excludedOrders.push(input);
    return Promise.resolve(this.mutationFound);
  }

  includeOrder(): Promise<boolean> {
    return Promise.resolve(this.mutationFound);
  }

  findLastPlan(): Promise<null> {
    return Promise.resolve(null);
  }

  hasPermission(): Promise<boolean> {
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
    { newId: () => `019c7a20-0000-7000-8000-00000000f${(sequence += 1).toString().padStart(3, "0")}` },
    {
      // Правила российского номера — их достаточно, чтобы проверить, что форма перестала
      // требовать E.164 и приводит набранное человеком сама.
      normalize(value: string): string {
        const digits = value.replace(/\D/g, "");
        if (/^[78]\d{10}$/.test(digits)) {
          return `+7${digits.slice(1)}`;
        }
        throw new Error("Phone number is invalid");
      }
    }
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

  it("requires the participants permission to add someone by hand", async () => {
    const service = serviceWith(new FakeRepository());

    await assert.rejects(
      service.addParticipant({
        actor: actor("accommodation.read"),
        eventId: EVENT_ID,
        participant: {
          displayName: "Иван",
          phone: null,
          source: "max",
          ticketTitle: "",
          adults: 1,
          children: 0,
          sleepingPlaces: 1,
          note: "",
          outreachContactId: null
        }
      }),
      /accommodation permission is invalid/
    );
  });

  it("accepts a phone the way a human types it", async () => {
    // Форма требовала строго «+7…», и набранное «8 999 123-45-67» отлетало ошибкой — при том
    // что тот же номер загрузка файла принимала спокойно.
    const repository = new FakeRepository();
    const service = serviceWith(repository);

    await service.addParticipant({
      actor: actor("participants.manage"),
      eventId: EVENT_ID,
      participant: {
        displayName: "Иван",
        phone: "8 (999) 123-45-67",
        source: "direct",
        ticketTitle: "",
        adults: 1,
        children: 0,
        sleepingPlaces: 0,
        note: "",
        outreachContactId: null
      }
    });

    assert.equal(
      (repository.createdParticipants[0] as { readonly phone: string }).phone,
      "+79991234567"
    );
  });

  it("still says so when the participant phone is not a phone", async () => {
    const service = serviceWith(new FakeRepository());

    await assert.rejects(
      service.addParticipant({
        actor: actor("participants.manage"),
        eventId: EVENT_ID,
        participant: {
          displayName: "Иван",
          phone: "мобильный",
          source: "direct",
          ticketTitle: "",
          adults: 1,
          children: 0,
          sleepingPlaces: 0,
          note: "",
          outreachContactId: null
        }
      }),
      /phone is invalid/
    );
  });

  it("refuses a participant with nobody in it", async () => {
    const service = serviceWith(new FakeRepository());

    await assert.rejects(
      service.addParticipant({
        actor: actor("participants.manage"),
        eventId: EVENT_ID,
        participant: {
          displayName: "Иван",
          phone: null,
          source: "max",
          ticketTitle: "",
          adults: 0,
          children: 0,
          sleepingPlaces: 0,
          note: "",
          outreachContactId: null
        }
      }),
      /headcount is invalid/
    );
  });

  it("refuses more sleeping places than people", async () => {
    const service = serviceWith(new FakeRepository());

    await assert.rejects(
      service.addParticipant({
        actor: actor("participants.manage"),
        eventId: EVENT_ID,
        participant: {
          displayName: "Иван",
          phone: null,
          source: "max",
          ticketTitle: "",
          adults: 1,
          children: 0,
          sleepingPlaces: 2,
          note: "",
          outreachContactId: null
        }
      }),
      /headcount is invalid/
    );
  });

  it("demands a reason before excluding an order from the reports", async () => {
    const service = serviceWith(new FakeRepository());

    await assert.rejects(
      service.excludeOrder({
        actor: actor("orders.exclude"),
        orderId: "019c7a20-0000-7000-8000-000000000101",
        reason: "  "
      }),
      /reason is invalid/
    );
  });

  it("records who excluded the order and why", async () => {
    const repository = new FakeRepository();
    const service = serviceWith(repository);

    await service.excludeOrder({
      actor: actor("orders.exclude"),
      orderId: "019c7a20-0000-7000-8000-000000000101",
      reason: "Тестовый заказ"
    });

    assert.deepEqual(repository.excludedOrders, [{
      orderId: "019c7a20-0000-7000-8000-000000000101",
      reason: "Тестовый заказ",
      adminId: ADMIN_ID,
      excludedAt: new Date("2026-07-31T09:00:00Z")
    }]);
  });

  it("reports a missing order instead of pretending it was excluded", async () => {
    const service = serviceWith(new FakeRepository([], true, EVENT, false));

    await assert.rejects(
      service.excludeOrder({
        actor: actor("orders.exclude"),
        orderId: "019c7a20-0000-7000-8000-000000000101",
        reason: "Тестовый заказ"
      }),
      /Order was not found/
    );
  });

  it("checks sleeping places against the resulting headcount, not the change alone", async () => {
    // У участника было 3 человека и 3 места; уменьшаем людей до одного, места не трогаем —
    // получилось бы три места на одного, чего мы не везём.
    const repository = new FakeRepository([], true, EVENT, true, [
      participant("019c7a20-0000-7000-8000-000000000101", {
        adults: 2,
        children: 1,
        sleepingPlaces: 3
      })
    ]);
    const service = serviceWith(repository);

    await assert.rejects(
      service.updateParticipant({
        actor: actor("participants.manage"),
        eventId: EVENT_ID,
        participantId: "019c7a20-0000-7000-8000-000000000101",
        changes: { adults: 1, children: 0 }
      }),
      /headcount is invalid/
    );
  });

  it("allows a change that stays consistent once applied", async () => {
    const repository = new FakeRepository([], true, EVENT, true, [
      participant("019c7a20-0000-7000-8000-000000000101", {
        adults: 2,
        children: 1,
        sleepingPlaces: 3
      })
    ]);
    const service = serviceWith(repository);

    await service.updateParticipant({
      actor: actor("participants.manage"),
      eventId: EVENT_ID,
      participantId: "019c7a20-0000-7000-8000-000000000101",
      changes: { adults: 1, children: 0, sleepingPlaces: 1 }
    });

    assert.equal(repository.updatedParticipants.length, 1);
  });

  it("refuses an empty update instead of touching the row", async () => {
    const repository = new FakeRepository();
    const service = serviceWith(repository);

    await assert.rejects(
      service.updateParticipant({
        actor: actor("participants.manage"),
        eventId: EVENT_ID,
        participantId: "019c7a20-0000-7000-8000-000000000101",
        changes: {}
      }),
      /update is empty/
    );
    assert.equal(repository.updatedParticipants.length, 0);
  });

  it("refuses an amount that is not a whole number of kopecks", async () => {
    const service = serviceWith(new FakeRepository());

    await assert.rejects(
      service.updateParticipant({
        actor: actor("participants.manage"),
        eventId: EVENT_ID,
        participantId: "019c7a20-0000-7000-8000-000000000101",
        changes: { amountKopecks: "1200.50" }
      }),
      /amount is invalid/
    );
  });

  it("requires options for a select field and forbids them elsewhere", async () => {
    const service = serviceWith(new FakeRepository());

    await assert.rejects(
      service.addParticipantField({
        actor: actor("participants.manage"),
        eventId: EVENT_ID,
        label: "Способ оплаты",
        type: "select",
        options: [],
        scope: "event"
      }),
      /options are invalid/
    );
    await assert.rejects(
      service.addParticipantField({
        actor: actor("participants.manage"),
        eventId: EVENT_ID,
        label: "Комментарий",
        type: "text",
        options: ["a"],
        scope: "event"
      }),
      /options are invalid/
    );
  });

  it("stores a global field without an event, and an event field with one", async () => {
    const repository = new FakeRepository();
    const service = serviceWith(repository);

    await service.addParticipantField({
      actor: actor("participants.manage"),
      eventId: EVENT_ID,
      label: "Откуда узнал",
      type: "text",
      options: null,
      scope: "global"
    });
    await service.addParticipantField({
      actor: actor("participants.manage"),
      eventId: EVENT_ID,
      label: "Аллергия",
      type: "text",
      options: null,
      scope: "event"
    });

    const created = repository.createdFields as readonly {
      eventId: string | null;
      fieldKey: string;
    }[];
    assert.equal(created[0]?.eventId, null);
    assert.equal(created[1]?.eventId, EVENT_ID);
    // Русская подпись в ключ не переводится — ключ остаётся валидным для базы.
    assert.match(created[0]?.fieldKey ?? "", /^[a-z0-9_]{1,60}$/);
  });

  it("demands a reason before removing a participant", async () => {
    const service = serviceWith(new FakeRepository());

    await assert.rejects(
      service.removeParticipant({
        actor: actor("participants.manage"),
        eventId: EVENT_ID,
        participantId: "019c7a20-0000-7000-8000-000000000101",
        reason: ""
      }),
      /reason is invalid/
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
