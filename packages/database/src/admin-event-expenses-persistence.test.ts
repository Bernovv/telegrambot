import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PostgresAdminEventExpensesRepository } from "./admin-event-expenses-persistence.js";
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
const EXPENSE_ID = "019c0123-4567-789a-bcde-f0123456789c";

describe("PostgreSQL event expenses persistence", () => {
  it("reads expenses with their category label and vendor name", async () => {
    const connection = new FakeConnection((text) =>
      text.includes("from public.event_expenses e") ? rows([expenseRow]) : affected()
    );
    const repository = new PostgresAdminEventExpensesRepository(new FakePool(connection));

    const expenses = await repository.listExpenses(EVENT_ID);

    assert.equal(expenses.length, 1);
    assert.equal(expenses[0]?.categoryLabel, "Аренда");
    assert.equal(expenses[0]?.vendorName, "Палатки Урала");
    assert.equal(expenses[0]?.plannedKopecks, "3000000");
    assert.equal(expenses[0]?.status, "paid");
  });

  // Смету двое правят с разных экранов; «последний выиграл» здесь означает молча стёртую
  // чужую сумму, поэтому расхождение версий обязано стать конфликтом.
  it("reports a conflict when the row moved on before the update landed", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("for update")) {
        return rows([{ ...beforeRow, lock_version: 7 }]);
      }
      return affected();
    });
    const repository = new PostgresAdminEventExpensesRepository(new FakePool(connection));

    const outcome = await repository.updateExpense(updateInput());

    assert.equal(outcome, "conflict");
    assert.equal(
      connection.queries.some((query) => query.text.includes("insert into public.audit_log")),
      false
    );
  });

  it("reports a missing expense instead of writing an audit entry for nothing", async () => {
    const connection = new FakeConnection((text) =>
      text.includes("for update") ? rows([]) : affected()
    );
    const repository = new PostgresAdminEventExpensesRepository(new FakePool(connection));

    const outcome = await repository.updateExpense(updateInput());

    assert.equal(outcome, "missing");
  });

  it("records what the amount was before the edit, not only what it became", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("for update")) {
        return rows([beforeRow]);
      }
      if (text.includes("update public.event_expenses")) {
        return rows([{ id: EXPENSE_ID, lock_version: 2 }]);
      }
      return affected();
    });
    const repository = new PostgresAdminEventExpensesRepository(new FakePool(connection));

    const outcome = await repository.updateExpense(updateInput());

    assert.equal(outcome, "applied");
    const audit = findQuery(connection, "insert into public.audit_log");
    assert.equal(audit.values[3], "event_expense.updated");
    const before = JSON.parse(String(audit.values[6])) as Record<string, unknown>;
    const after = JSON.parse(String(audit.values[7])) as Record<string, unknown>;
    assert.equal(before.plannedKopecks, "3000000");
    assert.equal(after.plannedKopecks, "3450000");
    assert.equal(connection.queries.at(-1)?.text, "commit");
  });

  it("never touches an already cancelled expense", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("for update")) {
        return rows([beforeRow]);
      }
      return rows([]);
    });
    const repository = new PostgresAdminEventExpensesRepository(new FakePool(connection));

    await repository.updateExpense(updateInput());

    assert.match(
      findQuery(connection, "update public.event_expenses").text,
      /status <> 'cancelled'/
    );
  });

  it("tells a vanished expense apart from a stale version when cancelling", async () => {
    const missing = new FakeConnection(() => rows([]));
    const stale = new FakeConnection((text) =>
      text.includes("select id from public.event_expenses")
        ? rows([{ id: EXPENSE_ID }])
        : rows([]));

    const repository = (connection: FakeConnection) =>
      new PostgresAdminEventExpensesRepository(new FakePool(connection));

    assert.equal(await repository(missing).cancelExpense(cancelInput()), "missing");
    assert.equal(await repository(stale).cancelExpense(cancelInput()), "conflict");
  });

  it("keeps the cancellation reason in the audit entry", async () => {
    const connection = new FakeConnection((text) =>
      text.includes("update public.event_expenses")
        ? rows([{ id: EXPENSE_ID, lock_version: 2 }])
        : affected());
    const repository = new PostgresAdminEventExpensesRepository(new FakePool(connection));

    await repository.cancelExpense(cancelInput());

    const audit = findQuery(connection, "insert into public.audit_log");
    assert.equal(audit.values[3], "event_expense.cancelled");
    assert.equal(audit.values[5], "договорились с другим подрядчиком");
  });

  it("treats a duplicate vendor name as a refusal, not as a crash", async () => {
    const connection = new FakeConnection((text) =>
      text.includes("insert into public.vendors") ? rows([]) : affected());
    const repository = new PostgresAdminEventExpensesRepository(new FakePool(connection));

    const created = await repository.createVendor({
      vendorId: "019c0123-4567-789a-bcde-f0123456789d",
      name: "Палатки Урала",
      kind: "rent",
      contactName: null,
      phone: null,
      telegram: null,
      note: "",
      adminId: ADMIN_ID
    });

    assert.equal(created, false);
  });

  it("counts how often each vendor was used, across every event", async () => {
    const connection = new FakeConnection((text) =>
      text.includes("from public.vendors v") ? rows([vendorRow]) : affected());
    const repository = new PostgresAdminEventExpensesRepository(new FakePool(connection));

    const vendors = await repository.listVendors();

    assert.equal(vendors[0]?.expenseCount, 4);
    assert.match(
      findQuery(connection, "from public.vendors v").text,
      /left join public\.event_expenses e on e\.vendor_id = v\.id/
    );
  });
});

function updateInput() {
  return {
    eventId: EVENT_ID,
    expenseId: EXPENSE_ID,
    lockVersion: 1,
    auditId: "019c0123-4567-789a-bcde-f0123456789e",
    actorAdminId: ADMIN_ID,
    actorRole: "super_admin",
    changes: { plannedKopecks: "3450000" }
  };
}

function cancelInput() {
  return {
    eventId: EVENT_ID,
    expenseId: EXPENSE_ID,
    lockVersion: 1,
    reason: "договорились с другим подрядчиком",
    auditId: "019c0123-4567-789a-bcde-f0123456789e",
    actorAdminId: ADMIN_ID,
    actorRole: "super_admin",
    cancelledAt: new Date("2026-08-10T09:00:00.000Z")
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

const beforeRow = {
  title: "Палатки трёхместные",
  status: "committed",
  planned_kopecks: "3000000",
  actual_kopecks: null,
  lock_version: 1
};

const expenseRow = {
  id: EXPENSE_ID,
  category_code: "rent",
  category_label: "Аренда",
  vendor_id: "019c0123-4567-789a-bcde-f0123456789d",
  vendor_name: "Палатки Урала",
  title: "Палатки трёхместные",
  quantity: "10",
  unit: "шт",
  planned_kopecks: "3000000",
  actual_kopecks: "3450000",
  status: "paid",
  paid_at: "2026-08-09T12:00:00.000Z",
  payment_method: "перевод",
  note: "",
  cancelled_at: null,
  cancelled_reason: null,
  lock_version: 2
};

const vendorRow = {
  id: "019c0123-4567-789a-bcde-f0123456789d",
  name: "Палатки Урала",
  kind: "rent",
  contact_name: "Сергей",
  phone_e164: "+79000000000",
  telegram: null,
  note: "",
  is_archived: false,
  expense_count: "4"
};
