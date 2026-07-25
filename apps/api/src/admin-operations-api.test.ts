import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminPermission } from "@ticket-platform/contracts";
import type { FastifyInstance } from "fastify";
import { createApiApplication } from "./app.js";
import type { AdminOperationsHandlers } from "./admin-operations-api.js";

describe("administrator users and orders HTTP contract", () => {
  it("requires distinct read permissions and delegates validated filters", async () => {
    const permissions: string[] = [];
    const requests: unknown[] = [];
    const app = await createApiApplication({
      appVersion: "test",
      bodyLimitBytes: 262_144,
      readiness,
      adminAuth: {
        tokenVerifier: {
          async verify() {
            return {
              subject: "auth-1",
              assuranceLevel: "aal1",
              issuedAt: new Date("2026-07-25T14:00:00.000Z")
            };
          }
        },
        authorizer: {
          async execute(_token, permission) {
            permissions.push(permission);
            return {
              adminId: ADMIN_ID,
              authSubject: "auth-1",
              roleCodes: ["sales_manager"],
              permission
            };
          }
        }
      },
      adminOperations: handlers(requests)
    });
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const users = await fastify.inject({
        method: "GET",
        url: "/api/v1/users?search=%40alice&blocked=false&limit=20",
        headers: { authorization: "Bearer valid-token" }
      });
      const orders = await fastify.inject({
        method: "GET",
        url: `/api/v1/orders?status=paid&userId=${USER_ID}`,
        headers: { authorization: "Bearer valid-token" }
      });

      assert.equal(users.statusCode, 200);
      assert.equal(orders.statusCode, 200);
      assert.deepEqual(permissions, ["users.read", "orders.read"]);
      assert.deepEqual(requests.slice(0, 2).map((request) => ({
        search: (request as { search?: string }).search,
        blocked: (request as { blocked?: boolean }).blocked,
        status: (request as { status?: string }).status,
        userId: (request as { userId?: string }).userId
      })), [
        { search: "@alice", blocked: false, status: undefined, userId: undefined },
        { search: undefined, blocked: undefined, status: "paid", userId: USER_ID }
      ]);
    } finally {
      await app.close();
    }
  });

  it("rejects unknown query fields and invalid cursors before persistence", async () => {
    const requests: unknown[] = [];
    const app = await createApiApplication({
      appVersion: "test",
      bodyLimitBytes: 262_144,
      readiness,
      adminAuth: adminAuth(),
      adminOperations: handlers(requests)
    });
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const unknown = await fastify.inject({
        method: "GET",
        url: "/api/v1/users?rawPhone=true",
        headers: { authorization: "Bearer valid-token" }
      });
      const cursor = await fastify.inject({
        method: "GET",
        url: "/api/v1/orders?cursor=not-valid",
        headers: { authorization: "Bearer valid-token" }
      });

      assert.equal(unknown.statusCode, 400);
      assert.equal(cursor.statusCode, 400);
      assert.equal(requests.length, 0);
    } finally {
      await app.close();
    }
  });

  it("returns 404 for a missing detail and 401 without a bearer token", async () => {
    const app = await createApiApplication({
      appVersion: "test",
      bodyLimitBytes: 262_144,
      readiness,
      adminAuth: adminAuth(),
      adminOperations: handlers([])
    });
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const missing = await fastify.inject({
        method: "GET",
        url: `/api/v1/users/${USER_ID}`,
        headers: { authorization: "Bearer valid-token" }
      });
      const unauthorized = await fastify.inject({
        method: "GET",
        url: "/api/v1/orders"
      });

      assert.equal(missing.statusCode, 404);
      assert.equal(unauthorized.statusCode, 401);
    } finally {
      await app.close();
    }
  });
});

function handlers(requests: unknown[]): AdminOperationsHandlers {
  return {
    listUsers: {
      async execute(input) {
        requests.push(input);
        return { items: [], nextCursor: null };
      }
    },
    getUser: {
      async execute(input) {
        requests.push(input);
        return null;
      }
    },
    listOrders: {
      async execute(input) {
        requests.push(input);
        return { items: [], nextCursor: null };
      }
    },
    getOrder: {
      async execute(input) {
        requests.push(input);
        return null;
      }
    }
  };
}

function adminAuth() {
  return {
    tokenVerifier: {
      async verify() {
        return {
          subject: "auth-1",
          assuranceLevel: "aal1" as const,
          issuedAt: new Date("2026-07-25T14:00:00.000Z")
        };
      }
    },
    authorizer: {
      async execute(
        _token: unknown,
        permission: AdminPermission
      ) {
        return {
          adminId: ADMIN_ID,
          authSubject: "auth-1",
          roleCodes: ["sales_manager"],
          permission
        };
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
      checkedAt: "2026-07-25T14:00:00.000Z",
      components: []
    };
  }
};

const ADMIN_ID = "00000000-0000-4000-8000-000000000010";
const USER_ID = "00000000-0000-4000-8000-000000000001";
