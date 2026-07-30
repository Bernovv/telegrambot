import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  SqlConnection,
  SqlConnectionPool,
  SqlQueryResult
} from "./postgres.js";
import {
  PostgresAdminUserImportDecisionRepository
} from "./admin-user-import-decision-persistence.js";

describe("PostgresAdminUserImportDecisionRepository", () => {
  it("reads the latest decision context in a repeatable-read snapshot", async () => {
    const connection = new FakeConnection((text) =>
      text.includes("from public.user_import_match_analyses")
        ? rows([contextRow()])
        : affected()
    );
    const repository = new PostgresAdminUserImportDecisionRepository(
      new FakePool(connection)
    );

    const context = await repository.getContext(analysisId, 2);

    assert.equal(context?.matchStatus, "POSSIBLE_MATCH");
    assert.deepEqual(context?.candidateUserIds, [userId]);
    assert.equal(context?.currentDecision, null);
    assert.equal(connection.queries[0]?.text.includes("repeatable read"), true);
    assert.equal(connection.queries.at(-1)?.text, "commit");
  });

  it("locks the result and appends decision plus PII-free audit atomically", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("for update of result")) {
        return rows([{ row_number: 2 }]);
      }
      if (text.includes("from public.user_import_match_analyses")) {
        return rows([contextRow()]);
      }
      if (text.includes("insert into public.user_import_row_decisions")) {
        return rows([decisionRow(1)]);
      }
      return affected();
    });
    const repository = new PostgresAdminUserImportDecisionRepository(
      new FakePool(connection)
    );

    const result = await repository.append(input());

    assert.equal(result.status, "created");
    if (result.status === "created") {
      assert.equal(result.value.version, 1);
      assert.equal(result.value.targetUserId, userId);
    }
    const lock = connection.queries.find((query) =>
      query.text.includes("for update of result")
    );
    assert.ok(lock);
    const insert = connection.queries.find((query) =>
      query.text.includes("insert into public.user_import_row_decisions")
    );
    assert.equal(insert?.values[4], 1);
    assert.equal(insert?.values[7], null);
    const audit = connection.queries.find((query) =>
      query.text.includes("insert into public.audit_log")
    );
    assert.equal(String(audit?.values[6]).includes("MERGE_SAFE_FIELDS"), true);
    assert.equal(String(audit?.values[6]).includes("+79999999999"), false);
    assert.equal(connection.queries.at(-1)?.text, "commit");
  });

  it("returns a version conflict without decision or audit writes", async () => {
    const connection = new FakeConnection((text) =>
      text.includes("for update of result")
        ? rows([{ row_number: 2 }])
        : text.includes("from public.user_import_match_analyses")
          ? rows([contextRow({
            decision_id: previousDecisionId,
            decision_version: 1,
            decision_action: "IGNORE_ROW",
            decision_target_user_id: null,
            decision_created_at: occurredAt
          })])
          : affected()
    );
    const repository = new PostgresAdminUserImportDecisionRepository(
      new FakePool(connection)
    );

    const result = await repository.append(input());

    assert.equal(result.status, "version_conflict");
    assert.equal(
      connection.queries.some((query) =>
        query.text.includes("insert into public.user_import_row_decisions")
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

  it("links a revision to the decision it supersedes", async () => {
    const previous = {
      decision_id: previousDecisionId,
      decision_version: 1,
      decision_action: "IGNORE_ROW",
      decision_target_user_id: null,
      decision_created_at: occurredAt
    };
    const connection = new FakeConnection((text) => {
      if (text.includes("for update of result")) {
        return rows([{ row_number: 2 }]);
      }
      if (text.includes("from public.user_import_match_analyses")) {
        return rows([contextRow(previous)]);
      }
      if (text.includes("insert into public.user_import_row_decisions")) {
        return rows([decisionRow(2)]);
      }
      return affected();
    });
    const repository = new PostgresAdminUserImportDecisionRepository(
      new FakePool(connection)
    );

    const result = await repository.append({
      ...input(),
      expectedDecisionVersion: 1,
      context: {
        ...input().context,
        currentDecision: {
          id: previousDecisionId,
          analysisId,
          rowNumber: 2,
          version: 1,
          action: "IGNORE_ROW",
          targetUserId: null,
          decidedAt: occurredAt.toISOString()
        }
      }
    });

    assert.equal(result.status, "created");
    const insert = connection.queries.find((query) =>
      query.text.includes("insert into public.user_import_row_decisions")
    );
    assert.equal(insert?.values[4], 2);
    assert.equal(insert?.values[7], previousDecisionId);
  });
});

class FakePool implements SqlConnectionPool {
  constructor(private readonly connection: SqlConnection) {}
  async connect(): Promise<SqlConnection> {
    return this.connection;
  }
}

class FakeConnection implements SqlConnection {
  readonly queries: { text: string; values: readonly unknown[] }[] = [];
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

function input() {
  return {
    decisionId,
    context: {
      analysisId,
      batchId,
      rowNumber: 2,
      matchStatus: "POSSIBLE_MATCH" as const,
      candidateUserIds: [userId],
      matchKinds: ["telegram_username" as const],
      currentDecision: null
    },
    action: "MERGE_SAFE_FIELDS" as const,
    targetUserId: userId,
    expectedDecisionVersion: 0,
    audit: {
      auditId,
      actorAdminId: adminId,
      actorRole: "technical_admin",
      reason: "Решение по строке",
      requestId: "request-123",
      ipAddress: "127.0.0.1",
      userAgent: "test",
      occurredAt
    }
  };
}

function contextRow(
  decision: Partial<{
    readonly decision_id: string | null;
    readonly decision_version: number | null;
    readonly decision_action: string | null;
    readonly decision_target_user_id: string | null;
    readonly decision_created_at: Date | null;
  }> = {}
) {
  return { ...contextRowBase(), ...decision };
}

function contextRowBase() {
  return {
    analysis_id: analysisId,
    batch_id: batchId,
    row_number: 2,
    match_status: "POSSIBLE_MATCH",
    candidate_user_ids: [userId],
    match_kinds: ["telegram_username"],
    decision_id: null,
    decision_version: null,
    decision_action: null,
    decision_target_user_id: null,
    decision_created_at: null
  };
}

function decisionRow(version: number) {
  return {
    id: decisionId,
    analysis_id: analysisId,
    row_number: 2,
    decision_version: version,
    action: "MERGE_SAFE_FIELDS",
    target_user_id: userId,
    created_at: occurredAt
  };
}

function rows<TRow>(value: readonly TRow[]): SqlQueryResult<TRow> {
  return { rows: value, rowCount: value.length };
}

function affected(): SqlQueryResult<never> {
  return { rows: [], rowCount: 1 };
}

const occurredAt = new Date("2026-07-31T16:00:00.000Z");
const adminId = "00000000-0000-4000-8000-000000000101";
const userId = "00000000-0000-4000-8000-000000000201";
const batchId = "00000000-0000-4000-8000-000000000902";
const analysisId = "00000000-0000-4000-8000-000000000903";
const auditId = "00000000-0000-4000-8000-000000000904";
const previousDecisionId = "00000000-0000-4000-8000-000000000905";
const decisionId = "00000000-0000-4000-8000-000000000906";
