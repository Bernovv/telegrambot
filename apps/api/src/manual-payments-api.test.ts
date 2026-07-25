import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadRequestException,
  UnauthorizedException
} from "@nestjs/common";
import type {
  ConfirmPaymentCommand,
  ConfirmPaymentResult
} from "@ticket-platform/application";
import type { FastifyInstance } from "fastify";
import { createApiApplication } from "./app.js";
import {
  ManualPaymentsController,
  type ConfirmManualPaymentHandler
} from "./manual-payments-api.js";

describe("ManualPaymentsController", () => {
  it("uses the authenticated admin and delegates validated evidence", async () => {
    let received: ConfirmPaymentCommand | undefined;
    const controller = new ManualPaymentsController({
      async execute(command) {
        received = command;
        return result;
      }
    });

    const response = await controller.execute(
      orderId,
      {
        amountKopecks: "239000",
        currency: "RUB",
        method: "bank_transfer",
        externalReference: "bank-reference-1",
        reason: "Payment verified by sales manager"
      },
      "manual:payment:1",
      "request-1",
      {
        adminActor: {
          adminId: "admin-1",
          authSubject: "auth-1",
          roleCodes: ["sales_manager"],
          permission: "orders.manual_paid"
        }
      } as never
    );

    assert.equal(response, result);
    assert.equal(received?.actor.type, "admin");
    assert.equal(
      received?.actor.type === "admin" ? received.actor.adminId : null,
      "admin-1"
    );
    assert.equal(received?.manualEvidence?.requestId, "request-1");
    assert.ok(received?.confirmedAt instanceof Date);
  });

  it("rejects malformed evidence and a missing authenticated actor", async () => {
    const controller = new ManualPaymentsController(noopHandler);

    await assert.rejects(
      controller.execute(
        orderId,
        { amountKopecks: "0", currency: "rub" },
        "manual:payment:1",
        undefined,
        { adminActor: undefined } as never
      ),
      BadRequestException
    );
    await assert.rejects(
      controller.execute(
        orderId,
        {
          amountKopecks: "239000",
          currency: "RUB",
          method: "cash",
          externalReference: "receipt-1",
          reason: "Cash received"
        },
        "manual:payment:1",
        undefined,
        { adminActor: undefined } as never
      ),
      UnauthorizedException
    );
  });

  it("registers an authenticated MFA-sensitive HTTP operation", async () => {
    let received: ConfirmPaymentCommand | undefined;
    let requiredPermission: string | undefined;
    const app = await createApiApplication({
      appVersion: "test",
      bodyLimitBytes: 262_144,
      readiness: {
        async execute() {
          return {
            service: "api",
            status: "healthy",
            version: "test",
            checkedAt: "2026-07-24T12:00:00.000Z",
            components: []
          };
        }
      },
      adminAuth: {
        tokenVerifier: {
          async verify() {
            return {
              subject: "auth-1",
              assuranceLevel: "aal2",
              issuedAt: new Date("2026-07-24T12:00:00.000Z")
            };
          }
        },
        authorizer: {
          async execute(_token, permission) {
            requiredPermission = permission;
            return {
              adminId: "admin-1",
              authSubject: "auth-1",
              roleCodes: ["sales_manager"],
              permission
            };
          }
        }
      },
      manualPayments: {
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
        url: `/api/v1/orders/${orderId}/manual-payment`,
        payload: validBody
      });
      const authorized = await fastify.inject({
        method: "POST",
        url: `/api/v1/orders/${orderId}/manual-payment`,
        headers: {
          authorization: "Bearer valid-token",
          "idempotency-key": "manual:payment:1"
        },
        payload: validBody
      });

      assert.equal(unauthorized.statusCode, 401);
      assert.equal(authorized.statusCode, 201);
      assert.equal(requiredPermission, "orders.manual_paid");
      assert.equal(
        received?.actor.type === "admin" ? received.actor.adminId : null,
        "admin-1"
      );
    } finally {
      await app.close();
    }
  });
});

const noopHandler: ConfirmManualPaymentHandler = {
  async execute() {
    return result;
  }
};

const orderId = "019c0123-4567-789a-bcde-f0123456789a";

const validBody = {
  amountKopecks: "239000",
  currency: "RUB",
  method: "bank_transfer",
  externalReference: "bank-reference-1",
  reason: "Payment verified by sales manager"
} as const;

const result: ConfirmPaymentResult = {
  paymentAttemptId: "019c0123-4567-789a-bcde-f0123456789b",
  orderId,
  status: "paid",
  paidAt: "2026-07-24T12:20:00.000Z",
  amountKopecks: "239000",
  walletCapturedKopecks: "10000",
  ticketCount: 2,
  ticketNumbers: ["BP-ORDER-T001", "BP-ORDER-T002"],
  created: true
};
