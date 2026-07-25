import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConfirmPaymentService } from "./payment-confirmation.js";
import {
  ReconcileTBankPaymentsBatchService,
  type TBankOrderLookupResult,
  type TBankReconciliationClaim,
  type TBankReconciliationRepository
} from "./tbank-reconciliation.js";

const at = new Date("2026-07-25T12:00:00.000Z");

describe("ReconcileTBankPaymentsBatchService", () => {
  it("confirms exactly one amount-matching successful payment", async () => {
    const fixture = createFixture({
      lookup: lookupWith([{
        providerPaymentId: "1234567890",
        amountKopecks: 239000n,
        status: "CONFIRMED",
        success: true,
        errorCode: "0"
      }])
    });

    const result = await fixture.service.execute(command);

    assert.deepEqual(result, {
      claimed: 1,
      confirmed: 1,
      released: 0,
      deferred: 0,
      review: 0
    });
    assert.equal(fixture.confirmations.length, 1);
    assert.equal(fixture.confirmations[0]?.providerEvidence?.origin, "reconciliation");
    assert.equal(
      fixture.confirmations[0]?.providerEvidence?.providerPaymentId,
      "1234567890"
    );
  });

  it("defers a retryable provider failure with bounded backoff", async () => {
    const fixture = createFixture({
      lookup: {
        found: false,
        errorCode: "NETWORK_ERROR",
        retryable: true
      }
    });

    const result = await fixture.service.execute(command);

    assert.equal(result.deferred, 1);
    assert.equal(fixture.retries.length, 1);
    assert.equal(
      fixture.retries[0]?.nextAttemptAt.toISOString(),
      "2026-07-25T12:01:00.000Z"
    );
  });

  it("releases an uncertain attempt only after repeated empty observations", async () => {
    const fixture = createFixture({
      lookup: lookupWith([]),
      emptyOutcome: "released"
    });

    const result = await fixture.service.execute(command);

    assert.equal(result.released, 1);
    assert.equal(fixture.empties[0]?.releaseAfterCount, 3);
  });

  it("routes multiple, mismatched, and refund-state payments to review", async () => {
    const scenarios: readonly TBankOrderLookupResult[] = [
      lookupWith([
        payment("1", 239000n, "NEW"),
        payment("2", 239000n, "NEW")
      ]),
      lookupWith([payment("1", 1n, "NEW")]),
      lookupWith([payment("1", 239000n, "REFUNDING")])
    ];

    for (const lookup of scenarios) {
      const fixture = createFixture({ lookup });
      const result = await fixture.service.execute(command);
      assert.equal(result.review, 1);
      assert.equal(fixture.reviews.length, 1);
      assert.equal(fixture.observed.length, 0);
    }
  });
});

function createFixture(options: {
  readonly lookup: TBankOrderLookupResult;
  readonly emptyOutcome?: "retry" | "released";
}) {
  const confirmations: Parameters<ConfirmPaymentService["execute"]>[0][] = [];
  const retries: Parameters<TBankReconciliationRepository["recordRetry"]>[0][] = [];
  const empties: Parameters<TBankReconciliationRepository["recordEmpty"]>[0][] = [];
  const reviews: Parameters<TBankReconciliationRepository["recordReview"]>[0][] = [];
  const observed: Parameters<TBankReconciliationRepository["recordObserved"]>[0][] = [];
  const repository: TBankReconciliationRepository = {
    async claimBatch() {
      return [claim];
    },
    async recordRetry(input) {
      retries.push(input);
    },
    async recordEmpty(input) {
      empties.push(input);
      return options.emptyOutcome ?? "retry";
    },
    async recordReview(input) {
      reviews.push(input);
    },
    async recordObserved(input) {
      observed.push(input);
    }
  };
  const confirmPayment = {
    async execute(input: Parameters<ConfirmPaymentService["execute"]>[0]) {
      confirmations.push(input);
      return {
        paymentAttemptId: input.providerEvidence?.paymentAttemptId ?? "missing",
        orderId: input.orderId,
        status: "paid" as const,
        paidAt: input.confirmedAt.toISOString(),
        amountKopecks: input.amountKopecks,
        walletCapturedKopecks: "0",
        ticketCount: 1,
        ticketNumbers: ["BP-000001-T001"],
        created: true
      };
    }
  } as unknown as ConfirmPaymentService;
  let sequence = 0;

  return {
    service: new ReconcileTBankPaymentsBatchService(
      repository,
      { async checkOrder() { return options.lookup; } },
      confirmPayment,
      {
        newId() {
          sequence += 1;
          return `00000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
        }
      }
    ),
    confirmations,
    retries,
    empties,
    reviews,
    observed
  };
}

function lookupWith(
  payments: Extract<TBankOrderLookupResult, { found: true }>["payments"]
): TBankOrderLookupResult {
  return {
    found: true,
    merchantOrderId: claim.merchantOrderId,
    payments,
    responseHash: "a".repeat(64)
  };
}

function payment(
  providerPaymentId: string,
  amountKopecks: bigint,
  status: Extract<TBankOrderLookupResult, { found: true }>["payments"][number]["status"]
) {
  return {
    providerPaymentId,
    amountKopecks,
    status,
    success: true,
    errorCode: "0"
  } as const;
}

const claim: TBankReconciliationClaim = {
  paymentAttemptId: "00000000-0000-4000-8000-000000000001",
  orderId: "00000000-0000-4000-8000-000000000002",
  idempotencyKey: "tbank_init:order-1:1",
  merchantOrderId: "tb_order_1",
  amountKopecks: "239000",
  currency: "RUB",
  reconciliationAttemptCount: 2,
  emptyObservationCount: 0,
  leaseOwner: "worker:test"
};

const command = {
  workerId: "worker:test",
  at,
  batchSize: 10,
  leaseSeconds: 60,
  initialDelaySeconds: 60,
  retryBaseSeconds: 30,
  retryMaxSeconds: 3_600,
  emptyObservationThreshold: 3
};
