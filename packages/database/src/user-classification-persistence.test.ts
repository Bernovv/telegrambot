import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PostgresUnitOfWork,
  TransactionSession,
  type SqlConnection,
  type SqlConnectionPool,
  type SqlQueryResult
} from "./postgres.js";
import {
  PostgresUserClassificationAuditWriter,
  PostgresUserClassificationRepository
} from "./user-classification-persistence.js";

describe("PostgresUserClassificationRepository", () => {
  it("locks a user, closes the prior group assignment, and appends a status", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.users")) {
        return rows([{ id: userId }]);
      }
      if (text.includes("from public.user_statuses")) {
        return rows([{
          id: statusId,
          code: "interested",
          display_name: "Заинтересован",
          color: "#7C3AED",
          exclusivity_group: "lifecycle",
          allowed_transition_codes: null,
          is_active: true
        }]);
      }
      if (
        text.includes("from public.user_status_assignments assignment")
        && text.includes("assignment.exclusivity_group")
      ) {
        return rows([{
          id: oldAssignmentId,
          status_id: oldStatusId,
          status_code: "new",
          exclusivity_group: "lifecycle",
          allowed_transition_codes: null
        }]);
      }
      if (
        text.includes("select status_code as code")
        && text.includes("user_status_assignments")
      ) {
        return rows([{ code: "interested" }]);
      }
      if (text.includes("select category_code as code")) {
        return rows([]);
      }
      return affected();
    });
    const session = new TransactionSession();
    const repository = new PostgresUserClassificationRepository(session);
    const unitOfWork = new PostgresUnitOfWork(
      new FakePool(connection),
      session
    );

    const snapshot = await unitOfWork.transact(async () => {
      assert.equal(await repository.lockUser(userId), true);
      const definition = await repository.findStatusByCode("interested");
      assert.ok(definition);
      const current = await repository.findActiveStatusInGroup(
        userId,
        "lifecycle"
      );
      assert.equal(current?.code, "new");
      await repository.closeStatusAssignment({
        assignmentId: oldAssignmentId,
        removedAt: assignedAt,
        source: "scenario",
        sourceReference,
        reason
      });
      await repository.createStatusAssignment({
        assignmentId,
        userId,
        status: definition,
        source: "scenario",
        sourceReference,
        actorAdminId: null,
        reason,
        assignedAt
      });
      return repository.getActiveSnapshot(userId);
    });

    assert.deepEqual(snapshot, {
      statusCodes: ["interested"],
      categoryCodes: []
    });
    assert.equal(
      findQuery(connection, "update public.user_status_assignments").values[0],
      oldAssignmentId
    );
    assert.deepEqual(
      findQuery(connection, "insert into public.user_status_assignments").values,
      [
        assignmentId,
        userId,
        statusId,
        "interested",
        "Заинтересован",
        "#7C3AED",
        "lifecycle",
        "scenario",
        sourceReference,
        null,
        reason,
        assignedAt
      ]
    );
    assert.equal(connection.queries.at(-1)?.text, "commit");
  });

  it("loads and appends category snapshots without replacing other tags", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.user_categories")) {
        return rows([{
          id: categoryId,
          code: "vip",
          display_name: "VIP",
          color: "#CA8A04",
          is_active: true
        }]);
      }
      if (
        text.includes("from public.user_category_assignments")
        && text.includes("category_id = $2")
      ) {
        return rows([]);
      }
      return affected();
    });
    const session = new TransactionSession();
    const repository = new PostgresUserClassificationRepository(session);

    await new PostgresUnitOfWork(
      new FakePool(connection),
      session
    ).transact(async () => {
      const definition = await repository.findCategoryByCode("vip");
      assert.ok(definition);
      assert.equal(
        await repository.findActiveCategory(userId, categoryId),
        null
      );
      await repository.createCategoryAssignment({
        assignmentId,
        userId,
        category: definition,
        source: "scenario",
        sourceReference,
        actorAdminId: null,
        reason,
        assignedAt
      });
    });

    assert.deepEqual(
      findQuery(connection, "insert into public.user_category_assignments").values,
      [
        assignmentId,
        userId,
        categoryId,
        "vip",
        "VIP",
        "#CA8A04",
        "scenario",
        sourceReference,
        null,
        reason,
        assignedAt
      ]
    );
  });

  it("closes a category and appends masked administrator audit atomically", async () => {
    const connection = new FakeConnection(() => affected());
    const session = new TransactionSession();
    const repository = new PostgresUserClassificationRepository(session);
    const audit = new PostgresUserClassificationAuditWriter(session);

    await new PostgresUnitOfWork(
      new FakePool(connection),
      session
    ).transact(async () => {
      await repository.closeCategoryAssignment({
        assignmentId,
        removedAt: assignedAt,
        source: "manual",
        sourceReference: `manual:${auditId}`,
        reason
      });
      await audit.append({
        audit: {
          auditId,
          actorRole: "sales_manager",
          requestId: "manual-classification-1",
          ipAddress: "127.0.0.1",
          userAgent: "test"
        },
        actorAdminId: adminId,
        action: "user_category.removed",
        userId,
        reason,
        before: { statusCodes: [], categoryCodes: ["vip"] },
        after: { statusCodes: [], categoryCodes: [] },
        occurredAt: assignedAt
      });
    });

    assert.equal(
      findQuery(connection, "update public.user_category_assignments").values[0],
      assignmentId
    );
    assert.deepEqual(
      findQuery(connection, "insert into public.audit_log").values.slice(0, 6),
      [
        auditId,
        adminId,
        "sales_manager",
        "user_category.removed",
        userId,
        reason
      ]
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

const userId = "00000000-0000-4000-8000-000000000101";
const statusId = "00000000-0000-4000-8000-000000000102";
const oldStatusId = "00000000-0000-4000-8000-000000000103";
const categoryId = "00000000-0000-4000-8000-000000000104";
const oldAssignmentId = "00000000-0000-4000-8000-000000000105";
const assignmentId = "00000000-0000-4000-8000-000000000106";
const adminId = "00000000-0000-4000-8000-000000000109";
const auditId = "00000000-0000-4000-8000-000000000110";
const sourceReference =
  "scenario_status:00000000-0000-4000-8000-000000000107:00000000-0000-4000-8000-000000000108";
const reason = "Назначено опубликованным сценарием";
const assignedAt = new Date("2026-07-28T18:30:00.000Z");
