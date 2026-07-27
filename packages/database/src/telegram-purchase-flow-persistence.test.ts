import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createTelegramPurchaseFlowPersistence,
  PostgresEventCatalogRepository,
  PostgresPurchaseDraftRepository
} from "./telegram-purchase-flow-persistence.js";
import type { SqlConnection, SqlConnectionPool, SqlQueryResult } from "./postgres.js";

interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

describe("PostgreSQL Telegram purchase draft persistence", () => {
  it("returns null when the user has no in-progress draft", async () => {
    const connection = new FakeConnection(() => rows([{
      ticket_type: null,
      step: null,
      adult_quantity: null,
      child_quantity: null,
      idempotency_nonce: null,
      started_at: null
    }]));
    const repository = new PostgresPurchaseDraftRepository(new FakePool(connection));

    const draft = await repository.getDraft("user-1");

    assert.equal(draft, null);
    assert.equal(connection.released, true);
  });

  it("reads back a draft written earlier, quantities parsed as numbers", async () => {
    const connection = new FakeConnection(() => rows([{
      ticket_type: "adult_standard",
      step: "awaiting_child_quantity",
      adult_quantity: "3",
      child_quantity: "0",
      idempotency_nonce: "nonce-1",
      started_at: "2026-07-27T10:00:00.000Z"
    }]));
    const repository = new PostgresPurchaseDraftRepository(new FakePool(connection));

    const draft = await repository.getDraft("user-1");

    assert.deepEqual(draft, {
      ticketType: "adult_standard",
      step: "awaiting_child_quantity",
      adultQuantity: 3,
      childQuantity: 0,
      idempotencyNonce: "nonce-1",
      startedAt: "2026-07-27T10:00:00.000Z"
    });
  });

  it("writes the draft as a single jsonb_set update and releases the connection", async () => {
    const connection = new FakeConnection(() => affected());
    const repository = new PostgresPurchaseDraftRepository(new FakePool(connection));

    await repository.setDraft("user-1", {
      ticketType: "adult_vip",
      step: "awaiting_quantity",
      adultQuantity: null,
      childQuantity: 0,
      idempotencyNonce: "nonce-2",
      startedAt: "2026-07-27T10:00:00.000Z"
    });

    const query = findQuery(connection, "jsonb_set(metadata");
    assert.equal(query.values[0], "user-1");
    assert.deepEqual(JSON.parse(query.values[1] as string), {
      ticketType: "adult_vip",
      step: "awaiting_quantity",
      adultQuantity: null,
      childQuantity: 0,
      idempotencyNonce: "nonce-2",
      startedAt: "2026-07-27T10:00:00.000Z"
    });
    assert.equal(connection.released, true);
  });

  it("clears the draft key without touching the rest of metadata", async () => {
    const connection = new FakeConnection(() => affected());
    const repository = new PostgresPurchaseDraftRepository(new FakePool(connection));

    await repository.clearDraft("user-1");

    const query = findQuery(connection, "metadata - 'telegramPurchaseDraft'");
    assert.deepEqual(query.values, ["user-1"]);
  });
});

describe("PostgreSQL event catalog lookup", () => {
  it("returns null for an unknown or unpublished event slug", async () => {
    const connection = new FakeConnection(() => rows([]));
    const repository = new PostgresEventCatalogRepository(new FakePool(connection));

    const catalog = await repository.findPublishedCatalog("does-not-exist");

    assert.equal(catalog, null);
  });

  it("aggregates active products by product type, ignoring unrecognized types", async () => {
    const connection = new FakeConnection(() => rows([
      {
        event_id: "event-1",
        currency: "RUB",
        product_id: "product-standard",
        product_type: "adult_standard",
        maximum_quantity_per_order: 50
      },
      {
        event_id: "event-1",
        currency: "RUB",
        product_id: "product-child",
        product_type: "child",
        maximum_quantity_per_order: 50
      },
      {
        event_id: "event-1",
        currency: "RUB",
        product_id: "product-merch",
        product_type: "custom",
        maximum_quantity_per_order: 10
      }
    ]));
    const repository = new PostgresEventCatalogRepository(new FakePool(connection));

    const catalog = await repository.findPublishedCatalog("business-picnic-2026");

    assert.deepEqual(catalog, {
      eventId: "event-1",
      currency: "RUB",
      offerUrl: null,
      products: {
        adult_standard: { id: "product-standard", maximumQuantityPerOrder: 50 },
        child: { id: "product-child", maximumQuantityPerOrder: 50 }
      }
    });
  });
});

describe("createTelegramPurchaseFlowPersistence", () => {
  it("wires both repositories against the same pool", async () => {
    const connection = new FakeConnection(() => rows([]));
    const persistence = createTelegramPurchaseFlowPersistence(new FakePool(connection));

    assert.ok(persistence.purchaseDraftRepository instanceof PostgresPurchaseDraftRepository);
    assert.ok(persistence.eventCatalogRepository instanceof PostgresEventCatalogRepository);
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
    private readonly respond: (text: string, values: readonly unknown[]) => SqlQueryResult<unknown>
  ) {}

  async query<TRow>(text: string, values: readonly unknown[] = []): Promise<SqlQueryResult<TRow>> {
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
