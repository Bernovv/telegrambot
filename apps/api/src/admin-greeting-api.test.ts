import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InvalidEventGreetingError } from "@ticket-platform/application";
import {
  DEFAULT_GREETING_TEMPLATE,
  type AdminPermission,
  type EventGreetingView
} from "@ticket-platform/contracts";
import type { FastifyInstance } from "fastify";
import type { AdminGreetingHandler } from "./admin-greeting-api.js";
import { createApiApplication } from "./app.js";

const EVENT_ID = "019c0123-4567-789a-bcde-f0123456789a";
const ADMIN_ID = "019c0123-4567-789a-bcde-f0123456789b";

describe("event greeting HTTP contract", () => {
  it("reads with events.read and saves with events.write", async () => {
    const permissions: string[] = [];
    const calls: unknown[] = [];
    const app = await application(permissions, calls);
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const read = await fastify.inject({
        method: "GET",
        url: `/api/v1/events/${EVENT_ID}/greeting`,
        headers: { authorization: "Bearer valid-token" }
      });
      const write = await fastify.inject({
        method: "POST",
        url: `/api/v1/events/${EVENT_ID}/greeting`,
        headers: { authorization: "Bearer valid-token" },
        payload: {
          isEnabled: true,
          eventPhrase: "Открытой встрече предпринимателей",
          bodyTemplate: null
        }
      });

      assert.equal(read.statusCode, 200);
      assert.equal(read.json().defaultTemplate, DEFAULT_GREETING_TEMPLATE);
      assert.equal(write.statusCode, 201);
      assert.deepEqual(permissions, ["events.read", "events.write"]);
      assert.deepEqual((calls[0] as { settings: unknown }).settings, {
        isEnabled: true,
        eventPhrase: "Открытой встрече предпринимателей",
        bodyTemplate: null
      });
    } finally {
      await app.close();
    }
  });

  it("rejects a body with unknown or missing fields", async () => {
    const calls: unknown[] = [];
    const app = await application([], calls);
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      for (const payload of [
        { isEnabled: true, eventPhrase: null },
        { isEnabled: "да", eventPhrase: null, bodyTemplate: null },
        { isEnabled: true, eventPhrase: null, bodyTemplate: null, sendNow: true }
      ]) {
        const response = await fastify.inject({
          method: "POST",
          url: `/api/v1/events/${EVENT_ID}/greeting`,
          headers: { authorization: "Bearer valid-token" },
          payload
        });
        assert.equal(response.statusCode, 400);
      }
      assert.equal(calls.length, 0);
    } finally {
      await app.close();
    }
  });

  it("answers 422 with the reason when the text has a typo", async () => {
    // Причина уходит в панель как есть: менеджеру надо знать, какую подстановку поправить.
    const app = await application([], [], () => {
      throw new InvalidEventGreetingError("Неизвестная подстановка: {мероприятие}");
    });
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const response = await fastify.inject({
        method: "POST",
        url: `/api/v1/events/${EVENT_ID}/greeting`,
        headers: { authorization: "Bearer valid-token" },
        payload: { isEnabled: true, eventPhrase: null, bodyTemplate: "{мероприятие}" }
      });

      assert.equal(response.statusCode, 422);
      assert.equal(response.json().code, "INVALID_GREETING");
      assert.equal(response.json().title, "Неизвестная подстановка: {мероприятие}");
    } finally {
      await app.close();
    }
  });

  it("answers 404 when the event is gone", async () => {
    const app = await application([], [], () => {
      throw new Error("Event was not found");
    });
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const response = await fastify.inject({
        method: "POST",
        url: `/api/v1/events/${EVENT_ID}/greeting`,
        headers: { authorization: "Bearer valid-token" },
        payload: { isEnabled: false, eventPhrase: null, bodyTemplate: null }
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
        url: `/api/v1/events/${EVENT_ID}/greeting`
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
    adminGreeting: handler(calls, onWrite)
  });
}

function handler(calls: unknown[], onWrite?: () => never): AdminGreetingHandler {
  return {
    async get() {
      return view;
    },
    async save(input) {
      if (onWrite) {
        onWrite();
      }
      calls.push(input);
      return view;
    }
  };
}

const view: EventGreetingView = {
  eventId: EVENT_ID,
  isEnabled: true,
  eventPhrase: null,
  bodyTemplate: null,
  defaultTemplate: DEFAULT_GREETING_TEMPLATE,
  event: {
    title: "Открытая встреча предпринимателей",
    startsAt: "2026-11-18T15:30:00.000Z",
    timeZone: "Europe/Moscow",
    locationName: null,
    locationAddress: "ул. Рубинштейна, 27"
  },
  stats: { pending: 0, queued: 0, noChannel: 0, skipped: 0 },
  updatedAt: null,
  updatedByName: null,
  canEdit: true
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
