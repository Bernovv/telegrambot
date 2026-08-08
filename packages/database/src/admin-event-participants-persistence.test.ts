import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PostgresAdminEventParticipantsRepository } from "./admin-event-participants-persistence.js";
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

describe("PostgreSQL event participants persistence", () => {
  it("reads paid order items with money, phone and payment date", async () => {
    const connection = new FakeConnection((text) =>
      text.includes("from public.orders o") ? rows([orderItemRow]) : affected()
    );
    const repository = new PostgresAdminEventParticipantsRepository(
      new FakePool(connection)
    );

    const items = await repository.listPaidOrderItems(EVENT_ID);

    assert.deepEqual(items, [{
      orderId: "019c0123-4567-789a-bcde-f0123456789c",
      orderNumber: "BP-0001",
      buyerName: "Иван",
      phone: "+79000000000",
      telegramUsername: "ivan",
      paidAt: new Date("2026-08-01T10:00:00.000Z"),
      totalKopecks: "249000",
      productTitle: "Стандарт",
      quantity: 2,
      bundleComposition: [{ role: "adult", quantity: 1 }],
      inventoryUnitsPerItem: 1,
      includesSleepingPlace: false
    }]);
  });

  it("leaves out refunded, draft and test orders", async () => {
    const connection = new FakeConnection((text) =>
      text.includes("from public.orders o") ? rows([]) : affected()
    );
    const repository = new PostgresAdminEventParticipantsRepository(
      new FakePool(connection)
    );

    await repository.listPaidOrderItems(EVENT_ID);

    const query = findQuery(connection, "from public.orders o");
    assert.match(query.text, /o\.status = 'paid'/);
    assert.match(query.text, /o\.excluded_at is null/);
    assert.deepEqual(query.values, [EVENT_ID]);
  });

  // Список участников — отчёт, а не правка: снимок должен быть согласованным, иначе оплата,
  // прошедшая в середине чтения, попадёт в одну строку и не попадёт в итог.
  it("reads inside a read-only repeatable read transaction and commits it", async () => {
    const connection = new FakeConnection((text) =>
      text.includes("from public.orders o") ? rows([orderItemRow]) : affected()
    );
    const repository = new PostgresAdminEventParticipantsRepository(
      new FakePool(connection)
    );

    await repository.listPaidOrderItems(EVENT_ID);

    assert.equal(
      connection.queries[0]?.text,
      "begin transaction isolation level repeatable read read only"
    );
    assert.equal(connection.queries.at(-1)?.text, "commit");
  });

  it("rolls the transaction back when the query fails", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.orders o")) {
        throw new Error("соединение потеряно");
      }
      return affected();
    });
    const repository = new PostgresAdminEventParticipantsRepository(
      new FakePool(connection)
    );

    await assert.rejects(() => repository.listPaidOrderItems(EVENT_ID));
    assert.equal(connection.queries.at(-1)?.text, "rollback");
  });
  it("reads the paper answers of this event only, never another year's", async () => {
    const connection = new FakeConnection((text) =>
      text.includes("from public.event_order_field_values v")
        ? rows([answerRow])
        : affected()
    );
    const repository = new PostgresAdminEventParticipantsRepository(
      new FakePool(connection)
    );

    const answers = await repository.listOrderFieldValues(EVENT_ID);

    assert.deepEqual(answers, [{
      orderId: "019c0123-4567-789a-bcde-f0123456789c",
      value: {
        fieldId: "019c0123-4567-789a-bcde-f0123456789f",
        label: "Город",
        type: "text",
        options: null,
        value: "Москва"
      }
    }]);
    const query = findQuery(connection, "from public.event_order_field_values v");
    assert.match(query.text, /join public\.orders o on o\.id = v\.order_id/);
    assert.match(query.text, /o\.event_id = \$1::uuid/);
  });

  it("refuses to attach an answer to an order from a different event", async () => {
    const connection = new FakeConnection((text) =>
      text.includes("from public.orders\n") || text.includes("select id from public.orders")
        ? rows([])
        : affected()
    );
    const repository = new PostgresAdminEventParticipantsRepository(
      new FakePool(connection)
    );

    const saved = await repository.saveOrderFieldValue({
      eventId: EVENT_ID,
      orderId: "019c0123-4567-789a-bcde-f0123456789c",
      fieldId: "019c0123-4567-789a-bcde-f0123456789f",
      value: "Москва",
      adminId: "019c0123-4567-789a-bcde-f0123456789b"
    });

    assert.equal(saved, false);
    assert.equal(connection.queries.at(-1)?.text, "rollback");
  });

  it("deletes the row when the answer is cleared instead of writing an empty string", async () => {
    const connection = new FakeConnection((text) =>
      text.includes("select id from public.orders")
        ? rows([{ id: "019c0123-4567-789a-bcde-f0123456789c" }])
        : affected()
    );
    const repository = new PostgresAdminEventParticipantsRepository(
      new FakePool(connection)
    );

    await repository.saveOrderFieldValue({
      eventId: EVENT_ID,
      orderId: "019c0123-4567-789a-bcde-f0123456789c",
      fieldId: "019c0123-4567-789a-bcde-f0123456789f",
      value: null,
      adminId: "019c0123-4567-789a-bcde-f0123456789b"
    });

    assert.match(
      findQuery(connection, "delete from public.event_order_field_values").text,
      /field_definition_id = \$2::uuid/
    );
    assert.equal(connection.queries.at(-1)?.text, "commit");
  });
});

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

const answerRow = {
  order_id: "019c0123-4567-789a-bcde-f0123456789c",
  field_definition_id: "019c0123-4567-789a-bcde-f0123456789f",
  label: "Город",
  field_type: "text",
  options: null,
  value_text: "Москва"
};

const orderItemRow = {
  order_id: "019c0123-4567-789a-bcde-f0123456789c",
  order_number: "BP-0001",
  buyer_name: "Иван",
  phone: "+79000000000",
  telegram_username: "ivan",
  paid_at: "2026-08-01T10:00:00.000Z",
  total_kopecks: "249000",
  product_title: "Стандарт",
  quantity: 2,
  bundle_composition: '[{"role":"adult","quantity":1}]',
  inventory_units_per_item: 1,
  includes_sleeping_place: false
};
