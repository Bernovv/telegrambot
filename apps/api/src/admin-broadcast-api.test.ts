import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminPermission } from "@ticket-platform/contracts";
import type { FastifyInstance } from "fastify";
import { createApiApplication } from "./app.js";
import type { AdminBroadcastHandlers } from "./admin-broadcast-api.js";

describe("admin broadcast HTTP contract", () => {
  it("requires the broadcasts.send permission and creates a campaign from a valid body", async () => {
    const permissions: string[] = [];
    const requests: unknown[] = [];
    const app = await createApiApplication({
      appVersion: "test",
      bodyLimitBytes: 262_144,
      readiness,
      adminAuth: adminAuth(permissions),
      adminBroadcast: handlers(requests)
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
      adminBroadcast: handlers(requests)
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
      adminBroadcast: handlers(requests)
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

  it("считает аудиторию по тем же фильтрам и требует то же разрешение", async () => {
    const permissions: string[] = [];
    const requests: unknown[] = [];
    const app = await createApiApplication({
      appVersion: "test",
      bodyLimitBytes: 262_144,
      readiness,
      adminAuth: adminAuth(permissions),
      adminBroadcast: handlers(requests)
    });
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const response = await fastify.inject({
        method: "GET",
        url: `/api/v1/broadcasts/audience?targetEventId=${EVENT_ID}&targetOrderStatus=paid`,
        headers: { authorization: "Bearer valid-token" }
      });

      assert.equal(response.statusCode, 200);
      assert.deepEqual(permissions, ["broadcasts.send"]);
      assert.deepEqual(JSON.parse(response.body), {
        recipientCount: 42,
        truncated: false,
        limit: 5_000
      });
      assert.deepEqual(requests[0], {
        actor: {
          adminId: ADMIN_ID,
          authSubject: "auth-1",
          roleCodes: ["content_manager"],
          permission: "broadcasts.send"
        },
        targetEventId: EVENT_ID,
        targetOrderStatus: "paid"
      });
    } finally {
      await app.close();
    }
  });

  it("отклоняет подсчёт по неизвестному фильтру, а не молча его игнорирует", async () => {
    const requests: unknown[] = [];
    const app = await createApiApplication({
      appVersion: "test",
      bodyLimitBytes: 262_144,
      readiness,
      adminAuth: adminAuth([]),
      adminBroadcast: handlers(requests)
    });
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const response = await fastify.inject({
        method: "GET",
        url: "/api/v1/broadcasts/audience?targetOrderStatus=shipped",
        headers: { authorization: "Bearer valid-token" }
      });

      assert.equal(response.statusCode, 400);
      assert.equal(requests.length, 0);
    } finally {
      await app.close();
    }
  });

  it("принимает пробную рассылку и передаёт признак дальше", async () => {
    const requests: unknown[] = [];
    const app = await createApiApplication({
      appVersion: "test",
      bodyLimitBytes: 262_144,
      readiness,
      adminAuth: adminAuth([]),
      adminBroadcast: handlers(requests)
    });
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const response = await fastify.inject({
        method: "POST",
        url: "/api/v1/broadcasts",
        headers: { authorization: "Bearer valid-token", "content-type": "application/json" },
        payload: { messageText: "Проверка", isTest: true }
      });

      assert.equal(response.statusCode, 201);
      assert.equal((requests[0] as { readonly isTest?: boolean }).isTest, true);
    } finally {
      await app.close();
    }
  });

  it("принимает картинку, кнопку и сегмент аудитории и передаёт их дальше", async () => {
    const requests: unknown[] = [];
    const app = await createApiApplication({
      appVersion: "test",
      bodyLimitBytes: 1_600_000,
      readiness,
      adminAuth: adminAuth([]),
      adminBroadcast: handlers(requests)
    });
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const upload = await fastify.inject({
        method: "POST",
        url: "/api/v1/broadcast-images",
        headers: { authorization: "Bearer valid-token", "content-type": "application/json" },
        payload: { fileName: "promo.png", contentBase64: "A".repeat(200) }
      });
      const created = await fastify.inject({
        method: "POST",
        url: "/api/v1/broadcasts",
        headers: { authorization: "Bearer valid-token", "content-type": "application/json" },
        payload: {
          messageText: "Успей купить",
          targetAudience: "bot_users",
          imageId: IMAGE_ID,
          button: { text: "Купить билет", url: "https://biz-day.ru/tariffs" }
        }
      });

      assert.equal(upload.statusCode, 201);
      assert.equal(JSON.parse(upload.body).imageId, IMAGE_ID);
      assert.equal(created.statusCode, 201);
      const request = requests[1] as {
        readonly targetAudience?: string;
        readonly imageId?: string;
        readonly button?: { readonly text: string; readonly url: string };
      };
      assert.equal(request.targetAudience, "bot_users");
      assert.equal(request.imageId, IMAGE_ID);
      assert.deepEqual(request.button, {
        text: "Купить билет",
        url: "https://biz-day.ru/tariffs"
      });
    } finally {
      await app.close();
    }
  });

  it("не принимает кнопку без https и картинку не по схеме", async () => {
    const requests: unknown[] = [];
    const app = await createApiApplication({
      appVersion: "test",
      bodyLimitBytes: 1_600_000,
      readiness,
      adminAuth: adminAuth([]),
      adminBroadcast: handlers(requests)
    });
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const insecureButton = await fastify.inject({
        method: "POST",
        url: "/api/v1/broadcasts",
        headers: { authorization: "Bearer valid-token", "content-type": "application/json" },
        payload: {
          messageText: "Привет",
          button: { text: "Купить", url: "http://biz-day.ru" }
        }
      });
      const emptyImage = await fastify.inject({
        method: "POST",
        url: "/api/v1/broadcast-images",
        headers: { authorization: "Bearer valid-token", "content-type": "application/json" },
        payload: { fileName: "promo.png", contentBase64: "AAAA" }
      });

      assert.equal(insecureButton.statusCode, 400);
      assert.equal(emptyImage.statusCode, 400);
      assert.equal(requests.length, 0);
    } finally {
      await app.close();
    }
  });

  it("отдаёт историю рассылок под тем же разрешением", async () => {
    const permissions: string[] = [];
    const app = await createApiApplication({
      appVersion: "test",
      bodyLimitBytes: 262_144,
      readiness,
      adminAuth: adminAuth(permissions),
      adminBroadcast: handlers([])
    });
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const response = await fastify.inject({
        method: "GET",
        url: "/api/v1/broadcasts",
        headers: { authorization: "Bearer valid-token" }
      });

      assert.equal(response.statusCode, 200);
      assert.deepEqual(JSON.parse(response.body), { items: [] });
      assert.deepEqual(permissions, ["broadcasts.send"]);
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
      adminBroadcast: handlers([])
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

function handlers(requests: unknown[], audienceCount = 42): AdminBroadcastHandlers {
  return {
    create: {
      async execute(input) {
        requests.push(input);
        return { broadcastId: "broadcast-1" };
      }
    },
    audience: {
      async execute(input) {
        requests.push(input);
        return { recipientCount: audienceCount, truncated: false, limit: 5_000 };
      }
    },
    image: {
      async execute(input) {
        requests.push(input);
        return {
          imageId: IMAGE_ID,
          mimeType: "image/png",
          byteSize: 2_048,
          width: 1_280,
          height: 720
        };
      }
    },
    list: {
      async execute(input) {
        requests.push(input);
        return { items: [] };
      }
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
const IMAGE_ID = "00000000-0000-4000-8000-000000000003";
