import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InvalidZvonobotCallError } from "@ticket-platform/application";
import type { FastifyInstance } from "fastify";
import { createApiApplication } from "./app.js";
import type { ZvonobotWebhookHandler } from "./zvonobot-webhook.js";

const SECRET = "zvonobot-secret-key-0001";

describe("zvonobot webhook HTTP contract", () => {
  it("принимает звонок по секретному пути и отвечает сразу", async () => {
    const received: unknown[] = [];
    const app = await application({
      async execute(input) {
        received.push(input.payload);
        return { status: "accepted" };
      }
    });

    try {
      const response = await post(app, SECRET, {
        call_id: "call-1",
        phone: "+79991234567",
        button: "1"
      });

      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), { status: "accepted" });
      assert.equal(received.length, 1);
    } finally {
      await app.close();
    }
  });

  it("пускает и по заголовку: не всякий кабинет умеет ключ в адресе", async () => {
    const app = await application({
      async execute() {
        return { status: "accepted" };
      }
    });

    try {
      const response = await post(app, "не-ключ", { call_id: "call-1" }, SECRET);

      assert.equal(response.statusCode, 200);
    } finally {
      await app.close();
    }
  });

  it("без ключа не отвечает и до разбора не доходит", async () => {
    let called = false;
    const app = await application({
      async execute() {
        called = true;
        return { status: "accepted" };
      }
    });

    try {
      const response = await post(app, "чужой-ключ", { call_id: "call-1" });

      assert.equal(response.statusCode, 401);
      assert.equal(called, false);
    } finally {
      await app.close();
    }
  });

  it("повтор вебхука — это тоже 200, иначе они будут слать его по кругу", async () => {
    const app = await application({
      async execute() {
        return { status: "duplicate" };
      }
    });

    try {
      const response = await post(app, SECRET, { call_id: "call-1" });

      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), { status: "duplicate" });
    } finally {
      await app.close();
    }
  });

  it("тело не того вида не превращается в бесконечный повтор", async () => {
    const app = await application({
      async execute() {
        throw new InvalidZvonobotCallError("invalid_payload");
      }
    });

    try {
      // Разобранный JSON, который не объект: строка вместо отчёта о звонке.
      const response = await post(app, SECRET, JSON.stringify("не объект"));

      // Ответ, отличный от 200, для них значит «повторить», а исправить такое тело повтор
      // не может: принимаем и забываем.
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), { status: "ignored" });
    } finally {
      await app.close();
    }
  });

  it("не поднимается без ключа в настройках", async () => {
    const app = await createApiApplication({
      appVersion: "test",
      bodyLimitBytes: 1_000_000,
      readiness: readiness()
    });
    await app.init();

    try {
      const response = await post(app, SECRET, { call_id: "call-1" });

      assert.equal(response.statusCode, 404);
    } finally {
      await app.close();
    }
  });
});

async function application(handler: ZvonobotWebhookHandler) {
  const app = await createApiApplication({
    appVersion: "test",
    bodyLimitBytes: 1_000_000,
    readiness: readiness(),
    zvonobot: {
      config: { secret: SECRET, bodyLimitBytes: 65_536 },
      handler,
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
  key: string,
  payload: unknown,
  headerKey?: string
) {
  const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
  return await fastify.inject({
    method: "POST",
    url: `/api/v1/zvonobot/${encodeURIComponent(key)}/calls`,
    payload: payload as never,
    headers: {
      "content-type": "application/json",
      ...(headerKey === undefined ? {} : { "x-zvonobot-key": headerKey })
    }
  });
}
