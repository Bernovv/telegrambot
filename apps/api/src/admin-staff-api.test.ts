import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LastHeadError } from "@ticket-platform/application";
import type { AdminPermission, StaffView } from "@ticket-platform/contracts";
import type { FastifyInstance } from "fastify";
import type { AdminStaffHandler } from "./admin-staff-api.js";
import { createApiApplication } from "./app.js";

const ADMIN_ID = "019c0123-4567-789a-bcde-f0123456789b";
const MENTOR_ID = "019c0123-4567-789a-bcde-f0123456789c";
const SLOT_ID = "019c0123-4567-789a-bcde-f0123456789d";
const CONTACT_ID = "019c0123-4567-789a-bcde-f0123456789e";

describe("staff HTTP contract", () => {
  // Четыре разрешения, а не одно: видеть команду может каждый, менять роли —
  // руководитель, править календарь — он и наставник, записывать клиента — он и менеджер.
  it("разводит чтение, роли, календарь и запись по своим разрешениям", async () => {
    const permissions: string[] = [];
    const app = await application(permissions);
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const headers = { authorization: "Bearer valid-token" };
      await fastify.inject({ method: "GET", url: "/api/v1/staff", headers });
      await fastify.inject({
        method: "POST",
        url: "/api/v1/staff/roles",
        headers,
        payload: { adminId: MENTOR_ID, role: "mentor", granted: true }
      });
      await fastify.inject({
        method: "POST",
        url: "/api/v1/staff/slots",
        headers,
        payload: {
          mentorAdminId: MENTOR_ID,
          fromDate: "2026-08-24",
          toDate: "2026-08-31",
          weekdays: [2],
          hours: [15]
        }
      });
      await fastify.inject({
        method: "POST",
        url: "/api/v1/staff/slots/book",
        headers,
        payload: { slotId: SLOT_ID, contactId: CONTACT_ID }
      });

      assert.deepEqual(permissions, [
        "team.read",
        "team.manage",
        "mentor_slots.manage",
        "mentor_slots.book"
      ]);
    } finally {
      await app.close();
    }
  });

  // Двое менеджеров выбирают время одновременно — второму нужен отказ, а не молчаливая
  // перезапись первого.
  it("отвечает 409, когда окошко успели занять", async () => {
    const app = await application([], { bookOutcome: "already_booked" });
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const response = await fastify.inject({
        method: "POST",
        url: "/api/v1/staff/slots/book",
        headers: { authorization: "Bearer valid-token" },
        payload: { slotId: SLOT_ID, contactId: CONTACT_ID }
      });

      assert.equal(response.statusCode, 409);
      assert.equal(response.json().code, "SLOT_ALREADY_BOOKED");
    } finally {
      await app.close();
    }
  });

  it("отвечает 409 на попытку снять роль с последнего руководителя", async () => {
    const app = await application([], { onRole: () => { throw new LastHeadError(); } });
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const response = await fastify.inject({
        method: "POST",
        url: "/api/v1/staff/roles",
        headers: { authorization: "Bearer valid-token" },
        payload: { adminId: ADMIN_ID, role: "head", granted: false }
      });

      assert.equal(response.statusCode, 409);
      assert.equal(response.json().code, "LAST_HEAD");
    } finally {
      await app.close();
    }
  });

  it("не берёт роль, которой нет, и расписание без дней", async () => {
    const app = await application([]);
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const headers = { authorization: "Bearer valid-token" };
      const role = await fastify.inject({
        method: "POST",
        url: "/api/v1/staff/roles",
        headers,
        payload: { adminId: ADMIN_ID, role: "super_admin", granted: true }
      });
      const slots = await fastify.inject({
        method: "POST",
        url: "/api/v1/staff/slots",
        headers,
        payload: {
          mentorAdminId: MENTOR_ID,
          fromDate: "24.08.2026",
          toDate: "2026-08-31",
          weekdays: [2],
          hours: [15]
        }
      });

      assert.equal(role.statusCode, 400);
      assert.equal(slots.statusCode, 400);
    } finally {
      await app.close();
    }
  });

  it("возвращает 401 без токена", async () => {
    const app = await application([]);
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const response = await fastify.inject({ method: "GET", url: "/api/v1/staff" });
      assert.equal(response.statusCode, 401);
    } finally {
      await app.close();
    }
  });
});

function application(
  permissions: string[],
  options: {
    readonly bookOutcome?: "booked" | "already_booked" | "not_found";
    readonly onRole?: () => never;
  } = {}
) {
  return createApiApplication({
    appVersion: "test",
    bodyLimitBytes: 262_144,
    readiness,
    adminAuth: adminAuth(permissions),
    adminStaff: handler(options)
  });
}

function handler(options: {
  readonly bookOutcome?: "booked" | "already_booked" | "not_found";
  readonly onRole?: () => never;
}): AdminStaffHandler {
  return {
    async view() {
      return view;
    },
    async setRole() {
      if (options.onRole) {
        options.onRole();
      }
      return { changed: true };
    },
    async listSlots() {
      return [];
    },
    async createSlots() {
      return { created: 1, skipped: 0 };
    },
    async cancelSlot() {
      return { cancelled: true };
    },
    async bookSlot() {
      return options.bookOutcome ?? "booked";
    },
    async releaseSlot() {
      return { released: true };
    }
  };
}

const view: StaffView = {
  members: [],
  canManageRoles: true,
  canManageSlots: true,
  canBookSlots: true,
  viewerAdminId: ADMIN_ID
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
          roleCodes: ["head"],
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
