import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  SqlConnection,
  SqlConnectionPool,
  SqlQueryResult
} from "./postgres.js";
import {
  PostgresAdminUserImportPreviewRepository
} from "./admin-user-import-persistence.js";

describe("PostgresAdminUserImportPreviewRepository", () => {
  it("creates append-only staging rows and a PII-free audit atomically", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("insert into public.user_import_batches")) {
        return rows([{ id: batchId }]);
      }
      if (
        text.includes("from public.user_import_batches")
        && text.includes("where id = $1")
      ) {
        return rows([batchRow()]);
      }
      if (text.includes("from public.user_import_rows")) {
        return rows([importRow()]);
      }
      return affected();
    });
    const repository = new PostgresAdminUserImportPreviewRepository(
      new FakePool(connection)
    );

    const result = await repository.create(createInput());

    assert.equal(result.status, "created");
    assert.equal(result.value.previewRows[0]?.normalized?.phone, "+79999999999");
    const staging = connection.queries.find((query) =>
      query.text.includes("insert into public.user_import_rows")
    );
    assert.deepEqual(JSON.parse(String(staging?.values[1])), [{
      row_number: 2,
      normalized_content_hash: "b".repeat(64),
      status: "NEW",
      normalized_data: normalized,
      issue_codes: []
    }]);
    const audit = connection.queries.find((query) =>
      query.text.includes("insert into public.audit_log")
    );
    const auditAfter = String(audit?.values[5]);
    assert.equal(auditAfter.includes("+79999999999"), false);
    assert.equal(auditAfter.includes("Анатолий"), false);
    assert.equal(connection.queries.at(-1)?.text, "commit");
  });

  it("returns a checksum winner without inserting rows or audit", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("insert into public.user_import_batches")) {
        return rows([]);
      }
      if (
        text.includes("from public.user_import_batches")
        && text.includes("where file_checksum = $1")
      ) {
        return rows([batchRow()]);
      }
      if (text.includes("from public.user_import_rows")) {
        return rows([importRow()]);
      }
      return affected();
    });
    const repository = new PostgresAdminUserImportPreviewRepository(
      new FakePool(connection)
    );

    const result = await repository.create(createInput());

    assert.equal(result.status, "existing");
    assert.equal(
      connection.queries.some((query) =>
        query.text.includes("insert into public.user_import_rows")
      ),
      false
    );
    assert.equal(
      connection.queries.some((query) =>
        query.text.includes("insert into public.audit_log")
      ),
      false
    );
    assert.equal(connection.queries.at(-1)?.text, "commit");
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
    batchId,
    fileName: "users.csv",
    fileChecksum: "a".repeat(64),
    byteSize: 120,
    delimiter: ";" as const,
    rows: [{
      rowNumber: 2,
      normalizedContentHash: "b".repeat(64),
      status: "NEW" as const,
      normalized,
      issueCodes: []
    }],
    audit: {
      auditId,
      actorAdminId: adminId,
      actorRole: "technical_admin",
      reason: "Проверка импорта",
      requestId: "request-123",
      ipAddress: "127.0.0.1",
      userAgent: "test",
      occurredAt
    }
  };
}

function batchRow() {
  return {
    id: batchId,
    file_name: "users.csv",
    file_checksum: "a".repeat(64),
    byte_size: 120,
    delimiter: ";",
    status: "preview_ready",
    total_row_count: 1,
    new_row_count: 1,
    invalid_row_count: 0,
    ignored_row_count: 0,
    created_at: occurredAt
  };
}

function importRow() {
  return {
    row_number: 2,
    status: "NEW",
    normalized_data: normalized,
    issue_codes: []
  };
}

function rows<TRow>(value: readonly TRow[]): SqlQueryResult<TRow> {
  return { rows: value, rowCount: value.length };
}

function affected(): SqlQueryResult<never> {
  return { rows: [], rowCount: 1 };
}

const normalized = {
  telegramUserId: null,
  telegramUsername: "user_one",
  phone: "+79999999999",
  externalCrmId: null,
  firstName: "Анатолий",
  lastName: "Иванов"
};
const occurredAt = new Date("2026-07-31T06:00:00.000Z");
const adminId = "00000000-0000-4000-8000-000000000101";
const auditId = "00000000-0000-4000-8000-000000000901";
const batchId = "00000000-0000-4000-8000-000000000902";
