import type {
  TBankOrderLookupPayment,
  TBankReconciliationClaim,
  TBankReconciliationRepository
} from "@ticket-platform/application";
import {
  PostgresUnitOfWork,
  TransactionSession,
  type SqlConnectionPool
} from "./postgres.js";

interface ReconciliationClaimRow {
  readonly payment_attempt_id: string;
  readonly order_id: string;
  readonly idempotency_key: string;
  readonly merchant_order_id: string;
  readonly amount_kopecks: string;
  readonly currency: string;
  readonly reconciliation_attempt_count: number;
  readonly reconciliation_empty_count: number;
  readonly reconciliation_locked_by: string;
}

interface UpdatedAttemptRow {
  readonly order_id: string;
  readonly reconciliation_empty_count: number;
}

export class PostgresTBankReconciliationRepository
implements TBankReconciliationRepository {
  private readonly unitOfWork: PostgresUnitOfWork;

  constructor(
    private readonly session: TransactionSession,
    pool: SqlConnectionPool
  ) {
    this.unitOfWork = new PostgresUnitOfWork(pool, session);
  }

  claimBatch(input: {
    readonly workerId: string;
    readonly at: Date;
    readonly olderThan: Date;
    readonly batchSize: number;
    readonly leaseSeconds: number;
  }): Promise<readonly TBankReconciliationClaim[]> {
    return this.unitOfWork.transact(async () => {
      const result = await this.session.query<ReconciliationClaimRow>(
        `with candidates as (
           select attempt.id
           from public.payment_attempts attempt
           join public.orders orders on orders.id = attempt.order_id
           where attempt.provider = 'tbank'
             and (
               attempt.status in ('creating', 'unknown', 'authorized')
               or (attempt.status = 'pending' and attempt.payment_url is null)
             )
             and orders.status = 'payment_processing'
             and attempt.created_at <= $3
             and (
               attempt.reconciliation_next_attempt_at is null
               or attempt.reconciliation_next_attempt_at <= $2
             )
             and (
               attempt.reconciliation_locked_until is null
               or attempt.reconciliation_locked_until < $2
             )
             and (
               attempt.reconciliation_last_result is null
               or attempt.reconciliation_last_result not like 'REVIEW:%'
             )
           order by
             attempt.reconciliation_next_attempt_at nulls first,
             attempt.created_at,
             attempt.id
           limit $4
           for update of attempt skip locked
         )
         update public.payment_attempts attempt
         set reconciliation_attempt_count = reconciliation_attempt_count + 1,
             reconciliation_last_attempt_at = $2,
             reconciliation_locked_by = $1,
             reconciliation_locked_until = $2 + ($5 * interval '1 second'),
             updated_at = $2
         from candidates
         where attempt.id = candidates.id
         returning
           attempt.id as payment_attempt_id,
           attempt.order_id,
           attempt.idempotency_key,
           attempt.merchant_order_id,
           attempt.amount_kopecks::text,
           attempt.currency,
           attempt.reconciliation_attempt_count,
           attempt.reconciliation_empty_count,
           attempt.reconciliation_locked_by`,
        [
          input.workerId,
          input.at,
          input.olderThan,
          input.batchSize,
          input.leaseSeconds
        ]
      );

      return result.rows.map((row) => ({
        paymentAttemptId: row.payment_attempt_id,
        orderId: row.order_id,
        idempotencyKey: row.idempotency_key,
        merchantOrderId: row.merchant_order_id,
        amountKopecks: row.amount_kopecks,
        currency: row.currency,
        reconciliationAttemptCount: row.reconciliation_attempt_count,
        emptyObservationCount: row.reconciliation_empty_count,
        leaseOwner: row.reconciliation_locked_by
      }));
    });
  }

  recordRetry(input: {
    readonly claim: TBankReconciliationClaim;
    readonly eventId: string;
    readonly resultCode: string;
    readonly responseHash: string | null;
    readonly observedAt: Date;
    readonly nextAttemptAt: Date;
  }): Promise<void> {
    return this.unitOfWork.transact(async () => {
      await this.insertEvent({
        ...input,
        eventType: "retry",
        paymentCount: 0,
        payment: null,
        eventKey: null
      });
      await this.releaseLease(
        input.claim,
        input.observedAt,
        input.nextAttemptAt,
        safeResultCode(input.resultCode)
      );
    });
  }

  recordEmpty(input: {
    readonly claim: TBankReconciliationClaim;
    readonly eventId: string;
    readonly responseHash: string;
    readonly observedAt: Date;
    readonly nextAttemptAt: Date;
    readonly releaseAfterCount: number;
    readonly historyId: string;
  }): Promise<"retry" | "released"> {
    return this.unitOfWork.transact(async () => {
      await this.insertEvent({
        ...input,
        eventType: "empty",
        resultCode: "EMPTY",
        paymentCount: 0,
        payment: null,
        eventKey: null
      });
      const updated = await this.session.query<UpdatedAttemptRow>(
        `update public.payment_attempts
         set reconciliation_empty_count = reconciliation_empty_count + 1,
             reconciliation_last_result = 'EMPTY',
             reconciliation_next_attempt_at = case
               when reconciliation_empty_count + 1 >= $4 then null
               else $3
             end,
             reconciliation_locked_by = null,
             reconciliation_locked_until = null,
             status = case
               when reconciliation_empty_count + 1 >= $4 then 'failed'
               else status
             end,
             updated_at = $2
         where id = $1
           and provider = 'tbank'
           and reconciliation_locked_by = $5
         returning order_id, reconciliation_empty_count`,
        [
          input.claim.paymentAttemptId,
          input.observedAt,
          input.nextAttemptAt,
          input.releaseAfterCount,
          input.claim.leaseOwner
        ]
      );
      const row = updated.rows[0];
      if (!row) {
        throw leaseLost(input.claim.paymentAttemptId);
      }
      if (row.reconciliation_empty_count < input.releaseAfterCount) {
        return "retry";
      }

      await this.returnOrderToPayment({
        orderId: row.order_id,
        paymentAttemptId: input.claim.paymentAttemptId,
        historyId: input.historyId,
        occurredAt: input.observedAt,
        reason: "tbank_reconciliation_empty"
      });
      return "released";
    });
  }

  recordReview(input: {
    readonly claim: TBankReconciliationClaim;
    readonly eventId: string;
    readonly resultCode: string;
    readonly responseHash: string | null;
    readonly paymentCount: number;
    readonly observedAt: Date;
  }): Promise<void> {
    return this.unitOfWork.transact(async () => {
      const resultCode = safeResultCode(input.resultCode);
      await this.insertEvent({
        ...input,
        resultCode,
        eventType: "review",
        payment: null,
        eventKey: null
      });
      await this.releaseLease(
        input.claim,
        input.observedAt,
        null,
        safeResultCode(`REVIEW:${resultCode}`)
      );
    });
  }

  recordObserved(input: {
    readonly claim: TBankReconciliationClaim;
    readonly eventId: string;
    readonly eventKey: string;
    readonly responseHash: string;
    readonly payment: TBankOrderLookupPayment;
    readonly observedAt: Date;
    readonly nextAttemptAt: Date | null;
    readonly historyId: string;
  }): Promise<void> {
    return this.unitOfWork.transact(async () => {
      await this.insertEvent({
        ...input,
        eventType: "observed",
        resultCode: safeResultCode(`STATUS:${input.payment.status}`),
        paymentCount: 1
      });
      const terminal = isTerminal(input.payment.status);
      const internalStatus = terminal
        ? terminalAttemptStatus(input.payment.status)
        : input.payment.status === "AUTHORIZED"
          ? "authorized"
          : "unknown";
      const updated = await this.session.query<UpdatedAttemptRow>(
        `update public.payment_attempts
         set provider_payment_id = coalesce(provider_payment_id, $3),
             provider_status = $4,
             status = $5,
             reconciliation_empty_count = 0,
             reconciliation_last_result = $6,
             reconciliation_next_attempt_at = $7,
             reconciliation_locked_by = null,
             reconciliation_locked_until = null,
             updated_at = $2
         where id = $1
           and provider = 'tbank'
           and reconciliation_locked_by = $8
           and (
             provider_payment_id is null
             or provider_payment_id = $3
           )
         returning order_id, reconciliation_empty_count`,
        [
          input.claim.paymentAttemptId,
          input.observedAt,
          input.payment.providerPaymentId,
          input.payment.status,
          internalStatus,
          safeResultCode(`STATUS:${input.payment.status}`),
          input.nextAttemptAt,
          input.claim.leaseOwner
        ]
      );
      const row = updated.rows[0];
      if (!row) {
        throw leaseLost(input.claim.paymentAttemptId);
      }
      if (terminal) {
        await this.returnOrderToPayment({
          orderId: row.order_id,
          paymentAttemptId: input.claim.paymentAttemptId,
          historyId: input.historyId,
          occurredAt: input.observedAt,
          reason: "tbank_reconciliation_terminal"
        });
      }
    });
  }

  private async releaseLease(
    claim: TBankReconciliationClaim,
    at: Date,
    nextAttemptAt: Date | null,
    resultCode: string
  ): Promise<void> {
    const updated = await this.session.query(
      `update public.payment_attempts
       set reconciliation_last_result = $3,
           reconciliation_next_attempt_at = $4,
           reconciliation_locked_by = null,
           reconciliation_locked_until = null,
           updated_at = $2
       where id = $1
         and provider = 'tbank'
         and reconciliation_locked_by = $5`,
      [
        claim.paymentAttemptId,
        at,
        resultCode,
        nextAttemptAt,
        claim.leaseOwner
      ]
    );
    if (updated.rowCount !== 1) {
      throw leaseLost(claim.paymentAttemptId);
    }
  }

  private async insertEvent(input: {
    readonly claim: TBankReconciliationClaim;
    readonly eventId: string;
    readonly eventType: "retry" | "empty" | "observed" | "review";
    readonly resultCode: string;
    readonly responseHash: string | null;
    readonly paymentCount: number;
    readonly payment: TBankOrderLookupPayment | null;
    readonly eventKey: string | null;
    readonly observedAt: Date;
  }): Promise<void> {
    await this.session.query(
      `insert into public.payment_reconciliation_events (
         id, payment_attempt_id, event_type, result_code, response_hash,
         payment_count, provider_payment_id, provider_status, observed_at,
         metadata_schema_version, metadata
       ) values (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9,
         1, $10::jsonb
       )`,
      [
        input.eventId,
        input.claim.paymentAttemptId,
        input.eventType,
        safeResultCode(input.resultCode),
        input.responseHash,
        input.paymentCount,
        input.payment?.providerPaymentId ?? null,
        input.payment?.status ?? null,
        input.observedAt,
        JSON.stringify({
          schemaVersion: 1,
          eventKey: input.eventKey,
          success: input.payment?.success ?? null,
          errorCode: input.payment?.errorCode ?? null
        })
      ]
    );
  }

  private async returnOrderToPayment(input: {
    readonly orderId: string;
    readonly paymentAttemptId: string;
    readonly historyId: string;
    readonly occurredAt: Date;
    readonly reason: "tbank_reconciliation_empty" | "tbank_reconciliation_terminal";
  }): Promise<void> {
    const updated = await this.session.query(
      `update public.orders
       set status = 'awaiting_payment',
           lock_version = lock_version + 1,
           updated_at = $2
       where id = $1
         and status = 'payment_processing'`,
      [input.orderId, input.occurredAt]
    );
    if (updated.rowCount !== 1) {
      throw new Error(`T-Bank reconciliation lost the processing order: ${input.orderId}`);
    }
    await this.session.query(
      `insert into public.order_status_history (
         id, order_id, from_status, to_status, reason, actor_type,
         idempotency_key, occurred_at, metadata_schema_version, metadata
       ) values (
         $1, $2, 'payment_processing', 'awaiting_payment', $3, 'system',
         $4, $5, 1, $6::jsonb
       )`,
      [
        input.historyId,
        input.orderId,
        input.reason,
        `${input.reason}:${input.paymentAttemptId}`,
        input.occurredAt,
        JSON.stringify({
          schemaVersion: 1,
          paymentAttemptId: input.paymentAttemptId
        })
      ]
    );
  }
}

export function createTBankReconciliationPersistence(
  pool: SqlConnectionPool
): TBankReconciliationRepository {
  const session = new TransactionSession();
  return new PostgresTBankReconciliationRepository(session, pool);
}

function safeResultCode(value: string): string {
  return /^[A-Z0-9_:-]{1,80}$/.test(value) ? value : "INVALID_RESULT_CODE";
}

function isTerminal(status: TBankOrderLookupPayment["status"]): boolean {
  return [
    "DEADLINE_EXPIRED",
    "CANCELED",
    "AUTH_FAIL",
    "REJECTED",
    "REVERSED"
  ].includes(status);
}

function terminalAttemptStatus(
  status: TBankOrderLookupPayment["status"]
): "failed" | "cancelled" {
  return ["DEADLINE_EXPIRED", "CANCELED", "REVERSED"].includes(status)
    ? "cancelled"
    : "failed";
}

function leaseLost(paymentAttemptId: string): Error {
  return new Error(`T-Bank reconciliation lease was lost: ${paymentAttemptId}`);
}
