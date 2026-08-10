import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PostgresAdminEventTeamRepository } from "./admin-event-team-persistence.js";
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
const ORGANIZER_ID = "019c0123-4567-789a-bcde-f0123456789c";

describe("PostgreSQL event team persistence", () => {
  // Прибыль обязана совпадать с тем, что показывают «Участники» и «Расходы»: те же
  // правила отбора и один снимок на всё.
  it("reads revenue and expenses by the same rules their own tabs use", async () => {
    const connection = new FakeConnection((text) =>
      text.includes("revenue_from_orders") ? rows([moneyRow]) : affected());
    const repository = new PostgresAdminEventTeamRepository(new FakePool(connection));

    const money = await repository.loadMoney(EVENT_ID);

    assert.deepEqual(money, {
      revenueFromOrdersKopecks: "50000000",
      revenueFromManualKopecks: "10000000",
      expensesKopecks: "20000000",
      expensesWithoutActual: 2
    });

    const query = findQuery(connection, "revenue_from_orders");
    assert.match(query.text, /o\.status = 'paid'/);
    assert.match(query.text, /o\.excluded_at is null/);
    assert.match(query.text, /p\.deleted_at is null/);
    assert.match(query.text, /e\.status <> 'cancelled'/);
  });

  it("reads all the money in one consistent snapshot", async () => {
    const connection = new FakeConnection((text) =>
      text.includes("revenue_from_orders") ? rows([moneyRow]) : affected());
    const repository = new PostgresAdminEventTeamRepository(new FakePool(connection));

    await repository.loadMoney(EVENT_ID);

    assert.equal(
      connection.queries[0]?.text,
      "begin transaction isolation level repeatable read read only"
    );
    // Один запрос на всё: между двумя прибыль успела бы измениться на проходящей оплате.
    assert.equal(
      connection.queries.filter((q) => q.text.includes("select")).length,
      1
    );
    assert.equal(connection.queries.at(-1)?.text, "commit");
  });

  it("answers zero rather than nothing when the event has no money yet", async () => {
    const connection = new FakeConnection(() => rows([]));
    const repository = new PostgresAdminEventTeamRepository(new FakePool(connection));

    const money = await repository.loadMoney(EVENT_ID);

    assert.deepEqual(money, {
      revenueFromOrdersKopecks: "0",
      revenueFromManualKopecks: "0",
      expensesKopecks: "0",
      expensesWithoutActual: 0
    });
  });

  it("reports a duplicate organizer as a refusal, not as a crash", async () => {
    const connection = new FakeConnection((text) =>
      text.includes("insert into public.event_organizers") ? rows([]) : affected());
    const repository = new PostgresAdminEventTeamRepository(new FakePool(connection));

    const created = await repository.createOrganizer({
      organizerId: ORGANIZER_ID,
      eventId: EVENT_ID,
      personName: "Иван",
      roleLabel: "Организатор",
      sharePercent: "50",
      responsibilities: "",
      note: "",
      adminId: "019c0123-4567-789a-bcde-f0123456789b"
    });

    assert.equal(created, false);
  });

  it("scopes removal to the event so an id alone cannot reach another one", async () => {
    const connection = new FakeConnection((text) =>
      text.includes("delete from public.event_organizers")
        ? rows([{ id: ORGANIZER_ID }])
        : affected());
    const repository = new PostgresAdminEventTeamRepository(new FakePool(connection));

    await repository.removeOrganizer(EVENT_ID, ORGANIZER_ID);

    const query = findQuery(connection, "delete from public.event_organizers");
    assert.match(query.text, /event_id = \$2::uuid/);
    assert.deepEqual(query.values, [ORGANIZER_ID, EVENT_ID]);
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

const moneyRow = {
  revenue_from_orders: "50000000",
  revenue_from_manual: "10000000",
  expenses: "20000000",
  expenses_without_actual: "2"
};
