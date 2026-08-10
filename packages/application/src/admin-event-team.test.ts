import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminRequestActor } from "@ticket-platform/contracts";
import {
  AdminEventTeamService,
  OrganizerAlreadyExistsError,
  OrganizerNotFoundError,
  SharesExceedHundredError,
  TeamEventNotFoundError,
  buildTeamView,
  type AdminEventTeamRepository,
  type EventMoneyRow,
  type StoredOrganizer
} from "./admin-event-team.js";

const EVENT_ID = "019c0123-4567-789a-bcde-f0123456789a";
const ADMIN_ID = "019c0123-4567-789a-bcde-f0123456789b";
const ORGANIZER_ID = "019c0123-4567-789a-bcde-f0123456789c";

describe("buildTeamView", () => {
  it("takes the profit as revenue from both channels minus the actual expenses", () => {
    const view = buildTeamView({
      event: { id: EVENT_ID, title: "Бизнес-Пикник" },
      money: money({
        revenueFromOrdersKopecks: "50000000",
        revenueFromManualKopecks: "10000000",
        expensesKopecks: "20000000"
      }),
      organizers: [],
      canManage: true,
      calculatedAt: new Date("2026-08-10T09:00:00.000Z")
    });

    assert.equal(view.profit.revenueKopecks, "60000000");
    assert.equal(view.profit.profitKopecks, "40000000");
    assert.equal(view.profit.preliminary, false);
  });

  // Пока у части расходов нет факта, прибыль завышена — и доли вместе с ней.
  it("marks the split preliminary while some expense has no actual amount", () => {
    const view = buildTeamView({
      event: { id: EVENT_ID, title: "Бизнес-Пикник" },
      money: money({ expensesWithoutActual: 3 }),
      organizers: [],
      canManage: true,
      calculatedAt: new Date("2026-08-10T09:00:00.000Z")
    });

    assert.equal(view.profit.preliminary, true);
    assert.equal(view.profit.expensesWithoutActual, 3);
  });

  // 33.33% от миллиона в плавающей точке даёт хвост, который потом не сходится в сумме.
  it("splits thirds without losing or inventing a kopeck", () => {
    const view = buildTeamView({
      event: { id: EVENT_ID, title: "Бизнес-Пикник" },
      money: money({
        revenueFromOrdersKopecks: "100000000",
        expensesKopecks: "0"
      }),
      organizers: [
        organizer({ id: "a", personName: "Иван", sharePercent: "33.33" }),
        organizer({ id: "b", personName: "Мария", sharePercent: "33.33" }),
        organizer({ id: "c", personName: "Пётр", sharePercent: "33.33" })
      ],
      canManage: true,
      calculatedAt: new Date("2026-08-10T09:00:00.000Z")
    });

    const shares = view.organizers.map((person) => BigInt(person.shareKopecks));
    const total = shares.reduce((sum, share) => sum + share, 0n);

    assert.deepEqual(shares.map(String), ["33330000", "33330000", "33330000"]);
    // Остаток виден отдельно, а не растворяется в чьей-то доле.
    assert.equal(view.unallocatedKopecks, (100000000n - total).toString());
    assert.equal(view.allocatedPercent, "99.99");
  });

  it("shows the loss honestly instead of hiding it behind a zero", () => {
    const view = buildTeamView({
      event: { id: EVENT_ID, title: "Бизнес-Пикник" },
      money: money({
        revenueFromOrdersKopecks: "10000000",
        expensesKopecks: "16000000"
      }),
      organizers: [organizer({ sharePercent: "50" })],
      canManage: true,
      calculatedAt: new Date("2026-08-10T09:00:00.000Z")
    });

    assert.equal(view.profit.profitKopecks, "-6000000");
    assert.equal(view.organizers[0]?.shareKopecks, "-3000000");
  });

  it("reports how much of the profit nobody was assigned", () => {
    const view = buildTeamView({
      event: { id: EVENT_ID, title: "Бизнес-Пикник" },
      money: money({
        revenueFromOrdersKopecks: "10000000",
        expensesKopecks: "0"
      }),
      organizers: [organizer({ sharePercent: "60" })],
      canManage: true,
      calculatedAt: new Date("2026-08-10T09:00:00.000Z")
    });

    assert.equal(view.allocatedPercent, "60");
    assert.equal(view.unallocatedKopecks, "4000000");
  });
});

describe("AdminEventTeamService", () => {
  it("hides the numbers from anyone without the finance permission", async () => {
    const service = build(repository());

    await assert.rejects(
      () => service.summary({ actor: actorWith("accommodation.read"), eventId: EVENT_ID }),
      /permission is invalid/
    );
  });

  // Раздать больше ста процентов значит пообещать больше, чем заработали.
  it("refuses a share that pushes the total past one hundred percent", async () => {
    const service = build(repository({
      async listOrganizers() {
        return [
          organizer({ id: "a", personName: "Иван", sharePercent: "60" }),
          organizer({ id: "b", personName: "Мария", sharePercent: "30" })
        ];
      }
    }));

    await assert.rejects(
      () => service.addOrganizer({
        actor: actorWith("event_finance.manage"),
        eventId: EVENT_ID,
        personName: "Пётр",
        sharePercent: "10.01"
      }),
      SharesExceedHundredError
    );
  });

  it("lets an existing organizer keep their own share when editing other fields", async () => {
    const saved: unknown[] = [];
    const service = build(repository({
      async listOrganizers() {
        return [
          organizer({ id: ORGANIZER_ID, personName: "Иван", sharePercent: "70" }),
          organizer({ id: "b", personName: "Мария", sharePercent: "30" })
        ];
      },
      async updateOrganizer(input) {
        saved.push(input.changes);
        return true;
      }
    }));

    // 70 у самого себя не должно складываться с новыми 70 — иначе правка своей же доли
    // упиралась бы в лимит на ровном месте.
    await service.updateOrganizer({
      actor: actorWith("event_finance.manage"),
      eventId: EVENT_ID,
      organizerId: ORGANIZER_ID,
      changes: { sharePercent: "70" }
    });

    assert.equal(saved.length, 1);
  });

  it("rejects a share that is not a sane percentage", async () => {
    const service = build(repository());

    for (const sharePercent of ["101", "-5", "50,5", "половина", "33.333"]) {
      await assert.rejects(
        () => service.addOrganizer({
          actor: actorWith("event_finance.manage"),
          eventId: EVENT_ID,
          personName: "Пётр",
          sharePercent
        }),
        /request is invalid/
      );
    }
  });

  it("reports a duplicate person instead of doubling their share", async () => {
    const service = build(repository({ async createOrganizer() { return false; } }));

    await assert.rejects(
      () => service.addOrganizer({
        actor: actorWith("event_finance.manage"),
        eventId: EVENT_ID,
        personName: "Иван",
        sharePercent: "10"
      }),
      OrganizerAlreadyExistsError
    );
  });

  it("reports a missing event instead of creating an orphan organizer", async () => {
    const service = build(repository({ async findEvent() { return null; } }));

    await assert.rejects(
      () => service.addOrganizer({
        actor: actorWith("event_finance.manage"),
        eventId: EVENT_ID,
        personName: "Иван",
        sharePercent: "10"
      }),
      TeamEventNotFoundError
    );
  });

  it("reports a vanished organizer on removal", async () => {
    const service = build(repository({ async removeOrganizer() { return false; } }));

    await assert.rejects(
      () => service.removeOrganizer({
        actor: actorWith("event_finance.manage"),
        eventId: EVENT_ID,
        organizerId: ORGANIZER_ID
      }),
      OrganizerNotFoundError
    );
  });
});

function build(repo: AdminEventTeamRepository): AdminEventTeamService {
  let id = 0;
  return new AdminEventTeamService(
    repo,
    { now: () => new Date("2026-08-10T09:00:00.000Z") },
    { newId: () => `generated-${(id += 1)}` }
  );
}

function actorWith(permission: string): AdminRequestActor {
  return {
    adminId: ADMIN_ID,
    authSubject: "auth-1",
    permission,
    roleCodes: ["super_admin"]
  } as AdminRequestActor;
}

function repository(
  overrides: Partial<AdminEventTeamRepository> = {}
): AdminEventTeamRepository {
  return {
    async findEvent() {
      return { id: EVENT_ID, title: "Бизнес-Пикник" };
    },
    async loadMoney() {
      return money({});
    },
    async listOrganizers() {
      return [];
    },
    async hasPermission() {
      return true;
    },
    async createOrganizer() {
      return true;
    },
    async updateOrganizer() {
      return true;
    },
    async removeOrganizer() {
      return true;
    },
    ...overrides
  };
}

function money(overrides: Partial<EventMoneyRow>): EventMoneyRow {
  return {
    revenueFromOrdersKopecks: "0",
    revenueFromManualKopecks: "0",
    expensesKopecks: "0",
    expensesWithoutActual: 0,
    ...overrides
  };
}

function organizer(overrides: Partial<StoredOrganizer>): StoredOrganizer {
  return {
    id: ORGANIZER_ID,
    personName: "Иван",
    roleLabel: "Организатор",
    sharePercent: "50",
    responsibilities: "",
    note: "",
    ...overrides
  };
}
