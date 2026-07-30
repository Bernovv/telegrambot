import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  SqlConnection,
  SqlConnectionPool,
  SqlQueryResult
} from "./postgres.js";
import {
  PostgresAdminUserImportMatchingRepository
} from "./admin-user-import-matching-persistence.js";

describe("PostgresAdminUserImportMatchingRepository", () => {
  it("loads staging and identity candidates in one repeatable-read snapshot", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.user_import_batches")) {
        return rows([{ id: batchId }]);
      }
      if (text.includes("with import_rows as")) {
        return rows([candidateRow()]);
      }
      if (
        text.includes("from public.user_import_rows")
        && !text.includes("join public.user_import_rows")
      ) {
        return rows([sourceRow()]);
      }
      return affected();
    });
    const repository = new PostgresAdminUserImportMatchingRepository(
      new FakePool(connection)
    );

    const context = await repository.loadContext(batchId);

    assert.equal(context?.rows[0]?.normalized?.phone, "+79999999999");
    assert.equal(
      context?.candidates[0]?.matchKind,
      "verified_phone"
    );
    assert.deepEqual(
      context?.candidates[0]?.profile.protectedPhones,
      ["+79999999999"]
    );
    const lookup = connection.queries.find((query) =>
      query.text.includes("with import_rows as")
    );
    assert.match(
      lookup?.text ?? "",
      /contact\.verification_status = 'verified'/
    );
    assert.match(
      lookup?.text ?? "",
      /contact\.verification_status = 'imported'/
    );
    assert.match(
      lookup?.text ?? "",
      /external_identity\.source_system = 'crm'/
    );
    assert.equal(connection.queries.at(-1)?.text, "commit");
  });

  it("writes immutable results and a PII-free audit atomically", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("insert into public.user_import_match_analyses")) {
        return rows([{ id: analysisId }]);
      }
      if (
        text.includes("from public.user_import_match_analyses")
        && text.includes("where id = $1")
      ) {
        return rows([analysisRow()]);
      }
      if (text.includes("from public.user_import_match_results")) {
        return rows([matchResultRow()]);
      }
      return affected();
    });
    const repository = new PostgresAdminUserImportMatchingRepository(
      new FakePool(connection)
    );

    const result = await repository.create(createInput());

    assert.equal(result.status, "created");
    assert.equal(result.value.previewRows[0]?.status, "MERGE_NEW_FIELDS");
    const stored = connection.queries.find((query) =>
      query.text.includes("insert into public.user_import_match_results")
    );
    assert.deepEqual(JSON.parse(String(stored?.values[2])), [{
      row_number: 2,
      status: "MERGE_NEW_FIELDS",
      matched_user_id: userId,
      candidate_user_ids: [userId],
      match_kinds: ["telegram_id"],
      issue_codes: []
    }]);
    const audit = connection.queries.find((query) =>
      query.text.includes("insert into public.audit_log")
    );
    const auditAfter = String(audit?.values[5]);
    assert.equal(auditAfter.includes("+79999999999"), false);
    assert.equal(auditAfter.includes("Иван"), false);
    assert.equal(connection.queries.at(-1)?.text, "commit");
  });

  it("returns the existing analysis after a concurrent batch winner", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("insert into public.user_import_match_analyses")) {
        return rows([]);
      }
      if (
        text.includes("from public.user_import_match_analyses")
        && text.includes("where batch_id = $1")
      ) {
        return rows([analysisRow()]);
      }
      if (text.includes("from public.user_import_match_results")) {
        return rows([matchResultRow()]);
      }
      return affected();
    });
    const repository = new PostgresAdminUserImportMatchingRepository(
      new FakePool(connection)
    );

    const result = await repository.create(createInput());

    assert.equal(result.status, "existing");
    assert.equal(
      connection.queries.some((query) =>
        query.text.includes("insert into public.user_import_match_results")
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

  it("projects the latest append-only administrator decision", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.user_import_match_analyses")) {
        return rows([analysisRow()]);
      }
      if (text.includes("from public.user_import_match_results")) {
        return rows([matchResultRow({
          decision_id: decisionId,
          decision_version: 2,
          decision_action: "MERGE_SAFE_FIELDS",
          decision_target_user_id: userId,
          decision_created_at: occurredAt
        })]);
      }
      return affected();
    });
    const repository = new PostgresAdminUserImportMatchingRepository(
      new FakePool(connection)
    );

    const result = await repository.findByBatchId(batchId);

    assert.equal(result?.previewRows[0]?.decision?.version, 2);
    assert.equal(
      result?.previewRows[0]?.decision?.targetUserId,
      userId
    );
  });

  it("paginates immutable analysis rows without skipping the cursor", async () => {
    const connection = new FakeConnection((text, values) => {
      if (
        text.includes("from public.user_import_match_analyses")
        && !text.includes("from public.user_import_match_results")
      ) {
        return rows([{ id: analysisId }]);
      }
      if (text.includes("from public.user_import_match_results")) {
        assert.deepEqual(values, [analysisId, 201, 2]);
        return rows([
          { ...matchResultRow(), row_number: 202 },
          { ...matchResultRow(), row_number: 203 }
        ]);
      }
      return affected();
    });
    const repository = new PostgresAdminUserImportMatchingRepository(
      new FakePool(connection)
    );

    const result = await repository.listRows({
      analysisId,
      afterRowNumber: 201,
      limit: 1
    });

    assert.deepEqual(
      result?.rows.map((row) => row.rowNumber),
      [202]
    );
    assert.equal(result?.nextAfterRowNumber, 202);
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

function createInput() {
  return {
    analysisId,
    batchId,
    observedAt: occurredAt,
    rows: [{
      rowNumber: 2,
      status: "MERGE_NEW_FIELDS" as const,
      matchedUserId: userId,
      candidateUserIds: [userId],
      matchKinds: ["telegram_id" as const],
      issueCodes: []
    }],
    audit: {
      auditId,
      actorAdminId: adminId,
      actorRole: "technical_admin",
      reason: "Сопоставление импорта",
      requestId: "request-123",
      ipAddress: "127.0.0.1",
      userAgent: "test",
      occurredAt
    }
  };
}

function sourceRow() {
  return {
    row_number: 2,
    status: "NEW",
    normalized_data: normalized,
    issue_codes: []
  };
}

function candidateRow() {
  return {
    row_number: 2,
    match_kind: "verified_phone",
    user_id: userId,
    first_name: "Иван",
    last_name: "Иванов",
    telegram_user_ids: ["123456789"],
    telegram_usernames: ["user_one"],
    protected_phones: ["+79999999999"],
    external_crm_ids: ["crm-1"]
  };
}

function analysisRow() {
  return {
    id: analysisId,
    batch_id: batchId,
    status: "completed",
    total_row_count: 1,
    new_row_count: 0,
    exact_no_change_row_count: 0,
    merge_new_fields_row_count: 1,
    possible_match_row_count: 0,
    conflict_row_count: 0,
    invalid_row_count: 0,
    ignored_row_count: 0,
    observed_at: occurredAt,
    created_at: occurredAt
  };
}

function matchResultRow(decision: Partial<{
  readonly decision_id: string | null;
  readonly decision_version: number | null;
  readonly decision_action: string | null;
  readonly decision_target_user_id: string | null;
  readonly decision_created_at: Date | null;
}> = {}) {
  return {
    analysis_id: analysisId,
    row_number: 2,
    status: "MERGE_NEW_FIELDS",
    matched_user_id: userId,
    candidate_user_ids: [userId],
    match_kinds: ["telegram_id"],
    issue_codes: [],
    normalized_data: normalized,
    decision_id: null,
    decision_version: null,
    decision_action: null,
    decision_target_user_id: null,
    decision_created_at: null,
    ...decision
  };
}

function rows<TRow>(value: readonly TRow[]): SqlQueryResult<TRow> {
  return { rows: value, rowCount: value.length };
}

function affected(): SqlQueryResult<never> {
  return { rows: [], rowCount: 1 };
}

const normalized = {
  telegramUserId: "123456789",
  telegramUsername: "user_one",
  phone: "+79999999999",
  externalCrmId: "crm-1",
  firstName: "Иван",
  lastName: "Иванов"
};
const occurredAt = new Date("2026-07-31T12:00:00.000Z");
const adminId = "00000000-0000-4000-8000-000000000101";
const userId = "00000000-0000-4000-8000-000000000201";
const batchId = "00000000-0000-4000-8000-000000000902";
const analysisId = "00000000-0000-4000-8000-000000000903";
const auditId = "00000000-0000-4000-8000-000000000904";
const decisionId = "00000000-0000-4000-8000-000000000905";
