import type { MessengerChannel } from "@ticket-platform/domain";
import type {
  IdGenerator,
  PreparedTBankPaymentAttempt,
  PrepareTBankPaymentResult,
  RecordTBankStatusEvent,
  TBankPaymentInitializationRepository,
  TBankWebhookPaymentAttempt,
  TBankWebhookRepository
} from "@ticket-platform/application";
import {
  PostgresUnitOfWork,
  TransactionSession,
  type SqlConnectionPool
} from "./postgres.js";

interface PaymentOrderRow {
  readonly id: string;
  readonly number: string;
  readonly status: string;
  readonly currency: string;
  readonly external_due_kopecks: string;
  readonly offer_accepted_at: Date | null;
  readonly expires_at: Date;
  readonly item_count: string;
  readonly active_reservation_count: string;
  readonly unexpired_reservation_count: string;
}

interface PaymentAttemptRow {
  readonly id: string;
  readonly order_id: string;
  readonly attempt_number: number;
  readonly status: string;
  readonly amount_kopecks: string;
  readonly currency: string;
  readonly idempotency_key: string;
  readonly merchant_order_id: string;
  readonly provider_payment_id: string | null;
  readonly payment_url: string | null;
}

interface InsertedEventRow {
  readonly id: string;
}

interface AttemptOrderRow {
  readonly order_id: string;
}

export class PostgresTBankPaymentInitializationRepository
implements TBankPaymentInitializationRepository {
  private readonly unitOfWork: PostgresUnitOfWork;

  constructor(
    private readonly session: TransactionSession,
    pool: SqlConnectionPool,
    private readonly idGenerator: IdGenerator
  ) {
    this.unitOfWork = new PostgresUnitOfWork(pool, session);
  }

  prepare(input: {
    readonly publicOrderTokenHash: string;
    readonly channel: MessengerChannel;
    readonly senderExternalUserId: string;
    readonly requestedAt: Date;
  }): Promise<PrepareTBankPaymentResult> {
    return this.unitOfWork.transact(async () => {
      const orderResult = await this.session.query<PaymentOrderRow>(
        `select
           orders.id,
           orders.number,
           orders.status,
           orders.currency,
           orders.external_due_kopecks::text,
           orders.offer_accepted_at,
           orders.expires_at,
           (
             select count(*)::text
             from public.order_items item
             where item.order_id = orders.id
           ) as item_count,
           (
             select count(*)::text
             from public.inventory_reservations reservation
             where reservation.order_id = orders.id
               and reservation.status = 'active'
           ) as active_reservation_count,
           (
             select count(*)::text
             from public.inventory_reservations reservation
             where reservation.order_id = orders.id
               and reservation.status = 'active'
               and reservation.expires_at > $3
           ) as unexpired_reservation_count
         from public.orders orders
         join public.messenger_identities identity
           on identity.user_id = orders.user_id
          and identity.channel = $4::text
          and identity.external_user_id = $2
         where orders.public_token_hash = $1
         for update of orders`,
        [
          input.publicOrderTokenHash,
          input.senderExternalUserId,
          input.requestedAt,
          input.channel
        ]
      );
      const order = orderResult.rows[0];
      if (!order) {
        return { status: "not_found" };
      }
      const latestResult = await this.session.query<PaymentAttemptRow>(
        `select
           id,
           order_id,
           attempt_number,
           status,
           amount_kopecks::text,
           currency,
           idempotency_key,
           merchant_order_id,
           provider_payment_id,
           payment_url
         from public.payment_attempts
         where order_id = $1
           and provider = 'tbank'
         order by attempt_number desc
         limit 1
         for update`,
        [order.id]
      );
      const latest = latestResult.rows[0];
      if (order.status === "payment_processing") {
        if (!hasActiveReservations(order)) {
          return { status: "unavailable" };
        }
        if (latest?.status === "pending" && latest.payment_url) {
          return { status: "pending", attempt: toPreparedAttempt(order, latest) };
        }
        if (
          latest
          && ["creating", "pending", "authorized", "unknown"].includes(latest.status)
        ) {
          return { status: "uncertain" };
        }
        return { status: "unavailable" };
      }
      if (!isPayableOrder(order, input.requestedAt)) {
        return { status: "unavailable" };
      }
      if (latest?.status === "pending" && latest.payment_url) {
        return { status: "pending", attempt: toPreparedAttempt(order, latest) };
      }
      if (
        latest
        && ["creating", "pending", "authorized", "unknown"].includes(latest.status)
      ) {
        return { status: "uncertain" };
      }
      if (
        latest
        && ["succeeded", "partially_refunded", "refunded"].includes(latest.status)
      ) {
        return { status: "unavailable" };
      }

      const attemptNumber = (latest?.attempt_number ?? 0) + 1;
      const paymentAttemptId = this.idGenerator.newId();
      const merchantOrderId = createMerchantOrderId(order.id, attemptNumber);
      const attempt: PreparedTBankPaymentAttempt = {
        paymentAttemptId,
        orderId: order.id,
        orderNumber: order.number,
        idempotencyKey: `tbank_init:${order.id}:${attemptNumber}`,
        merchantOrderId,
        amountKopecks: order.external_due_kopecks,
        currency: order.currency,
        description: `Билет ${order.number}`.slice(0, 140),
        paymentUrl: null
      };

      await this.session.query(
        `insert into public.payment_attempts (
           id, order_id, attempt_number, provider, status,
           amount_kopecks, currency, idempotency_key, merchant_order_id,
           metadata_schema_version, metadata, created_at, updated_at
         ) values (
           $1, $2, $3, 'tbank', 'creating',
           $4, $5, $6, $7,
           1, $8::jsonb, $9, $9
         )`,
        [
          attempt.paymentAttemptId,
          attempt.orderId,
          attemptNumber,
          attempt.amountKopecks,
          attempt.currency,
          attempt.idempotencyKey,
          attempt.merchantOrderId,
          JSON.stringify({ schemaVersion: 1, channel: input.channel }),
          input.requestedAt
        ]
      );
      const started = await this.session.query(
        `update public.orders
         set status = 'payment_processing',
             lock_version = lock_version + 1,
             updated_at = $2
         where id = $1
           and status = 'awaiting_payment'`,
        [order.id, input.requestedAt]
      );
      if (started.rowCount !== 1) {
        throw new Error(`T-Bank payment start lost the locked order: ${order.id}`);
      }
      await this.session.query(
        `insert into public.order_status_history (
           id, order_id, from_status, to_status, reason, actor_type,
           idempotency_key, occurred_at, metadata_schema_version, metadata
         ) values (
           $1, $2, 'awaiting_payment', 'payment_processing',
           'tbank_payment_started', 'system',
           $3, $4, 1, $5::jsonb
         )`,
        [
          this.idGenerator.newId(),
          order.id,
          `tbank_payment_started:${attempt.paymentAttemptId}`,
          input.requestedAt,
          JSON.stringify({
            schemaVersion: 1,
            paymentAttemptId: attempt.paymentAttemptId
          })
        ]
      );

      return { status: "created", attempt };
    });
  }

  markInitialized(
    paymentAttemptId: string,
    providerPaymentId: string,
    paymentUrl: string,
    providerStatus: "NEW",
    initializedAt: Date
  ): Promise<void> {
    return this.unitOfWork.transact(async () => {
      const result = await this.session.query(
        `update public.payment_attempts
         set status = 'pending',
             provider_payment_id = $2,
             payment_url = $3,
             provider_status = $4,
             initialization_error_code = null,
             initialized_at = $5,
             updated_at = $5
         where id = $1
           and provider = 'tbank'
           and status = 'creating'`,
        [
          paymentAttemptId,
          providerPaymentId,
          paymentUrl,
          providerStatus,
          initializedAt
        ]
      );
      if (result.rowCount !== 1) {
        throw new Error(`T-Bank initialization state was lost: ${paymentAttemptId}`);
      }
    });
  }

  markInitializationFailed(
    paymentAttemptId: string,
    errorCode: string,
    uncertain: boolean,
    failedAt: Date
  ): Promise<void> {
    return this.unitOfWork.transact(async () => {
      const result = await this.session.query<AttemptOrderRow>(
        `update public.payment_attempts
         set status = $2,
             initialization_error_code = $3,
             updated_at = $4
         where id = $1
           and provider = 'tbank'
           and status = 'creating'
         returning order_id`,
        [
          paymentAttemptId,
          uncertain ? "unknown" : "failed",
          safeErrorCode(errorCode),
          failedAt
        ]
      );
      if (result.rowCount !== 1) {
        throw new Error(`T-Bank initialization failure state was lost: ${paymentAttemptId}`);
      }
      const orderId = result.rows[0]?.order_id;
      if (!uncertain && orderId) {
        await this.returnOrderToPayment(orderId, paymentAttemptId, failedAt);
      }
    });
  }

  private async returnOrderToPayment(
    orderId: string,
    paymentAttemptId: string,
    occurredAt: Date
  ): Promise<void> {
    const updated = await this.session.query(
      `update public.orders
       set status = 'awaiting_payment',
           lock_version = lock_version + 1,
           updated_at = $2
       where id = $1
         and status = 'payment_processing'`,
      [orderId, occurredAt]
    );
    if (updated.rowCount !== 1) {
      throw new Error(`T-Bank payment failure lost the processing order: ${orderId}`);
    }
    await this.session.query(
      `insert into public.order_status_history (
         id, order_id, from_status, to_status, reason, actor_type,
         idempotency_key, occurred_at, metadata_schema_version, metadata
       ) values (
         $1, $2, 'payment_processing', 'awaiting_payment',
         'tbank_initialization_failed', 'system',
         $3, $4, 1, $5::jsonb
       )`,
      [
        this.idGenerator.newId(),
        orderId,
        `tbank_initialization_failed:${paymentAttemptId}`,
        occurredAt,
        JSON.stringify({ schemaVersion: 1, paymentAttemptId })
      ]
    );
  }
}

export class PostgresTBankWebhookRepository implements TBankWebhookRepository {
  private readonly unitOfWork: PostgresUnitOfWork;

  constructor(
    private readonly session: TransactionSession,
    pool: SqlConnectionPool,
    private readonly idGenerator: IdGenerator
  ) {
    this.unitOfWork = new PostgresUnitOfWork(pool, session);
  }

  findAttempt(
    providerPaymentId: string,
    merchantOrderId: string
  ): Promise<TBankWebhookPaymentAttempt | null> {
    return this.unitOfWork.transact(async () => {
      const result = await this.session.query<PaymentAttemptRow>(
        `select
           id,
           order_id,
           attempt_number,
           status,
           amount_kopecks::text,
           currency,
           idempotency_key,
           merchant_order_id,
           provider_payment_id,
           payment_url
         from public.payment_attempts
         where provider = 'tbank'
           and provider_payment_id = $1
           and merchant_order_id = $2`,
        [providerPaymentId, merchantOrderId]
      );
      const row = result.rows[0];
      if (!row?.provider_payment_id) {
        return null;
      }
      return {
        paymentAttemptId: row.id,
        orderId: row.order_id,
        idempotencyKey: row.idempotency_key,
        providerPaymentId: row.provider_payment_id,
        merchantOrderId: row.merchant_order_id,
        amountKopecks: row.amount_kopecks,
        currency: row.currency
      };
    });
  }

  recordStatusEvent(
    input: RecordTBankStatusEvent
  ): Promise<"recorded" | "duplicate"> {
    return this.unitOfWork.transact(async () => {
      const inserted = await this.session.query<InsertedEventRow>(
        `insert into public.payment_provider_events (
           id, payment_attempt_id, provider, event_key, provider_payment_id,
           merchant_order_id, provider_status, success, error_code,
           amount_kopecks, payload_hash, outcome, received_at,
           metadata_schema_version, metadata
         ) values (
           $1, $2, 'tbank', $3, $4,
           $5, $6, $7, $8,
           $9, $10, $11, $12,
           1, '{}'::jsonb
         )
         on conflict (provider, event_key) do nothing
         returning id`,
        [
          input.eventRecordId,
          input.attempt?.paymentAttemptId ?? null,
          input.event.eventKey,
          input.event.providerPaymentId,
          input.event.merchantOrderId,
          input.event.status,
          input.event.success,
          input.event.errorCode,
          input.event.amountKopecks.toString(),
          input.event.payloadHash,
          input.outcome,
          input.receivedAt
        ]
      );
      if (!inserted.rows[0]) {
        return "duplicate";
      }

      if (input.attempt && input.internalStatus) {
        const transitioned = await this.session.query(
          `update public.payment_attempts
           set status = $2,
               provider_status = $3,
               initialization_error_code = case
                 when $4 = '0' then null
                 else $4
               end,
               updated_at = $5
           where id = $1
             and provider = 'tbank'
             and (
               ($2 = 'pending' and status in ('creating', 'pending', 'unknown'))
               or ($2 = 'authorized' and status in ('creating', 'pending', 'authorized', 'unknown'))
               or ($2 in ('failed', 'cancelled') and status in ('creating', 'pending', 'authorized', 'unknown', 'failed', 'cancelled'))
             )`,
          [
            input.attempt.paymentAttemptId,
            input.internalStatus,
            input.event.status,
            safeErrorCode(input.event.errorCode),
            input.receivedAt
          ]
        );
        if (
          transitioned.rowCount === 1
          && (input.internalStatus === "failed" || input.internalStatus === "cancelled")
        ) {
          await this.returnOrderToPayment(input);
        }
      }
      return "recorded";
    });
  }

  private async returnOrderToPayment(input: RecordTBankStatusEvent): Promise<void> {
    if (!input.attempt) {
      return;
    }
    const updated = await this.session.query(
      `update public.orders
       set status = 'awaiting_payment',
           lock_version = lock_version + 1,
           updated_at = $2
       where id = $1
         and status = 'payment_processing'`,
      [input.attempt.orderId, input.receivedAt]
    );
    if (updated.rowCount !== 1) {
      return;
    }
    await this.session.query(
      `insert into public.order_status_history (
         id, order_id, from_status, to_status, reason, actor_type,
         idempotency_key, occurred_at, metadata_schema_version, metadata
       ) values (
         $1, $2, 'payment_processing', 'awaiting_payment',
         'tbank_payment_stopped', 'payment_provider',
         $3, $4, 1, $5::jsonb
       )`,
      [
        this.idGenerator.newId(),
        input.attempt.orderId,
        `tbank_payment_stopped:${input.event.eventKey}`,
        input.receivedAt,
        JSON.stringify({
          schemaVersion: 1,
          paymentAttemptId: input.attempt.paymentAttemptId,
          providerStatus: input.event.status
        })
      ]
    );
  }
}

export function createTBankPaymentPersistence(
  pool: SqlConnectionPool,
  idGenerator: IdGenerator
) {
  const initializationSession = new TransactionSession();
  const webhookSession = new TransactionSession();

  return {
    initializationRepository: new PostgresTBankPaymentInitializationRepository(
      initializationSession,
      pool,
      idGenerator
    ),
    webhookRepository: new PostgresTBankWebhookRepository(
      webhookSession,
      pool,
      idGenerator
    )
  } as const;
}

function isPayableOrder(order: PaymentOrderRow, requestedAt: Date): boolean {
  const itemCount = Number(order.item_count);
  const unexpiredReservationCount = Number(order.unexpired_reservation_count);
  const externalDue = BigInt(order.external_due_kopecks);
  return order.status === "awaiting_payment"
    && order.offer_accepted_at !== null
    && order.expires_at > requestedAt
    && order.currency === "RUB"
    && externalDue > 0n
    && externalDue <= 9_999_999_999n
    && itemCount > 0
    && unexpiredReservationCount === itemCount;
}

function hasActiveReservations(order: PaymentOrderRow): boolean {
  const itemCount = Number(order.item_count);
  return itemCount > 0
    && Number(order.active_reservation_count) === itemCount;
}

function toPreparedAttempt(
  order: PaymentOrderRow,
  attempt: PaymentAttemptRow
): PreparedTBankPaymentAttempt {
  return {
    paymentAttemptId: attempt.id,
    orderId: order.id,
    orderNumber: order.number,
    idempotencyKey: attempt.idempotency_key,
    merchantOrderId: attempt.merchant_order_id,
    amountKopecks: attempt.amount_kopecks,
    currency: attempt.currency,
    description: `Билет ${order.number}`.slice(0, 140),
    paymentUrl: attempt.payment_url
  };
}

function createMerchantOrderId(orderId: string, attemptNumber: number): string {
  const normalizedOrderId = orderId.replaceAll("-", "");
  const value = `tb_${normalizedOrderId}_${attemptNumber}`;
  if (!/^[A-Za-z0-9._-]{1,50}$/.test(value)) {
    throw new Error("T-Bank merchant order ID cannot be generated");
  }
  return value;
}

function safeErrorCode(value: string): string {
  return /^[A-Za-z0-9_-]{1,20}$/.test(value) ? value : "PROVIDER_ERROR";
}
