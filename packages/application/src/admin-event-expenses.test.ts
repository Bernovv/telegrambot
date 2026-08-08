import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminRequestActor, EventExpense } from "@ticket-platform/contracts";
import {
  AdminEventExpensesService,
  ExpenseConflictError,
  ExpenseNotFoundError,
  ExpensesEventNotFoundError,
  VendorAlreadyExistsError,
  buildExpensesView,
  type AdminEventExpensesRepository
} from "./admin-event-expenses.js";

const EVENT_ID = "019c0123-4567-789a-bcde-f0123456789a";
const ADMIN_ID = "019c0123-4567-789a-bcde-f0123456789b";
const EXPENSE_ID = "019c0123-4567-789a-bcde-f0123456789c";
const VENDOR_ID = "019c0123-4567-789a-bcde-f0123456789d";

describe("buildExpensesView", () => {
  it("sums the estimate and the actuals per category, in the category order", () => {
    const view = buildExpensesView({
      event: { id: EVENT_ID, title: "Бизнес-Пикник" },
      expenses: [
        expense({ categoryCode: "food", categoryLabel: "Продукты", plannedKopecks: "1000", actualKopecks: "1200" }),
        expense({ id: "b", categoryCode: "rent", categoryLabel: "Аренда", plannedKopecks: "3000", actualKopecks: "3000" }),
        expense({ id: "c", categoryCode: "food", categoryLabel: "Продукты", plannedKopecks: "500", actualKopecks: null })
      ],
      categories: [
        { code: "rent", label: "Аренда", position: 1 },
        { code: "food", label: "Продукты", position: 2 }
      ],
      vendors: [],
      canManage: true,
      calculatedAt: new Date("2026-08-10T09:00:00.000Z")
    });

    assert.deepEqual(view.totals, {
      plannedKopecks: "4500",
      actualKopecks: "4200",
      openCount: 1,
      cancelledCount: 0
    });
    assert.deepEqual(view.byCategory.map((row) => row.categoryCode), ["rent", "food"]);
    assert.equal(view.byCategory[1]?.plannedKopecks, "1500");
    assert.equal(view.byCategory[1]?.count, 2);
  });

  // Отменённая строка остаётся на экране, но не тратит денег: иначе доли организаторов
  // посчитаются от расхода, которого не было.
  it("keeps a cancelled expense visible but out of both the estimate and the actuals", () => {
    const view = buildExpensesView({
      event: { id: EVENT_ID, title: "Бизнес-Пикник" },
      expenses: [
        expense({ plannedKopecks: "1000", actualKopecks: "1000" }),
        expense({
          id: "b",
          status: "cancelled",
          plannedKopecks: "9999900",
          actualKopecks: "9999900",
          cancelledAt: "2026-08-09T10:00:00.000Z",
          cancelledReason: "договорились с другим подрядчиком"
        })
      ],
      categories: [{ code: "rent", label: "Аренда", position: 1 }],
      vendors: [],
      canManage: true,
      calculatedAt: new Date("2026-08-10T09:00:00.000Z")
    });

    assert.deepEqual(view.totals, {
      plannedKopecks: "1000",
      actualKopecks: "1000",
      openCount: 0,
      cancelledCount: 1
    });
    assert.equal(view.expenses.length, 2);
    assert.equal(view.byCategory.length, 1);
  });

  it("adds money as bigint kopecks so hundreds of rows keep their precision", () => {
    const view = buildExpensesView({
      event: { id: EVENT_ID, title: "Бизнес-Пикник" },
      expenses: [
        expense({ plannedKopecks: "9007199254740993", actualKopecks: "0" }),
        expense({ id: "b", plannedKopecks: "1", actualKopecks: "0" })
      ],
      categories: [{ code: "rent", label: "Аренда", position: 1 }],
      vendors: [],
      canManage: false,
      calculatedAt: new Date("2026-08-10T09:00:00.000Z")
    });

    assert.equal(view.totals.plannedKopecks, "9007199254740994");
  });
});

describe("AdminEventExpensesService", () => {
  it("lets a reader see the numbers but reports that they may not edit", async () => {
    const service = build(repository({ async hasPermission() { return false; } }));

    const view = await service.summary({
      actor: actorWith("expenses.read"),
      eventId: EVENT_ID
    });

    assert.equal(view.canManage, false);
  });

  it("refuses to write for someone holding only the read permission", async () => {
    const service = build(repository());

    await assert.rejects(
      () => service.addExpense({
        actor: actorWith("expenses.read"),
        eventId: EVENT_ID,
        categoryCode: "rent",
        title: "Палатки",
        plannedKopecks: "3000000"
      }),
      /permission is invalid/
    );
  });

  it("reports a missing event instead of creating an orphan expense", async () => {
    const created: unknown[] = [];
    const service = build(repository({
      async findEvent() { return null; },
      async createExpense(input) { created.push(input); }
    }));

    await assert.rejects(
      () => service.addExpense({
        actor: actorWith("expenses.manage"),
        eventId: EVENT_ID,
        categoryCode: "rent",
        title: "Палатки",
        plannedKopecks: "3000000"
      }),
      ExpensesEventNotFoundError
    );
    assert.equal(created.length, 0);
  });

  it("rejects a planned amount that is not whole kopecks", async () => {
    const service = build(repository());

    for (const amount of ["30 000", "3000.50", "-1", ""]) {
      await assert.rejects(
        () => service.addExpense({
          actor: actorWith("expenses.manage"),
          eventId: EVENT_ID,
          categoryCode: "rent",
          title: "Палатки",
          plannedKopecks: amount
        }),
        /request is invalid/
      );
    }
  });

  // «Оплачено» без суммы и даты тихо выпадает из фактических расходов и завышает прибыль,
  // от которой считаются доли.
  it("refuses to mark an expense paid without both the amount and the date", async () => {
    const service = build(repository());
    const base = {
      actor: actorWith("expenses.manage"),
      eventId: EVENT_ID,
      expenseId: EXPENSE_ID,
      lockVersion: 1
    };

    await assert.rejects(
      () => service.updateExpense({ ...base, changes: { status: "paid" } }),
      /request is invalid/
    );
    await assert.rejects(
      () => service.updateExpense({
        ...base,
        changes: { status: "paid", actualKopecks: "3450000" }
      }),
      /request is invalid/
    );

    const saved: unknown[] = [];
    const ok = build(repository({
      async updateExpense(input) {
        saved.push(input.changes);
        return "applied";
      }
    }));
    await ok.updateExpense({
      ...base,
      changes: {
        status: "paid",
        actualKopecks: "3450000",
        paidAt: new Date("2026-08-09T12:00:00.000Z")
      }
    });
    assert.equal(saved.length, 1);
  });

  it("turns a stale lock version into a conflict, not a silent overwrite", async () => {
    const service = build(repository({
      async updateExpense() { return "conflict"; }
    }));

    await assert.rejects(
      () => service.updateExpense({
        actor: actorWith("expenses.manage"),
        eventId: EVENT_ID,
        expenseId: EXPENSE_ID,
        lockVersion: 1,
        changes: { title: "Палатки трёхместные" }
      }),
      ExpenseConflictError
    );
  });

  it("demands a reason of substance before cancelling an expense", async () => {
    const service = build(repository());
    const base = {
      actor: actorWith("expenses.manage"),
      eventId: EVENT_ID,
      expenseId: EXPENSE_ID,
      lockVersion: 1
    };

    await assert.rejects(
      () => service.cancelExpense({ ...base, reason: "  " }),
      /request is invalid/
    );
    await assert.rejects(
      () => service.cancelExpense({ ...base, reason: "ой" }),
      /request is invalid/
    );
  });

  it("reports a vanished expense on cancel instead of doing nothing", async () => {
    const service = build(repository({
      async cancelExpense() { return "missing"; }
    }));

    await assert.rejects(
      () => service.cancelExpense({
        actor: actorWith("expenses.manage"),
        eventId: EVENT_ID,
        expenseId: EXPENSE_ID,
        lockVersion: 1,
        reason: "дублирующая строка"
      }),
      ExpenseNotFoundError
    );
  });

  it("reports a duplicate vendor name rather than creating a second card", async () => {
    const service = build(repository({
      async createVendor() { return false; }
    }));

    await assert.rejects(
      () => service.addVendor({
        actor: actorWith("expenses.manage"),
        name: "Палатки Урала",
        kind: "rent"
      }),
      VendorAlreadyExistsError
    );
  });

  it("keeps a vendor phone only when it looks like a phone", async () => {
    const saved: unknown[] = [];
    const service = build(repository({
      async createVendor(input) {
        saved.push(input.phone);
        return true;
      }
    }));

    await service.addVendor({
      actor: actorWith("expenses.manage"),
      name: "Палатки Урала",
      kind: "rent",
      phone: "  "
    });
    await assert.rejects(
      () => service.addVendor({
        actor: actorWith("expenses.manage"),
        name: "Баня у реки",
        kind: "rent",
        phone: "89001234567"
      }),
      /request is invalid/
    );

    assert.deepEqual(saved, [null]);
  });
});

function build(repo: AdminEventExpensesRepository): AdminEventExpensesService {
  let id = 0;
  return new AdminEventExpensesService(
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
  overrides: Partial<AdminEventExpensesRepository> = {}
): AdminEventExpensesRepository {
  return {
    async findEvent() {
      return { id: EVENT_ID, title: "Бизнес-Пикник" };
    },
    async listExpenses() {
      return [];
    },
    async listCategories() {
      return [{ code: "rent", label: "Аренда", position: 1 }];
    },
    async listVendors() {
      return [];
    },
    async hasPermission() {
      return true;
    },
    async createVendor() {
      return true;
    },
    async createExpense() {
      // ничего
    },
    async updateExpense() {
      return "applied";
    },
    async cancelExpense() {
      return "applied";
    },
    ...overrides
  };
}

function expense(overrides: Partial<EventExpense>): EventExpense {
  return {
    id: EXPENSE_ID,
    categoryCode: "rent",
    categoryLabel: "Аренда",
    vendorId: VENDOR_ID,
    vendorName: "Палатки Урала",
    title: "Палатки трёхместные",
    quantity: "10",
    unit: "шт",
    plannedKopecks: "3000000",
    actualKopecks: "3450000",
    status: "paid",
    paidAt: "2026-08-09T12:00:00.000Z",
    paymentMethod: "перевод",
    note: "",
    cancelledAt: null,
    cancelledReason: null,
    lockVersion: 1,
    ...overrides
  };
}
