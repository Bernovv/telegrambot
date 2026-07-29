import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminPermission } from "@ticket-platform/contracts";
import type { FastifyInstance } from "fastify";
import { createApiApplication } from "./app.js";

describe("administrator segment preview HTTP contract", () => {
  it("requires users.read and rejects unknown expression fields", async () => {
    const permissions: AdminPermission[] = [];
    let received: unknown;
    const app = await createApiApplication({
      appVersion: "test",
      bodyLimitBytes: 65_536,
      readiness,
      adminAuth: {
        tokenVerifier: {
          async verify() {
            return {
              subject: "auth-1",
              assuranceLevel: "aal1",
              issuedAt: new Date("2026-07-29T08:00:00.000Z")
            };
          }
        },
        authorizer: {
          async execute(_token, permission) {
            permissions.push(permission);
            return {
              adminId,
              authSubject: "auth-1",
              roleCodes: ["analyst"],
              permission
            };
          }
        }
      },
      adminSegments: {
        preview: {
          async execute(input) {
            received = input.request;
            return { totalCount: "4", sampleUsers: [] };
          }
        },
        list: { async execute() { return []; } },
        get: { async execute() { throw new Error("unused"); } },
        create: { async execute() { throw new Error("unused"); } },
        updateDraft: { async execute() { throw new Error("unused"); } },
        publish: { async execute() { throw new Error("unused"); } },
        listSnapshots: { async execute() { return []; } },
        getSnapshot: { async execute() { throw new Error("unused"); } },
        requestSnapshot: { async execute() { throw new Error("unused"); } }
      }
    });
    await app.init();
    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const payload = {
        operator: "and",
        groups: [{
          operator: "or",
          conditions: [{
            kind: "status",
            mode: "any",
            codes: ["paid"]
          }]
        }],
        sampleLimit: 10
      };
      const valid = await fastify.inject({
        method: "POST",
        url: "/api/v1/segments/preview",
        headers: { authorization: "Bearer valid" },
        payload
      });
      const invalid = await fastify.inject({
        method: "POST",
        url: "/api/v1/segments/preview",
        headers: { authorization: "Bearer valid" },
        payload: { ...payload, rawSql: "select 1" }
      });

      assert.equal(valid.statusCode, 201);
      assert.equal(valid.json().totalCount, "4");
      assert.equal(invalid.statusCode, 400);
      assert.deepEqual(permissions, ["users.read", "users.read"]);
      assert.deepEqual(received, payload);
    } finally {
      await app.close();
    }
  });

  it("uses broadcasts.send for saved draft creation", async () => {
    const permissions: AdminPermission[] = [];
    let received: unknown;
    const app = await createApiApplication({
      appVersion: "test",
      bodyLimitBytes: 65_536,
      readiness,
      adminAuth: {
        tokenVerifier: {
          async verify() {
            return {
              subject: "auth-1",
              assuranceLevel: "aal1",
              issuedAt: new Date("2026-07-29T08:00:00.000Z")
            };
          }
        },
        authorizer: {
          async execute(_token, permission) {
            permissions.push(permission);
            return {
              adminId,
              authSubject: "auth-1",
              roleCodes: ["content_manager"],
              permission
            };
          }
        }
      },
      adminSegments: {
        preview: { async execute() { return { totalCount: "0", sampleUsers: [] }; } },
        list: { async execute() { return []; } },
        get: { async execute() { return savedSegment; } },
        create: {
          async execute(input) {
            received = input.request;
            return savedSegment;
          }
        },
        updateDraft: { async execute() { return savedSegment; } },
        publish: { async execute() { return savedSegment; } },
        listSnapshots: { async execute() { return []; } },
        getSnapshot: { async execute() { throw new Error("unused"); } },
        requestSnapshot: { async execute() { throw new Error("unused"); } }
      }
    });
    await app.init();
    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const response = await fastify.inject({
        method: "POST",
        url: "/api/v1/segments",
        headers: {
          authorization: "Bearer valid",
          "x-request-id": "request-123"
        },
        payload: {
          name: "Покупатели",
          expression: {
            operator: "and",
            groups: [{
              operator: "and",
              conditions: [{
                kind: "status",
                mode: "any",
                codes: ["paid"]
              }]
            }]
          },
          reason: "Первый черновик"
        }
      });

      assert.equal(response.statusCode, 201);
      assert.equal(response.json().id, segmentId);
      assert.deepEqual(permissions, ["broadcasts.send"]);
      assert.equal(
        (received as { readonly name: string }).name,
        "Покупатели"
      );
    } finally {
      await app.close();
    }
  });

  it("queues a snapshot only for an exact published version", async () => {
    const permissions: AdminPermission[] = [];
    let received: unknown;
    const app = await createApiApplication({
      appVersion: "test",
      bodyLimitBytes: 65_536,
      readiness,
      adminAuth: {
        tokenVerifier: {
          async verify() {
            return {
              subject: "auth-1",
              assuranceLevel: "aal1",
              issuedAt: new Date("2026-07-29T08:00:00.000Z")
            };
          }
        },
        authorizer: {
          async execute(_token, permission) {
            permissions.push(permission);
            return {
              adminId,
              authSubject: "auth-1",
              roleCodes: ["content_manager"],
              permission
            };
          }
        }
      },
      adminSegments: {
        preview: { async execute() { return { totalCount: "0", sampleUsers: [] }; } },
        list: { async execute() { return []; } },
        get: { async execute() { return savedSegment; } },
        create: { async execute() { return savedSegment; } },
        updateDraft: { async execute() { return savedSegment; } },
        publish: { async execute() { return savedSegment; } },
        listSnapshots: { async execute() { return []; } },
        getSnapshot: { async execute() { throw new Error("unused"); } },
        requestSnapshot: {
          async execute(input) {
            received = input.request;
            return snapshotSummary;
          }
        }
      }
    });
    await app.init();
    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const response = await fastify.inject({
        method: "POST",
        url: `/api/v1/segments/${segmentId}/audience-snapshots`,
        headers: { authorization: "Bearer valid" },
        payload: {
          segmentVersionId: versionId,
          reason: "Фиксация аудитории"
        }
      });

      assert.equal(response.statusCode, 201);
      assert.equal(response.json().status, "pending");
      assert.deepEqual(permissions, ["broadcasts.send"]);
      assert.equal(
        (received as { readonly segmentVersionId: string }).segmentVersionId,
        versionId
      );
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
      checkedAt: "2026-07-29T08:00:00.000Z",
      components: []
    };
  }
};

const adminId = "00000000-0000-4000-8000-000000000101";
const segmentId = "00000000-0000-4000-8000-000000000501";
const versionId = "00000000-0000-4000-8000-000000000502";
const savedSegment = {
  id: segmentId,
  name: "Покупатели",
  description: null,
  lockVersion: 1,
  draft: {
    id: versionId,
    versionNumber: 1,
    status: "draft" as const,
    schemaVersion: 1 as const,
    name: "Покупатели",
    description: null,
    expression: {
      operator: "and" as const,
      groups: [{
        operator: "and" as const,
        conditions: [{
          kind: "status" as const,
          mode: "any" as const,
          codes: ["paid"]
        }]
      }]
    },
    createdAt: "2026-07-29T08:00:00.000Z",
    updatedAt: "2026-07-29T08:00:00.000Z",
    publishedAt: null
  },
  published: null,
  updatedAt: "2026-07-29T08:00:00.000Z"
};
const snapshotSummary = {
  id: "00000000-0000-4000-8000-000000000503",
  segmentId,
  segmentVersionId: versionId,
  segmentVersionNumber: 1,
  status: "pending" as const,
  totalCount: null,
  requestedAt: "2026-07-29T09:00:00.000Z",
  completedAt: null
};
