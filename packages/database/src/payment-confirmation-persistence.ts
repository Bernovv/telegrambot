import type {
  ConfirmablePaymentOrder,
  ConfirmedPaymentRecord,
  IdGenerator,
  PaymentConfirmationRepository,
  PersistPaymentConfirmationInput
} from "@ticket-platform/application";
import {
  PostgresOutboxWriter
} from "./telegram-start-persistence.js";
import {
  PostgresUnitOfWork,
  TransactionSession,
  type SqlConnectionPool
} from "./postgres.js";

interface ConfirmedPaymentRow {
  readonly payment_attempt_id: string;
  readonly confirmation_request_hash: string;
  readonly order_id: string;
  readonly confirmed_at: Date;
  readonly amount_kopecks: string;
  readonly wallet_applied_kopecks: string;
}

interface TicketResultRow {
  readonly id: string;
  readonly ticket_number: string;
}

interface PaymentOrderRow {
  readonly id: string;
  readonly number: string;
  readonly user_id: string;
  readonly event_id: string;
  readonly status: ConfirmablePaymentOrder["status"];
  readonly currency: string;
  readonly total_kopecks: string;
  readonly wallet_applied_kopecks: string;
  readonly external_due_kopecks: string;
  readonly offer_version_id: string | null;
  readonly offer_accepted_at: Date | null;
  readonly expires_at: Date;
}

interface PaymentOrderItemRow {
  readonly id: string;
  readonly quantity: number;
  readonly reservation_status: "active" | "consumed" | "released" | "expired" | null;
  readonly reservation_expires_at: Date | null;
}

interface WalletHoldRow {
  readonly id: string;
  readonly wallet_account_id: string;
  readonly amount_kopecks: string;
  readonly cached_held_kopecks: string;
}

interface WalletHoldAllocationRow {
  readonly source_entry_id: string;
  readonly amount_kopecks: string;
  readonly bucket: "bonus" | "referral" | "cash_equivalent" | "refund";
}

export class PostgresPaymentConfirmationRepository
implements PaymentConfirmationRepository {
  constructor(
    private readonly session: TransactionSession,
    private readonly idGenerator: IdGenerator
  ) {}

  async lockIdempotencyKey(idempotencyKey: string): Promise<void> {
    await this.session.query(
      "select pg_advisory_xact_lock(hashtextextended($1, 94721))",
      [idempotencyKey]
    );
  }

  async findByIdempotencyKey(
    idempotencyKey: string
  ): Promise<ConfirmedPaymentRecord | null> {
    const result = await this.session.query<ConfirmedPaymentRow>(
      `select
         attempt.id as payment_attempt_id,
         attempt.confirmation_request_hash,
         attempt.order_id,
         attempt.confirmed_at,
         attempt.amount_kopecks::text,
         orders.wallet_applied_kopecks::text
       from public.payment_attempts attempt
       join public.orders orders on orders.id = attempt.order_id
       where attempt.idempotency_key = $1
         and attempt.status = 'succeeded'`,
      [idempotencyKey]
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }

    const tickets = await this.session.query<TicketResultRow>(
      `select id, ticket_number
       from public.tickets
       where order_id = $1
       order by ticket_number`,
      [row.order_id]
    );

    return {
      paymentAttemptId: row.payment_attempt_id,
      confirmationRequestHash: row.confirmation_request_hash,
      orderId: row.order_id,
      paidAt: row.confirmed_at,
      amount: BigInt(row.amount_kopecks),
      walletCaptured: BigInt(row.wallet_applied_kopecks),
      tickets: tickets.rows.map((ticket) => ({
        id: ticket.id,
        ticketNumber: ticket.ticket_number
      }))
    };
  }

  async lockOrder(orderId: string): Promise<ConfirmablePaymentOrder | null> {
    const orderResult = await this.session.query<PaymentOrderRow>(
      `select
         id,
         number,
         user_id,
         event_id,
         status,
         currency,
         total_kopecks::text,
         wallet_applied_kopecks::text,
         external_due_kopecks::text,
         offer_version_id,
         offer_accepted_at,
         expires_at
       from public.orders
       where id = $1
       for update`,
      [orderId]
    );
    const order = orderResult.rows[0];
    if (!order) {
      return null;
    }

    const itemResult = await this.session.query<PaymentOrderItemRow>(
      `select
         item.id,
         item.quantity,
         reservation.status as reservation_status,
         reservation.expires_at as reservation_expires_at
       from public.order_items item
       left join public.inventory_reservations reservation
         on reservation.order_item_id = item.id
       where item.order_id = $1
       order by item.created_at, item.id`,
      [orderId]
    );

    return {
      id: order.id,
      number: order.number,
      userId: order.user_id,
      eventId: order.event_id,
      status: order.status,
      currency: order.currency,
      total: BigInt(order.total_kopecks),
      walletApplied: BigInt(order.wallet_applied_kopecks),
      externalDue: BigInt(order.external_due_kopecks),
      offerVersionId: order.offer_version_id,
      offerAcceptedAt: order.offer_accepted_at,
      expiresAt: order.expires_at,
      items: itemResult.rows.map((item) => ({
        id: item.id,
        quantity: item.quantity,
        reservationStatus: item.reservation_status,
        reservationExpiresAt: item.reservation_expires_at
      }))
    };
  }

  async persistConfirmation(input: PersistPaymentConfirmationInput): Promise<void> {
    if (input.command.source === "tbank") {
      await this.confirmTBankAttempt(input);
    } else {
      await this.insertConfirmedAttempt(input);
    }

    if (input.command.source === "manual") {
      await this.insertManualEvidence(input);
    }

    const updatedOrder = await this.session.query(
      `update public.orders
       set status = 'paid',
           paid_at = $2,
           lock_version = lock_version + 1,
           updated_at = $2
       where id = $1
         and status = $3
         and ($4 = true or expires_at > $2)`,
      [
        input.order.id,
        input.command.confirmedAt,
        input.order.status,
        input.command.source === "tbank"
      ]
    );
    if (updatedOrder.rowCount !== 1) {
      throw new Error(`Locked order could not be confirmed paid: ${input.order.id}`);
    }

    const consumedReservations = await this.session.query(
      `update public.inventory_reservations
       set status = 'consumed',
           consumed_at = $2,
           updated_at = $2
       where order_id = $1
         and status = 'active'
         and expires_at > $2`,
      [input.order.id, input.command.confirmedAt]
    );
    if (consumedReservations.rowCount !== input.order.items.length) {
      throw new Error(`Inventory consumption requires reconciliation: ${input.order.id}`);
    }

    await this.captureWalletHold(input);

    for (const ticket of input.tickets) {
      await this.session.query(
        `insert into public.tickets (
           id, ticket_number, event_id, order_id, order_item_id, owner_user_id,
           sequence, token_hash, status, issued_at, created_at
         ) values (
           $1, $2, $3, $4, $5, $6,
           $7, $8, 'issued', $9, $9
         )`,
        [
          ticket.id,
          ticket.ticketNumber,
          input.order.eventId,
          input.order.id,
          ticket.orderItemId,
          input.order.userId,
          ticket.sequence,
          ticket.tokenHash,
          input.command.confirmedAt
        ]
      );
    }

    await this.insertHistory(input);

    if (input.command.source === "manual") {
      await this.insertAudit(input);
    }
  }

  private async insertConfirmedAttempt(
    input: PersistPaymentConfirmationInput
  ): Promise<void> {
    const internalEvidence = input.command.internalEvidence;
    if (input.command.source === "internal" && !internalEvidence) {
      throw new Error("Internal payment evidence was not provided");
    }
    await this.session.query(
      `insert into public.payment_attempts (
         id, order_id, attempt_number, provider, status, amount_kopecks, currency,
         idempotency_key, confirmation_request_hash, confirmed_at,
         metadata_schema_version, metadata, created_at, updated_at
       ) values (
         $1, $2,
         (select coalesce(max(attempt_number), 0) + 1 from public.payment_attempts where order_id = $2),
         $3, 'succeeded', $4, $5,
         $6, $7, $8,
         1, $9::jsonb, $8, $8
       )`,
      [
        input.paymentAttemptId,
        input.order.id,
        input.command.source,
        input.command.amountKopecks,
        input.command.currency,
        input.command.idempotencyKey,
        input.confirmationRequestHash,
        input.command.confirmedAt,
        JSON.stringify({
          schemaVersion: 1,
          actorType: input.command.actor.type,
          ...(input.command.source === "internal" && internalEvidence
            ? {
                reason: internalEvidence.reason,
                userId: internalEvidence.userId,
                eventId: internalEvidence.eventId
              }
            : {})
        })
      ]
    );
  }

  private async confirmTBankAttempt(
    input: PersistPaymentConfirmationInput
  ): Promise<void> {
    const evidence = input.command.providerEvidence;
    if (!evidence) {
      throw new Error("Verified T-Bank payment evidence was not provided");
    }

    const updatedAttempt = await this.session.query(
      `update public.payment_attempts
       set status = 'succeeded',
           confirmation_request_hash = $3,
           provider_event_id = $4,
           provider_status = $5,
           provider_payment_id = coalesce(provider_payment_id, $7),
           initialization_error_code = null,
           reconciliation_next_attempt_at = null,
           reconciliation_locked_by = null,
           reconciliation_locked_until = null,
           confirmed_at = $6,
           updated_at = $6
       where id = $1
         and order_id = $2
         and provider = 'tbank'
         and (
           provider_payment_id is null
           or provider_payment_id = $7
         )
         and merchant_order_id = $8
         and amount_kopecks = $9
         and currency = $10
         and status in ('pending', 'authorized', 'unknown')`,
      [
        evidence.paymentAttemptId,
        input.order.id,
        input.confirmationRequestHash,
        evidence.eventKey,
        evidence.providerStatus,
        input.command.confirmedAt,
        evidence.providerPaymentId,
        evidence.merchantOrderId,
        input.command.amountKopecks,
        input.command.currency
      ]
    );
    if (updatedAttempt.rowCount !== 1) {
      throw new Error(`T-Bank payment attempt requires reconciliation: ${input.paymentAttemptId}`);
    }

    await this.session.query(
      `insert into public.payment_provider_events (
         id, payment_attempt_id, provider, event_key, provider_payment_id,
         merchant_order_id, provider_status, success, error_code,
         amount_kopecks, payload_hash, outcome, received_at,
         metadata_schema_version, metadata
       ) values (
         $1, $2, 'tbank', $3, $4,
         $5, $6, true, $7,
         $8, $9, 'processed', $10,
         1, $11::jsonb
       )`,
      [
        evidence.eventRecordId,
        evidence.paymentAttemptId,
        evidence.eventKey,
        evidence.providerPaymentId,
        evidence.merchantOrderId,
        evidence.providerStatus,
        evidence.providerErrorCode,
        input.command.amountKopecks,
        evidence.payloadHash,
        input.command.confirmedAt,
        JSON.stringify({
          schemaVersion: 1,
          origin: evidence.origin
        })
      ]
    );
  }

  private async insertManualEvidence(input: PersistPaymentConfirmationInput): Promise<void> {
    const evidence = input.command.manualEvidence;
    if (!evidence || input.command.actor.type !== "admin") {
      throw new Error("Manual payment evidence was not provided");
    }

    await this.session.query(
      `insert into public.manual_payments (
         id, payment_attempt_id, order_id, confirmed_by_admin_id, method,
         external_reference, reason, request_id, recorded_at,
         metadata_schema_version, metadata
       ) values (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9,
         1, '{}'::jsonb
       )`,
      [
        input.manualPaymentId,
        input.paymentAttemptId,
        input.order.id,
        input.command.actor.adminId,
        evidence.method,
        evidence.externalReference,
        evidence.reason,
        evidence.requestId,
        input.command.confirmedAt
      ]
    );
  }

  private async captureWalletHold(input: PersistPaymentConfirmationInput): Promise<void> {
    const holdResult = await this.session.query<WalletHoldRow>(
      `select
         hold.id,
         hold.wallet_account_id,
         hold.amount_kopecks::text,
         account.cached_held_kopecks::text
       from public.wallet_holds hold
       join public.wallet_accounts account on account.id = hold.wallet_account_id
       where hold.reference_type = 'order'
         and hold.reference_id = $1
         and hold.status = 'active'
       for update of hold, account`,
      [input.order.id]
    );
    const hold = holdResult.rows[0];

    if (!hold) {
      if (input.order.walletApplied !== 0n) {
        throw new Error(`Active wallet hold is missing for order: ${input.order.id}`);
      }
      return;
    }

    const amount = BigInt(hold.amount_kopecks);
    if (
      amount !== input.order.walletApplied
      || BigInt(hold.cached_held_kopecks) < amount
    ) {
      throw new Error(`Wallet hold requires reconciliation for order: ${input.order.id}`);
    }

    const allocationResult = await this.session.query<WalletHoldAllocationRow>(
      `select
         allocation.source_entry_id,
         allocation.amount_kopecks::text,
         source.bucket
       from public.wallet_hold_entries allocation
       join public.wallet_entries source on source.id = allocation.source_entry_id
       where allocation.wallet_hold_id = $1
       order by allocation.created_at, allocation.id`,
      [hold.id]
    );
    const allocated = allocationResult.rows.reduce(
      (sum, allocation) => sum + BigInt(allocation.amount_kopecks),
      0n
    );
    if (allocated !== amount) {
      throw new Error(`Wallet hold allocations require reconciliation: ${input.order.id}`);
    }

    const transactionId = this.idGenerator.newId();
    await this.session.query(
      `insert into public.wallet_transactions (
         id, wallet_account_id, transaction_type, status, idempotency_key,
         reference_type, reference_id, actor_type, reason, created_at, posted_at
       ) values (
         $1, $2, 'ORDER_CAPTURE', 'posted', $3,
         'order', $4, 'system', 'payment_confirmed', $5, $5
       )`,
      [
        transactionId,
        hold.wallet_account_id,
        `order_capture:${input.order.id}`,
        input.order.id,
        input.command.confirmedAt
      ]
    );

    for (const allocation of allocationResult.rows) {
      await this.session.query(
        `insert into public.wallet_entries (
           id, wallet_account_id, wallet_transaction_id, direction,
           amount_kopecks, bucket, source_entry_id, effective_at, created_at
         ) values (
           $1, $2, $3, 'debit',
           $4, $5, $6, $7, $7
         )`,
        [
          this.idGenerator.newId(),
          hold.wallet_account_id,
          transactionId,
          allocation.amount_kopecks,
          allocation.bucket,
          allocation.source_entry_id,
          input.command.confirmedAt
        ]
      );
    }

    const updatedHold = await this.session.query(
      `update public.wallet_holds
       set status = 'captured',
           captured_at = $2,
           updated_at = $2
       where id = $1
         and status = 'active'`,
      [hold.id, input.command.confirmedAt]
    );
    if (updatedHold.rowCount !== 1) {
      throw new Error(`Wallet hold transition was lost for order: ${input.order.id}`);
    }

    const updatedAccount = await this.session.query(
      `update public.wallet_accounts
       set cached_held_kopecks = cached_held_kopecks - $2,
           balance_version = balance_version + 1,
           updated_at = $3
       where id = $1
         and cached_held_kopecks >= $2`,
      [hold.wallet_account_id, amount.toString(), input.command.confirmedAt]
    );
    if (updatedAccount.rowCount !== 1) {
      throw new Error(`Wallet account capture failed for order: ${input.order.id}`);
    }
  }

  private async insertHistory(input: PersistPaymentConfirmationInput): Promise<void> {
    const actorType = input.command.actor.type === "admin"
      ? "admin"
      : input.command.actor.type;
    const actorAdminId = input.command.actor.type === "admin"
      ? input.command.actor.adminId
      : null;

    await this.session.query(
      `insert into public.order_status_history (
         id, order_id, from_status, to_status, reason, actor_type,
         actor_admin_id, idempotency_key, occurred_at,
         metadata_schema_version, metadata
       ) values (
         $1, $2, $3, 'paid', 'payment_confirmed', $4,
         $5, $6, $7,
         1, $8::jsonb
       )`,
      [
        input.historyId,
        input.order.id,
        input.order.status,
        actorType,
        actorAdminId,
        `payment_confirmed:${input.paymentAttemptId}`,
        input.command.confirmedAt,
        JSON.stringify({
          schemaVersion: 1,
          paymentAttemptId: input.paymentAttemptId,
          source: input.command.source,
          walletCapturedKopecks: input.order.walletApplied.toString(),
          externalPaidKopecks: input.command.amountKopecks
        })
      ]
    );
  }

  private async insertAudit(input: PersistPaymentConfirmationInput): Promise<void> {
    if (input.command.actor.type !== "admin" || !input.command.manualEvidence) {
      throw new Error("Manual payment audit actor is missing");
    }

    await this.session.query(
      `insert into public.audit_log (
         id, actor_admin_id, actor_role, action, target_type, target_id,
         reason, before_masked, after_masked, request_id, created_at
       ) values (
         $1, $2, 'administrator', 'order.manual_payment_confirmed', 'order', $3,
         $4, $5::jsonb, $6::jsonb, $7, $8
       )`,
      [
        input.auditId,
        input.command.actor.adminId,
        input.order.id,
        input.command.manualEvidence.reason,
        JSON.stringify({ status: input.order.status }),
        JSON.stringify({
          status: "paid",
          paymentAttemptId: input.paymentAttemptId,
          amountKopecks: input.command.amountKopecks,
          currency: input.command.currency,
          method: input.command.manualEvidence.method
        }),
        input.command.manualEvidence.requestId,
        input.command.confirmedAt
      ]
    );
  }
}

export function createPaymentConfirmationPersistence(
  pool: SqlConnectionPool,
  idGenerator: IdGenerator
) {
  const session = new TransactionSession();

  return {
    paymentConfirmationRepository: new PostgresPaymentConfirmationRepository(
      session,
      idGenerator
    ),
    outboxWriter: new PostgresOutboxWriter(session),
    unitOfWork: new PostgresUnitOfWork(pool, session)
  } as const;
}
