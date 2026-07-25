import type {
  PreparedFullTBankRefund,
  PrepareFullTBankRefundResult,
  TBankRefundReconciliationClaim,
  TBankRefundReconciliationRepository
} from "@ticket-platform/application";
import {
  PostgresUnitOfWork,
  TransactionSession,
  type SqlConnectionPool
} from "./postgres.js";

interface RefundRequestRow {
  readonly refund_request_id: string;
  readonly order_id: string;
  readonly payment_attempt_id: string;
  readonly provider_payment_id: string;
  readonly merchant_order_id: string;
  readonly external_request_id: string;
  readonly external_amount_kopecks: string;
  readonly wallet_amount_kopecks: string;
  readonly currency: string;
  readonly request_hash: string;
  readonly status: PreparedFullTBankRefund["status"];
  readonly reconciliation_locked_by?: string;
  readonly reconciliation_attempt_count?: number;
}

interface RefundableOrderRow {
  readonly id: string;
  readonly user_id: string;
  readonly status: string;
  readonly currency: string;
  readonly external_due_kopecks: string;
  readonly wallet_applied_kopecks: string;
  readonly ticket_count: string;
  readonly checked_in_ticket_count: string;
}

interface RefundableAttemptRow {
  readonly id: string;
  readonly status: string;
  readonly provider_payment_id: string | null;
  readonly merchant_order_id: string | null;
  readonly amount_kopecks: string;
  readonly currency: string;
}

interface LockedRefundRow extends RefundRequestRow {
  readonly requested_by_admin_id: string;
  readonly reason: string;
}

interface WalletRefundRow {
  readonly wallet_account_id: string;
  readonly capture_transaction_id: string;
}

export class PostgresTBankRefundRepository
implements TBankRefundReconciliationRepository {
  private readonly unitOfWork: PostgresUnitOfWork;

  constructor(
    private readonly session: TransactionSession,
    pool: SqlConnectionPool
  ) {
    this.unitOfWork = new PostgresUnitOfWork(pool, session);
  }

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
  }): Promise<PrepareFullTBankRefundResult> {
    return this.unitOfWork.transact(async () => {
      await this.session.query(
        "select pg_advisory_xact_lock(hashtextextended($1, 183741))",
        [input.idempotencyKey]
      );
      const existing = await this.findByIdempotencyKey(input.idempotencyKey);
      if (existing) {
        return { status: "existing", refund: existing };
      }

      const orderResult = await this.session.query<RefundableOrderRow>(
        `select
           orders.id,
           orders.user_id,
           orders.status,
           orders.currency,
           orders.external_due_kopecks::text,
           orders.wallet_applied_kopecks::text,
           (
             select count(*)::text
             from public.tickets ticket
             where ticket.order_id = orders.id
           ) as ticket_count,
           (
             select count(*)::text
             from public.tickets ticket
             where ticket.order_id = orders.id
               and ticket.status = 'checked_in'
           ) as checked_in_ticket_count
         from public.orders orders
         where orders.id = $1
         for update`,
        [input.orderId]
      );
      const order = orderResult.rows[0];
      if (!order) {
        return { status: "not_found" };
      }
      if (
        order.status !== "paid"
        || BigInt(order.external_due_kopecks) <= 0n
        || order.currency !== "RUB"
        || BigInt(order.ticket_count) <= 0n
        || BigInt(order.checked_in_ticket_count) > 0n
      ) {
        return { status: "unavailable" };
      }

      const attemptResult = await this.session.query<RefundableAttemptRow>(
        `select
           id,
           status,
           provider_payment_id,
           merchant_order_id,
           amount_kopecks::text,
           currency
         from public.payment_attempts
         where order_id = $1
           and provider = 'tbank'
           and status in ('succeeded', 'partially_refunded', 'refunded')
         order by attempt_number desc
         limit 1
         for update`,
        [order.id]
      );
      const attempt = attemptResult.rows[0];
      if (
        !attempt
        || attempt.status !== "succeeded"
        || !attempt.provider_payment_id
        || !attempt.merchant_order_id
        || attempt.amount_kopecks !== order.external_due_kopecks
        || attempt.currency !== order.currency
      ) {
        return { status: "unavailable" };
      }
      const active = await this.session.query(
        `select id
         from public.payment_refund_requests
         where payment_attempt_id = $1
           and status in ('created', 'submitted', 'unknown', 'review', 'succeeded')
         limit 1
         for update`,
        [attempt.id]
      );
      if (active.rowCount > 0) {
        return { status: "unavailable" };
      }

      await this.session.query(
        `insert into public.payment_refund_requests (
           id, order_id, payment_attempt_id, refund_type, status,
           idempotency_key, request_hash, external_request_id,
           external_amount_kopecks, wallet_amount_kopecks, currency,
           reason, requested_by_admin_id, requested_at,
           reconciliation_next_attempt_at,
           metadata_schema_version, metadata, created_at, updated_at
         ) values (
           $1, $2, $3, 'full', 'created',
           $4, $5, $6,
           $7, $8, $9,
           $10, $11, $12,
           $12,
           1, $13::jsonb, $12, $12
         )`,
        [
          input.refundRequestId,
          order.id,
          attempt.id,
          input.idempotencyKey,
          input.requestHash,
          input.externalRequestId,
          order.external_due_kopecks,
          order.wallet_applied_kopecks,
          order.currency,
          input.reason,
          input.requestedByAdminId,
          input.requestedAt,
          JSON.stringify({ schemaVersion: 1, scope: "full" })
        ]
      );
      await this.session.query(
        `insert into public.audit_log (
           id, actor_admin_id, actor_role, action, target_type, target_id,
           reason, before_masked, after_masked, request_id, created_at
         ) values (
           $1, $2, 'financial_admin', 'payment.full_refund_requested',
           'payment_refund_request', $3,
           $4, $5::jsonb, $6::jsonb, $7, $8
         )`,
        [
          input.auditId,
          input.requestedByAdminId,
          input.refundRequestId,
          input.reason,
          JSON.stringify({ orderStatus: order.status }),
          JSON.stringify({
            refundStatus: "created",
            orderId: order.id,
            paymentAttemptId: attempt.id,
            externalAmountKopecks: order.external_due_kopecks,
            walletAmountKopecks: order.wallet_applied_kopecks,
            currency: order.currency
          }),
          input.idempotencyKey,
          input.requestedAt
        ]
      );

      return {
        status: "created",
        refund: {
          refundRequestId: input.refundRequestId,
          orderId: order.id,
          paymentAttemptId: attempt.id,
          providerPaymentId: attempt.provider_payment_id,
          merchantOrderId: attempt.merchant_order_id,
          externalRequestId: input.externalRequestId,
          externalAmountKopecks: order.external_due_kopecks,
          walletAmountKopecks: order.wallet_applied_kopecks,
          currency: order.currency,
          requestHash: input.requestHash,
          status: "created"
        }
      };
    });
  }

  recordProviderResult(input: Parameters<
    TBankRefundReconciliationRepository["recordProviderResult"]
  >[0]): Promise<void> {
    return this.unitOfWork.transact(async () => {
      const inserted = await this.session.query(
        `insert into public.payment_refund_events (
           id, refund_request_id, origin, event_type, event_key,
           result_code, provider_status, response_hash, observed_at,
           metadata_schema_version, metadata
         ) values (
           $1, $2, $3, 'provider_result', $4,
           $5, $6, $7, $8,
           1, '{}'::jsonb
         )
         on conflict (event_key) where event_key is not null do nothing`,
        [
          input.eventId,
          input.refund.refundRequestId,
          input.origin,
          input.eventKey,
          safeResultCode(input.resultCode),
          input.providerStatus,
          input.responseHash,
          input.observedAt
        ]
      );
      if (input.eventKey && inserted.rowCount === 0) {
        return;
      }
      const updated = await this.session.query(
        `update public.payment_refund_requests
         set status = $2,
             provider_status = $3,
             last_result_code = $4,
             response_hash = coalesce($5, response_hash),
             reconciliation_next_attempt_at = $6,
             reconciliation_locked_by = null,
             reconciliation_locked_until = null,
             updated_at = $7
         where id = $1
           and status in ('created', 'submitted', 'unknown', 'review')
           and (
             $8::text is null
             or reconciliation_locked_by = $8
           )`,
        [
          input.refund.refundRequestId,
          input.resultStatus,
          input.providerStatus,
          safeResultCode(input.resultCode),
          input.responseHash,
          input.nextAttemptAt,
          input.observedAt,
          input.leaseOwner ?? null
        ]
      );
      if (updated.rowCount !== 1) {
        throw new Error(
          `T-Bank refund state or lease was lost: ${input.refund.refundRequestId}`
        );
      }
    });
  }

  finalize(input: Parameters<
    TBankRefundReconciliationRepository["finalize"]
  >[0]): Promise<"completed" | "duplicate"> {
    return this.unitOfWork.transact(async () => {
      const lockedResult = await this.session.query<LockedRefundRow>(
        `${REFUND_SELECT}
         where refund.id = $1
         for update`,
        [input.refund.refundRequestId]
      );
      const locked = lockedResult.rows[0];
      if (!locked) {
        throw new Error(`T-Bank refund request was not found: ${input.refund.refundRequestId}`);
      }
      if (locked.status === "succeeded") {
        return "duplicate";
      }
      assertRefundBinding(locked, input.refund);
      if (
        input.evidence.providerStatus !== "REFUNDED"
        || !/^[a-f0-9]{64}$/.test(input.evidence.responseHash)
      ) {
        throw new Error("T-Bank full refund evidence is invalid");
      }

      const orderResult = await this.session.query<RefundableOrderRow>(
        `select
           orders.id,
           orders.user_id,
           orders.status,
           orders.currency,
           orders.external_due_kopecks::text,
           orders.wallet_applied_kopecks::text,
           (
             select count(*)::text
             from public.tickets ticket
             where ticket.order_id = orders.id
           ) as ticket_count,
           (
             select count(*)::text
             from public.tickets ticket
             where ticket.order_id = orders.id
               and ticket.status = 'checked_in'
           ) as checked_in_ticket_count
         from public.orders orders
         where orders.id = $1
         for update`,
        [locked.order_id]
      );
      const order = orderResult.rows[0];
      if (
        !order
        || order.status !== "paid"
        || order.external_due_kopecks !== locked.external_amount_kopecks
        || order.wallet_applied_kopecks !== locked.wallet_amount_kopecks
        || order.currency !== locked.currency
        || BigInt(order.ticket_count) <= 0n
        || BigInt(order.checked_in_ticket_count) > 0n
      ) {
        throw new Error(`Order requires refund reconciliation: ${locked.order_id}`);
      }
      const attemptResult = await this.session.query<RefundableAttemptRow>(
        `select
           id,
           status,
           provider_payment_id,
           merchant_order_id,
           amount_kopecks::text,
           currency
         from public.payment_attempts
         where id = $1
         for update`,
        [locked.payment_attempt_id]
      );
      const attempt = attemptResult.rows[0];
      if (
        !attempt
        || attempt.status !== "succeeded"
        || attempt.provider_payment_id !== locked.provider_payment_id
        || attempt.merchant_order_id !== locked.merchant_order_id
        || attempt.amount_kopecks !== locked.external_amount_kopecks
        || attempt.currency !== locked.currency
      ) {
        throw new Error(
          `Payment attempt requires refund reconciliation: ${locked.payment_attempt_id}`
        );
      }

      await this.session.query(
        `insert into public.payment_refund_events (
           id, refund_request_id, origin, event_type, event_key,
           result_code, provider_status, response_hash, observed_at,
           metadata_schema_version, metadata
         ) values (
           $1, $2, $3, 'finalized', $4,
           'FULL_REFUND_COMPLETED', 'REFUNDED', $5, $6,
           1, '{}'::jsonb
         )
         on conflict (event_key) where event_key is not null do nothing`,
        [
          input.evidence.eventId,
          locked.refund_request_id,
          input.evidence.origin,
          input.evidence.eventKey,
          input.evidence.responseHash,
          input.evidence.observedAt
        ]
      );
      const refundUpdated = await this.session.query(
        `update public.payment_refund_requests
         set status = 'succeeded',
             provider_status = 'REFUNDED',
             last_result_code = 'FULL_REFUND_COMPLETED',
             response_hash = $2,
             completed_at = $3,
             reconciliation_next_attempt_at = null,
             reconciliation_locked_by = null,
             reconciliation_locked_until = null,
             updated_at = $3
         where id = $1`,
        [
          locked.refund_request_id,
          input.evidence.responseHash,
          input.evidence.observedAt
        ]
      );
      if (refundUpdated.rowCount !== 1) {
        throw new Error(`T-Bank refund request update failed: ${locked.refund_request_id}`);
      }
      const attemptUpdated = await this.session.query(
        `update public.payment_attempts
         set status = 'refunded',
             provider_status = 'REFUNDED',
             updated_at = $2
         where id = $1
           and status = 'succeeded'`,
        [locked.payment_attempt_id, input.evidence.observedAt]
      );
      if (attemptUpdated.rowCount !== 1) {
        throw new Error(`Payment attempt refund failed: ${locked.payment_attempt_id}`);
      }
      const orderUpdated = await this.session.query(
        `update public.orders
         set status = 'refunded',
             lock_version = lock_version + 1,
             updated_at = $2
         where id = $1
           and status = 'paid'`,
        [locked.order_id, input.evidence.observedAt]
      );
      if (orderUpdated.rowCount !== 1) {
        throw new Error(`Order refund failed: ${locked.order_id}`);
      }
      const ticketsUpdated = await this.session.query(
        `update public.tickets
         set status = 'refunded',
             revoked_at = $2
         where order_id = $1
           and status = 'issued'`,
        [locked.order_id, input.evidence.observedAt]
      );
      if (ticketsUpdated.rowCount !== Number(order.ticket_count)) {
        throw new Error(`Ticket refund set changed: ${locked.order_id}`);
      }

      await this.refundWallet(
        locked,
        order,
        input.walletTransactionId,
        input.walletEntryId,
        input.evidence.observedAt
      );
      await this.session.query(
        `insert into public.order_status_history (
           id, order_id, from_status, to_status, reason, actor_type,
           actor_admin_id, idempotency_key, occurred_at,
           metadata_schema_version, metadata
         ) values (
           $1, $2, 'paid', 'refunded', 'tbank_full_refund', 'admin',
           $3, $4, $5,
           1, $6::jsonb
         )`,
        [
          input.historyId,
          locked.order_id,
          locked.requested_by_admin_id,
          `tbank_full_refund:${locked.refund_request_id}`,
          input.evidence.observedAt,
          JSON.stringify({
            schemaVersion: 1,
            refundRequestId: locked.refund_request_id,
            paymentAttemptId: locked.payment_attempt_id,
            externalAmountKopecks: locked.external_amount_kopecks,
            walletAmountKopecks: locked.wallet_amount_kopecks
          })
        ]
      );
      await this.session.query(
        `insert into public.audit_log (
           id, actor_admin_id, actor_role, action, target_type, target_id,
           reason, before_masked, after_masked, request_id, created_at
         ) values (
           $1, $2, 'financial_admin', 'payment.full_refund_completed',
           'payment_refund_request', $3,
           $4, $5::jsonb, $6::jsonb, $7, $8
         )`,
        [
          input.auditId,
          locked.requested_by_admin_id,
          locked.refund_request_id,
          locked.reason,
          JSON.stringify({ orderStatus: "paid", refundStatus: locked.status }),
          JSON.stringify({
            orderStatus: "refunded",
            refundStatus: "succeeded",
            externalAmountKopecks: locked.external_amount_kopecks,
            walletAmountKopecks: locked.wallet_amount_kopecks,
            currency: locked.currency
          }),
          `refund-complete:${locked.refund_request_id}`,
          input.evidence.observedAt
        ]
      );
      return "completed";
    });
  }

  findActive(
    providerPaymentId: string,
    merchantOrderId: string
  ): Promise<PreparedFullTBankRefund | null> {
    return this.unitOfWork.transact(async () => {
      const result = await this.session.query<RefundRequestRow>(
        `${REFUND_SELECT}
         where attempt.provider_payment_id = $1
           and attempt.merchant_order_id = $2
           and refund.status in ('created', 'submitted', 'unknown', 'review', 'succeeded')
         order by refund.requested_at desc
         limit 1`,
        [providerPaymentId, merchantOrderId]
      );
      const row = result.rows[0];
      return row ? mapRefund(row) : null;
    });
  }

  claimReconciliationBatch(input: {
    readonly workerId: string;
    readonly at: Date;
    readonly batchSize: number;
    readonly leaseSeconds: number;
  }): Promise<readonly TBankRefundReconciliationClaim[]> {
    return this.unitOfWork.transact(async () => {
      const result = await this.session.query<RefundRequestRow>(
        `with candidates as (
           select refund.id
           from public.payment_refund_requests refund
           where refund.status in ('submitted', 'unknown')
             and (
               refund.reconciliation_next_attempt_at is null
               or refund.reconciliation_next_attempt_at <= $2
             )
             and (
               refund.reconciliation_locked_until is null
               or refund.reconciliation_locked_until < $2
             )
           order by
             refund.reconciliation_next_attempt_at nulls first,
             refund.requested_at,
             refund.id
           limit $3
           for update of refund skip locked
         )
         update public.payment_refund_requests refund
         set reconciliation_attempt_count = reconciliation_attempt_count + 1,
             reconciliation_locked_by = $1,
             reconciliation_locked_until = $2 + ($4 * interval '1 second'),
             updated_at = $2
         from candidates,
              public.payment_attempts attempt
         where refund.id = candidates.id
           and attempt.id = refund.payment_attempt_id
         returning
           refund.id as refund_request_id,
           refund.order_id,
           refund.payment_attempt_id,
           attempt.provider_payment_id,
           attempt.merchant_order_id,
           refund.external_request_id::text,
           refund.external_amount_kopecks::text,
           refund.wallet_amount_kopecks::text,
           refund.currency,
           refund.request_hash,
           refund.status,
           refund.reconciliation_locked_by,
           refund.reconciliation_attempt_count`,
        [input.workerId, input.at, input.batchSize, input.leaseSeconds]
      );
      return result.rows.map((row) => ({
        ...mapRefund(row),
        leaseOwner: row.reconciliation_locked_by ?? input.workerId,
        attemptCount: row.reconciliation_attempt_count ?? 0
      }));
    });
  }

  private async findByIdempotencyKey(
    idempotencyKey: string
  ): Promise<PreparedFullTBankRefund | null> {
    const result = await this.session.query<RefundRequestRow>(
      `${REFUND_SELECT}
       where refund.idempotency_key = $1
       limit 1`,
      [idempotencyKey]
    );
    const row = result.rows[0];
    return row ? mapRefund(row) : null;
  }

  private async refundWallet(
    refund: LockedRefundRow,
    order: RefundableOrderRow,
    transactionId: string,
    entryId: string,
    refundedAt: Date
  ): Promise<void> {
    if (BigInt(refund.wallet_amount_kopecks) === 0n) {
      return;
    }
    const walletResult = await this.session.query<WalletRefundRow>(
      `select
         account.id as wallet_account_id,
         capture.id as capture_transaction_id
       from public.wallet_accounts account
       join public.wallet_transactions capture
         on capture.wallet_account_id = account.id
        and capture.transaction_type = 'ORDER_CAPTURE'
        and capture.status = 'posted'
        and capture.reference_type = 'order'
        and capture.reference_id = $1
       where account.user_id = $2
         and account.currency = $3
       for update of account`,
      [order.id, order.user_id, order.currency]
    );
    const wallet = walletResult.rows[0];
    if (!wallet) {
      throw new Error(`Wallet capture requires refund reconciliation: ${order.id}`);
    }
    await this.session.query(
      `insert into public.wallet_transactions (
         id, wallet_account_id, transaction_type, status, idempotency_key,
         reference_type, reference_id, actor_type, actor_id, reason,
         reversal_of_transaction_id, metadata, created_at, posted_at
       ) values (
         $1, $2, 'REFUND_CREDIT', 'posted', $3,
         'refund', $4, 'admin', $5, $6,
         $7, $8::jsonb, $9, $9
       )`,
      [
        transactionId,
        wallet.wallet_account_id,
        `refund_credit:${refund.refund_request_id}`,
        refund.refund_request_id,
        refund.requested_by_admin_id,
        refund.reason,
        wallet.capture_transaction_id,
        JSON.stringify({
          schemaVersion: 1,
          orderId: order.id,
          paymentAttemptId: refund.payment_attempt_id
        }),
        refundedAt
      ]
    );
    await this.session.query(
      `insert into public.wallet_entries (
         id, wallet_account_id, wallet_transaction_id, direction,
         amount_kopecks, bucket, source_entry_id, effective_at, created_at
       ) values (
         $1, $2, $3, 'credit',
         $4, 'refund', null, $5, $5
       )`,
      [
        entryId,
        wallet.wallet_account_id,
        transactionId,
        refund.wallet_amount_kopecks,
        refundedAt
      ]
    );
    const updated = await this.session.query(
      `update public.wallet_accounts
       set cached_available_kopecks = cached_available_kopecks + $2,
           balance_version = balance_version + 1,
           updated_at = $3
       where id = $1`,
      [
        wallet.wallet_account_id,
        refund.wallet_amount_kopecks,
        refundedAt
      ]
    );
    if (updated.rowCount !== 1) {
      throw new Error(`Wallet account refund failed: ${wallet.wallet_account_id}`);
    }
  }
}

export function createTBankRefundPersistence(
  pool: SqlConnectionPool
): TBankRefundReconciliationRepository {
  const session = new TransactionSession();
  return new PostgresTBankRefundRepository(session, pool);
}

function mapRefund(row: RefundRequestRow): PreparedFullTBankRefund {
  return {
    refundRequestId: row.refund_request_id,
    orderId: row.order_id,
    paymentAttemptId: row.payment_attempt_id,
    providerPaymentId: row.provider_payment_id,
    merchantOrderId: row.merchant_order_id,
    externalRequestId: row.external_request_id,
    externalAmountKopecks: row.external_amount_kopecks,
    walletAmountKopecks: row.wallet_amount_kopecks,
    currency: row.currency,
    requestHash: row.request_hash,
    status: row.status
  };
}

function assertRefundBinding(
  stored: RefundRequestRow,
  supplied: PreparedFullTBankRefund
): void {
  const expected = mapRefund(stored);
  if (
    expected.refundRequestId !== supplied.refundRequestId
    || expected.orderId !== supplied.orderId
    || expected.paymentAttemptId !== supplied.paymentAttemptId
    || expected.providerPaymentId !== supplied.providerPaymentId
    || expected.merchantOrderId !== supplied.merchantOrderId
    || expected.externalRequestId !== supplied.externalRequestId
    || expected.externalAmountKopecks !== supplied.externalAmountKopecks
    || expected.walletAmountKopecks !== supplied.walletAmountKopecks
    || expected.currency !== supplied.currency
    || expected.requestHash !== supplied.requestHash
  ) {
    throw new Error(`T-Bank refund binding mismatch: ${supplied.refundRequestId}`);
  }
}

function safeResultCode(value: string): string {
  return /^[A-Z0-9_:-]{1,80}$/.test(value) ? value : "INVALID_RESULT_CODE";
}

const REFUND_SELECT = `select
  refund.id as refund_request_id,
  refund.order_id,
  refund.payment_attempt_id,
  attempt.provider_payment_id,
  attempt.merchant_order_id,
  refund.external_request_id::text,
  refund.external_amount_kopecks::text,
  refund.wallet_amount_kopecks::text,
  refund.currency,
  refund.request_hash,
  refund.status,
  refund.requested_by_admin_id,
  refund.reason
from public.payment_refund_requests refund
join public.payment_attempts attempt on attempt.id = refund.payment_attempt_id`;
