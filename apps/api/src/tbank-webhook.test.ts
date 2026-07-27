import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { VerifiedTBankWebhook } from "@ticket-platform/application";
import type { FastifyInstance } from "fastify";
import { createApiApplication } from "./app.js";

describe("T-Bank webhook HTTP contract", () => {
  it("returns exact OK text after verification and processing", async () => {
    const processed: VerifiedTBankWebhook[] = [];
    const app = await testApplication({
      verifyWebhook() {
        return verifiedEvent;
      },
      async execute(event) {
        processed.push(event);
      }
    });

    try {
      const response = await inject(app, webhookBody);

      assert.equal(response.statusCode, 200);
      assert.equal(response.body, "OK");
      assert.match(response.headers["content-type"] ?? "", /^text\/plain/);
      assert.equal(processed.length, 1);
    } finally {
      await app.close();
    }
  });

  it("rejects an invalid signature before application processing", async () => {
    let calls = 0;
    const app = await testApplication({
      verifyWebhook() {
        throw new Error("invalid signature");
      },
      async execute() {
        calls += 1;
      }
    });

    try {
      const response = await inject(app, webhookBody);

      assert.equal(response.statusCode, 401);
      assert.equal(calls, 0);
    } finally {
      await app.close();
    }
  });

  it("enforces the provider-specific parsed body limit", async () => {
    let calls = 0;
    const app = await testApplication({
      verifyWebhook() {
        return verifiedEvent;
      },
      async execute() {
        calls += 1;
      }
    }, 1_024);

    try {
      const response = await inject(app, {
        ...webhookBody,
        padding: "x".repeat(2_000)
      });

      assert.equal(response.statusCode, 413);
      assert.equal(calls, 0);
    } finally {
      await app.close();
    }
  });
});

async function testApplication(
  dependencies: {
    readonly verifyWebhook: (payload: unknown) => VerifiedTBankWebhook;
    readonly execute: (event: VerifiedTBankWebhook, receivedAt: Date) => Promise<void>;
  },
  bodyLimitBytes = 65_536
) {
  const app = await createApiApplication({
    appVersion: "test",
    bodyLimitBytes: 262_144,
    readiness: {
      async execute() {
        return {
          service: "api",
          status: "healthy",
          version: "test",
          checkedAt: "2026-07-24T13:00:00.000Z",
          components: []
        };
      }
    },
    tbankWebhook: {
      config: { bodyLimitBytes },
      verifier: { verifyWebhook: dependencies.verifyWebhook },
      handler: { execute: dependencies.execute },
      logger: { info() {}, error() {} }
    }
  });
  await app.init();
  return app;
}

async function inject(
  app: Awaited<ReturnType<typeof testApplication>>,
  payload: object
) {
  const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
  return fastify.inject({
    method: "POST",
    url: "/webhooks/payments/tbank",
    payload
  });
}

const verifiedEvent: VerifiedTBankWebhook = {
  providerPaymentId: "1234567890",
  merchantOrderId: "tb_019c01234567789abcdef0123456789a_1",
  status: "CONFIRMED",
  success: true,
  errorCode: "0",
  amountKopecks: 239000n,
  payloadHash: "a".repeat(64),
  eventKey: "b".repeat(64)
};

const webhookBody = {
  TerminalKey: "test-terminal",
  PaymentId: "1234567890",
  OrderId: verifiedEvent.merchantOrderId,
  Success: true,
  Status: "CONFIRMED",
  ErrorCode: "0",
  Amount: 239000,
  Token: "c".repeat(64)
};
