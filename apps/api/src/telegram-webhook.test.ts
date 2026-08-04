import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  TelegramUpdate,
  TelegramUpdateProcessor
} from "@ticket-platform/messenger-telegram";
import type { FastifyInstance } from "fastify";
import { createApiApplication } from "./app.js";

const pathSecret = "path_secret_12345678901234567890";
const headerSecret = "header_secret_123456789012345678";

describe("Telegram webhook HTTP contract", () => {
  it("accepts a validated update with both secrets", async () => {
    const updates: TelegramUpdate[] = [];
    const app = await testApplication({
      async handleUpdate(update) {
        updates.push(update);
      }
    });

    try {
      const response = await inject(app, {
        url: `/webhooks/telegram/${pathSecret}`,
        headers: { "x-telegram-bot-api-secret-token": headerSecret },
        payload: startUpdate()
      });

      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), { ok: true });
      assert.equal(updates.length, 1);
      assert.equal(updates[0]?.update_id, 1001);
    } finally {
      await app.close();
    }
  });

  it("hides a wrong path secret and rejects a missing header secret", async () => {
    const app = await testApplication({ async handleUpdate() {} });

    try {
      const wrongPath = await inject(app, {
        url: "/webhooks/telegram/wrong_path_secret_123456789012345",
        headers: { "x-telegram-bot-api-secret-token": headerSecret },
        payload: startUpdate()
      });
      const missingHeader = await inject(app, {
        url: `/webhooks/telegram/${pathSecret}`,
        headers: {},
        payload: startUpdate()
      });

      assert.equal(wrongPath.statusCode, 404);
      assert.equal(missingHeader.statusCode, 401);
    } finally {
      await app.close();
    }
  });

  it("rejects malformed updates before invoking the processor", async () => {
    let calls = 0;
    const app = await testApplication({
      async handleUpdate() {
        calls += 1;
      }
    });

    try {
      const response = await inject(app, {
        url: `/webhooks/telegram/${pathSecret}`,
        headers: { "x-telegram-bot-api-secret-token": headerSecret },
        payload: { update_id: "not-an-integer" }
      });

      assert.equal(response.statusCode, 400);
      assert.equal(calls, 0);
    } finally {
      await app.close();
    }
  });

  it("returns 413 before processing an oversized body", async () => {
    let calls = 0;
    const app = await testApplication({
      async handleUpdate() {
        calls += 1;
      }
    }, 1_024);

    try {
      const response = await inject(app, {
        url: `/webhooks/telegram/${pathSecret}`,
        headers: { "x-telegram-bot-api-secret-token": headerSecret },
        payload: { update_id: 1001, padding: "x".repeat(2_000) }
      });

      assert.equal(response.statusCode, 413);
      assert.equal(calls, 0);
    } finally {
      await app.close();
    }
  });

  it("returns 500 when processing fails so Telegram can retry", async () => {
    const app = await testApplication({
      async handleUpdate() {
        throw new Error("persistence unavailable");
      }
    });

    try {
      const response = await inject(app, {
        url: `/webhooks/telegram/${pathSecret}`,
        headers: { "x-telegram-bot-api-secret-token": headerSecret },
        payload: startUpdate()
      });

      assert.equal(response.statusCode, 500);
    } finally {
      await app.close();
    }
  });
});

async function testApplication(processor: TelegramUpdateProcessor, bodyLimitBytes = 262_144) {
  const app = await createApiApplication({
    appVersion: "test",
    bodyLimitBytes,
    readiness: {
      async execute() {
        return {
          service: "api",
          status: "healthy",
          version: "test",
          checkedAt: "2026-07-23T10:00:00.000Z",
          components: []
        };
      }
    },
    webhook: {
      config: { pathSecret, headerSecret, bodyLimitBytes: 262_144 },
      processor
    }
  });
  await app.init();
  return app;
}

async function inject(
  app: Awaited<ReturnType<typeof testApplication>>,
  request: {
    readonly url: string;
    readonly headers: Record<string, string>;
    readonly payload: object;
  }
) {
  const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
  return await fastify.inject({
    method: "POST",
    url: request.url,
    headers: request.headers,
    payload: request.payload
  });
}

function startUpdate(): TelegramUpdate {
  return {
    update_id: 1001,
    message: {
      message_id: 1,
      date: 1_753_171_200,
      from: { id: 777, is_bot: false, first_name: "Oleg" },
      chat: { id: 777, type: "private", first_name: "Oleg" },
      text: "/start",
      entities: [{ offset: 0, length: 6, type: "bot_command" }]
    }
  };
}
