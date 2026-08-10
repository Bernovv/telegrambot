import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminPermission, EventInventoryView } from "@ticket-platform/contracts";
import type { FastifyInstance } from "fastify";
import type { AdminInventoryHandler } from "./admin-inventory-api.js";
import { createApiApplication } from "./app.js";

const EVENT_ID = "019c0123-4567-789a-bcde-f0123456789a";
const ADMIN_ID = "019c0123-4567-789a-bcde-f0123456789b";
const ITEM_ID = "019c0123-4567-789a-bcde-f0123456789c";
const NEED_ID = "019c0123-4567-789a-bcde-f0123456789d";

describe("event inventory HTTP contract", () => {
  it("reads behind inventory.read and writes behind inventory.manage", async () => {
    const permissions: string[] = [];
    const app = await application(permissions, []);
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const read = await fastify.inject({
        method: "GET",
        url: `/api/v1/events/${EVENT_ID}/inventory`,
        headers: { authorization: "Bearer valid-token" }
      });
      const write = await fastify.inject({
        method: "POST",
        url: `/api/v1/events/${EVENT_ID}/inventory/needs`,
        headers: { authorization: "Bearer valid-token" },
        payload: { itemId: ITEM_ID, quantityNeeded: "3", source: "stock" }
      });

      assert.equal(read.statusCode, 200);
      assert.equal(write.statusCode, 201);
      assert.deepEqual(permissions, ["inventory.read", "inventory.manage"]);
    } finally {
      await app.close();
    }
  });

  it("rejects a quantity written with a comma or a word", async () => {
    const calls: unknown[] = [];
    const app = await application([], calls);
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      for (const quantityNeeded of ["3,5", "три", "-2", ""]) {
        const response = await fastify.inject({
          method: "POST",
          url: `/api/v1/events/${EVENT_ID}/inventory/needs`,
          headers: { authorization: "Bearer valid-token" },
          payload: { title: "Гирлянда", quantityNeeded, source: "buy" }
        });
        assert.equal(response.statusCode, 400);
      }
      assert.equal(calls.length, 0);
    } finally {
      await app.close();
    }
  });

  // Списание — это отрицательное движение, и запретить минус здесь значило бы запретить
  // выносить вещи со склада вообще.
  it("accepts a negative movement but not a zero one", async () => {
    const calls: unknown[] = [];
    const app = await application([], calls);
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const url = `/api/v1/events/${EVENT_ID}/inventory/movements`;
      const headers = { authorization: "Bearer valid-token" };

      const negative = await fastify.inject({
        method: "POST",
        url,
        headers,
        payload: { itemId: ITEM_ID, kind: "written_off", quantityDelta: "-2" }
      });
      const zero = await fastify.inject({
        method: "POST",
        url,
        headers,
        payload: { itemId: ITEM_ID, kind: "audit", quantityDelta: "0" }
      });

      assert.equal(negative.statusCode, 201);
      assert.equal(zero.statusCode, 400);
      assert.equal(calls.length, 1);
    } finally {
      await app.close();
    }
  });

  it("answers 409 on a duplicate stock title", async () => {
    const app = await application([], [], () => {
      throw new Error("Inventory item with this title already exists");
    });
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const response = await fastify.inject({
        method: "POST",
        url: "/api/v1/inventory/items",
        headers: { authorization: "Bearer valid-token" },
        payload: { title: "Палатка", categoryCode: "equipment" }
      });

      assert.equal(response.statusCode, 409);
      assert.equal(response.json().code, "INVENTORY_ITEM_EXISTS");
    } finally {
      await app.close();
    }
  });

  it("answers 404 when the loading line is gone", async () => {
    const app = await application([], [], () => {
      throw new Error("Inventory need was not found");
    });
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const response = await fastify.inject({
        method: "POST",
        url: `/api/v1/events/${EVENT_ID}/inventory/needs/update`,
        headers: { authorization: "Bearer valid-token" },
        payload: { needId: NEED_ID, status: "loaded" }
      });

      assert.equal(response.statusCode, 404);
      assert.equal(response.json().code, "INVENTORY_NEED_NOT_FOUND");
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
        url: `/api/v1/events/${EVENT_ID}/inventory`
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
    adminInventory: handler(calls, onWrite)
  });
}

function handler(calls: unknown[], onWrite?: () => never): AdminInventoryHandler {
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
    async addItem(input) {
      record(input);
    },
    async setComponent(input) {
      record(input);
    },
    async addNeed(input) {
      record(input);
    },
    async updateNeed(input) {
      record(input);
    },
    async recordMovement(input) {
      record(input);
    }
  };
}

const view: EventInventoryView = {
  eventId: EVENT_ID,
  eventTitle: "Бизнес-Пикник",
  calculatedAt: "2026-08-10T09:00:00.000Z",
  totals: {
    needCount: 0,
    fromStock: 0,
    toBuy: 0,
    toRent: 0,
    loaded: 0,
    shortCount: 0
  },
  needs: [],
  items: [],
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
