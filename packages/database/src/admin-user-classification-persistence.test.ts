import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  AdminUserCategoryDefinition
} from "@ticket-platform/contracts";
import {
  type SqlConnection,
  type SqlConnectionPool,
  type SqlQueryResult
} from "./postgres.js";
import { PostgresAdminUserClassificationRepository } from "./admin-user-classification-persistence.js";

describe("PostgresAdminUserClassificationRepository", () => {
  it("updates a locked status and appends administrator audit", async () => {
    const connection = new FakeConnection((text) => {
      if (
        text.includes("from public.user_statuses")
        && text.includes("for update")
      ) {
        return rows([statusRow()]);
      }
      if (text.includes("select count(*)::text as count")) {
        return rows([{ count: "1" }]);
      }
      if (text.includes("update public.user_statuses")) {
        return rows([{
          ...statusRow(),
          display_name: "Клиент",
          allowed_transition_codes: ["paid"],
          lock_version: 2
        }]);
      }
      return affected();
    });
    const repository = new PostgresAdminUserClassificationRepository(
      new FakePool(connection)
    );

    const result = await repository.updateStatus({
      statusId,
      expectedLockVersion: 1,
      patch: {
        displayName: "Клиент",
        color: "#2563EB",
        description: null,
        exclusivityGroup: "lifecycle",
        allowedTransitionCodes: ["paid"],
        isActive: true
      },
      audit
    });

    assert.equal(result.status, "updated");
    if (result.status === "updated") {
      assert.equal(result.value.lockVersion, 2);
      assert.equal(result.value.displayName, "Клиент");
    }
    assert.deepEqual(
      findQuery(connection, "update public.user_statuses").values.slice(0, 3),
      [statusId, "Клиент", "#2563EB"]
    );
    assert.equal(
      findQuery(connection, "insert into public.audit_log").values[3],
      "user_status.updated"
    );
    assert.equal(connection.queries.at(-1)?.text, "commit");
  });

  it("returns a code conflict without inserting or auditing", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("select id from public.user_categories")) {
        return rows([{ id: categoryId }]);
      }
      return affected();
    });
    const repository = new PostgresAdminUserClassificationRepository(
      new FakePool(connection)
    );

    const result = await repository.createCategory({
      category: category(),
      audit
    });

    assert.equal(result, "code_conflict");
    assert.equal(
      connection.queries.some((query) =>
        query.text.includes("insert into public.user_categories")
      ),
      false
    );
    assert.equal(
      connection.queries.some((query) =>
        query.text.includes("insert into public.audit_log")
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

interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
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

function statusRow() {
  return {
    id: statusId,
    code: "interested",
    display_name: "Заинтересован",
    color: "#7C3AED",
    description: null,
    is_system: false,
    exclusivity_group: "lifecycle",
    allowed_transition_codes: null,
    is_active: true,
    lock_version: 1
  };
}

function category(): AdminUserCategoryDefinition {
  return {
    id: categoryId,
    code: "vip",
    displayName: "VIP",
    color: "#CA8A04",
    description: null,
    isSystem: false,
    isActive: true,
    lockVersion: 1
  };
}

const statusId = "00000000-0000-4000-8000-000000000101";
const categoryId = "00000000-0000-4000-8000-000000000102";
const audit = {
  auditId: "00000000-0000-4000-8000-000000000103",
  actorAdminId: "00000000-0000-4000-8000-000000000104",
  actorRole: "sales_manager",
  reason: "Обновление рабочего справочника",
  requestId: "request-classification-1",
  ipAddress: "127.0.0.1",
  userAgent: "test",
  occurredAt: new Date("2026-07-28T19:30:00.000Z")
};
