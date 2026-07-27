import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminPermission } from "@ticket-platform/contracts";
import type { FastifyInstance } from "fastify";
import { createApiApplication } from "./app.js";
import type { ExportParticipantsHandler } from "./participants-export-api.js";

describe("participants export HTTP contract", () => {
  it("requires the participants.export permission and streams the CSV with attachment headers", async () => {
    const permissions: string[] = [];
    const requests: unknown[] = [];
    const app = await createApiApplication({
      appVersion: "test",
      bodyLimitBytes: 262_144,
      readiness,
      adminAuth: adminAuth(permissions),
      participantsExport: handler(requests)
    });
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const response = await fastify.inject({
        method: "GET",
        url: `/api/v1/events/${EVENT_ID}/participants/export`,
        headers: { authorization: "Bearer valid-token" }
      });

      assert.equal(response.statusCode, 200);
      assert.deepEqual(permissions, ["participants.export"]);
      assert.equal(response.headers["content-type"], "text/csv; charset=utf-8");
      assert.equal(
        response.headers["content-disposition"],
        `attachment; filename="participants-${EVENT_ID}.csv"`
      );
      assert.equal(response.body, "Order,Name\r\nBP-0001,Ivan\r\n");
      assert.deepEqual(requests, [{ actor: { adminId: ADMIN_ID, authSubject: "auth-1", roleCodes: ["sales_manager"], permission: "participants.export" }, eventId: EVENT_ID }]);
    } finally {
      await app.close();
    }
  });

  it("rejects a non-UUID event id before invoking the handler", async () => {
    const requests: unknown[] = [];
    const app = await createApiApplication({
      appVersion: "test",
      bodyLimitBytes: 262_144,
      readiness,
      adminAuth: adminAuth([]),
      participantsExport: handler(requests)
    });
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const response = await fastify.inject({
        method: "GET",
        url: "/api/v1/events/not-a-uuid/participants/export",
        headers: { authorization: "Bearer valid-token" }
      });

      assert.equal(response.statusCode, 400);
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
      participantsExport: handler([])
    });
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const response = await fastify.inject({
        method: "GET",
        url: `/api/v1/events/${EVENT_ID}/participants/export`
      });

      assert.equal(response.statusCode, 401);
    } finally {
      await app.close();
    }
  });
});

function handler(requests: unknown[]): ExportParticipantsHandler {
  return {
    async execute(input) {
      requests.push(input);
      return {
        csv: "Order,Name\r\nBP-0001,Ivan\r\n",
        rowCount: 1,
        filename: `participants-${input.eventId}.csv`
      };
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
const EVENT_ID = "00000000-0000-4000-8000-000000000002";
