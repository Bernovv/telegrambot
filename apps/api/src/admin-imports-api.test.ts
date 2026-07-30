import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AdminUserImportDecisionVersionConflictError
} from "@ticket-platform/application";
import type { AdminPermission } from "@ticket-platform/contracts";
import type { FastifyInstance } from "fastify";
import { createApiApplication } from "./app.js";

describe("administrator user imports HTTP contract", () => {
  it("requires imports.execute and rejects malformed preview payloads", async () => {
    const permissions: AdminPermission[] = [];
    let received: unknown;
    let analyzed: unknown;
    let decided: unknown;
    let listed: unknown;
    const app = await createApiApplication({
      appVersion: "test",
      bodyLimitBytes: 750_000,
      readiness,
      adminAuth: {
        tokenVerifier: {
          async verify() {
            return {
              subject: "auth-1",
              assuranceLevel: "aal1",
              issuedAt: new Date("2026-07-31T06:00:00.000Z")
            };
          }
        },
        authorizer: {
          async execute(_token, permission) {
            permissions.push(permission);
            return {
              adminId,
              authSubject: "auth-1",
              roleCodes: ["technical_admin"],
              permission
            };
          }
        }
      },
      adminImports: {
        previewUsers: {
          async execute(input) {
            received = input.request;
            return response;
          }
        },
        analyzeUsers: {
          async execute(input) {
            analyzed = {
              batchId: input.batchId,
              request: input.request
            };
            return analysisResponse;
          }
        },
        decideUserRow: {
          async execute(input) {
            if (input.request.expectedDecisionVersion === 99) {
              throw new AdminUserImportDecisionVersionConflictError();
            }
            decided = {
              analysisId: input.analysisId,
              rowNumber: input.rowNumber,
              request: input.request
            };
            return decisionResponse;
          }
        },
        listUserRows: {
          async execute(input) {
            listed = {
              analysisId: input.analysisId,
              afterRowNumber: input.afterRowNumber,
              limit: input.limit
            };
            return {
              rows: analysisResponse.analysis.previewRows,
              nextAfterRowNumber: null
            };
          }
        }
      }
    });
    await app.init();
    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const payload = {
        fileName: "users.csv",
        contentBase64: Buffer.from(
          "telegram_id,first_name\n123456789,Иван",
          "utf8"
        ).toString("base64"),
        reason: "Проверка клиентской базы"
      };
      const valid = await fastify.inject({
        method: "POST",
        url: "/api/v1/imports/users/preview",
        headers: { authorization: "Bearer valid" },
        payload
      });
      const unknown = await fastify.inject({
        method: "POST",
        url: "/api/v1/imports/users/preview",
        headers: { authorization: "Bearer valid" },
        payload: { ...payload, execute: true }
      });
      const malformed = await fastify.inject({
        method: "POST",
        url: "/api/v1/imports/users/preview",
        headers: { authorization: "Bearer valid" },
        payload: { ...payload, contentBase64: "not-base64" }
      });
      const analysis = await fastify.inject({
        method: "POST",
        url: `/api/v1/imports/users/${batchId}/analyze`,
        headers: { authorization: "Bearer valid" },
        payload: { reason: "Проверка совпадений" }
      });
      const invalidAnalysis = await fastify.inject({
        method: "POST",
        url: `/api/v1/imports/users/${batchId}/analyze`,
        headers: { authorization: "Bearer valid" },
        payload: { reason: "Проверка совпадений", merge: true }
      });
      const decisionPayload = {
        action: "MERGE_SAFE_FIELDS",
        targetUserId: candidateUserId,
        expectedDecisionVersion: 0,
        reason: "Подтверждение кандидата"
      };
      const decision = await fastify.inject({
        method: "POST",
        url: `/api/v1/imports/users/analyses/${analysisId}/rows/2/decision`,
        headers: { authorization: "Bearer valid" },
        payload: decisionPayload
      });
      const malformedDecision = await fastify.inject({
        method: "POST",
        url: `/api/v1/imports/users/analyses/${analysisId}/rows/2/decision`,
        headers: { authorization: "Bearer valid" },
        payload: { ...decisionPayload, mergeAll: true }
      });
      const staleDecision = await fastify.inject({
        method: "POST",
        url: `/api/v1/imports/users/analyses/${analysisId}/rows/2/decision`,
        headers: { authorization: "Bearer valid" },
        payload: { ...decisionPayload, expectedDecisionVersion: 99 }
      });
      const rowPage = await fastify.inject({
        method: "GET",
        url: `/api/v1/imports/users/analyses/${analysisId}/rows`
          + "?afterRowNumber=201&limit=100",
        headers: { authorization: "Bearer valid" }
      });

      assert.equal(valid.statusCode, 201);
      assert.equal(valid.json().batch.status, "preview_ready");
      assert.equal(unknown.statusCode, 400);
      assert.equal(malformed.statusCode, 400);
      assert.equal(analysis.statusCode, 201);
      assert.equal(
        analysis.json().analysis.previewRows[0].status,
        "POSSIBLE_MATCH"
      );
      assert.equal(invalidAnalysis.statusCode, 400);
      assert.equal(decision.statusCode, 201);
      assert.equal(decision.json().decision.version, 1);
      assert.equal(malformedDecision.statusCode, 400);
      assert.equal(staleDecision.statusCode, 409);
      assert.equal(rowPage.statusCode, 200);
      assert.equal(rowPage.json().rows[0].rowNumber, 2);
      assert.deepEqual(permissions, [
        "imports.execute",
        "imports.execute",
        "imports.execute",
        "imports.execute",
        "imports.execute",
        "imports.execute",
        "imports.execute",
        "imports.execute",
        "imports.execute"
      ]);
      assert.deepEqual(received, payload);
      assert.deepEqual(analyzed, {
        batchId,
        request: { reason: "Проверка совпадений" }
      });
      assert.deepEqual(decided, {
        analysisId,
        rowNumber: 2,
        request: decisionPayload
      });
      assert.deepEqual(listed, {
        analysisId,
        afterRowNumber: 201,
        limit: 100
      });
    } finally {
      await app.close();
    }
  });
});

const readiness = {
  async execute() {
    return {
      service: "api",
      status: "healthy" as const,
      version: "test",
      checkedAt: "2026-07-31T06:00:00.000Z",
      components: []
    };
  }
};

const adminId = "00000000-0000-4000-8000-000000000101";
const batchId = "00000000-0000-4000-8000-000000000902";
const analysisId = "00000000-0000-4000-8000-000000000903";
const candidateUserId = "00000000-0000-4000-8000-000000000201";
const response = {
  reusedExisting: false,
  batch: {
    id: batchId,
    fileName: "users.csv",
    fileChecksum: "a".repeat(64),
    byteSize: 50,
    delimiter: "," as const,
    status: "preview_ready" as const,
    totalRowCount: 1,
    newRowCount: 1,
    invalidRowCount: 0,
    ignoredRowCount: 0,
    previewRows: [{
      rowNumber: 2,
      status: "NEW" as const,
      normalized: {
        telegramUserId: "123456789",
        telegramUsername: null,
        phone: null,
        externalCrmId: null,
        firstName: "Иван",
        lastName: null
      },
      issueCodes: []
    }],
    createdAt: "2026-07-31T06:00:00.000Z"
  }
};

const analysisResponse = {
  reusedExisting: false,
  analysis: {
    id: analysisId,
    batchId,
    status: "completed" as const,
    totalRowCount: 1,
    newRowCount: 0,
    exactMatchNoChangeRowCount: 0,
    mergeNewFieldsRowCount: 0,
    possibleMatchRowCount: 1,
    conflictRowCount: 0,
    invalidRowCount: 0,
    ignoredRowCount: 0,
    previewRows: [{
      rowNumber: 2,
      status: "POSSIBLE_MATCH" as const,
      normalized: response.batch.previewRows[0]?.normalized ?? null,
      matchedUserId: null,
      candidateUserIds: [
        candidateUserId
      ],
      matchKinds: ["telegram_username" as const],
      issueCodes: ["username_requires_confirmation"],
      decision: null
    }],
    observedAt: "2026-07-31T06:00:00.000Z",
    createdAt: "2026-07-31T06:00:00.000Z"
  }
};

const decisionResponse = {
  decision: {
    id: "00000000-0000-4000-8000-000000000904",
    analysisId,
    rowNumber: 2,
    version: 1,
    action: "MERGE_SAFE_FIELDS" as const,
    targetUserId: candidateUserId,
    decidedAt: "2026-07-31T06:05:00.000Z"
  }
};
