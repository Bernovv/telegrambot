import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminPermission, EventExpensesView } from "@ticket-platform/contracts";
import type { FastifyInstance } from "fastify";
import type { AdminExpensesHandler } from "./admin-expenses-api.js";
import { createApiApplication } from "./app.js";

const EVENT_ID = "019c0123-4567-789a-bcde-f0123456789a";
const ADMIN_ID = "019c0123-4567-789a-bcde-f0123456789b";
const EXPENSE_ID = "019c0123-4567-789a-bcde-f0123456789c";

describe("event expenses HTTP contract", () => {
  it("serves the summary to a reader and requires manage to add a row", async () => {
    const permissions: string[] = [];
    const app = await application(permissions, []);
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const read = await fastify.inject({
        method: "GET",
        url: `/api/v1/events/${EVENT_ID}/expenses`,
        headers: { authorization: "Bearer valid-token" }
      });
      const write = await fastify.inject({
        method: "POST",
        url: `/api/v1/events/${EVENT_ID}/expenses`,
        headers: { authorization: "Bearer valid-token" },
        payload: {
          categoryCode: "rent",
          title: "Палатки трёхместные",
          plannedKopecks: "3000000"
        }
      });

      assert.equal(read.statusCode, 200);
      assert.equal(write.statusCode, 201);
      assert.deepEqual(permissions, ["expenses.read", "expenses.manage"]);
    } finally {
      await app.close();
    }
  });

  it("rejects a rouble amount written the human way", async () => {
    const calls: unknown[] = [];
    const app = await application([], calls);
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      for (const plannedKopecks of ["30 000", "3000.50", "тридцать тысяч"]) {
        const response = await fastify.inject({
          method: "POST",
          url: `/api/v1/events/${EVENT_ID}/expenses`,
          headers: { authorization: "Bearer valid-token" },
          payload: { categoryCode: "rent", title: "Палатки", plannedKopecks }
        });
        assert.equal(response.statusCode, 400);
      }
      assert.equal(calls.length, 0);
    } finally {
      await app.close();
    }
  });

  // Отмена — отдельный путь с обязательной причиной. Разрешить 'cancelled' обычной правкой
  // значило бы дать погасить оплаченный расход молча.
  it("refuses to cancel an expense through the ordinary edit", async () => {
    const calls: unknown[] = [];
    const app = await application([], calls);
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const response = await fastify.inject({
        method: "POST",
        url: `/api/v1/events/${EVENT_ID}/expenses/update`,
        headers: { authorization: "Bearer valid-token" },
        payload: { expenseId: EXPENSE_ID, lockVersion: 1, status: "cancelled" }
      });

      assert.equal(response.statusCode, 400);
      assert.equal(calls.length, 0);
    } finally {
      await app.close();
    }
  });

  it("demands a reason before cancelling", async () => {
    const calls: unknown[] = [];
    const app = await application([], calls);
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const response = await fastify.inject({
        method: "POST",
        url: `/api/v1/events/${EVENT_ID}/expenses/cancel`,
        headers: { authorization: "Bearer valid-token" },
        payload: { expenseId: EXPENSE_ID, lockVersion: 1, reason: "ой" }
      });

      assert.equal(response.statusCode, 400);
      assert.equal(calls.length, 0);
    } finally {
      await app.close();
    }
  });

  it("answers 409 when someone else already changed the row", async () => {
    const app = await application([], [], () => {
      throw new Error("Event expense was changed by someone else");
    });
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const response = await fastify.inject({
        method: "POST",
        url: `/api/v1/events/${EVENT_ID}/expenses/update`,
        headers: { authorization: "Bearer valid-token" },
        payload: { expenseId: EXPENSE_ID, lockVersion: 1, plannedKopecks: "1" }
      });

      assert.equal(response.statusCode, 409);
      assert.equal(response.json().code, "EXPENSE_CONFLICT");
    } finally {
      await app.close();
    }
  });

  it("answers 409 on a duplicate vendor name", async () => {
    const app = await application([], [], () => {
      throw new Error("Vendor with this name already exists");
    });
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const response = await fastify.inject({
        method: "POST",
        url: "/api/v1/vendors",
        headers: { authorization: "Bearer valid-token" },
        payload: { name: "Палатки Урала", kind: "rent" }
      });

      assert.equal(response.statusCode, 409);
      assert.equal(response.json().code, "VENDOR_EXISTS");
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
        url: `/api/v1/events/${EVENT_ID}/expenses`
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
    adminExpenses: handler(calls, onWrite)
  });
}

function handler(calls: unknown[], onWrite?: () => never): AdminExpensesHandler {
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
    async addVendor(input) {
      record(input);
    },
    async addExpense(input) {
      record(input);
    },
    async updateExpense(input) {
      record(input);
    },
    async cancelExpense(input) {
      record(input);
    }
  };
}

const view: EventExpensesView = {
  eventId: EVENT_ID,
  eventTitle: "Бизнес-Пикник",
  calculatedAt: "2026-08-10T09:00:00.000Z",
  totals: {
    plannedKopecks: "3000000",
    actualKopecks: "0",
    openCount: 1,
    cancelledCount: 0
  },
  byCategory: [],
  expenses: [],
  categories: [],
  vendors: [],
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
