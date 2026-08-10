import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PostgresAdminEventInventoryRepository } from "./admin-event-inventory-persistence.js";
import type {
  SqlConnection,
  SqlConnectionPool,
  SqlQueryResult
} from "./postgres.js";

interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

const EVENT_ID = "019c0123-4567-789a-bcde-f0123456789a";
const ADMIN_ID = "019c0123-4567-789a-bcde-f0123456789b";
const TENT_ID = "019c0123-4567-789a-bcde-f0123456789c";
const BAG_ID = "019c0123-4567-789a-bcde-f0123456789d";

describe("PostgreSQL event inventory persistence", () => {
  it("attaches each kit component to its parent item", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.inventory_items i")) {
        return rows([itemRow]);
      }
      if (text.includes("from public.inventory_item_components k")) {
        return rows([componentRow]);
      }
      return affected();
    });
    const repository = new PostgresAdminEventInventoryRepository(new FakePool(connection));

    const items = await repository.listItems();

    assert.equal(items.length, 1);
    assert.deepEqual(items[0]?.components, [{
      itemId: BAG_ID,
      title: "Спальник",
      unit: "шт",
      quantityPerParent: "3"
    }]);
  });

  // Остаток — это сумма движений. Число, появившееся без строки в истории, потом нечем
  // объяснить, поэтому заведение карточки с остатком сразу пишет движение.
  it("writes an audit movement when a card is created with a starting quantity", async () => {
    const connection = new FakeConnection((text) =>
      text.includes("insert into public.inventory_items")
        ? rows([{ id: TENT_ID }])
        : affected());
    const repository = new PostgresAdminEventInventoryRepository(new FakePool(connection));

    await repository.createItem(itemInput("4"));

    const movement = findQuery(connection, "insert into public.inventory_movements");
    assert.match(movement.text, /'audit'/);
    assert.equal(connection.queries.at(-1)?.text, "commit");
  });

  it("writes no movement when the card starts empty", async () => {
    const connection = new FakeConnection((text) =>
      text.includes("insert into public.inventory_items")
        ? rows([{ id: TENT_ID }])
        : affected());
    const repository = new PostgresAdminEventInventoryRepository(new FakePool(connection));

    await repository.createItem(itemInput("0"));

    assert.equal(
      connection.queries.some((q) => q.text.includes("insert into public.inventory_movements")),
      false
    );
  });

  it("reports a duplicate title as a refusal, not as a crash", async () => {
    const connection = new FakeConnection((text) =>
      text.includes("insert into public.inventory_items") ? rows([]) : affected());
    const repository = new PostgresAdminEventInventoryRepository(new FakePool(connection));

    assert.equal(await repository.createItem(itemInput("0")), false);
  });

  it("moves the stock and records the movement in one transaction", async () => {
    const connection = new FakeConnection((text) =>
      text.includes("update public.inventory_items")
        ? rows([{ id: TENT_ID }])
        : affected());
    const repository = new PostgresAdminEventInventoryRepository(new FakePool(connection));

    const saved = await repository.recordMovement(movementInput("-2"));

    assert.equal(saved, true);
    assert.equal(connection.queries[0]?.text, "begin");
    assert.match(
      findQuery(connection, "update public.inventory_items").text,
      /greatest\(0, quantity_owned \+ \$2::numeric\)/
    );
    assert.ok(findQuery(connection, "insert into public.inventory_movements"));
    assert.equal(connection.queries.at(-1)?.text, "commit");
  });

  it("records nothing when the item is gone", async () => {
    const connection = new FakeConnection((text) =>
      text.includes("update public.inventory_items") ? rows([]) : affected());
    const repository = new PostgresAdminEventInventoryRepository(new FakePool(connection));

    assert.equal(await repository.recordMovement(movementInput("1")), false);
    assert.equal(
      connection.queries.some((q) => q.text.includes("insert into public.inventory_movements")),
      false
    );
  });

  it("removes a component from the kit when its quantity drops to zero", async () => {
    const connection = new FakeConnection((text) =>
      text.includes("select id from public.inventory_items")
        ? rows([{ id: TENT_ID }, { id: BAG_ID }])
        : affected());
    const repository = new PostgresAdminEventInventoryRepository(new FakePool(connection));

    await repository.setComponent({
      parentItemId: TENT_ID,
      childItemId: BAG_ID,
      quantityPerParent: "0"
    });

    assert.ok(findQuery(connection, "delete from public.inventory_item_components"));
  });

  it("refuses a component whose parent or child does not exist", async () => {
    const connection = new FakeConnection((text) =>
      text.includes("select id from public.inventory_items")
        ? rows([{ id: TENT_ID }])
        : affected());
    const repository = new PostgresAdminEventInventoryRepository(new FakePool(connection));

    const saved = await repository.setComponent({
      parentItemId: TENT_ID,
      childItemId: BAG_ID,
      quantityPerParent: "3"
    });

    assert.equal(saved, false);
  });

  it("scopes a need update to its own event", async () => {
    const connection = new FakeConnection((text) =>
      text.includes("update public.event_inventory_needs")
        ? rows([{ id: "need" }])
        : affected());
    const repository = new PostgresAdminEventInventoryRepository(new FakePool(connection));

    await repository.updateNeed({
      eventId: EVENT_ID,
      needId: "019c0123-4567-789a-bcde-f0123456789e",
      changes: { status: "loaded" }
    });

    assert.match(
      findQuery(connection, "update public.event_inventory_needs").text,
      /event_id = \$2::uuid/
    );
  });
});

function itemInput(quantityOwned: string) {
  return {
    itemId: TENT_ID,
    title: "Палатка трёхместная",
    categoryCode: "equipment",
    unit: "шт",
    quantityOwned,
    storageLocation: "гараж",
    condition: "good" as const,
    note: "",
    adminId: ADMIN_ID
  };
}

function movementInput(quantityDelta: string) {
  return {
    movementId: "019c0123-4567-789a-bcde-f0123456789f",
    itemId: TENT_ID,
    eventId: EVENT_ID,
    kind: "loaded" as const,
    quantityDelta,
    note: "",
    adminId: ADMIN_ID
  };
}

class FakePool implements SqlConnectionPool {
  constructor(private readonly connection: SqlConnection) {}

  async connect(): Promise<SqlConnection> {
    return this.connection;
  }
}

class FakeConnection implements SqlConnection {
  readonly queries: RecordedQuery[] = [];

  constructor(
    private readonly respond: (
      text: string,
      values: readonly unknown[]
    ) => SqlQueryResult<unknown>
  ) {}

  async query<TRow>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<SqlQueryResult<TRow>> {
    this.queries.push({ text, values });
    return this.respond(text, values) as SqlQueryResult<TRow>;
  }

  release(): void {}
}

function affected(): SqlQueryResult<never> {
  return { rows: [], rowCount: 1 };
}

function rows<TRow>(resultRows: readonly TRow[]): SqlQueryResult<TRow> {
  return { rows: resultRows, rowCount: resultRows.length };
}

function findQuery(connection: FakeConnection, fragment: string): RecordedQuery {
  const query = connection.queries.find((candidate) => candidate.text.includes(fragment));
  assert.ok(query, `Expected query containing: ${fragment}`);
  return query;
}

const itemRow = {
  id: TENT_ID,
  title: "Палатка трёхместная",
  category_code: "equipment",
  category_label: "Оборудование",
  unit: "шт",
  quantity_owned: "10",
  storage_location: "гараж",
  condition: "good",
  note: "",
  is_archived: false
};

const componentRow = {
  parent_item_id: TENT_ID,
  child_item_id: BAG_ID,
  title: "Спальник",
  unit: "шт",
  quantity_per_parent: "3"
};
