import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminPermission, EventTeamView } from "@ticket-platform/contracts";
import type { FastifyInstance } from "fastify";
import type { AdminTeamHandler } from "./admin-team-api.js";
import { createApiApplication } from "./app.js";

const EVENT_ID = "019c0123-4567-789a-bcde-f0123456789a";
const ADMIN_ID = "019c0123-4567-789a-bcde-f0123456789b";
const ORGANIZER_ID = "019c0123-4567-789a-bcde-f0123456789c";

describe("event team HTTP contract", () => {
  // Кто сколько заработал — не операционные данные. Читать их можно только с
  // event_finance.read, править — только с event_finance.manage.
  it("puts reading and editing behind the two finance permissions", async () => {
    const permissions: string[] = [];
    const app = await application(permissions, []);
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const read = await fastify.inject({
        method: "GET",
        url: `/api/v1/events/${EVENT_ID}/team`,
        headers: { authorization: "Bearer valid-token" }
      });
      const write = await fastify.inject({
        method: "POST",
        url: `/api/v1/events/${EVENT_ID}/team`,
        headers: { authorization: "Bearer valid-token" },
        payload: { personName: "Иван", sharePercent: "40" }
      });

      assert.equal(read.statusCode, 200);
      assert.equal(write.statusCode, 201);
      assert.deepEqual(permissions, ["event_finance.read", "event_finance.manage"]);
    } finally {
      await app.close();
    }
  });

  it("rejects a share that is not a sane percentage", async () => {
    const calls: unknown[] = [];
    const app = await application([], calls);
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      for (const sharePercent of ["101", "-5", "50,5", "33.333", "половина"]) {
        const response = await fastify.inject({
          method: "POST",
          url: `/api/v1/events/${EVENT_ID}/team`,
          headers: { authorization: "Bearer valid-token" },
          payload: { personName: "Иван", sharePercent }
        });
        assert.equal(response.statusCode, 400);
      }
      assert.equal(calls.length, 0);
    } finally {
      await app.close();
    }
  });

  it("answers 409 when the shares would add up past one hundred", async () => {
    const app = await application([], [], () => {
      throw new Error("Event organizer shares exceed one hundred percent");
    });
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const response = await fastify.inject({
        method: "POST",
        url: `/api/v1/events/${EVENT_ID}/team`,
        headers: { authorization: "Bearer valid-token" },
        payload: { personName: "Пётр", sharePercent: "40" }
      });

      assert.equal(response.statusCode, 409);
      assert.equal(response.json().code, "SHARES_EXCEED_HUNDRED");
    } finally {
      await app.close();
    }
  });

  it("answers 409 when the same person is added twice", async () => {
    const app = await application([], [], () => {
      throw new Error("Event organizer with this name already exists");
    });
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const response = await fastify.inject({
        method: "POST",
        url: `/api/v1/events/${EVENT_ID}/team`,
        headers: { authorization: "Bearer valid-token" },
        payload: { personName: "Иван", sharePercent: "10" }
      });

      assert.equal(response.statusCode, 409);
      assert.equal(response.json().code, "ORGANIZER_EXISTS");
    } finally {
      await app.close();
    }
  });

  it("answers 404 when the organizer is gone", async () => {
    const app = await application([], [], () => {
      throw new Error("Event organizer was not found");
    });
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const response = await fastify.inject({
        method: "POST",
        url: `/api/v1/events/${EVENT_ID}/team/remove`,
        headers: { authorization: "Bearer valid-token" },
        payload: { organizerId: ORGANIZER_ID }
      });

      assert.equal(response.statusCode, 404);
      assert.equal(response.json().code, "ORGANIZER_NOT_FOUND");
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
        url: `/api/v1/events/${EVENT_ID}/team`
      });

      assert.equal(response.statusCode, 401);
    } finally {
      await app.close();
    }
  });
});

function application(
  permissions: string[],
  calls: unknown[],
  onWrite?: () => never
) {
  return createApiApplication({
    appVersion: "test",
    bodyLimitBytes: 262_144,
    readiness,
    adminAuth: adminAuth(permissions),
    adminTeam: handler(calls, onWrite)
  });
}

function handler(calls: unknown[], onWrite?: () => never): AdminTeamHandler {
  const record = (input: unknown) => {
    if (onWrite) {
      onWrite();
    }
    calls.push(input);
  };
  return {
    async summary() {
      return view;
    },
    async addOrganizer(input) {
      record(input);
    },
    async updateOrganizer(input) {
      record(input);
    },
    async removeOrganizer(input) {
      record(input);
    }
  };
}

const view: EventTeamView = {
  eventId: EVENT_ID,
  eventTitle: "Бизнес-Пикник",
  calculatedAt: "2026-08-10T09:00:00.000Z",
  profit: {
    revenueKopecks: "60000000",
    revenueFromOrdersKopecks: "50000000",
    revenueFromManualKopecks: "10000000",
    expensesKopecks: "20000000",
    profitKopecks: "40000000",
    preliminary: false,
    expensesWithoutActual: 0
  },
  organizers: [],
  allocatedPercent: "0",
  unallocatedKopecks: "40000000",
  canManage: true
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
