import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminPermission } from "@ticket-platform/contracts";
import type { FastifyInstance } from "fastify";
import { createApiApplication } from "./app.js";
import type { AdminUserClassificationHandlers } from "./admin-user-classification-api.js";

describe("administrator user classification HTTP contract", () => {
  it("uses separated read/write permissions and validates strict mutations", async () => {
    const permissions: AdminPermission[] = [];
    const calls: unknown[] = [];
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
              issuedAt: new Date("2026-07-28T19:00:00.000Z")
            };
          }
        },
        authorizer: {
          async execute(_token, permission) {
            permissions.push(permission);
            return {
              adminId,
              authSubject: "auth-1",
              roleCodes: ["sales_manager"],
              permission
            };
          }
        }
      },
      adminUserClassification: handlers(calls)
    });
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const listed = await fastify.inject({
        method: "GET",
        url: "/api/v1/classification",
        headers: { authorization: "Bearer valid-token" }
      });
      const created = await fastify.inject({
        method: "POST",
        url: "/api/v1/classification/categories",
        headers: {
          authorization: "Bearer valid-token",
          "x-request-id": "classification-request-1"
        },
        payload: {
          code: "vip",
          displayName: "VIP",
          color: "#CA8A04",
          description: null,
          reason: "Рабочая категория"
        }
      });
      const rejected = await fastify.inject({
        method: "POST",
        url: "/api/v1/classification/categories",
        headers: { authorization: "Bearer valid-token" },
        payload: {
          code: "vip",
          displayName: "VIP",
          color: "#CA8A04",
          description: null,
          reason: "Рабочая категория",
          sql: "select 1"
        }
      });
      const assigned = await fastify.inject({
        method: "POST",
        url: `/api/v1/users/${adminId}/classification/statuses`,
        headers: {
          authorization: "Bearer valid-token",
          "x-request-id": "classification-assignment-1"
        },
        payload: {
          code: "interested",
          reason: "Подтверждено оператором"
        }
      });

      assert.equal(listed.statusCode, 200);
      assert.equal(created.statusCode, 201);
      assert.equal(rejected.statusCode, 400);
      assert.equal(assigned.statusCode, 201);
      assert.deepEqual(permissions, [
        "users.read",
        "users.write",
        "users.write",
        "users.write"
      ]);
      assert.equal(calls.length, 3);
      assert.equal(
        (calls[1] as { readonly request: { readonly code: string } })
          .request.code,
        "vip"
      );
    } finally {
      await app.close();
    }
  });
});

function handlers(calls: unknown[]): AdminUserClassificationHandlers {
  return {
    list: {
      async execute(input) {
        calls.push(input);
        return { statuses: [], categories: [] };
      }
    },
    createStatus: {
      async execute(input) {
        calls.push(input);
        return {
          id: statusId,
          code: input.request.code,
          displayName: input.request.displayName,
          color: input.request.color,
          description: input.request.description,
          isSystem: false,
          exclusivityGroup: input.request.exclusivityGroup,
          allowedTransitionCodes: input.request.allowedTransitionCodes,
          isActive: true,
          lockVersion: 1
        };
      }
    },
    updateStatus: {
      async execute(input) {
        calls.push(input);
        return {
          id: input.statusId,
          code: "new",
          displayName: input.request.displayName,
          color: input.request.color,
          description: input.request.description,
          isSystem: true,
          exclusivityGroup: input.request.exclusivityGroup,
          allowedTransitionCodes: input.request.allowedTransitionCodes,
          isActive: input.request.isActive,
          lockVersion: input.request.expectedLockVersion + 1
        };
      }
    },
    createCategory: {
      async execute(input) {
        calls.push(input);
        return {
          id: categoryId,
          code: input.request.code,
          displayName: input.request.displayName,
          color: input.request.color,
          description: input.request.description,
          isSystem: false,
          isActive: true,
          lockVersion: 1
        };
      }
    },
    updateCategory: {
      async execute(input) {
        calls.push(input);
        return {
          id: input.categoryId,
          code: "vip",
          displayName: input.request.displayName,
          color: input.request.color,
          description: input.request.description,
          isSystem: false,
          isActive: input.request.isActive,
          lockVersion: input.request.expectedLockVersion + 1
        };
      }
    },
    assignStatus: {
      async execute(input) {
        calls.push(input);
        return {
          changed: true,
          statusCodes: [input.request.code],
          categoryCodes: []
        };
      }
    },
    assignCategory: {
      async execute(input) {
        calls.push(input);
        return {
          changed: true,
          statusCodes: [],
          categoryCodes: [input.request.code]
        };
      }
    },
    removeStatus: {
      async execute(input) {
        calls.push(input);
        return { changed: true, statusCodes: [], categoryCodes: [] };
      }
    },
    removeCategory: {
      async execute(input) {
        calls.push(input);
        return { changed: true, statusCodes: [], categoryCodes: [] };
      }
    }
  };
}

const readiness = {
  async execute() {
    return {
      service: "api",
      status: "healthy" as const,
      version: "test",
      checkedAt: "2026-07-28T19:00:00.000Z",
      components: []
    };
  }
};
const adminId = "00000000-0000-4000-8000-000000000101";
const statusId = "00000000-0000-4000-8000-000000000102";
const categoryId = "00000000-0000-4000-8000-000000000103";
