import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  AdminEventAuditContext,
  AdminEventPricingRuleRecord,
  AdminEventProductRecord
} from "@ticket-platform/application";
import { createAdminEventCatalogManagementPersistence } from "./admin-event-catalog-management-persistence.js";
import type {
  SqlConnection,
  SqlConnectionPool,
  SqlQueryResult
} from "./postgres.js";

interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

describe("PostgreSQL administrator event product and pricing management", () => {
  it("creates a product under the event sales lock and audits the new version", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.events") && text.includes("for update")) {
        return rows([eventGateRow]);
      }
      if (text.includes("select exists(")) {
        return rows([{ exists: false }]);
      }
      if (text.includes("update public.events")) {
        return rows([{ lock_version: 4 }]);
      }
      return affected();
    });
    const repository = createAdminEventCatalogManagementPersistence(
      new FakePool(connection)
    );

    const result = await repository.createProduct({
      eventId: EVENT_ID,
      productId: PRODUCT_ID,
      expectedLockVersion: 3,
      product,
      audit
    });

    assert.deepEqual(result, { status: "created", lockVersion: 4 });
    assert.equal(
      findQuery(connection, "pg_advisory_xact_lock").values[0],
      `event-sales:${EVENT_ID}`
    );
    const insert = findQuery(connection, "insert into public.ticket_products");
    assert.equal(insert.values[2], "adult_standard");
    assert.equal(insert.values[7], "[]");
    const auditInsert = findQuery(connection, "insert into public.audit_log");
    assert.equal(auditInsert.values[3], "event.product_created");
    assert.match(String(auditInsert.values[8]), /"eventLockVersion":4/);
    assert.equal(connection.queries.at(-1)?.text, "commit");
  });

  it("updates an owned product with before and after snapshots", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.events") && text.includes("for update")) {
        return rows([eventGateRow]);
      }
      if (text.includes("from public.ticket_products") && text.includes("for update")) {
        return rows([productRow]);
      }
      if (text.includes("select exists(")) {
        return rows([{ exists: false }]);
      }
      if (text.includes("update public.events")) {
        return rows([{ lock_version: 4 }]);
      }
      return affected();
    });
    const repository = createAdminEventCatalogManagementPersistence(
      new FakePool(connection)
    );

    const result = await repository.updateProduct({
      eventId: EVENT_ID,
      productId: PRODUCT_ID,
      expectedLockVersion: 3,
      product: { ...product, isActive: false },
      audit
    });

    assert.deepEqual(result, { status: "updated", lockVersion: 4 });
    const update = findQuery(connection, "update public.ticket_products");
    assert.equal(update.values[11], false);
    const auditInsert = findQuery(connection, "insert into public.audit_log");
    assert.match(String(auditInsert.values[7]), /"isActive":true/);
    assert.match(String(auditInsert.values[8]), /"isActive":false/);
  });

  it("rejects a product currency change that conflicts with existing prices", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.events") && text.includes("for update")) {
        return rows([eventGateRow]);
      }
      if (text.includes("from public.ticket_products") && text.includes("for update")) {
        return rows([productRow]);
      }
      if (text.includes("from public.pricing_rules")) {
        return rows([{ exists: true }]);
      }
      if (text.includes("select exists(")) {
        return rows([{ exists: false }]);
      }
      return affected();
    });
    const repository = createAdminEventCatalogManagementPersistence(
      new FakePool(connection)
    );

    const result = await repository.updateProduct({
      eventId: EVENT_ID,
      productId: PRODUCT_ID,
      expectedLockVersion: 3,
      product: { ...product, currency: "USD" },
      audit
    });

    assert.deepEqual(result, { status: "currency_mismatch" });
    assert.equal(
      connection.queries.some((query) =>
        query.text.includes("update public.ticket_products")
      ),
      false
    );
  });

  it("creates a bigint pricing rule and rejects a product currency mismatch", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.events") && text.includes("for update")) {
        return rows([eventGateRow]);
      }
      if (text.includes("select id, currency")) {
        return rows([{ id: PRODUCT_ID, currency: "RUB" }]);
      }
      if (text.includes("update public.events")) {
        return rows([{ lock_version: 4 }]);
      }
      return affected();
    });
    const repository = createAdminEventCatalogManagementPersistence(
      new FakePool(connection)
    );
    const created = await repository.createPricingRule({
      eventId: EVENT_ID,
      productId: PRODUCT_ID,
      pricingRuleId: PRICING_RULE_ID,
      expectedLockVersion: 3,
      pricingRule,
      audit
    });
    assert.deepEqual(created, { status: "created", lockVersion: 4 });
    const insert = findQuery(connection, "insert into public.pricing_rules");
    assert.equal(insert.values[5], "249000");
    assert.equal(insert.values[10], "{}");

    const mismatchConnection = new FakeConnection((text) => {
      if (text.includes("from public.events") && text.includes("for update")) {
        return rows([eventGateRow]);
      }
      if (text.includes("select id, currency")) {
        return rows([{ id: PRODUCT_ID, currency: "USD" }]);
      }
      return affected();
    });
    const mismatchRepository = createAdminEventCatalogManagementPersistence(
      new FakePool(mismatchConnection)
    );
    const mismatch = await mismatchRepository.createPricingRule({
      eventId: EVENT_ID,
      productId: PRODUCT_ID,
      pricingRuleId: PRICING_RULE_ID,
      expectedLockVersion: 3,
      pricingRule,
      audit
    });
    assert.deepEqual(mismatch, { status: "currency_mismatch" });
    assert.equal(
      mismatchConnection.queries.some((query) =>
        query.text.includes("insert into public.pricing_rules")
      ),
      false
    );
  });

  it("rolls back the child mutation when audit persistence fails", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.events") && text.includes("for update")) {
        return rows([eventGateRow]);
      }
      if (text.includes("select id, currency")) {
        return rows([{ id: PRODUCT_ID, currency: "RUB" }]);
      }
      if (text.includes("update public.events")) {
        return rows([{ lock_version: 4 }]);
      }
      if (text.includes("insert into public.audit_log")) {
        throw new Error("audit unavailable");
      }
      return affected();
    });
    const repository = createAdminEventCatalogManagementPersistence(
      new FakePool(connection)
    );

    await assert.rejects(
      repository.createPricingRule({
        eventId: EVENT_ID,
        productId: PRODUCT_ID,
        pricingRuleId: PRICING_RULE_ID,
        expectedLockVersion: 3,
        pricingRule,
        audit
      }),
      /audit unavailable/
    );
    assert.equal(connection.queries.at(-1)?.text, "rollback");
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

const EVENT_ID = "00000000-0000-4000-8000-000000000101";
const PRODUCT_ID = "00000000-0000-4000-8000-000000000201";
const PRICING_RULE_ID = "00000000-0000-4000-8000-000000000301";
const occurredAt = new Date("2026-07-26T11:00:00.000Z");

const eventGateRow = {
  id: EVENT_ID,
  status: "draft",
  lock_version: 3
};

const product: AdminEventProductRecord = {
  code: "adult_standard",
  productType: "adult_standard",
  title: "Standard",
  description: "Adult ticket",
  currency: "RUB",
  bundleComposition: [],
  inventoryUnitsPerItem: 1,
  capacity: 300,
  maximumQuantityPerOrder: 10,
  isActive: true,
  sortOrder: 0
};

const productRow = {
  id: PRODUCT_ID,
  event_id: EVENT_ID,
  code: product.code,
  product_type: product.productType,
  title: product.title,
  description: product.description,
  currency: product.currency,
  bundle_composition: [],
  inventory_units_per_item: product.inventoryUnitsPerItem,
  capacity: product.capacity,
  maximum_quantity_per_order: product.maximumQuantityPerOrder,
  is_active: product.isActive,
  sort_order: product.sortOrder
};

const pricingRule: AdminEventPricingRuleRecord = {
  currency: "RUB",
  minimumQuantity: 1,
  maximumQuantity: 2,
  unitPriceKopecks: "249000",
  priority: 10,
  specificity: 0,
  validFrom: new Date("2026-07-01T00:00:00.000Z"),
  validUntil: null,
  conditions: {},
  explanation: "Standard tier",
  isActive: true
};

const audit: AdminEventAuditContext = {
  auditId: "00000000-0000-4000-8000-000000000901",
  actorAdminId: "00000000-0000-4000-8000-000000000010",
  actorRole: "content_manager",
  reason: "Manage catalog",
  requestId: "request-catalog-1",
  ipAddress: "127.0.0.1",
  userAgent: "admin-web-test",
  occurredAt
};
