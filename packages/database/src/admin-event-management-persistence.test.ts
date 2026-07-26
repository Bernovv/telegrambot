import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  AdminEventAuditContext,
  AdminEventGeneralRecord
} from "@ticket-platform/application";
import { createAdminEventManagementPersistence } from "./admin-event-management-persistence.js";
import type {
  SqlConnection,
  SqlConnectionPool,
  SqlQueryResult
} from "./postgres.js";

interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

describe("PostgreSQL administrator event draft management", () => {
  it("creates a draft and append-only audit atomically", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("select exists(")) {
        return rows([{ exists: false }]);
      }
      return affected();
    });
    const repository = createAdminEventManagementPersistence(
      new FakePool(connection)
    );

    const result = await repository.createDraft({
      eventId: EVENT_ID,
      event,
      audit
    });

    assert.equal(result, "created");
    assert.equal(connection.queries[0]?.text, "begin");
    assert.equal(
      findQuery(connection, "pg_advisory_xact_lock").values[0],
      "event-slug:business-picnic"
    );
    const insert = findQuery(connection, "insert into public.events");
    assert.equal(insert.values[1], "business-picnic");
    assert.equal(insert.values[12], 500);
    const auditInsert = findQuery(connection, "insert into public.audit_log");
    assert.equal(auditInsert.values[3], "event.draft_created");
    assert.equal(auditInsert.values[6], null);
    assert.match(String(auditInsert.values[7]), /"lockVersion":1/);
    assert.equal(connection.queries.at(-1)?.text, "commit");
  });

  it("locks and updates only the expected draft version with before/after audit", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.events") && text.includes("for update")) {
        return rows([eventRow]);
      }
      if (text.includes("select exists(")) {
        return rows([{ exists: false }]);
      }
      if (text.includes("update public.events")) {
        return rows([{ lock_version: 3 }]);
      }
      return affected();
    });
    const repository = createAdminEventManagementPersistence(
      new FakePool(connection)
    );

    const result = await repository.updateDraft({
      eventId: EVENT_ID,
      expectedLockVersion: 2,
      event: { ...event, title: "Updated picnic" },
      audit
    });

    assert.deepEqual(result, { status: "updated", lockVersion: 3 });
    const update = findQuery(connection, "update public.events");
    assert.equal(update.values[2], "Updated picnic");
    const auditInsert = findQuery(connection, "insert into public.audit_log");
    assert.equal(auditInsert.values[3], "event.general_updated");
    assert.match(String(auditInsert.values[6]), /"title":"Business Picnic"/);
    assert.match(String(auditInsert.values[7]), /"lockVersion":3/);
  });

  it("does not mutate a stale draft and rolls back an audit failure", async () => {
    const staleConnection = new FakeConnection((text) => {
      if (text.includes("for update")) {
        return rows([eventRow]);
      }
      return affected();
    });
    const repository = createAdminEventManagementPersistence(
      new FakePool(staleConnection)
    );
    const stale = await repository.updateDraft({
      eventId: EVENT_ID,
      expectedLockVersion: 1,
      event,
      audit
    });
    assert.deepEqual(stale, { status: "version_conflict" });
    assert.equal(
      staleConnection.queries.some((query) =>
        query.text.includes("update public.events")
      ),
      false
    );

    const failingConnection = new FakeConnection((text) => {
      if (text.includes("select exists(")) {
        return rows([{ exists: false }]);
      }
      if (text.includes("insert into public.audit_log")) {
        throw new Error("audit unavailable");
      }
      return affected();
    });
    const failingRepository = createAdminEventManagementPersistence(
      new FakePool(failingConnection)
    );
    await assert.rejects(
      failingRepository.createDraft({ eventId: EVENT_ID, event, audit }),
      /audit unavailable/
    );
    assert.equal(failingConnection.queries.at(-1)?.text, "rollback");
  });

  it("publishes a complete locked draft and appends an audit record", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.events") && text.includes("for update")) {
        return rows([eventRow]);
      }
      if (text.includes("from public.ticket_products")) {
        return rows([{
          active_product_count: "1",
          unpriced_active_product_count: "0"
        }]);
      }
      if (text.includes("set status = 'published'")) {
        return rows([{ lock_version: 3 }]);
      }
      return affected();
    });
    const repository = createAdminEventManagementPersistence(
      new FakePool(connection)
    );

    const result = await repository.publishDraft({
      eventId: EVENT_ID,
      expectedLockVersion: 2,
      audit
    });

    assert.deepEqual(result, { status: "published", lockVersion: 3 });
    assert.match(
      findQuery(connection, "from public.ticket_products").text,
      /rules\.unit_price_kopecks > 0/
    );
    assert.equal(
      findQuery(connection, "set status = 'published'").values[1],
      occurredAt
    );
    const auditInsert = findQuery(connection, "insert into public.audit_log");
    assert.equal(auditInsert.values[3], "event.published");
    assert.match(String(auditInsert.values[7]), /"status":"published"/);
    assert.equal(connection.queries.at(-1)?.text, "commit");
  });

  it("returns every unmet publication requirement without mutating the draft", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.events") && text.includes("for update")) {
        return rows([{
          ...eventRow,
          support_contact: null,
          active_offer_version_id: null,
          published_scenario_version_id: null
        }]);
      }
      if (text.includes("from public.ticket_products")) {
        return rows([{
          active_product_count: "1",
          unpriced_active_product_count: "1"
        }]);
      }
      return affected();
    });
    const repository = createAdminEventManagementPersistence(
      new FakePool(connection)
    );

    const result = await repository.publishDraft({
      eventId: EVENT_ID,
      expectedLockVersion: 2,
      audit
    });

    assert.deepEqual(result, {
      status: "requirements_failed",
      issues: [
        "missing_support_contact",
        "active_product_without_price",
        "missing_active_offer",
        "missing_published_scenario"
      ]
    });
    assert.equal(
      connection.queries.some((query) =>
        query.text.includes("set status = 'published'")
      ),
      false
    );
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
const occurredAt = new Date("2026-07-26T10:00:00.000Z");

const event: AdminEventGeneralRecord = {
  slug: "business-picnic",
  title: "Business Picnic",
  description: "Annual event",
  timezone: "Europe/Moscow",
  startsAt: new Date("2026-08-20T08:00:00.000Z"),
  endsAt: new Date("2026-08-20T18:00:00.000Z"),
  salesStartsAt: new Date("2026-07-01T00:00:00.000Z"),
  salesEndsAt: new Date("2026-08-19T21:00:00.000Z"),
  locationName: "Park",
  locationAddress: "Moscow",
  supportContact: "@support",
  capacity: 500,
  reservationTtlMinutes: 30,
  phoneRequiredForPurchase: true,
  offerRequired: true
};

const audit: AdminEventAuditContext = {
  auditId: "00000000-0000-4000-8000-000000000901",
  actorAdminId: "00000000-0000-4000-8000-000000000010",
  actorRole: "content_manager",
  reason: "Update event",
  requestId: "request-1",
  ipAddress: "127.0.0.1",
  userAgent: "admin-web-test",
  occurredAt
};

const eventRow = {
  id: EVENT_ID,
  slug: event.slug,
  title: event.title,
  description: event.description,
  timezone: event.timezone,
  starts_at: event.startsAt,
  ends_at: event.endsAt,
  sales_starts_at: event.salesStartsAt,
  sales_ends_at: event.salesEndsAt,
  location_name: event.locationName,
  location_address: event.locationAddress,
  support_contact: event.supportContact,
  status: "draft",
  capacity: event.capacity,
  reservation_ttl_minutes: event.reservationTtlMinutes,
  phone_required_for_purchase: event.phoneRequiredForPurchase,
  offer_required: event.offerRequired,
  active_offer_version_id: "00000000-0000-4000-8000-000000000601",
  published_scenario_version_id: "00000000-0000-4000-8000-000000000701",
  lock_version: 2
};
