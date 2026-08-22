import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MaxUpdate } from "@ticket-platform/messenger-max";
import type { FastifyInstance } from "fastify";
import { createApiApplication } from "./app.js";

const PATH_SECRET = "max-path-secret-000001";
const HEADER_SECRET = "max-header-secret-01";

describe("max webhook HTTP contract", () => {
  it("принимает обновление по секретному пути и с секретом в заголовке", async () => {
    const received: MaxUpdate[] = [];
    const app = await application(received);

    try {
      const response = await post(app, PATH_SECRET, HEADER_SECRET, {
        update_type: "bot_started",
        user: { user_id: 777 }
      });

      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), { ok: true });
      assert.equal(received.length, 1);
      assert.equal(received[0]?.update_type, "bot_started");
    } finally {
      await app.close();
    }
  });

  it("чужой путь отвечает 404, а не 401: сканеру незачем знать, что здесь что-то есть", async () => {
    const received: MaxUpdate[] = [];
    const app = await application(received);

    try {
      const response = await post(app, "чужой-путь", HEADER_SECRET, { update_type: "ping" });

      assert.equal(response.statusCode, 404);
      assert.equal(received.length, 0);
    } finally {
      await app.close();
    }
  });

  it("верный путь с чужим секретом заголовка не пускает", async () => {
    const received: MaxUpdate[] = [];
    const app = await application(received);

    try {
      const response = await post(app, PATH_SECRET, "чужой-секрет", { update_type: "ping" });

      assert.equal(response.statusCode, 401);
      assert.equal(received.length, 0);
    } finally {
      await app.close();
    }
  });

  it("незнакомый тип обновления принимается: отказ стоил бы нам диалога", async () => {
    const received: MaxUpdate[] = [];
    const app = await application(received);

    try {
      // Отвергнутое обновление MAX повторит несколько раз и бросит — вместе с человеком,
      // который написал боту. Разбирается пусть транспорт, он молча пропустит незнакомое.
      const response = await post(app, PATH_SECRET, HEADER_SECRET, {
        update_type: "message_chat_created",
        chat: { chat_id: 42 }
      });

      assert.equal(response.statusCode, 200);
      assert.equal(received.length, 1);
    } finally {
      await app.close();
    }
  });

  it("не поднимается, пока канал MAX выключен", async () => {
    const app = await createApiApplication({
      appVersion: "test",
      bodyLimitBytes: 1_000_000,
      readiness: readiness()
    });
    await app.init();

    try {
      const response = await post(app, PATH_SECRET, HEADER_SECRET, { update_type: "ping" });

      assert.equal(response.statusCode, 404);
    } finally {
      await app.close();
    }
  });
});

async function application(received: MaxUpdate[]) {
  const app = await createApiApplication({
    appVersion: "test",
    bodyLimitBytes: 1_000_000,
    readiness: readiness(),
    maxWebhook: {
      config: {
        pathSecret: PATH_SECRET,
        headerSecret: HEADER_SECRET,
        bodyLimitBytes: 262_144
      },
      processor: {
        async handleUpdate(update) {
          received.push(update);
        }
      },
      logger: { info() {}, error() {} }
    }
  });
  await app.init();
  return app;
}

function readiness() {
  return {
    async execute() {
      return {
        service: "api",
        status: "healthy" as const,
        version: "test",
        checkedAt: "2026-08-22T10:00:00.000Z",
        components: []
      };
    }
  };
}

async function post(
  app: Awaited<ReturnType<typeof application>>,
  pathSecret: string,
  headerSecret: string,
  payload: unknown
) {
  const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
  return await fastify.inject({
    method: "POST",
    url: `/webhooks/max/${encodeURIComponent(pathSecret)}`,
    payload: payload as never,
    headers: {
      "content-type": "application/json",
      "x-max-bot-api-secret": headerSecret
    }
  });
}
