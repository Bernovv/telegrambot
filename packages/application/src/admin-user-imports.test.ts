import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminUserImportBatch } from "@ticket-platform/contracts";
import {
  InvalidAdminUserImportError,
  PreviewAdminUserImportService,
  type AdminUserImportPreviewRepository,
  type AdminUserImportStagedRow
} from "./admin-user-imports.js";

describe("administrator user import preview", () => {
  it("normalizes a bounded UTF-8 CSV without changing users", async () => {
    let staged: readonly AdminUserImportStagedRow[] = [];
    const service = serviceFor(repository({
      async create(input) {
        staged = input.rows;
        return {
          status: "created",
          value: batchFrom(input.rows, input.delimiter)
        };
      }
    }));

    const result = await service.execute(command(csv([
      "telegram_username;phone;first_name;last_name",
      "@User_One;+79999999999; Анатолий ;Иванов",
      "@User_One;+79999999999; Анатолий ;Иванов",
      "bad name;;=FORMULA;"
    ]), "users.csv"));

    assert.equal(result.reusedExisting, false);
    assert.equal(result.batch.delimiter, ";");
    assert.deepEqual(staged.map((row) => row.status), [
      "NEW",
      "IGNORED",
      "INVALID"
    ]);
    assert.deepEqual(staged[0]?.normalized, {
      telegramUserId: null,
      telegramUsername: "user_one",
      phone: "+79999999999",
      externalCrmId: null,
      firstName: "Анатолий",
      lastName: "Иванов"
    });
    assert.deepEqual(staged[2]?.issueCodes, [
      "invalid_first_name",
      "invalid_telegram_username"
    ]);
  });

  it("returns the existing checksum batch without another write", async () => {
    let writes = 0;
    const existing = batchFrom([], ",");
    const service = serviceFor(repository({
      async findByChecksum() {
        return existing;
      },
      async create() {
        writes += 1;
        return { status: "created", value: existing };
      }
    }));

    const result = await service.execute(command(csv([
      "telegram_id,first_name",
      "123456789,Иван"
    ]), "users.csv"));

    assert.equal(result.reusedExisting, true);
    assert.equal(result.batch.id, batchId);
    assert.equal(writes, 0);
  });

  it("rejects malformed files, unsafe names, and missing identities", async () => {
    const service = serviceFor(repository({}));
    const requests = [
      { fileName: "../users.csv", contentBase64: "AAAA" },
      { fileName: "users.txt", contentBase64: base64("telegram_id\n123") },
      { fileName: "users.csv", contentBase64: base64("first_name\nИван") },
      { fileName: "users.csv", contentBase64: "not-base64" }
    ];

    for (const request of requests) {
      await assert.rejects(
        service.execute({
          ...command("", request.fileName),
          request: {
            ...command("", request.fileName).request,
            contentBase64: request.contentBase64
          }
        }),
        InvalidAdminUserImportError
      );
    }
  });
});

function serviceFor(repository: AdminUserImportPreviewRepository) {
  return new PreviewAdminUserImportService(
    repository,
    {
      normalize(rawPhone) {
        if (rawPhone === "+79999999999") {
          return rawPhone;
        }
        throw new Error("invalid phone");
      }
    },
    ids(auditId, batchId)
  );
}

function repository(
  overrides: Partial<AdminUserImportPreviewRepository>
): AdminUserImportPreviewRepository {
  return {
    async findByChecksum() {
      return null;
    },
    async create(input) {
      return {
        status: "created",
        value: batchFrom(input.rows, input.delimiter)
      };
    },
    ...overrides
  };
}

function command(content: string, fileName: string) {
  return {
    actor,
    request: {
      fileName,
      contentBase64: base64(content),
      reason: "Проверка клиентской базы"
    },
    metadata
  };
}

function batchFrom(
  rows: readonly AdminUserImportStagedRow[],
  delimiter: "," | ";" | "\t"
): AdminUserImportBatch {
  return {
    id: batchId,
    fileName: "users.csv",
    fileChecksum: "a".repeat(64),
    byteSize: 100,
    delimiter,
    status: "preview_ready",
    totalRowCount: rows.length,
    newRowCount: rows.filter((row) => row.status === "NEW").length,
    invalidRowCount: rows.filter((row) => row.status === "INVALID").length,
    ignoredRowCount: rows.filter((row) => row.status === "IGNORED").length,
    previewRows: rows.map((row) => ({
      rowNumber: row.rowNumber,
      status: row.status,
      normalized: row.normalized,
      issueCodes: row.issueCodes
    })),
    createdAt: metadata.occurredAt.toISOString()
  };
}

function csv(lines: readonly string[]): string {
  return lines.join("\n");
}

function base64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function ids(...values: string[]) {
  return { newId: () => values.shift() ?? batchId };
}

const actor = {
  adminId: "00000000-0000-4000-8000-000000000101",
  authSubject: "auth-1",
  roleCodes: ["data_manager"],
  permission: "imports.execute"
} as const;
const metadata = {
  requestId: "request-123",
  ipAddress: "127.0.0.1",
  userAgent: "test",
  occurredAt: new Date("2026-07-31T06:00:00.000Z")
};
const auditId = "00000000-0000-4000-8000-000000000901";
const batchId = "00000000-0000-4000-8000-000000000902";
