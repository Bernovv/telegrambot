import { createHash } from "node:crypto";
import type { IdGenerator } from "./identity.js";
import type { ConfirmPaymentService } from "./payment-confirmation.js";
import type { TBankWebhookStatus } from "./tbank-payments.js";

export interface TBankReconciliationClaim {
  readonly paymentAttemptId: string;
  readonly orderId: string;
  readonly idempotencyKey: string;
  readonly merchantOrderId: string;
  readonly amountKopecks: string;
  readonly currency: string;
  readonly reconciliationAttemptCount: number;
  readonly emptyObservationCount: number;
  readonly leaseOwner: string;
}

export interface TBankOrderLookupPayment {
  readonly providerPaymentId: string;
  readonly amountKopecks: bigint;
  readonly status: TBankWebhookStatus;
  readonly success: boolean;
  readonly errorCode: string;
}

export type TBankOrderLookupResult =
  | {
      readonly found: true;
      readonly merchantOrderId: string;
      readonly payments: readonly TBankOrderLookupPayment[];
      readonly responseHash: string;
    }
  | {
      readonly found: false;
      readonly errorCode: string;
      readonly retryable: boolean;
    };

export interface TBankOrderLookupProvider {
  checkOrder(merchantOrderId: string): Promise<TBankOrderLookupResult>;
}

export interface TBankReconciliationRepository {
  claimBatch(input: {
    readonly workerId: string;
    readonly at: Date;
    readonly olderThan: Date;
    readonly batchSize: number;
    readonly leaseSeconds: number;
  }): Promise<readonly TBankReconciliationClaim[]>;
  recordRetry(input: {
    readonly claim: TBankReconciliationClaim;
    readonly eventId: string;
    readonly resultCode: string;
    readonly responseHash: string | null;
    readonly observedAt: Date;
    readonly nextAttemptAt: Date;
  }): Promise<void>;
  recordEmpty(input: {
    readonly claim: TBankReconciliationClaim;
    readonly eventId: string;
    readonly responseHash: string;
    readonly observedAt: Date;
    readonly nextAttemptAt: Date;
    readonly releaseAfterCount: number;
    readonly historyId: string;
  }): Promise<"retry" | "released">;
  recordReview(input: {
    readonly claim: TBankReconciliationClaim;
    readonly eventId: string;
    readonly resultCode: string;
    readonly responseHash: string | null;
    readonly paymentCount: number;
    readonly observedAt: Date;
  }): Promise<void>;
  recordObserved(input: {
    readonly claim: TBankReconciliationClaim;
    readonly eventId: string;
    readonly eventKey: string;
    readonly responseHash: string;
    readonly payment: TBankOrderLookupPayment;
    readonly observedAt: Date;
    readonly nextAttemptAt: Date | null;
    readonly historyId: string;
  }): Promise<void>;
}

export interface ReconcileTBankPaymentsBatchInput {
  readonly workerId: string;
  readonly at: Date;
  readonly batchSize: number;
  readonly leaseSeconds: number;
  readonly initialDelaySeconds: number;
  readonly retryBaseSeconds: number;
  readonly retryMaxSeconds: number;
  readonly emptyObservationThreshold: number;
}

export interface ReconcileTBankPaymentsBatchResult {
  readonly claimed: number;
  readonly confirmed: number;
  readonly released: number;
  readonly deferred: number;
  readonly review: number;
}

export class ReconcileTBankPaymentsBatchService {
  constructor(
    private readonly repository: TBankReconciliationRepository,
    private readonly provider: TBankOrderLookupProvider,
    private readonly confirmPayment: ConfirmPaymentService,
    private readonly idGenerator: IdGenerator
  ) {}

  async execute(
    input: ReconcileTBankPaymentsBatchInput
  ): Promise<ReconcileTBankPaymentsBatchResult> {
    validateInput(input);
    const claims = await this.repository.claimBatch({
      workerId: input.workerId,
      at: input.at,
      olderThan: new Date(input.at.getTime() - input.initialDelaySeconds * 1_000),
      batchSize: input.batchSize,
      leaseSeconds: input.leaseSeconds
    });
    const totals = { confirmed: 0, released: 0, deferred: 0, review: 0 };

    for (const claim of claims) {
      let lookup: TBankOrderLookupResult;
      try {
        lookup = await this.provider.checkOrder(claim.merchantOrderId);
      } catch {
        lookup = { found: false, errorCode: "NETWORK_ERROR", retryable: true };
      }
      const nextAttemptAt = retryAt(input, claim, input.at);
      if (!lookup.found) {
        if (lookup.retryable) {
          await this.repository.recordRetry({
            claim,
            eventId: this.idGenerator.newId(),
            resultCode: lookup.errorCode,
            responseHash: null,
            observedAt: input.at,
            nextAttemptAt
          });
          totals.deferred += 1;
        } else {
          await this.repository.recordReview({
            claim,
            eventId: this.idGenerator.newId(),
            resultCode: lookup.errorCode,
            responseHash: null,
            paymentCount: 0,
            observedAt: input.at
          });
          totals.review += 1;
        }
        continue;
      }

      if (lookup.payments.length === 0) {
        const outcome = await this.repository.recordEmpty({
          claim,
          eventId: this.idGenerator.newId(),
          responseHash: lookup.responseHash,
          observedAt: input.at,
          nextAttemptAt,
          releaseAfterCount: input.emptyObservationThreshold,
          historyId: this.idGenerator.newId()
        });
        totals[outcome === "released" ? "released" : "deferred"] += 1;
        continue;
      }
      const matching = lookup.payments.filter(
        (payment) => payment.amountKopecks.toString() === claim.amountKopecks
      );
      if (matching.length !== 1 || lookup.payments.length !== 1) {
        await this.repository.recordReview({
          claim,
          eventId: this.idGenerator.newId(),
          resultCode: "PAYMENT_BINDING_MISMATCH",
          responseHash: lookup.responseHash,
          paymentCount: lookup.payments.length,
          observedAt: input.at
        });
        totals.review += 1;
        continue;
      }

      const payment = matching[0];
      if (!payment) {
        throw new Error("T-Bank reconciliation payment selection was lost");
      }
      const eventKey = createHash("sha256")
        .update(`tbank-check-order:v1:${payment.providerPaymentId}:${payment.status}:${lookup.responseHash}`)
        .digest("hex");
      if (
        payment.status === "CONFIRMED"
        && payment.success
        && payment.errorCode === "0"
      ) {
        await this.confirmPayment.execute({
          orderId: claim.orderId,
          idempotencyKey: claim.idempotencyKey,
          source: "tbank",
          amountKopecks: claim.amountKopecks,
          currency: claim.currency,
          confirmedAt: input.at,
          actor: { type: "payment_provider" },
          providerEvidence: {
            origin: "reconciliation",
            paymentAttemptId: claim.paymentAttemptId,
            eventRecordId: this.idGenerator.newId(),
            eventKey,
            providerPaymentId: payment.providerPaymentId,
            merchantOrderId: claim.merchantOrderId,
            providerStatus: "CONFIRMED",
            providerErrorCode: payment.errorCode,
            payloadHash: lookup.responseHash
          }
        });
        totals.confirmed += 1;
        continue;
      }
      if (requiresReview(payment)) {
        await this.repository.recordReview({
          claim,
          eventId: this.idGenerator.newId(),
          resultCode: `UNSAFE_STATUS_${payment.status}`,
          responseHash: lookup.responseHash,
          paymentCount: 1,
          observedAt: input.at
        });
        totals.review += 1;
        continue;
      }

      await this.repository.recordObserved({
        claim,
        eventId: this.idGenerator.newId(),
        eventKey,
        responseHash: lookup.responseHash,
        payment,
        observedAt: input.at,
        nextAttemptAt: isTerminal(payment.status) ? null : nextAttemptAt,
        historyId: this.idGenerator.newId()
      });
      if (isTerminal(payment.status)) {
        totals.released += 1;
      } else {
        totals.deferred += 1;
      }
    }

    return { claimed: claims.length, ...totals };
  }
}

function requiresReview(payment: TBankOrderLookupPayment): boolean {
  return (
    payment.status === "CONFIRMED"
    || [
      "REVERSING",
      "PARTIAL_REVERSED",
      "REFUNDING",
      "PARTIAL_REFUNDED",
      "REFUNDED"
    ].includes(payment.status)
  );
}

function isTerminal(status: TBankWebhookStatus): boolean {
  return [
    "DEADLINE_EXPIRED",
    "CANCELED",
    "AUTH_FAIL",
    "REJECTED",
    "REVERSED"
  ].includes(status);
}

function retryAt(
  input: ReconcileTBankPaymentsBatchInput,
  claim: TBankReconciliationClaim,
  at: Date
): Date {
  const exponent = Math.min(
    Math.max(0, claim.reconciliationAttemptCount - 1),
    20
  );
  const seconds = Math.min(
    input.retryMaxSeconds,
    input.retryBaseSeconds * (2 ** exponent)
  );
  return new Date(at.getTime() + seconds * 1_000);
}

function validateInput(input: ReconcileTBankPaymentsBatchInput): void {
  const bounds: readonly [number, number, number, string][] = [
    [input.batchSize, 1, 100, "batch size"],
    [input.leaseSeconds, 10, 3_600, "lease"],
    [input.initialDelaySeconds, 30, 86_400, "initial delay"],
    [input.retryBaseSeconds, 5, 3_600, "retry base"],
    [input.retryMaxSeconds, input.retryBaseSeconds, 86_400, "retry maximum"],
    [input.emptyObservationThreshold, 2, 10, "empty observation threshold"]
  ];
  if (
    !/^[A-Za-z0-9._:-]{3,200}$/.test(input.workerId)
    || Number.isNaN(input.at.getTime())
    || bounds.some(([value, min, max]) =>
      !Number.isSafeInteger(value) || value < min || value > max)
  ) {
    throw new Error("T-Bank reconciliation configuration is invalid");
  }
}
