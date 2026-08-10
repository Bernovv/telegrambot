import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminRequestActor, InventoryItem } from "@ticket-platform/contracts";
import {
  AdminEventInventoryService,
  InventoryEventNotFoundError,
  InventoryItemAlreadyExistsError,
  InventoryItemNotFoundError,
  InventoryNeedNotFoundError,
  buildInventoryView,
  type AdminEventInventoryRepository,
  type StoredInventoryNeed
} from "./admin-event-inventory.js";

const EVENT_ID = "019c0123-4567-789a-bcde-f0123456789a";
const ADMIN_ID = "019c0123-4567-789a-bcde-f0123456789b";
const TENT_ID = "019c0123-4567-789a-bcde-f0123456789c";
const BAG_ID = "019c0123-4567-789a-bcde-f0123456789d";
const MAT_ID = "019c0123-4567-789a-bcde-f0123456789e";
const NEED_ID = "019c0123-4567-789a-bcde-f0123456789f";

describe("buildInventoryView", () => {
  // Заказали три трёхместные — значит девять спальников и девять пенок. Считается на лету,
  // чтобы состав комплекта и список погрузки не разъезжались.
  it("unfolds a kit into its components, multiplied by the quantity needed", () => {
    const view = buildInventoryView({
      event: { id: EVENT_ID, title: "Бизнес-Пикник" },
      items: [tent(), item(BAG_ID, "Спальник"), item(MAT_ID, "Пенка")],
      needs: [need({ itemId: TENT_ID, quantityNeeded: "3" })],
      canManage: true,
      calculatedAt: new Date("2026-08-10T09:00:00.000Z")
    });

    assert.deepEqual(view.needs[0]?.unfolds, [
      { itemId: BAG_ID, title: "Спальник", unit: "шт", quantityPerParent: "9" },
      { itemId: MAT_ID, title: "Пенка", unit: "шт", quantityPerParent: "9" }
    ]);
  });

  it("takes the title from the stock card so a rename reaches the loading list", () => {
    const view = buildInventoryView({
      event: { id: EVENT_ID, title: "Бизнес-Пикник" },
      items: [item(TENT_ID, "Палатка трёхместная, новая")],
      needs: [need({ itemId: TENT_ID, title: "Палатка старое название" })],
      canManage: true,
      calculatedAt: new Date("2026-08-10T09:00:00.000Z")
    });

    assert.equal(view.needs[0]?.title, "Палатка трёхместная, новая");
  });

  it("keeps the typed title for something that is not on the stock yet", () => {
    const view = buildInventoryView({
      event: { id: EVENT_ID, title: "Бизнес-Пикник" },
      items: [],
      needs: [need({ itemId: null, title: "Гирлянда", source: "buy" })],
      canManage: true,
      calculatedAt: new Date("2026-08-10T09:00:00.000Z")
    });

    assert.equal(view.needs[0]?.title, "Гирлянда");
    assert.equal(view.needs[0]?.quantityOwned, null);
    assert.deepEqual(view.needs[0]?.unfolds, []);
  });

  // Взять со склада больше, чем там лежит, нельзя — и увидеть это надо до погрузки.
  it("flags a stock line that asks for more than the warehouse holds", () => {
    const view = buildInventoryView({
      event: { id: EVENT_ID, title: "Бизнес-Пикник" },
      items: [item(TENT_ID, "Палатка", "4")],
      needs: [
        need({ itemId: TENT_ID, quantityNeeded: "10", source: "stock" }),
        need({ id: "b", itemId: TENT_ID, quantityNeeded: "2", source: "stock" }),
        need({ id: "c", itemId: null, title: "Гирлянда", source: "buy" })
      ],
      canManage: true,
      calculatedAt: new Date("2026-08-10T09:00:00.000Z")
    });

    assert.deepEqual(view.totals, {
      needCount: 3,
      fromStock: 2,
      toBuy: 1,
      toRent: 0,
      loaded: 0,
      shortCount: 1
    });
  });

  it("counts both loaded and returned lines as loaded", () => {
    const view = buildInventoryView({
      event: { id: EVENT_ID, title: "Бизнес-Пикник" },
      items: [item(TENT_ID, "Палатка", "10")],
      needs: [
        need({ itemId: TENT_ID, status: "loaded" }),
        need({ id: "b", itemId: TENT_ID, status: "returned" }),
        need({ id: "c", itemId: TENT_ID, status: "needed" })
      ],
      canManage: true,
      calculatedAt: new Date("2026-08-10T09:00:00.000Z")
    });

    assert.equal(view.totals.loaded, 2);
  });
});

describe("AdminEventInventoryService", () => {
  it("refuses to write for someone holding only the read permission", async () => {
    const service = build(repository());

    await assert.rejects(
      () => service.addItem({
        actor: actorWith("inventory.read"),
        title: "Палатка",
        categoryCode: "equipment"
      }),
      /permission is invalid/
    );
  });

  it("reports a duplicate stock card instead of creating a second one", async () => {
    const service = build(repository({ async createItem() { return false; } }));

    await assert.rejects(
      () => service.addItem({
        actor: actorWith("inventory.manage"),
        title: "Палатка",
        categoryCode: "equipment"
      }),
      InventoryItemAlreadyExistsError
    );
  });

  it("refuses a need that names neither a stock item nor anything else", async () => {
    const service = build(repository());

    await assert.rejects(
      () => service.addNeed({
        actor: actorWith("inventory.manage"),
        eventId: EVENT_ID,
        quantityNeeded: "3",
        source: "buy"
      }),
      /request is invalid/
    );
  });

  it("reports a missing event instead of creating an orphan need", async () => {
    const created: unknown[] = [];
    const service = build(repository({
      async findEvent() { return null; },
      async createNeed(input) { created.push(input); }
    }));

    await assert.rejects(
      () => service.addNeed({
        actor: actorWith("inventory.manage"),
        eventId: EVENT_ID,
        title: "Гирлянда",
        quantityNeeded: "3",
        source: "buy"
      }),
      InventoryEventNotFoundError
    );
    assert.equal(created.length, 0);
  });

  it("rejects a quantity that is zero, negative or not a number", async () => {
    const service = build(repository());

    for (const quantityNeeded of ["0", "-3", "три", "3,5"]) {
      await assert.rejects(
        () => service.addNeed({
          actor: actorWith("inventory.manage"),
          eventId: EVENT_ID,
          title: "Гирлянда",
          quantityNeeded,
          source: "buy"
        }),
        /request is invalid/
      );
    }
  });

  it("refuses to put a kit inside itself", async () => {
    const service = build(repository());

    await assert.rejects(
      () => service.setComponent({
        actor: actorWith("inventory.manage"),
        parentItemId: TENT_ID,
        childItemId: TENT_ID,
        quantityPerParent: "1"
      }),
      /request is invalid/
    );
  });

  it("treats a zero component quantity as removing it from the kit", async () => {
    const saved: unknown[] = [];
    const service = build(repository({
      async setComponent(input) {
        saved.push(input.quantityPerParent);
        return true;
      }
    }));

    await service.setComponent({
      actor: actorWith("inventory.manage"),
      parentItemId: TENT_ID,
      childItemId: BAG_ID,
      quantityPerParent: "0"
    });

    assert.deepEqual(saved, ["0"]);
  });

  it("rejects a movement of exactly nothing", async () => {
    const service = build(repository());

    await assert.rejects(
      () => service.recordMovement({
        actor: actorWith("inventory.manage"),
        eventId: EVENT_ID,
        itemId: TENT_ID,
        kind: "written_off",
        quantityDelta: "0"
      }),
      /request is invalid/
    );
  });

  it("allows a negative movement, because writing off is how things leave the stock", async () => {
    const saved: unknown[] = [];
    const service = build(repository({
      async recordMovement(input) {
        saved.push(input.quantityDelta);
        return true;
      }
    }));

    await service.recordMovement({
      actor: actorWith("inventory.manage"),
      eventId: null,
      itemId: TENT_ID,
      kind: "written_off",
      quantityDelta: "-2"
    });

    assert.deepEqual(saved, ["-2"]);
  });

  it("reports a vanished item or need rather than doing nothing", async () => {
    const noItem = build(repository({ async recordMovement() { return false; } }));
    const noNeed = build(repository({ async updateNeed() { return false; } }));

    await assert.rejects(
      () => noItem.recordMovement({
        actor: actorWith("inventory.manage"),
        eventId: null,
        itemId: TENT_ID,
        kind: "purchase",
        quantityDelta: "1"
      }),
      InventoryItemNotFoundError
    );
    await assert.rejects(
      () => noNeed.updateNeed({
        actor: actorWith("inventory.manage"),
        eventId: EVENT_ID,
        needId: NEED_ID,
        changes: { status: "loaded" }
      }),
      InventoryNeedNotFoundError
    );
  });
});

function build(repo: AdminEventInventoryRepository): AdminEventInventoryService {
  let id = 0;
  return new AdminEventInventoryService(
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
  overrides: Partial<AdminEventInventoryRepository> = {}
): AdminEventInventoryRepository {
  return {
    async findEvent() {
      return { id: EVENT_ID, title: "Бизнес-Пикник" };
    },
    async listItems() {
      return [];
    },
    async listNeeds() {
      return [];
    },
    async hasPermission() {
      return true;
    },
    async createItem() {
      return true;
    },
    async setComponent() {
      return true;
    },
    async createNeed() {
      // ничего
    },
    async updateNeed() {
      return true;
    },
    async recordMovement() {
      return true;
    },
    ...overrides
  };
}

function item(id: string, title: string, quantityOwned = "10"): InventoryItem {
  return {
    id,
    title,
    categoryCode: "equipment",
    categoryLabel: "Оборудование",
    unit: "шт",
    quantityOwned,
    storageLocation: "гараж",
    condition: "good",
    note: "",
    isArchived: false,
    components: []
  };
}

function tent(): InventoryItem {
  return {
    ...item(TENT_ID, "Палатка трёхместная"),
    components: [
      { itemId: BAG_ID, title: "Спальник", unit: "шт", quantityPerParent: "3" },
      { itemId: MAT_ID, title: "Пенка", unit: "шт", quantityPerParent: "3" }
    ]
  };
}

function need(overrides: Partial<StoredInventoryNeed>): StoredInventoryNeed {
  return {
    id: NEED_ID,
    itemId: TENT_ID,
    title: "Палатка трёхместная",
    quantityNeeded: "1",
    source: "stock",
    status: "needed",
    note: "",
    ...overrides
  };
}
