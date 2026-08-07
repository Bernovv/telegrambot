import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminPermission, EventParticipantsView } from "@ticket-platform/contracts";
import type { FastifyInstance } from "fastify";
import type {
  AdminAccommodationHandler,
  AdminEventParticipantsHandler
} from "./admin-accommodation-api.js";
import { createApiApplication } from "./app.js";

const EVENT_ID = "019c0123-4567-789a-bcde-f0123456789a";
const ADMIN_ID = "019c0123-4567-789a-bcde-f0123456789b";

describe("event participants HTTP contract", () => {
  it("serves the list behind the accommodation.read permission", async () => {
    const permissions: string[] = [];
    const requests: unknown[] = [];
    const app = await application(permissions, requests);
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const response = await fastify.inject({
        method: "GET",
        url: `/api/v1/events/${EVENT_ID}/participants`,
        headers: { authorization: "Bearer valid-token" }
      });

      assert.equal(response.statusCode, 200);
      assert.deepEqual(permissions, ["accommodation.read"]);
      assert.equal(response.json().totals.guests, 3);
      assert.deepEqual(requests, [{
        actor: {
          adminId: ADMIN_ID,
          authSubject: "auth-1",
          roleCodes: ["sales_manager"],
          permission: "accommodation.read"
        },
        eventId: EVENT_ID
      }]);
    } finally {
      await app.close();
    }
  });

  it("rejects a non-UUID event id before reaching the handler", async () => {
    const requests: unknown[] = [];
    const app = await application([], requests);
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const response = await fastify.inject({
        method: "GET",
        url: "/api/v1/events/not-a-uuid/participants",
        headers: { authorization: "Bearer valid-token" }
      });

      assert.equal(response.statusCode, 400);
      assert.equal(requests.length, 0);
    } finally {
      await app.close();
    }
  });

  it("answers 404 for an event that does not exist", async () => {
    const app = await application([], [], () => {
      throw new Error("Event was not found");
    });
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const response = await fastify.inject({
        method: "GET",
        url: `/api/v1/events/${EVENT_ID}/participants`,
        headers: { authorization: "Bearer valid-token" }
      });

      assert.equal(response.statusCode, 404);
      assert.equal(response.json().code, "EVENT_NOT_FOUND");
    } finally {
      await app.close();
    }
  });

  it("returns 401 without a bearer token", async () => {
    const app = await application([], []);
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const response = await fastify.inject({
        method: "GET",
        url: `/api/v1/events/${EVENT_ID}/participants`
      });

      assert.equal(response.statusCode, 401);
    } finally {
      await app.close();
    }
  });
});

function application(
  permissions: string[],
  requests: unknown[],
  onList?: () => never
) {
  return createApiApplication({
    appVersion: "test",
    bodyLimitBytes: 262_144,
    readiness,
    adminAuth: adminAuth(permissions),
    adminAccommodation: {} as AdminAccommodationHandler,
    adminEventParticipants: participantsHandler(requests, onList)
  });
}

function participantsHandler(
  requests: unknown[],
  onList?: () => never
): AdminEventParticipantsHandler {
  return {
    async list(input) {
      if (onList) {
        onList();
      }
      requests.push(input);
      return view;
    }
  };
}

const view: EventParticipantsView = {
  eventId: EVENT_ID,
  eventTitle: "Бизнес-Пикник",
  calculatedAt: "2026-08-10T09:00:00.000Z",
  totals: {
    people: 2,
    guests: 3,
    adults: 2,
    children: 1,
    sleepingPlaces: 2,
    amountKopecks: "498000",
    fromOrders: 2,
    fromManual: 1
  },
  rows: [],
  excludedOrders: 0,
  canManageParticipants: true
};

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
      async execute(_token: unknown, permission: AdminPermission) {
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
