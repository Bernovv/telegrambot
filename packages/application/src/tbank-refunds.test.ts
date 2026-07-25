import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HandleTBankRefundWebhookService,
  ReconcileTBankRefundsBatchService,
  RequestFullTBankRefundService,
  type FullTBankRefundProviderResult,
  type PreparedFullTBankRefund,
  type TBankRefundReconciliationClaim,
  type TBankRefundReconciliationRepository
} from "./tbank-refunds.js";
import type { TBankOrderLookupResult } from "./tbank-reconciliation.js";

const at = new Date("2026-07-25T14:00:00.000Z");

describe("RequestFullTBankRefundService", () => {
  it("finalizes an exact provider-confirmed full refund", async () => {
    const fixture = refundFixture({
      providerResult: {
        submitted: true,
        providerPaymentId: refund.providerPaymentId,
        merchantOrderId: refund.merchantOrderId,
        providerStatus: "REFUNDED",
        originalAmountKopecks: 239000n,
        remainingAmountKopecks: 0n,
        responseHash: "a".repeat(64)
      }
    });

    const result = await fixture.request.execute(command);

    assert.equal(result.status, "succeeded");
    assert.equal(result.created, true);
    assert.equal(fixture.providerCalls.length, 1);
    assert.equal(fixture.finalizations.length, 1);
    assert.equal(
      fixture.finalizations[0]?.evidence.origin,
      "cancel_response"
    );
  });

  it("records a network timeout as unknown and never finalizes it", async () => {
    const fixture = refundFixture({
      providerResult: {
        submitted: false,
        errorCode: "NETWORK_ERROR",
        retryable: true,
        uncertain: true
      }
    });

    const result = await fixture.request.execute(command);

    assert.equal(result.status, "unknown");
    assert.equal(fixture.providerResults[0]?.resultStatus, "unknown");
    assert.equal(fixture.finalizations.length, 0);
  });

  it("returns an existing idempotent request without another provider call", async () => {
    const fixture = refundFixture({ prepareStatus: "existing" });

    const result = await fixture.request.execute(command);

    assert.equal(result.created, false);
    assert.equal(fixture.providerCalls.length, 0);
  });

  it("routes a submitted response with a foreign payment binding to review", async () => {
    const fixture = refundFixture({
      providerResult: {
        submitted: true,
        providerPaymentId: "foreign-payment",
        merchantOrderId: refund.merchantOrderId,
        providerStatus: "REFUNDED",
        originalAmountKopecks: 239000n,
        remainingAmountKopecks: 0n,
        responseHash: "a".repeat(64)
      }
    });

    const result = await fixture.request.execute(command);

    assert.equal(result.status, "review");
    assert.equal(
      fixture.providerResults[0]?.resultCode,
      "PAYMENT_BINDING_MISMATCH"
    );
    assert.equal(fixture.finalizations.length, 0);
  });
});

describe("HandleTBankRefundWebhookService", () => {
  it("finalizes a signed matching REFUNDED notification", async () => {
    const fixture = refundFixture();

    const handled = await fixture.webhook.execute({
      providerPaymentId: refund.providerPaymentId,
      merchantOrderId: refund.merchantOrderId,
      status: "REFUNDED",
      success: true,
      errorCode: "0",
      amountKopecks: 239000n,
      payloadHash: "b".repeat(64),
      eventKey: "c".repeat(64)
    }, at);

    assert.equal(handled, true);
    assert.equal(fixture.finalizations[0]?.evidence.origin, "webhook");
  });

  it("routes a partial provider outcome to review", async () => {
    const fixture = refundFixture();

    await fixture.webhook.execute({
      providerPaymentId: refund.providerPaymentId,
      merchantOrderId: refund.merchantOrderId,
      status: "PARTIAL_REFUNDED",
      success: true,
      errorCode: "0",
      amountKopecks: 239000n,
      payloadHash: "b".repeat(64),
      eventKey: "c".repeat(64)
    }, at);

    assert.equal(fixture.providerResults[0]?.resultStatus, "review");
    assert.equal(fixture.finalizations.length, 0);
  });
});

describe("ReconcileTBankRefundsBatchService", () => {
  it("completes one exactly bound REFUNDED payment", async () => {
    const fixture = refundFixture({
      claimStatus: "submitted",
      lookup: {
        found: true,
        merchantOrderId: refund.merchantOrderId,
        payments: [{
          providerPaymentId: refund.providerPaymentId,
          amountKopecks: 239000n,
          status: "REFUNDED",
          success: true,
          errorCode: "0"
        }],
        responseHash: "d".repeat(64)
      }
    });

    const result = await fixture.reconcile.execute({
      workerId: "worker:test",
      at,
      batchSize: 10,
      leaseSeconds: 120,
      retryBaseSeconds: 30,
      retryMaxSeconds: 3_600
    });

    assert.deepEqual(result, {
      claimed: 1,
      completed: 1,
      deferred: 0,
      review: 0
    });
    assert.equal(fixture.finalizations[0]?.evidence.origin, "reconciliation");
  });

  it("retries an uncertain Cancel with the same external request ID", async () => {
    const fixture = refundFixture({
      providerResult: {
        submitted: true,
        providerPaymentId: refund.providerPaymentId,
        merchantOrderId: refund.merchantOrderId,
        providerStatus: "REFUNDING",
        originalAmountKopecks: 239000n,
        remainingAmountKopecks: 239000n,
        responseHash: "f".repeat(64)
      }
    });

    const result = await fixture.reconcile.execute({
      workerId: "worker:test",
      at,
      batchSize: 10,
      leaseSeconds: 120,
      retryBaseSeconds: 30,
      retryMaxSeconds: 3_600
    });

    assert.equal(result.deferred, 1);
    assert.equal(fixture.providerCalls.length, 1);
    assert.deepEqual(fixture.providerCalls[0], {
      providerPaymentId: refund.providerPaymentId,
      merchantOrderId: refund.merchantOrderId,
      expectedOriginalAmountKopecks: 239000n,
      externalRequestId: refund.externalRequestId
    });
    assert.equal(fixture.providerResults[0]?.resultStatus, "submitted");
  });
});

function refundFixture(options: {
  readonly prepareStatus?: "created" | "existing";
  readonly providerResult?: FullTBankRefundProviderResult;
  readonly lookup?: TBankOrderLookupResult;
  readonly claimStatus?: TBankRefundReconciliationClaim["status"];
} = {}) {
  const providerCalls: unknown[] = [];
  const providerResults: Parameters<
    TBankRefundReconciliationRepository["recordProviderResult"]
  >[0][] = [];
  const finalizations: Parameters<
    TBankRefundReconciliationRepository["finalize"]
  >[0][] = [];
  const repository: TBankRefundReconciliationRepository = {
    async prepare(input) {
      return {
        status: options.prepareStatus ?? "created",
        refund: { ...refund, requestHash: input.requestHash }
      };
    },
    async recordProviderResult(input) {
      providerResults.push(input);
    },
    async finalize(input) {
      finalizations.push(input);
      return "completed";
    },
    async findActive() {
      return refund;
    },
    async claimReconciliationBatch() {
      return [{ ...claim, status: options.claimStatus ?? "unknown" }];
    }
  };
  const provider = {
    async refundFullPayment(input: unknown) {
      providerCalls.push(input);
      return options.providerResult ?? {
        submitted: false,
        errorCode: "DECLINED",
        retryable: false,
        uncertain: false
      };
    }
  };
  let generated = 100;
  const idGenerator = {
    newId() {
      generated += 1;
      return `00000000-0000-4000-8000-${generated.toString().padStart(12, "0")}`;
    }
  };

  return {
    request: new RequestFullTBankRefundService(
      repository,
      provider,
      idGenerator,
      {
        newId() {
          return "7c4934c2-95e8-4a96-a28a-73b7762e3112";
        }
      }
    ),
    webhook: new HandleTBankRefundWebhookService(repository, idGenerator),
    reconcile: new ReconcileTBankRefundsBatchService(
      repository,
      {
        async checkOrder() {
          return options.lookup ?? {
            found: false,
            errorCode: "NETWORK_ERROR",
            retryable: true
          };
        }
      },
      provider,
      idGenerator
    ),
    providerCalls,
    providerResults,
    finalizations
  };
}

const refund: PreparedFullTBankRefund = {
  refundRequestId: "00000000-0000-4000-8000-000000000001",
  orderId: "00000000-0000-4000-8000-000000000002",
  paymentAttemptId: "00000000-0000-4000-8000-000000000003",
  providerPaymentId: "1234567890",
  merchantOrderId: "tb_order_1",
  externalRequestId: "7c4934c2-95e8-4a96-a28a-73b7762e3112",
  externalAmountKopecks: "239000",
  walletAmountKopecks: "10000",
  currency: "RUB",
  requestHash: "e".repeat(64),
  status: "created"
};

const claim: TBankRefundReconciliationClaim = {
  ...refund,
  status: "unknown",
  leaseOwner: "worker:test",
  attemptCount: 1
};

const command = {
  orderId: refund.orderId,
  idempotencyKey: "refund:order-1:full",
  reason: "Customer requested cancellation",
  actor: {
    adminId: "00000000-0000-4000-8000-000000000010",
    authSubject: "auth-subject",
    roleCodes: ["finance"],
    permission: "payments.refund" as const
  },
  requestedAt: at
};
