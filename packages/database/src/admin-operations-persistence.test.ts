import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAdminOperationsPersistence } from "./admin-operations-persistence.js";
import type {
  SqlConnection,
  SqlConnectionPool,
  SqlQueryResult
} from "./postgres.js";

interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

describe("PostgreSQL administrator read models", () => {
  it("lists masked users with parameterized cursor pagination in a read-only snapshot", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.users users")) {
        return rows([userRow]);
      }
      return affected();
    });
    const repository = createAdminOperationsPersistence(new FakePool(connection));

    const result = await repository.listUsers({
      search: "100%_test",
      blocked: false,
      cursor: {
        occurredAt: new Date("2026-07-25T15:00:00.000Z"),
        id: USER_ID
      },
      limit: 26
    });

    assert.equal(result[0]?.phoneMasked, "+7********67");
    assert.equal(connection.queries[0]?.text,
      "begin transaction isolation level repeatable read read only");
    const query = findQuery(connection, "order by users.registered_at desc");
    assert.equal(query.values[0], "%100\\%\\_test%");
    assert.equal(query.values[5], 26);
    assert.equal(connection.queries.at(-1)?.text, "commit");
  });

  it("builds a user detail without exposing a raw phone", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("where users.id = $1")) {
        return rows([userRow]);
      }
      if (text.includes("from public.messenger_identities")) {
        return rows([identityRow]);
      }
      if (text.includes("from public.user_contacts")) {
        return rows([contactRow]);
      }
      if (text.includes("from public.wallet_accounts")) {
        return rows([walletRow]);
      }
      if (text.includes("where orders.user_id = $1")) {
        return rows([orderRow]);
      }
      return affected();
    });
    const repository = createAdminOperationsPersistence(new FakePool(connection));

    const result = await repository.getUser(USER_ID);

    assert.equal(result?.contacts[0]?.valueMasked, "+7********67");
    assert.equal(JSON.stringify(result).includes("+79991234567"), false);
    assert.equal(result?.recentOrders[0]?.number, "BP-000001");
    assert.equal(result?.walletAccounts[0]?.availableKopecks, "10000");
  });

  it("builds an order detail from immutable amounts, attempts, tickets, and history", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("where orders.id = $1")) {
        return rows([orderRow]);
      }
      if (text.includes("from public.order_items")) {
        return rows([itemRow]);
      }
      if (text.includes("from public.payment_attempts")) {
        return rows([attemptRow]);
      }
      if (text.includes("from public.tickets")) {
        return rows([ticketRow]);
      }
      if (text.includes("from public.order_status_history")) {
        return rows([historyRow]);
      }
      return affected();
    });
    const repository = createAdminOperationsPersistence(new FakePool(connection));

    const result = await repository.getOrder(ORDER_ID);

    assert.equal(result?.totalKopecks, "249000");
    assert.equal(result?.items[0]?.title, "Standard");
    assert.equal(result?.paymentAttempts[0]?.providerStatus, "CONFIRMED");
    assert.equal(result?.tickets[0]?.status, "issued");
    assert.equal(result?.history[0]?.toStatus, "paid");
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
  const query = connection.queries.find((candidate) =>
    candidate.text.includes(fragment)
  );
  assert.ok(query, `Expected query containing: ${fragment}`);
  return query;
}

const USER_ID = "00000000-0000-4000-8000-000000000001";
const ORDER_ID = "00000000-0000-4000-8000-000000000002";
const EVENT_ID = "00000000-0000-4000-8000-000000000003";
const at = new Date("2026-07-25T14:00:00.000Z");

const userRow = {
  id: USER_ID,
  display_name: "Alice",
  telegram_username: "alice",
  phone_normalized: "+79991234567",
  phone_status: "verified",
  is_blocked: false,
  registered_at: at,
  last_seen_at: at,
  order_count: "2",
  paid_order_count: "1",
  wallet_available_kopecks: "10000",
  wallet_held_kopecks: "0"
};

const identityRow = {
  channel: "telegram",
  external_user_id: "1001",
  username: "alice",
  first_seen_at: at,
  last_seen_at: at,
  is_bot_blocked: false
};

const contactRow = {
  contact_type: "phone",
  value_normalized: "+79991234567",
  verification_status: "verified",
  is_primary: true
};

const walletRow = {
  currency: "RUB",
  cached_available_kopecks: "10000",
  cached_held_kopecks: "0",
  status: "active",
  balance_version: "2"
};

const orderRow = {
  id: ORDER_ID,
  number: "BP-000001",
  status: "paid",
  user_id: USER_ID,
  user_display_name: "Alice",
  event_id: EVENT_ID,
  event_title: "Business Picnic",
  total_kopecks: "249000",
  wallet_applied_kopecks: "10000",
  external_due_kopecks: "239000",
  currency: "RUB",
  ticket_count: "1",
  created_at: at,
  paid_at: at,
  expires_at: new Date("2026-07-25T14:30:00.000Z"),
  source: "telegram",
  lock_version: 3
};

const itemRow = {
  id: "00000000-0000-4000-8000-000000000004",
  title: "Standard",
  quantity: 1,
  unit_price_kopecks: "249000",
  line_total_kopecks: "249000"
};

const attemptRow = {
  id: "00000000-0000-4000-8000-000000000005",
  provider: "tbank",
  status: "succeeded",
  amount_kopecks: "239000",
  currency: "RUB",
  provider_status: "CONFIRMED",
  created_at: at,
  confirmed_at: at
};

const ticketRow = {
  id: "00000000-0000-4000-8000-000000000006",
  ticket_number: "BP-000001-T001",
  status: "issued",
  issued_at: at,
  checked_in_at: null,
  revoked_at: null
};

const historyRow = {
  from_status: "payment_processing",
  to_status: "paid",
  reason: "payment_confirmed",
  actor_type: "payment_provider",
  occurred_at: at
};
