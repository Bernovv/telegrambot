import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InvalidSiteRegistrationError } from "@ticket-platform/application";
import type { SiteRegistrationResponse } from "@ticket-platform/contracts";
import type { FastifyInstance } from "fastify";
import { createApiApplication } from "./app.js";
import type { SiteRegistrationHandler } from "./site-registration-api.js";

const accepted: SiteRegistrationResponse = {
  status: "registered",
  eventTitle: "Бизнес-Среда, 26 августа",
  startsAt: "2026-08-26T16:00:00.000Z"
};

describe("site registration HTTP contract", () => {
  it("принимает заявку без входа в панель и отдаёт ответ формы", async () => {
    const received: unknown[] = [];
    const app = await application({
      async execute(input) {
        received.push(input);
        return accepted;
      }
    });

    try {
      const response = await post(app, {
        name: "Мария Соколова",
        phone: "+7 999 123-45-67",
        consent: true,
        page: "sreda"
      });

      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), accepted);
      assert.equal(received.length, 1);
    } finally {
      await app.close();
    }
  });

  it("возвращает код ошибки поля, а не пятисотку", async () => {
    const app = await application({
      async execute() {
        throw new InvalidSiteRegistrationError("invalid_phone");
      }
    });

    try {
      const response = await post(app, {
        name: "Мария Соколова",
        phone: "12345",
        consent: true
      });

      assert.equal(response.statusCode, 400);
      assert.equal(response.json().code, "invalid_phone");
    } finally {
      await app.close();
    }
  });

  it("не пускает заявку без согласия мимо разбора тела", async () => {
    let called = false;
    const app = await application({
      async execute() {
        called = true;
        return accepted;
      }
    });

    try {
      const response = await post(app, { name: "Мария", phone: "+79991234567" });

      assert.equal(response.statusCode, 400);
      assert.equal(response.json().code, "invalid_request");
      assert.equal(called, false);
    } finally {
      await app.close();
    }
  });

  it("режет поток заявок с одного адреса", async () => {
    const app = await application({
      async execute() {
        return accepted;
      }
    });

    try {
      const codes: number[] = [];
      for (let attempt = 0; attempt < 7; attempt += 1) {
        const response = await post(
          app,
          { name: "Мария Соколова", phone: "+79991234567", consent: true },
          "203.0.113.7"
        );
        codes.push(response.statusCode);
      }

      // Пять заявок за десять минут с одного адреса — потолок: это форма на встречу, а не
      // корзина магазина.
      assert.deepEqual(codes, [200, 200, 200, 200, 200, 429, 429]);
    } finally {
      await app.close();
    }
  });
});

async function application(handler: SiteRegistrationHandler) {
  const app = await createApiApplication({
    appVersion: "test",
    bodyLimitBytes: 1_000_000,
    readiness: {
      async execute() {
        return {
          service: "api",
          status: "healthy",
          version: "test",
          checkedAt: "2026-08-20T10:00:00.000Z",
          components: []
        };
      }
    },
    siteRegistration: {
      handler,
      logger: { info() {}, error() {} }
    }
  });
  await app.init();
  return app;
}

async function post(
  app: Awaited<ReturnType<typeof application>>,
  payload: unknown,
  forwardedFor = "203.0.113.1"
) {
  const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
  return await fastify.inject({
    method: "POST",
    url: "/api/v1/site/registrations",
    headers: { "x-forwarded-for": forwardedFor },
    payload: payload as Record<string, unknown>
  });
}
