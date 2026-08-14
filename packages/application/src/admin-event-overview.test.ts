import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  AdminRequestActor,
  EventExpensesView,
  EventInventoryView,
  EventParticipantsView,
  EventTeamView
} from "@ticket-platform/contracts";
import {
  AdminEventOverviewService,
  OverviewEventNotFoundError,
  buildOverview,
  type AdminEventOverviewRepository,
  type OverviewEventRow,
  type OverviewInput
} from "./admin-event-overview.js";

const EVENT_ID = "019c0123-4567-789a-bcde-f0123456789a";
const ADMIN_ID = "019c0123-4567-789a-bcde-f0123456789b";

describe("buildOverview", () => {
  // Обзор не считает своего: посчитай он выручку сам, однажды разошёлся бы с «Командой».
  it("repeats the numbers the other tabs already produced", () => {
    const overview = buildOverview(input({ team: team() }));

    assert.equal(overview.money?.revenueKopecks, "60000000");
    assert.equal(overview.money?.profitKopecks, "40000000");
    assert.equal(overview.money?.expensesPlannedKopecks, "18000000");
    assert.equal(overview.people.guests, 12);
    assert.equal(overview.people.questionnaireAnswered, 4);
  });

  it("hides the money entirely from someone who may not see it", () => {
    const overview = buildOverview(input({ team: null }));

    assert.equal(overview.money, null);
    // И пункта про доли в чек-листе тоже нет: он про те же закрытые цифры.
    assert.equal(
      overview.readiness.some((item) => item.code === "shares"),
      false
    );
    assert.equal(overview.people.guests, 12);
  });

  // Вечно красная строка про то, чего на мероприятии нет, учит не смотреть на список.
  it("leaves out checklist items that do not apply to this event", () => {
    const overview = buildOverview(input({
      event: { ...eventRow(), offerRequired: false },
      inventory: inventory({ needCount: 0 }),
      participants: participants({ sleepingPlaces: 0, fields: [] }),
      team: null
    }));

    const codes = overview.readiness.map((item) => item.code);
    assert.deepEqual(codes, ["prices", "estimate", "expenses_actual"]);
  });

  it("counts an item done only when it really is", () => {
    const overview = buildOverview(input({
      expenses: expenses({ openCount: 2 }),
      inventory: inventory({ needCount: 5, loaded: 5, shortCount: 0 }),
      tentPlanFixed: true,
      team: team({ allocatedPercent: "100" })
    }));

    const byCode = new Map(overview.readiness.map((item) => [item.code, item]));
    assert.equal(byCode.get("expenses_actual")?.done, false);
    assert.match(byCode.get("expenses_actual")?.hint ?? "", /Строк без факта: 2/);
    assert.equal(byCode.get("inventory_loaded")?.done, true);
    assert.equal(byCode.get("tent_plan")?.done, true);
    assert.equal(byCode.get("shares")?.done, true);
  });

  it("reports how many checklist items are done", () => {
    const overview = buildOverview(input({ team: team() }));

    assert.equal(
      overview.readinessDone,
      overview.readiness.filter((item) => item.done).length
    );
  });
});

describe("AdminEventOverviewService", () => {
  it("never asks for the team when the money is not to be shown", async () => {
    const asked: string[] = [];
    const service = new AdminEventOverviewService(
      repository({
        async hasPermission() {
          return false;
        },
        async loadTeam() {
          asked.push("team");
          return team();
        }
      }),
      { now: () => new Date("2026-08-10T09:00:00.000Z") }
    );

    const overview = await service.summary({
      actor: actorWith("events.read"),
      eventId: EVENT_ID
    });

    assert.equal(overview.money, null);
    assert.deepEqual(asked, []);
  });

  it("refuses an actor that arrived with someone else's permission", async () => {
    const service = new AdminEventOverviewService(
      repository(),
      { now: () => new Date("2026-08-10T09:00:00.000Z") }
    );

    await assert.rejects(
      () => service.summary({ actor: actorWith("orders.read"), eventId: EVENT_ID }),
      /permission is invalid/
    );
  });

  it("reports a missing event instead of an empty overview", async () => {
    const service = new AdminEventOverviewService(
      repository({ async findEvent() { return null; } }),
      { now: () => new Date("2026-08-10T09:00:00.000Z") }
    );

    await assert.rejects(
      () => service.summary({ actor: actorWith("events.read"), eventId: EVENT_ID }),
      OverviewEventNotFoundError
    );
  });
});

function actorWith(permission: string): AdminRequestActor {
  return {
    adminId: ADMIN_ID,
    authSubject: "auth-1",
    permission,
    roleCodes: ["super_admin"]
  } as AdminRequestActor;
}

function repository(
  overrides: Partial<AdminEventOverviewRepository> = {}
): AdminEventOverviewRepository {
  return {
    async findEvent() {
      return eventRow();
    },
    async loadParticipants() {
      return participants({});
    },
    async loadExpenses() {
      return expenses({});
    },
    async loadInventory() {
      return inventory({});
    },
    async loadTeam() {
      return team();
    },
    async hasFixedTentPlan() {
      return false;
    },
    async hasPermission() {
      return true;
    },
    ...overrides
  };
}

function input(overrides: Partial<OverviewInput>): OverviewInput {
  return {
    event: eventRow(),
    participants: participants({}),
    expenses: expenses({}),
    inventory: inventory({}),
    team: team(),
    tentPlanFixed: false,
    calculatedAt: new Date("2026-08-10T09:00:00.000Z"),
    ...overrides
  };
}

function eventRow(): OverviewEventRow {
  return {
    id: EVENT_ID,
    title: "Бизнес-Пикник",
    capacity: 60,
    occupiedUnits: 12,
    offerRequired: true,
    hasActiveOffer: true,
    pricedProductCount: 3
  };
}

function participants(overrides: {
  sleepingPlaces?: number;
  fields?: readonly never[];
}): EventParticipantsView {
  return {
    eventId: EVENT_ID,
    eventTitle: "Бизнес-Пикник",
    calculatedAt: "2026-08-10T09:00:00.000Z",
    totals: {
      people: 7,
      guests: 12,
      adults: 9,
      children: 3,
      sleepingPlaces: overrides.sleepingPlaces ?? 6,
      amountKopecks: "60000000",
      fromOrders: 10,
      fromManual: 2
    },
    rows: [],
    excludedOrders: 0,
    fields: overrides.fields ?? [
      { id: "f", label: "Город", type: "text", options: null, global: false }
    ],
    attendance: { registered: 0, attended: 0 },
    questionnaire: { people: 7, answered: 4 },
    canManageParticipants: true
  };
}

function expenses(overrides: { openCount?: number }): EventExpensesView {
  return {
    eventId: EVENT_ID,
    eventTitle: "Бизнес-Пикник",
    calculatedAt: "2026-08-10T09:00:00.000Z",
    totals: {
      plannedKopecks: "18000000",
      actualKopecks: "20000000",
      openCount: overrides.openCount ?? 0,
      cancelledCount: 0
    },
    byCategory: [],
    expenses: [{ id: "e" }] as unknown as EventExpensesView["expenses"],
    categories: [],
    vendors: [],
    canManage: true
  };
}

function inventory(overrides: {
  needCount?: number;
  loaded?: number;
  shortCount?: number;
}): EventInventoryView {
  return {
    eventId: EVENT_ID,
    eventTitle: "Бизнес-Пикник",
    calculatedAt: "2026-08-10T09:00:00.000Z",
    totals: {
      needCount: overrides.needCount ?? 4,
      fromStock: 2,
      toBuy: 1,
      toRent: 1,
      loaded: overrides.loaded ?? 1,
      shortCount: overrides.shortCount ?? 0
    },
    needs: [],
    items: [],
    canManage: true
  };
}

function team(overrides: { allocatedPercent?: string } = {}): EventTeamView {
  return {
    eventId: EVENT_ID,
    eventTitle: "Бизнес-Пикник",
    calculatedAt: "2026-08-10T09:00:00.000Z",
    profit: {
      revenueKopecks: "60000000",
      revenueFromOrdersKopecks: "50000000",
      revenueFromManualKopecks: "10000000",
      expensesKopecks: "20000000",
      profitKopecks: "40000000",
      preliminary: false,
      expensesWithoutActual: 0
    },
    organizers: [{
      id: "o",
      personName: "Иван",
      roleLabel: "Организатор",
      sharePercent: "50",
      responsibilities: "",
      note: "",
      shareKopecks: "20000000"
    }],
    allocatedPercent: overrides.allocatedPercent ?? "50",
    unallocatedKopecks: "20000000",
    canManage: true
  };
}
