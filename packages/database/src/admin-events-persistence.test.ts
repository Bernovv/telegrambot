import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAdminEventsPersistence } from "./admin-events-persistence.js";
import type {
  SqlConnection,
  SqlConnectionPool,
  SqlQueryResult
} from "./postgres.js";

interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

describe("PostgreSQL administrator event projections", () => {
  it("lists events with parameterized filters in a read-only snapshot", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("order by events.created_at desc")) {
        return rows([eventRow]);
      }
      return affected();
    });
    const repository = createAdminEventsPersistence(new FakePool(connection));

    const result = await repository.listEvents({
      search: "picnic%_2026",
      status: "published",
      cursor: null,
      limit: 26
    });

    assert.equal(result[0]?.title, "Business Picnic");
    assert.equal(result[0]?.reservedInventoryUnits, 15);
    assert.equal(
      connection.queries[0]?.text,
      "begin transaction isolation level repeatable read read only"
    );
    const query = findQuery(connection, "order by events.created_at desc");
    assert.equal(query.values[0], "%picnic\\%\\_2026%");
    assert.equal(query.values[1], "published");
    assert.equal(query.values[4], 26);
    assert.equal(connection.queries.at(-1)?.text, "commit");
  });

  it("builds event detail with content, inventory, prices, and offer", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("where events.id = $1") && text.includes("product_count")) {
        return rows([eventRow]);
      }
      if (text.includes("from public.event_content_blocks")) {
        return rows([contentRow]);
      }
      if (text.includes("from public.ticket_products products")) {
        return rows([productRow]);
      }
      if (text.includes("from public.pricing_rules rules")) {
        return rows([pricingRow]);
      }
      if (text.includes("from public.offer_versions versions")) {
        return rows([offerRow]);
      }
      if (
        text.includes("from public.scenario_versions versions")
        && text.includes("scenario_title")
      ) {
        return rows([scenarioVersionRow]);
      }
      if (text.includes("from public.scenario_nodes nodes")) {
        return rows(scenarioNodeRows);
      }
      if (text.includes("from public.scenario_edges edges")) {
        return rows([scenarioEdgeRow]);
      }
      return affected();
    });
    const repository = createAdminEventsPersistence(new FakePool(connection));

    const result = await repository.getEvent(EVENT_ID);

    assert.equal(result?.contentBlocks[0]?.content.heading, "Welcome");
    assert.equal(result?.products[0]?.title, "Standard");
    assert.equal(result?.products[0]?.pricingRules[0]?.unitPriceKopecks, "249000");
    assert.equal(result?.products[0]?.reservedInventoryUnits, 4);
    assert.equal(result?.activeOffer?.versionNumber, 3);
    assert.equal(result?.activeOffer?.sha256.length, 64);
    assert.equal(result?.offerVersions[0]?.acceptanceCount, 12);
    assert.equal(result?.offerVersions[0]?.sourceType, "google_docs");
    assert.equal(result?.scenarioVersions[0]?.scenarioTitle, "Ticket sale");
    assert.equal(result?.scenarioVersions[0]?.nodes.length, 2);
    assert.equal(result?.scenarioVersions[0]?.edges[0]?.toNodeId, SCENARIO_END_ID);
  });

  it("rejects malformed JSON projections and rolls back", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("where events.id = $1") && text.includes("product_count")) {
        return rows([eventRow]);
      }
      if (text.includes("from public.event_content_blocks")) {
        return rows([{ ...contentRow, content: [] }]);
      }
      return affected();
    });
    const repository = createAdminEventsPersistence(new FakePool(connection));

    await assert.rejects(repository.getEvent(EVENT_ID), /invalid JSON/);
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
const at = new Date("2026-07-25T12:00:00.000Z");

const eventRow = {
  id: EVENT_ID,
  slug: "business-picnic",
  title: "Business Picnic",
  description: "Annual event",
  status: "published" as const,
  timezone: "Europe/Moscow",
  starts_at: new Date("2026-08-20T08:00:00.000Z"),
  ends_at: new Date("2026-08-20T18:00:00.000Z"),
  sales_starts_at: new Date("2026-07-01T00:00:00.000Z"),
  sales_ends_at: new Date("2026-08-19T21:00:00.000Z"),
  location_name: "Park",
  location_address: "Moscow",
  support_contact: "@support",
  capacity: 500,
  reservation_ttl_minutes: 30,
  phone_required_for_purchase: true,
  offer_required: true,
  published_scenario_version_id: null,
  active_offer_version_id: "00000000-0000-4000-8000-000000000301",
  published_at: at,
  lock_version: 2,
  product_count: "2",
  active_product_count: "2",
  order_count: "120",
  paid_order_count: "98",
  ticket_count: "180",
  reserved_inventory_units: "15",
  consumed_inventory_units: "180",
  created_at: at,
  updated_at: at
};

const contentRow = {
  id: "00000000-0000-4000-8000-000000000401",
  block_type: "hero",
  title: "Hero",
  content_schema_version: 1,
  content: { heading: "Welcome" },
  sort_order: 0,
  is_visible: true
};

const productRow = {
  id: PRODUCT_ID,
  code: "adult_standard",
  product_type: "adult_standard" as const,
  title: "Standard",
  description: "Adult ticket",
  currency: "RUB",
  bundle_composition: [],
  inventory_units_per_item: 1,
  capacity: 300,
  maximum_quantity_per_order: 10,
  is_active: true,
  sort_order: 0,
  reserved_inventory_units: "4",
  consumed_inventory_units: "120"
};

const pricingRow = {
  id: "00000000-0000-4000-8000-000000000501",
  product_id: PRODUCT_ID,
  currency: "RUB",
  minimum_quantity: 1,
  maximum_quantity: 2,
  unit_price_kopecks: "249000",
  priority: 10,
  specificity: 1,
  valid_from: at,
  valid_until: null,
  conditions: {},
  explanation: "Standard tier",
  is_active: true
};

const offerRow = {
  id: "00000000-0000-4000-8000-000000000301",
  offer_document_id: "00000000-0000-4000-8000-000000000302",
  document_title: "Public offer",
  source_type: "google_docs",
  source_url: "https://docs.google.com/document/d/test",
  version_number: 3,
  public_url: "https://example.com/offer.pdf",
  storage_path: "offers/event/version.pdf",
  content_type: "application/pdf",
  sha256: "a".repeat(64),
  published_at: at,
  published_by_admin_id: "00000000-0000-4000-8000-000000000010",
  is_active: true,
  source_revision_id: "revision-3",
  display_text_snapshot: "Offer terms",
  acceptance_count: "12"
};

const SCENARIO_VERSION_ID = "00000000-0000-4000-8000-000000000701";
const SCENARIO_START_ID = "00000000-0000-4000-8000-000000000711";
const SCENARIO_END_ID = "00000000-0000-4000-8000-000000000712";
const scenarioVersionRow = {
  id: SCENARIO_VERSION_ID,
  scenario_id: "00000000-0000-4000-8000-000000000702",
  scenario_title: "Ticket sale",
  version_number: 1,
  status: "published" as const,
  schema_version: 1,
  validation_issues: [],
  created_by_admin_id: "00000000-0000-4000-8000-000000000010",
  published_by_admin_id: "00000000-0000-4000-8000-000000000010",
  created_at: at,
  updated_at: at,
  published_at: at
};
const scenarioNodeRows = [
  {
    scenario_version_id: SCENARIO_VERSION_ID,
    id: SCENARIO_START_ID,
    node_type: "start" as const,
    schema_version: 1,
    payload: {}
  },
  {
    scenario_version_id: SCENARIO_VERSION_ID,
    id: SCENARIO_END_ID,
    node_type: "end" as const,
    schema_version: 1,
    payload: {}
  }
];
const scenarioEdgeRow = {
  scenario_version_id: SCENARIO_VERSION_ID,
  id: "00000000-0000-4000-8000-000000000713",
  from_node_id: SCENARIO_START_ID,
  to_node_id: SCENARIO_END_ID,
  label: null,
  priority: 0,
  condition: {}
};
