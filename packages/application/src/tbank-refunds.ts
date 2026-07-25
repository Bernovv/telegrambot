import { createHash } from "node:crypto";
import type { AdminRequestActor } from "@ticket-platform/contracts";
import type { IdGenerator } from "./identity.js";
import type {
  TBankOrderLookupProvider,
  TBankOrderLookupResult
} from "./tbank-reconciliation.js";
import type {
  TBankWebhookStatus,
  VerifiedTBankWebhook
} from "./tbank-payments.js";

export type TBankRefundStatus =
  | "created"
  | "submitted"
  | "unknown"
  | "review"
  | "failed"
  | "succeeded";

export interface PreparedFullTBankRefund {
  readonly refundRequestId: string;
  readonly orderId: string;
  readonly paymentAttemptId: string;
  readonly providerPaymentId: string;
  readonly merchantOrderId: string;
  readonly externalRequestId: string;
  readonly externalAmountKopecks: string;
  readonly walletAmountKopecks: string;
  readonly currency: string;
  readonly requestHash: string;
  readonly status: TBankRefundStatus;
}

export type PrepareFullTBankRefundResult =
  | { readonly status: "created"; readonly refund: PreparedFullTBankRefund }
  | { readonly status: "existing"; readonly refund: PreparedFullTBankRefund }
  | { readonly status: "not_found" }
  | { readonly status: "unavailable" };

export interface FullTBankRefundProviderResult {
  readonly submitted: boolean;
  readonly providerPaymentId?: string;
  readonly merchantOrderId?: string;
  readonly providerStatus?: TBankWebhookStatus;
  readonly originalAmountKopecks?: bigint;
  readonly remainingAmountKopecks?: bigint;
  readonly responseHash?: string;
  readonly errorCode?: string;
  readonly retryable?: boolean;
  readonly uncertain?: boolean;
}

export interface FullTBankRefundProvider {
  refundFullPayment(input: {
    readonly providerPaymentId: string;
    readonly merchantOrderId: string;
    readonly expectedOriginalAmountKopecks: bigint;
    readonly externalRequestId: string;
  }): Promise<FullTBankRefundProviderResult>;
}

export interface TBankRefundEvidence {
  readonly eventId: string;
  readonly eventKey: string;
  readonly origin: "cancel_response" | "webhook" | "reconciliation";
  readonly providerStatus: TBankWebhookStatus;
  readonly responseHash: string;
  readonly observedAt: Date;
}

export interface TBankRefundRepository {
  prepare(input: {
    readonly refundRequestId: string;
    readonly auditId: string;
    readonly externalRequestId: string;
    readonly orderId: string;
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly reason: string;
    readonly requestedByAdminId: string;
    readonly requestedAt: Date;
  }): Promise<PrepareFullTBankRefundResult>;
  recordProviderResult(input: {
    readonly refund: PreparedFullTBankRefund;
    readonly eventId: string;
    readonly resultStatus: "submitted" | "unknown" | "review" | "failed";
    readonly resultCode: string;
    readonly origin: TBankRefundEvidence["origin"];
    readonly eventKey: string | null;
    readonly providerStatus: TBankWebhookStatus | null;
    readonly responseHash: string | null;
    readonly observedAt: Date;
    readonly nextAttemptAt: Date | null;
    readonly leaseOwner?: string;
  }): Promise<void>;
  finalize(input: {
    readonly refund: PreparedFullTBankRefund;
    readonly evidence: TBankRefundEvidence;
    readonly historyId: string;
    readonly walletTransactionId: string;
    readonly walletEntryId: string;
    readonly auditId: string;
  }): Promise<"completed" | "duplicate">;
  findActive(
    providerPaymentId: string,
    merchantOrderId: string
  ): Promise<PreparedFullTBankRefund | null>;
}

export interface RequestFullTBankRefundCommand {
  readonly orderId: string;
  readonly idempotencyKey: string;
  readonly reason: string;
  readonly actor: AdminRequestActor;
  readonly requestedAt: Date;
}

export interface RequestFullTBankRefundResult {
  readonly refundRequestId: string;
  readonly orderId: string;
  readonly status: TBankRefundStatus;
  readonly externalAmountKopecks: string;
  readonly walletAmountKopecks: string;
  readonly currency: string;
  readonly created: boolean;
}

export class RequestFullTBankRefundService {
  constructor(
    private readonly repository: TBankRefundRepository,
    private readonly provider: FullTBankRefundProvider,
    private readonly idGenerator: IdGenerator,
    private readonly externalRequestIdGenerator: IdGenerator
  ) {}

  async execute(
    command: RequestFullTBankRefundCommand
  ): Promise<RequestFullTBankRefundResult> {
    validateCommand(command);
    const requestHash = hashRequest(command);
    const prepared = await this.repository.prepare({
      refundRequestId: this.idGenerator.newId(),
      auditId: this.idGenerator.newId(),
      externalRequestId: this.externalRequestIdGenerator.newId(),
      orderId: command.orderId,
      idempotencyKey: command.idempotencyKey,
      requestHash,
      reason: command.reason.trim(),
      requestedByAdminId: command.actor.adminId,
      requestedAt: command.requestedAt
    });
    if (prepared.status === "not_found") {
      throw new Error("Refundable order was not found");
    }
    if (prepared.status === "unavailable") {
      throw new Error("Order is not available for a full T-Bank refund");
    }
    if (prepared.refund.requestHash !== requestHash) {
      throw new Error("Refund idempotency key was already used for another request");
    }
    if (prepared.status === "existing") {
      return toResult(prepared.refund, false);
    }

    let providerResult: FullTBankRefundProviderResult;
    try {
      providerResult = await this.provider.refundFullPayment({
        providerPaymentId: prepared.refund.providerPaymentId,
        merchantOrderId: prepared.refund.merchantOrderId,
        expectedOriginalAmountKopecks: BigInt(
          prepared.refund.externalAmountKopecks
        ),
        externalRequestId: prepared.refund.externalRequestId
      });
    } catch {
      providerResult = {
        submitted: false,
        errorCode: "NETWORK_ERROR",
        retryable: true,
        uncertain: true
      };
    }

    if (!providerResult.submitted) {
      const uncertain = providerResult.uncertain === true;
      await this.repository.recordProviderResult({
        refund: prepared.refund,
        eventId: this.idGenerator.newId(),
        resultStatus: uncertain ? "unknown" : "failed",
        resultCode: safeResultCode(providerResult.errorCode ?? "PROVIDER_ERROR"),
        origin: "cancel_response",
        eventKey: null,
        providerStatus: null,
        responseHash: null,
        observedAt: command.requestedAt,
        nextAttemptAt: uncertain
          ? new Date(command.requestedAt.getTime() + 30_000)
          : null
      });
      return toResult(
        { ...prepared.refund, status: uncertain ? "unknown" : "failed" },
        true
      );
    }

    if (!providerResultMatches(prepared.refund, providerResult)) {
      await this.repository.recordProviderResult({
        refund: prepared.refund,
        eventId: this.idGenerator.newId(),
        resultStatus: "review",
        resultCode: "PAYMENT_BINDING_MISMATCH",
        origin: "cancel_response",
        eventKey: null,
        providerStatus: providerResult.providerStatus ?? null,
        responseHash: providerResult.responseHash ?? null,
        observedAt: command.requestedAt,
        nextAttemptAt: null
      });
      return toResult({ ...prepared.refund, status: "review" }, true);
    }

    if (
      providerResult.providerStatus === "REFUNDED"
      && providerResult.remainingAmountKopecks === 0n
      && providerResult.responseHash
    ) {
      await finalizeRefund(
        this.repository,
        prepared.refund,
        {
          eventId: this.idGenerator.newId(),
          eventKey: refundEventKey(
            prepared.refund.providerPaymentId,
            "REFUNDED",
            providerResult.responseHash
          ),
          origin: "cancel_response",
          providerStatus: "REFUNDED",
          responseHash: providerResult.responseHash,
          observedAt: command.requestedAt
        },
        this.idGenerator
      );
      return toResult({ ...prepared.refund, status: "succeeded" }, true);
    }

    const safeIntermediate = providerResult.providerStatus === "REFUNDING";
    await this.repository.recordProviderResult({
      refund: prepared.refund,
      eventId: this.idGenerator.newId(),
      resultStatus: safeIntermediate ? "submitted" : "review",
      resultCode: safeResultCode(
        safeIntermediate
          ? "STATUS:REFUNDING"
          : `UNSAFE_STATUS:${providerResult.providerStatus ?? "UNKNOWN"}`
      ),
      origin: "cancel_response",
      eventKey: providerResult.responseHash
        ? refundEventKey(
            prepared.refund.providerPaymentId,
            providerResult.providerStatus ?? "REFUNDING",
            providerResult.responseHash
          )
        : null,
      providerStatus: providerResult.providerStatus ?? null,
      responseHash: providerResult.responseHash ?? null,
      observedAt: command.requestedAt,
      nextAttemptAt: safeIntermediate
        ? new Date(command.requestedAt.getTime() + 30_000)
        : null
    });
    return toResult(
      {
        ...prepared.refund,
        status: safeIntermediate ? "submitted" : "review"
      },
      true
    );
  }
}

export class HandleTBankRefundWebhookService {
  constructor(
    private readonly repository: TBankRefundRepository,
    private readonly idGenerator: IdGenerator
  ) {}

  async execute(
    event: VerifiedTBankWebhook,
    receivedAt: Date
  ): Promise<boolean> {
    if (!["REFUNDING", "PARTIAL_REFUNDED", "REFUNDED"].includes(event.status)) {
      return false;
    }
    const refund = await this.repository.findActive(
      event.providerPaymentId,
      event.merchantOrderId
    );
    if (!refund) {
      return false;
    }
    const amountMatches =
      event.amountKopecks.toString() === refund.externalAmountKopecks;
    if (
      event.status === "REFUNDED"
      && event.success
      && event.errorCode === "0"
      && amountMatches
    ) {
      await finalizeRefund(
        this.repository,
        refund,
        {
          eventId: this.idGenerator.newId(),
          eventKey: event.eventKey,
          origin: "webhook",
          providerStatus: "REFUNDED",
          responseHash: event.payloadHash,
          observedAt: receivedAt
        },
        this.idGenerator
      );
      return true;
    }

    const pending = event.status === "REFUNDING" && amountMatches;
    await this.repository.recordProviderResult({
      refund,
      eventId: this.idGenerator.newId(),
      resultStatus: pending ? "submitted" : "review",
      resultCode: safeResultCode(
        pending ? "STATUS:REFUNDING" : `UNSAFE_STATUS:${event.status}`
      ),
      origin: "webhook",
      eventKey: event.eventKey,
      providerStatus: event.status,
      responseHash: event.payloadHash,
      observedAt: receivedAt,
      nextAttemptAt: pending ? new Date(receivedAt.getTime() + 30_000) : null
    });
    return true;
  }
}

export interface TBankRefundReconciliationClaim
extends PreparedFullTBankRefund {
  readonly leaseOwner: string;
  readonly attemptCount: number;
}

export interface TBankRefundReconciliationRepository
extends TBankRefundRepository {
  claimReconciliationBatch(input: {
    readonly workerId: string;
    readonly at: Date;
    readonly batchSize: number;
    readonly leaseSeconds: number;
  }): Promise<readonly TBankRefundReconciliationClaim[]>;
}

export class ReconcileTBankRefundsBatchService {
  constructor(
    private readonly repository: TBankRefundReconciliationRepository,
    private readonly provider: TBankOrderLookupProvider,
    private readonly refundProvider: FullTBankRefundProvider,
    private readonly idGenerator: IdGenerator
  ) {}

  async execute(input: {
    readonly workerId: string;
    readonly at: Date;
    readonly batchSize: number;
    readonly leaseSeconds: number;
    readonly retryBaseSeconds: number;
    readonly retryMaxSeconds: number;
  }): Promise<{
    readonly claimed: number;
    readonly completed: number;
    readonly deferred: number;
    readonly review: number;
  }> {
    validateReconciliationInput(input);
    const claims = await this.repository.claimReconciliationBatch(input);
    const totals = { completed: 0, deferred: 0, review: 0 };
    for (const claim of claims) {
      if (claim.status === "unknown") {
        const nextAttemptAt = reconciliationRetryAt(input, claim);
        let result: FullTBankRefundProviderResult;
        try {
          result = await this.refundProvider.refundFullPayment({
            providerPaymentId: claim.providerPaymentId,
            merchantOrderId: claim.merchantOrderId,
            expectedOriginalAmountKopecks: BigInt(claim.externalAmountKopecks),
            externalRequestId: claim.externalRequestId
          });
        } catch {
          result = {
            submitted: false,
            errorCode: "NETWORK_ERROR",
            retryable: true,
            uncertain: true
          };
        }
        if (!result.submitted) {
          const retry = result.uncertain === true || result.retryable === true;
          await this.repository.recordProviderResult({
            refund: claim,
            eventId: this.idGenerator.newId(),
            resultStatus: retry ? "unknown" : "failed",
            resultCode: safeResultCode(result.errorCode ?? "PROVIDER_ERROR"),
            origin: "reconciliation",
            eventKey: null,
            providerStatus: null,
            responseHash: null,
            observedAt: input.at,
            nextAttemptAt: retry ? nextAttemptAt : null,
            leaseOwner: claim.leaseOwner
          });
          totals[retry ? "deferred" : "review"] += 1;
          continue;
        }
        if (!providerResultMatches(claim, result)) {
          await this.repository.recordProviderResult({
            refund: claim,
            eventId: this.idGenerator.newId(),
            resultStatus: "review",
            resultCode: "PAYMENT_BINDING_MISMATCH",
            origin: "reconciliation",
            eventKey: null,
            providerStatus: result.providerStatus ?? null,
            responseHash: result.responseHash ?? null,
            observedAt: input.at,
            nextAttemptAt: null,
            leaseOwner: claim.leaseOwner
          });
          totals.review += 1;
          continue;
        }
        if (
          result.providerStatus === "REFUNDED"
          && result.remainingAmountKopecks === 0n
          && result.responseHash
        ) {
          await finalizeRefund(
            this.repository,
            claim,
            {
              eventId: this.idGenerator.newId(),
              eventKey: refundEventKey(
                claim.providerPaymentId,
                "REFUNDED",
                result.responseHash
              ),
              origin: "reconciliation",
              providerStatus: "REFUNDED",
              responseHash: result.responseHash,
              observedAt: input.at
            },
            this.idGenerator
          );
          totals.completed += 1;
          continue;
        }
        const pending = result.providerStatus === "REFUNDING";
        await this.repository.recordProviderResult({
          refund: claim,
          eventId: this.idGenerator.newId(),
          resultStatus: pending ? "submitted" : "review",
          resultCode: safeResultCode(
            pending
              ? "STATUS:REFUNDING"
              : `UNSAFE_STATUS:${result.providerStatus ?? "UNKNOWN"}`
          ),
          origin: "reconciliation",
          eventKey: result.responseHash
            ? refundEventKey(
                claim.providerPaymentId,
                result.providerStatus ?? "REFUNDING",
                result.responseHash
              )
            : null,
          providerStatus: result.providerStatus ?? null,
          responseHash: result.responseHash ?? null,
          observedAt: input.at,
          nextAttemptAt: pending ? nextAttemptAt : null,
          leaseOwner: claim.leaseOwner
        });
        totals[pending ? "deferred" : "review"] += 1;
        continue;
      }

      let lookup: TBankOrderLookupResult;
      try {
        lookup = await this.provider.checkOrder(claim.merchantOrderId);
      } catch {
        lookup = { found: false, errorCode: "NETWORK_ERROR", retryable: true };
      }
      const nextAttemptAt = reconciliationRetryAt(input, claim);
      if (!lookup.found) {
        await this.repository.recordProviderResult({
          refund: claim,
          eventId: this.idGenerator.newId(),
          resultStatus: lookup.retryable ? "unknown" : "review",
          resultCode: safeResultCode(lookup.errorCode),
          origin: "reconciliation",
          eventKey: null,
          providerStatus: null,
          responseHash: null,
          observedAt: input.at,
          nextAttemptAt: lookup.retryable ? nextAttemptAt : null,
          leaseOwner: claim.leaseOwner
        });
        totals[lookup.retryable ? "deferred" : "review"] += 1;
        continue;
      }
      const matches = lookup.payments.filter(
        (payment) =>
          payment.providerPaymentId === claim.providerPaymentId
          && payment.amountKopecks.toString() === claim.externalAmountKopecks
      );
      const payment = matches.length === 1 && lookup.payments.length === 1
        ? matches[0]
        : undefined;
      if (!payment) {
        await this.repository.recordProviderResult({
          refund: claim,
          eventId: this.idGenerator.newId(),
          resultStatus: "review",
          resultCode: "PAYMENT_BINDING_MISMATCH",
          origin: "reconciliation",
          eventKey: null,
          providerStatus: null,
          responseHash: lookup.responseHash,
          observedAt: input.at,
          nextAttemptAt: null,
          leaseOwner: claim.leaseOwner
        });
        totals.review += 1;
        continue;
      }
      if (
        payment.status === "REFUNDED"
        && payment.success
        && payment.errorCode === "0"
      ) {
        await finalizeRefund(
          this.repository,
          claim,
          {
            eventId: this.idGenerator.newId(),
            eventKey: refundEventKey(
              claim.providerPaymentId,
              "REFUNDED",
              lookup.responseHash
            ),
            origin: "reconciliation",
            providerStatus: "REFUNDED",
            responseHash: lookup.responseHash,
            observedAt: input.at
          },
          this.idGenerator
        );
        totals.completed += 1;
        continue;
      }
      const pending = payment.status === "REFUNDING";
      await this.repository.recordProviderResult({
        refund: claim,
        eventId: this.idGenerator.newId(),
        resultStatus: pending ? "submitted" : "review",
        resultCode: safeResultCode(
          pending ? "STATUS:REFUNDING" : `UNSAFE_STATUS:${payment.status}`
        ),
        origin: "reconciliation",
        eventKey: refundEventKey(
          claim.providerPaymentId,
          payment.status,
          lookup.responseHash
        ),
        providerStatus: payment.status,
        responseHash: lookup.responseHash,
        observedAt: input.at,
        nextAttemptAt: pending ? nextAttemptAt : null,
        leaseOwner: claim.leaseOwner
      });
      totals[pending ? "deferred" : "review"] += 1;
    }
    return { claimed: claims.length, ...totals };
  }
}

async function finalizeRefund(
  repository: TBankRefundRepository,
  refund: PreparedFullTBankRefund,
  evidence: TBankRefundEvidence,
  idGenerator: IdGenerator
): Promise<void> {
  await repository.finalize({
    refund,
    evidence,
    historyId: idGenerator.newId(),
    walletTransactionId: idGenerator.newId(),
    walletEntryId: idGenerator.newId(),
    auditId: idGenerator.newId()
  });
}

function toResult(
  refund: PreparedFullTBankRefund,
  created: boolean
): RequestFullTBankRefundResult {
  return {
    refundRequestId: refund.refundRequestId,
    orderId: refund.orderId,
    status: refund.status,
    externalAmountKopecks: refund.externalAmountKopecks,
    walletAmountKopecks: refund.walletAmountKopecks,
    currency: refund.currency,
    created
  };
}

function providerResultMatches(
  refund: PreparedFullTBankRefund,
  result: FullTBankRefundProviderResult
): boolean {
  return result.providerPaymentId === refund.providerPaymentId
    && result.merchantOrderId === refund.merchantOrderId
    && result.originalAmountKopecks?.toString()
      === refund.externalAmountKopecks;
}

function validateCommand(command: RequestFullTBankRefundCommand): void {
  if (
    !UUID_PATTERN.test(command.orderId)
    || !/^[A-Za-z0-9._:-]{8,200}$/.test(command.idempotencyKey)
    || command.reason.trim().length < 3
    || command.reason.trim().length > 500
    || command.actor.permission !== "payments.refund"
    || !UUID_PATTERN.test(command.actor.adminId)
    || Number.isNaN(command.requestedAt.getTime())
  ) {
    throw new Error("Full T-Bank refund command is invalid");
  }
}

function hashRequest(command: RequestFullTBankRefundCommand): string {
  return createHash("sha256").update(JSON.stringify({
    orderId: command.orderId,
    reason: command.reason.trim(),
    requestedByAdminId: command.actor.adminId
  })).digest("hex");
}

function refundEventKey(
  providerPaymentId: string,
  status: TBankWebhookStatus,
  responseHash: string
): string {
  return createHash("sha256")
    .update(`tbank-refund:v1:${providerPaymentId}:${status}:${responseHash}`)
    .digest("hex");
}

function safeResultCode(value: string): string {
  return /^[A-Z0-9_:-]{1,80}$/.test(value) ? value : "INVALID_RESULT_CODE";
}

function validateReconciliationInput(input: {
  readonly workerId: string;
  readonly at: Date;
  readonly batchSize: number;
  readonly leaseSeconds: number;
  readonly retryBaseSeconds: number;
  readonly retryMaxSeconds: number;
}): void {
  if (
    !/^[A-Za-z0-9._:-]{3,200}$/.test(input.workerId)
    || Number.isNaN(input.at.getTime())
    || !Number.isSafeInteger(input.batchSize)
    || input.batchSize < 1
    || input.batchSize > 100
    || !Number.isSafeInteger(input.leaseSeconds)
    || input.leaseSeconds < 10
    || input.leaseSeconds > 3_600
    || !Number.isSafeInteger(input.retryBaseSeconds)
    || input.retryBaseSeconds < 5
    || input.retryBaseSeconds > 3_600
    || !Number.isSafeInteger(input.retryMaxSeconds)
    || input.retryMaxSeconds < input.retryBaseSeconds
    || input.retryMaxSeconds > 86_400
  ) {
    throw new Error("T-Bank refund reconciliation configuration is invalid");
  }
}

function reconciliationRetryAt(
  input: {
    readonly at: Date;
    readonly retryBaseSeconds: number;
    readonly retryMaxSeconds: number;
  },
  claim: TBankRefundReconciliationClaim
): Date {
  const exponent = Math.min(Math.max(0, claim.attemptCount - 1), 20);
  const seconds = Math.min(
    input.retryMaxSeconds,
    input.retryBaseSeconds * (2 ** exponent)
  );
  return new Date(input.at.getTime() + seconds * 1_000);
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
