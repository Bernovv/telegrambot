import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  AdminUserImportMatchAnalysis,
  AdminUserImportNormalizedRow
} from "@ticket-platform/contracts";
import {
  AdminUserImportBatchNotFoundError,
  AnalyzeAdminUserImportService,
  classifyAdminUserImportRows,
  type AdminUserImportIdentityCandidate,
  type AdminUserImportMatchingRepository
} from "./admin-user-import-matching.js";

describe("user import identity matching", () => {
  it("separates exact unchanged, additive, and provisional matches", () => {
    const results = classifyAdminUserImportRows({
      rows: [
        sourceRow(2, normalized),
        sourceRow(3, { ...normalized, externalCrmId: "crm-2" }),
        sourceRow(4, {
          ...normalized,
          telegramUserId: null,
          phone: null,
          externalCrmId: null
        }),
        sourceRow(5, {
          ...normalized,
          telegramUserId: null,
          telegramUsername: null,
          externalCrmId: null
        })
      ],
      candidates: [
        candidate(2, "telegram_id", userOne),
        candidate(2, "verified_phone", userOne),
        candidate(3, "telegram_id", userOne),
        candidate(4, "telegram_username", userOne),
        candidate(5, "imported_phone", userOne)
      ]
    });

    assert.equal(results[0]?.status, "EXACT_MATCH_NO_CHANGE");
    assert.equal(results[0]?.matchedUserId, userOne.userId);
    assert.equal(results[1]?.status, "MERGE_NEW_FIELDS");
    assert.equal(results[2]?.status, "POSSIBLE_MATCH");
    assert.deepEqual(results[2]?.issueCodes, [
      "username_requires_confirmation"
    ]);
    assert.equal(results[3]?.status, "POSSIBLE_MATCH");
    assert.deepEqual(results[3]?.issueCodes, [
      "imported_phone_requires_confirmation"
    ]);
  });

  it("never resolves identifiers that point at different users", () => {
    const results = classifyAdminUserImportRows({
      rows: [
        sourceRow(2, normalized),
        sourceRow(3, normalized)
      ],
      candidates: [
        candidate(2, "telegram_id", userOne),
        candidate(2, "verified_phone", userTwo),
        candidate(3, "telegram_id", userOne),
        candidate(3, "telegram_username", userTwo)
      ]
    });

    assert.deepEqual(
      results.map((result) => result.status),
      ["CONFLICT", "CONFLICT"]
    );
    assert.deepEqual(results[0]?.issueCodes, ["identity_conflict"]);
    assert.deepEqual(results[1]?.issueCodes, [
      "provisional_identity_conflict"
    ]);
    assert.equal(results.every((result) => !result.matchedUserId), true);
  });

  it("protects an existing trusted phone and preserves existing names", () => {
    const results = classifyAdminUserImportRows({
      rows: [
        sourceRow(2, {
          ...normalized,
          phone: "+78888888888",
          firstName: "Другой"
        }),
        sourceRow(3, {
          ...normalized,
          firstName: "Другой",
          telegramUsername: "old_username"
        })
      ],
      candidates: [
        candidate(2, "telegram_id", userOne),
        candidate(3, "telegram_id", userOne)
      ]
    });

    assert.equal(results[0]?.status, "CONFLICT");
    assert.deepEqual(results[0]?.issueCodes, [
      "verified_phone_conflict",
      "existing_first_name_preserved"
    ]);
    assert.equal(results[1]?.status, "EXACT_MATCH_NO_CHANGE");
    assert.deepEqual(results[1]?.issueCodes, [
      "existing_username_preserved",
      "existing_first_name_preserved"
    ]);
  });

  it("keeps invalid and duplicate staging decisions unchanged", () => {
    const results = classifyAdminUserImportRows({
      rows: [
        {
          rowNumber: 2,
          stagingStatus: "INVALID",
          normalized: null,
          issueCodes: ["invalid_phone"]
        },
        {
          rowNumber: 3,
          stagingStatus: "IGNORED",
          normalized,
          issueCodes: ["duplicate_in_file"]
        }
      ],
      candidates: []
    });

    assert.deepEqual(
      results.map((result) => result.status),
      ["INVALID", "IGNORED"]
    );
    assert.deepEqual(results[0]?.issueCodes, ["invalid_phone"]);
    assert.deepEqual(results[1]?.issueCodes, ["duplicate_in_file"]);
  });
});

describe("AnalyzeAdminUserImportService", () => {
  it("reuses the immutable analysis and does not load identities twice", async () => {
    let contextLoads = 0;
    const repository: AdminUserImportMatchingRepository = {
      async findByBatchId() {
        return analysis;
      },
      async loadContext() {
        contextLoads += 1;
        return { rows: [], candidates: [] };
      },
      async create() {
        throw new Error("must not create");
      }
    };
    const service = new AnalyzeAdminUserImportService(
      repository,
      { newId: () => analysisId }
    );

    const result = await service.execute(command());

    assert.equal(result.reusedExisting, true);
    assert.equal(result.analysis.id, analysisId);
    assert.equal(contextLoads, 0);
  });

  it("rejects an unknown staging batch before writing audit", async () => {
    const repository: AdminUserImportMatchingRepository = {
      async findByBatchId() {
        return null;
      },
      async loadContext() {
        return null;
      },
      async create() {
        throw new Error("must not create");
      }
    };
    const service = new AnalyzeAdminUserImportService(
      repository,
      { newId: () => analysisId }
    );

    await assert.rejects(
      service.execute(command()),
      AdminUserImportBatchNotFoundError
    );
  });
});

function sourceRow(
  rowNumber: number,
  value: AdminUserImportNormalizedRow
) {
  return {
    rowNumber,
    stagingStatus: "NEW" as const,
    normalized: value,
    issueCodes: []
  };
}

function candidate(
  rowNumber: number,
  matchKind: AdminUserImportIdentityCandidate["matchKind"],
  profile: AdminUserImportIdentityCandidate["profile"]
): AdminUserImportIdentityCandidate {
  return { rowNumber, matchKind, profile };
}

function command() {
  return {
    actor: {
      adminId,
      authSubject: "auth-1",
      roleCodes: ["technical_admin"],
      permission: "imports.execute" as const
    },
    batchId,
    request: { reason: "Проверка совпадений" },
    metadata: {
      requestId: "request-123",
      ipAddress: "127.0.0.1",
      userAgent: "test",
      occurredAt
    }
  };
}

const normalized: AdminUserImportNormalizedRow = {
  telegramUserId: "123456789",
  telegramUsername: "user_one",
  phone: "+79999999999",
  externalCrmId: "crm-1",
  firstName: "Иван",
  lastName: "Иванов"
};
const userOne = {
  userId: "00000000-0000-4000-8000-000000000201",
  firstName: "Иван",
  lastName: "Иванов",
  telegramUserIds: ["123456789"],
  telegramUsernames: ["user_one"],
  protectedPhones: ["+79999999999"],
  externalCrmIds: ["crm-1"]
};
const userTwo = {
  ...userOne,
  userId: "00000000-0000-4000-8000-000000000202",
  telegramUserIds: ["987654321"],
  telegramUsernames: ["user_two"],
  protectedPhones: ["+78888888888"],
  externalCrmIds: ["crm-2"]
};
const occurredAt = new Date("2026-07-31T12:00:00.000Z");
const adminId = "00000000-0000-4000-8000-000000000101";
const batchId = "00000000-0000-4000-8000-000000000902";
const analysisId = "00000000-0000-4000-8000-000000000903";
const analysis: AdminUserImportMatchAnalysis = {
  id: analysisId,
  batchId,
  status: "completed",
  totalRowCount: 1,
  newRowCount: 1,
  exactMatchNoChangeRowCount: 0,
  mergeNewFieldsRowCount: 0,
  possibleMatchRowCount: 0,
  conflictRowCount: 0,
  invalidRowCount: 0,
  ignoredRowCount: 0,
  previewRows: [],
  observedAt: occurredAt.toISOString(),
  createdAt: occurredAt.toISOString()
};
