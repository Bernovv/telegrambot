import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadRequestException,
  ConflictException
} from "@nestjs/common";
import type {
  RequestFullTBankRefundCommand,
  RequestFullTBankRefundResult
} from "@ticket-platform/application";
import type { FastifyInstance } from "fastify";
import { createApiApplication } from "./app.js";
import {
  FullRefundsController,
  type RequestFullRefundHandler
} from "./full-refunds-api.js";

describe("FullRefundsController", () => {
  it("delegates a validated request with the MFA-authorized admin actor", async () => {
    let received: RequestFullTBankRefundCommand | undefined;
    const controller = new FullRefundsController({
      async execute(command) {
        received = command;
        return result;
      }
    });

    const response = await controller.execute(
      orderId,
      validBody,
      "refund:order-1:full",
      {
        adminActor: {
          adminId: adminId,
          authSubject: "auth-1",
          roleCodes: ["financial_admin"],
          permission: "payments.refund"
        }
      } as never
    );

    assert.equal(response, result);
    assert.equal(received?.actor.adminId, adminId);
    assert.equal(received?.reason, validBody.reason);
    assert.ok(received?.requestedAt instanceof Date);
  });

  it("rejects malformed input and maps an unavailable order to conflict", async () => {
    const controller = new FullRefundsController(unavailableHandler);

    await assert.rejects(
      controller.execute(
        orderId,
        { reason: "x", unexpected: true },
        "refund:order-1:full",
        { adminActor: actor } as never
      ),
      BadRequestException
    );
    await assert.rejects(
      controller.execute(
        orderId,
        validBody,
        "refund:order-1:full",
        { adminActor: actor } as never
      ),
      ConflictException
    );
  });

  it("registers an authenticated MFA-sensitive HTTP endpoint", async () => {
    let requiredPermission: string | undefined;
    let received: RequestFullTBankRefundCommand | undefined;
    const app = await createApiApplication({
      appVersion: "test",
      bodyLimitBytes: 262_144,
      readiness: healthyReadiness,
      adminAuth: {
        tokenVerifier: {
          async verify() {
            return {
              subject: "auth-1",
              assuranceLevel: "aal2",
              issuedAt: new Date("2026-07-25T14:00:00.000Z")
            };
          }
        },
        authorizer: {
          async execute(_token, permission) {
            requiredPermission = permission;
            return { ...actor, permission };
          }
        }
      },
      fullRefunds: {
        async execute(command) {
          received = command;
          return result;
        }
      }
    });
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const unauthorized = await fastify.inject({
        method: "POST",
        url: `/api/v1/orders/${orderId}/refunds/full`,
        headers: { "idempotency-key": "refund:order-1:full" },
        payload: validBody
      });
      const authorized = await fastify.inject({
        method: "POST",
        url: `/api/v1/orders/${orderId}/refunds/full`,
        headers: {
          authorization: "Bearer valid-token",
          "idempotency-key": "refund:order-1:full"
        },
        payload: validBody
      });

      assert.equal(unauthorized.statusCode, 401);
      assert.equal(authorized.statusCode, 201);
      assert.equal(requiredPermission, "payments.refund");
      assert.equal(received?.actor.adminId, adminId);
    } finally {
      await app.close();
    }
  });
});

const unavailableHandler: RequestFullRefundHandler = {
  async execute() {
    throw new Error("Order is not available for a full T-Bank refund");
  }
};

const healthyReadiness = {
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

const orderId = "019c0123-4567-789a-bcde-f0123456789a";
const adminId = "019c0123-4567-789a-bcde-f0123456789b";
const actor = {
  adminId,
  authSubject: "auth-1",
  roleCodes: ["financial_admin"],
  permission: "payments.refund" as const
};
const validBody = {
  reason: "Customer requested cancellation"
};
const result: RequestFullTBankRefundResult = {
  refundRequestId: "019c0123-4567-789a-bcde-f0123456789c",
  orderId,
  status: "submitted",
  externalAmountKopecks: "239000",
  walletAmountKopecks: "10000",
  currency: "RUB",
  created: true
};
