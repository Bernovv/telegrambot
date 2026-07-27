import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminPermission } from "@ticket-platform/contracts";
import type { FastifyInstance } from "fastify";
import { createApiApplication } from "./app.js";
import type { CreateAdminBroadcastHandler } from "./admin-broadcast-api.js";

describe("admin broadcast HTTP contract", () => {
  it("requires the broadcasts.send permission and creates a campaign from a valid body", async () => {
    const permissions: string[] = [];
    const requests: unknown[] = [];
    const app = await createApiApplication({
      appVersion: "test",
      bodyLimitBytes: 262_144,
      readiness,
      adminAuth: adminAuth(permissions),
      adminBroadcast: handler(requests)
    });
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const response = await fastify.inject({
        method: "POST",
        url: "/api/v1/broadcasts",
        headers: { authorization: "Bearer valid-token", "content-type": "application/json" },
        payload: {
          messageText: "Скоро старт!",
          targetEventId: EVENT_ID,
          targetOrderStatus: "paid"
        }
      });

      assert.equal(response.statusCode, 201);
      assert.deepEqual(permissions, ["broadcasts.send"]);
      assert.deepEqual(JSON.parse(response.body), { broadcastId: "broadcast-1" });
      assert.equal(requests.length, 1);
      const request = requests[0] as {
        readonly messageText: string;
        readonly targetEventId?: string;
        readonly targetOrderStatus?: string;
      };
      assert.equal(request.messageText, "Скоро старт!");
      assert.equal(request.targetEventId, EVENT_ID);
      assert.equal(request.targetOrderStatus, "paid");
    } finally {
      await app.close();
    }
  });

  it("allows an unfiltered broadcast with only a message", async () => {
    const requests: unknown[] = [];
    const app = await createApiApplication({
      appVersion: "test",
      bodyLimitBytes: 262_144,
      readiness,
      adminAuth: adminAuth([]),
      adminBroadcast: handler(requests)
    });
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const response = await fastify.inject({
        method: "POST",
        url: "/api/v1/broadcasts",
        headers: { authorization: "Bearer valid-token", "content-type": "application/json" },
        payload: { messageText: "Всем привет" }
      });

      assert.equal(response.statusCode, 201);
      assert.equal(requests.length, 1);
    } finally {
      await app.close();
    }
  });

  it("rejects an empty message, an invalid status, and unknown fields", async () => {
    const requests: unknown[] = [];
    const app = await createApiApplication({
      appVersion: "test",
      bodyLimitBytes: 262_144,
      readiness,
      adminAuth: adminAuth([]),
      adminBroadcast: handler(requests)
    });
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const empty = await fastify.inject({
        method: "POST",
        url: "/api/v1/broadcasts",
        headers: { authorization: "Bearer valid-token", "content-type": "application/json" },
        payload: { messageText: "" }
      });
      const badStatus = await fastify.inject({
        method: "POST",
        url: "/api/v1/broadcasts",
        headers: { authorization: "Bearer valid-token", "content-type": "application/json" },
        payload: { messageText: "Hi", targetOrderStatus: "shipped" }
      });
      const unknownField = await fastify.inject({
        method: "POST",
        url: "/api/v1/broadcasts",
        headers: { authorization: "Bearer valid-token", "content-type": "application/json" },
        payload: { messageText: "Hi", rawSql: "drop table users" }
      });

      assert.equal(empty.statusCode, 400);
      assert.equal(badStatus.statusCode, 400);
      assert.equal(unknownField.statusCode, 400);
      assert.equal(requests.length, 0);
    } finally {
      await app.close();
    }
  });

  it("returns 401 without a bearer token", async () => {
    const app = await createApiApplication({
      appVersion: "test",
      bodyLimitBytes: 262_144,
      readiness,
      adminAuth: adminAuth([]),
      adminBroadcast: handler([])
    });
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const response = await fastify.inject({
        method: "POST",
        url: "/api/v1/broadcasts",
        headers: { "content-type": "application/json" },
        payload: { messageText: "Hi" }
      });

      assert.equal(response.statusCode, 401);
    } finally {
      await app.close();
    }
  });
});

function handler(requests: unknown[]): CreateAdminBroadcastHandler {
  return {
    async execute(input) {
      requests.push(input);
      return { broadcastId: "broadcast-1" };
    }
  };
}

function adminAuth(permissions: string[]) {
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
        permissions.push(permission);
        return {
          adminId: ADMIN_ID,
          authSubject: "auth-1",
          roleCodes: ["content_manager"],
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
const EVENT_ID = "00000000-0000-4000-8000-000000000002";
