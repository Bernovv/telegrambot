import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  AdminUserImportDecisionAction,
  AdminUserImportRowDecision
} from "@ticket-platform/contracts";
import {
  AdminUserImportDecisionVersionConflictError,
  DecideAdminUserImportRowService,
  InvalidAdminUserImportDecisionError,
  type AdminUserImportDecisionContext,
  type AdminUserImportDecisionRepository
} from "./admin-user-import-decisions.js";

describe("DecideAdminUserImportRowService", () => {
  it("allows a new user only for a username-only provisional match", async () => {
    const fixture = createFixture(possibleUsername);

    const result = await fixture.service.execute(command({
      action: "CREATE_NEW_USER",
      targetUserId: null,
      expectedDecisionVersion: 0
    }));

    assert.equal(result.decision.action, "CREATE_NEW_USER");
    assert.equal(fixture.appended?.expectedDecisionVersion, 0);
    assert.equal(fixture.appended?.audit.reason, "Проверка строки импорта");
  });

  it("rejects a new user when the provisional phone is already imported", async () => {
    const fixture = createFixture({
      ...possibleUsername,
      matchKinds: ["imported_phone"]
    });

    await assert.rejects(
      fixture.service.execute(command({
        action: "CREATE_NEW_USER",
        targetUserId: null,
        expectedDecisionVersion: 0
      })),
      (error: unknown) =>
        error instanceof InvalidAdminUserImportDecisionError
        && error.code === "create_new_not_safe"
    );
  });

  it("allows safe fields to merge only into an observed candidate", async () => {
    const fixture = createFixture(conflict);

    const result = await fixture.service.execute(command({
      action: "MERGE_SAFE_FIELDS",
      targetUserId: userOneId,
      expectedDecisionVersion: 0
    }));

    assert.equal(result.decision.targetUserId, userOneId);
    await assert.rejects(
      createFixture(conflict).service.execute(command({
        action: "MERGE_SAFE_FIELDS",
        targetUserId: unknownUserId,
        expectedDecisionVersion: 0
      })),
      (error: unknown) =>
        error instanceof InvalidAdminUserImportDecisionError
        && error.code === "target_must_be_candidate"
    );
  });

  it("allows an ambiguous row to be ignored", async () => {
    const fixture = createFixture(conflict);

    const result = await fixture.service.execute(command({
      action: "IGNORE_ROW",
      targetUserId: null,
      expectedDecisionVersion: 0
    }));

    assert.equal(result.decision.action, "IGNORE_ROW");
  });

  it("rejects stale decision versions before appending audit", async () => {
    const fixture = createFixture({
      ...possibleUsername,
      currentDecision: decision
    });

    await assert.rejects(
      fixture.service.execute(command({
        action: "IGNORE_ROW",
        targetUserId: null,
        expectedDecisionVersion: 0
      })),
      AdminUserImportDecisionVersionConflictError
    );
    assert.equal(fixture.appended, null);
  });

  it("maps a concurrent append conflict", async () => {
    const fixture = createFixture(possibleUsername, "version_conflict");

    await assert.rejects(
      fixture.service.execute(command({
        action: "IGNORE_ROW",
        targetUserId: null,
        expectedDecisionVersion: 0
      })),
      AdminUserImportDecisionVersionConflictError
    );
  });
});

function createFixture(
  context: AdminUserImportDecisionContext,
  appendStatus: "created" | "version_conflict" = "created"
) {
  const ids = [auditId, decisionId];
  const state: {
    appended: Parameters<AdminUserImportDecisionRepository["append"]>[0] | null;
  } = { appended: null };
  const repository: AdminUserImportDecisionRepository = {
    async getContext() {
      return context;
    },
    async append(input) {
      state.appended = input;
      if (appendStatus === "version_conflict") {
        return { status: "version_conflict" };
      }
      return {
        status: "created",
        value: {
          id: input.decisionId,
          analysisId: input.context.analysisId,
          rowNumber: input.context.rowNumber,
          version: input.expectedDecisionVersion + 1,
          action: input.action,
          targetUserId: input.targetUserId,
          decidedAt: input.audit.occurredAt.toISOString()
        }
      };
    }
  };
  return {
    service: new DecideAdminUserImportRowService(
      repository,
      { newId: () => ids.shift() ?? decisionId }
    ),
    get appended() {
      return state.appended;
    }
  };
}

function command(input: {
  readonly action: AdminUserImportDecisionAction;
  readonly targetUserId: string | null;
  readonly expectedDecisionVersion: number;
}) {
  return {
    actor: {
      adminId,
      authSubject: "auth-1",
      roleCodes: ["technical_admin"],
      permission: "imports.execute" as const
    },
    analysisId,
    rowNumber: 2,
    request: {
      ...input,
      reason: "Проверка строки импорта"
    },
    metadata: {
      requestId: "request-123",
      ipAddress: "127.0.0.1",
      userAgent: "test",
      occurredAt
    }
  };
}

const occurredAt = new Date("2026-07-31T15:00:00.000Z");
const adminId = "00000000-0000-4000-8000-000000000101";
const userOneId = "00000000-0000-4000-8000-000000000201";
const userTwoId = "00000000-0000-4000-8000-000000000202";
const unknownUserId = "00000000-0000-4000-8000-000000000299";
const batchId = "00000000-0000-4000-8000-000000000902";
const analysisId = "00000000-0000-4000-8000-000000000903";
const auditId = "00000000-0000-4000-8000-000000000904";
const decisionId = "00000000-0000-4000-8000-000000000906";
const possibleUsername: AdminUserImportDecisionContext = {
  analysisId,
  batchId,
  rowNumber: 2,
  matchStatus: "POSSIBLE_MATCH",
  candidateUserIds: [userOneId],
  matchKinds: ["telegram_username"],
  currentDecision: null
};
const conflict: AdminUserImportDecisionContext = {
  ...possibleUsername,
  matchStatus: "CONFLICT",
  candidateUserIds: [userOneId, userTwoId],
  matchKinds: ["telegram_id", "verified_phone"]
};
const decision: AdminUserImportRowDecision = {
  id: "00000000-0000-4000-8000-000000000905",
  analysisId,
  rowNumber: 2,
  version: 1,
  action: "IGNORE_ROW",
  targetUserId: null,
  decidedAt: "2026-07-31T15:00:00.000Z"
};
