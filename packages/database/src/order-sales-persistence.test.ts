import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CreateOrderService,
  type IdGenerator,
  type OrderReferenceGenerator
} from "@ticket-platform/application";
import {
  type SqlConnection,
  type SqlConnectionPool,
  type SqlQueryResult
} from "./postgres.js";
import { createOrderSalesPersistence } from "./order-sales-persistence.js";

interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

describe("PostgreSQL event sales persistence", () => {
  it("locks inventory and atomically creates an order, reservation, wallet hold, history, and outbox", async () => {
    const connection = new FakeConnection((text, values) => {
      if (text.includes("from public.orders")) {
        return rows([]);
      }
      if (text.includes("from public.events e")) {
        return rows([eventContextRow]);
      }
      if (text.includes("from public.ticket_products p")) {
        return rows([productPricingRow]);
      }
      if (text.includes("from public.inventory_reservations")) {
        return rows([]);
      }
      if (text.includes("insert into public.orders")) {
        return rows([{
          id: values[0],
          number: values[1],
          status: values[7],
          currency: values[8],
          total_kopecks: values[10],
          wallet_applied_kopecks: values[11],
          external_due_kopecks: values[12],
          expires_at: values[16],
          creation_request_hash: values[4]
        }]);
      }
      if (text.includes("from public.wallet_accounts")) {
        return rows([{
          id: "wallet-1",
          cached_available_kopecks: "10000",
          status: "active"
        }]);
      }
      if (text.includes("from public.wallet_entries credit")) {
        return rows([{
          id: "credit-1",
          amount_kopecks: "10000",
          debited_kopecks: "0",
          held_kopecks: "0"
        }]);
      }

      return affected();
    });
    const idGenerator = sequenceIdGenerator([
      "item-1",
      "order-1",
      "reservation-1",
      "wallet-transaction-1",
      "wallet-hold-1",
      "wallet-hold-entry-1",
      "history-1",
      "outbox-1"
    ]);
    const persistence = createOrderSalesPersistence(new FakePool(connection), idGenerator);
    const service = new CreateOrderService(
      persistence.orderSalesRepository,
      persistence.outboxWriter,
      persistence.unitOfWork,
      idGenerator,
      referenceGenerator
    );

    const result = await service.execute({
      idempotencyKey: "telegram-order:1001",
      userId: "user-1",
      eventId: "event-1",
      currency: "RUB",
      items: [{ productId: "product-1", quantity: 1 }],
      wallet: { mode: "all" },
      source: "telegram",
      createdAt: new Date("2026-07-24T12:00:00.000Z")
    });

    assert.equal(result.totalKopecks, "249000");
    assert.equal(result.walletAppliedKopecks, "10000");
    assert.equal(result.externalDueKopecks, "239000");
    assert.equal(connection.queries[0]?.text, "begin");
    assert.ok(queryIndex(connection, "pg_advisory_xact_lock") < queryIndex(connection, "from public.events e"));
    assert.deepEqual(findQuery(connection, "update public.wallet_accounts").values.slice(0, 2), [
      "wallet-1",
      "10000"
    ]);
    assert.equal(findQuery(connection, "insert into public.inventory_reservations").values[0], "reservation-1");
    assert.equal(findQuery(connection, "insert into public.order_status_history").values[0], "history-1");
    assert.equal(findQuery(connection, "insert into public.outbox_events").values[0], "outbox-1");
    assert.equal(connection.queries.at(-1)?.text, "commit");
    assert.equal(connection.released, true);
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
  released = false;

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

  release(): void {
    this.released = true;
  }
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

function queryIndex(connection: FakeConnection, fragment: string): number {
  const index = connection.queries.findIndex((candidate) => candidate.text.includes(fragment));
  assert.notEqual(index, -1, `Expected query containing: ${fragment}`);
  return index;
}

function sequenceIdGenerator(ids: readonly string[]): IdGenerator {
  let index = 0;
  return {
    newId() {
      const id = ids[index];
      index += 1;
      if (!id) {
        throw new Error("No generated ID left in test fixture");
      }
      return id;
    }
  };
}

const referenceGenerator: OrderReferenceGenerator = {
  orderNumber() {
    return "BP-000001";
  },
  publicToken() {
    return {
      token: "order_token_order-1",
      sha256: "a".repeat(64)
    };
  }
};

const eventContextRow = {
  id: "event-1",
  slug: "business-picnic",
  title: "Business Picnic",
  timezone: "Europe/Moscow",
  starts_at: new Date("2026-08-20T07:00:00.000Z"),
  ends_at: new Date("2026-08-20T18:00:00.000Z"),
  sales_starts_at: new Date("2026-07-01T00:00:00.000Z"),
  sales_ends_at: new Date("2026-08-20T06:00:00.000Z"),
  status: "published",
  capacity: 100,
  reservation_ttl_minutes: 30,
  phone_required_for_purchase: true,
  offer_required: true,
  active_offer_version_id: "offer-version-1",
  active_offer_public_url: "https://example.test/offers/offer-version-1",
  phone_status: "verified",
  wallet_available_kopecks: "10000"
} as const;

const productPricingRow = {
  product_id: "product-1",
  code: "standard",
  product_type: "adult_standard",
  title: "Standard",
  currency: "RUB",
  bundle_composition: [],
  inventory_units_per_item: 1,
  capacity: null,
  maximum_quantity_per_order: 10,
  is_active: true,
  rule_id: "rule-1",
  rule_currency: "RUB",
  unit_price_kopecks: "249000",
  priority: 10,
  specificity: 1,
  minimum_quantity: 1,
  maximum_quantity: 2,
  valid_from: null,
  valid_until: null,
  explanation: "Standard 1-2"
} as const;
