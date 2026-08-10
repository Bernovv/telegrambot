import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminPermission, EventOverview } from "@ticket-platform/contracts";
import type { FastifyInstance } from "fastify";
import type { AdminOverviewHandler } from "./admin-overview-api.js";
import { createApiApplication } from "./app.js";

const EVENT_ID = "019c0123-4567-789a-bcde-f0123456789a";
const ADMIN_ID = "019c0123-4567-789a-bcde-f0123456789b";

describe("event overview HTTP contract", () => {
  // Обзор открыт по общему праву на мероприятия; деньги внутри закрывает сам сервис,
  // поэтому второй ручки «обзор без денег» не существует.
  it("serves the overview behind the plain events.read permission", async () => {
    const permissions: string[] = [];
    const app = await application(permissions);
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const response = await fastify.inject({
        method: "GET",
        url: `/api/v1/events/${EVENT_ID}/overview`,
        headers: { authorization: "Bearer valid-token" }
      });

      assert.equal(response.statusCode, 200);
      assert.deepEqual(permissions, ["events.read"]);
      assert.equal(response.json().people.guests, 12);
    } finally {
      await app.close();
    }
  });

  it("passes through an overview that carries no money at all", async () => {
    const app = await application([], { ...overview, money: null });
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const response = await fastify.inject({
        method: "GET",
        url: `/api/v1/events/${EVENT_ID}/overview`,
        headers: { authorization: "Bearer valid-token" }
      });

      assert.equal(response.statusCode, 200);
      assert.equal(response.json().money, null);
    } finally {
      await app.close();
    }
  });

  it("rejects a non-UUID event id", async () => {
    const app = await application([]);
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const response = await fastify.inject({
        method: "GET",
        url: "/api/v1/events/not-a-uuid/overview",
        headers: { authorization: "Bearer valid-token" }
      });

      assert.equal(response.statusCode, 400);
    } finally {
      await app.close();
    }
  });

  it("answers 404 for an event that does not exist", async () => {
    const app = await application([], undefined, () => {
      throw new Error("Event was not found");
    });
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const response = await fastify.inject({
        method: "GET",
        url: `/api/v1/events/${EVENT_ID}/overview`,
        headers: { authorization: "Bearer valid-token" }
      });

      assert.equal(response.statusCode, 404);
      assert.equal(response.json().code, "EVENT_NOT_FOUND");
    } finally {
      await app.close();
    }
  });

  it("returns 401 without a bearer token", async () => {
    const app = await application([]);
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const response = await fastify.inject({
        method: "GET",
        url: `/api/v1/events/${EVENT_ID}/overview`
      });

      assert.equal(response.statusCode, 401);
    } finally {
      await app.close();
    }
  });
});

function application(
  permissions: string[],
  result: EventOverview = overview,
  onRead?: () => never
) {
  return createApiApplication({
    appVersion: "test",
    bodyLimitBytes: 262_144,
    readiness,
    adminAuth: adminAuth(permissions),
    adminOverview: handler(result, onRead)
  });
}

function handler(
  result: EventOverview,
  onRead?: () => never
): AdminOverviewHandler {
  return {
    async summary() {
      if (onRead) {
        onRead();
      }
      return result;
    }
  };
}

const overview: EventOverview = {
  eventId: EVENT_ID,
  eventTitle: "Бизнес-Пикник",
  calculatedAt: "2026-08-10T09:00:00.000Z",
  money: {
    revenueKopecks: "60000000",
    revenueFromOrdersKopecks: "50000000",
    revenueFromManualKopecks: "10000000",
    expensesPlannedKopecks: "18000000",
    expensesActualKopecks: "20000000",
    profitKopecks: "40000000",
    preliminary: false,
    expensesWithoutActual: 0,
    organizers: [],
    unallocatedKopecks: "40000000"
  },
  people: {
    capacity: 60,
    occupiedUnits: 12,
    people: 7,
    guests: 12,
    adults: 9,
    children: 3,
    sleepingPlaces: 6,
    fromOrders: 10,
    fromManual: 2,
    questionnaireAnswered: 4,
    questionnairePeople: 7
  },
  readiness: [],
  readinessDone: 0
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
          roleCodes: ["super_admin"],
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
