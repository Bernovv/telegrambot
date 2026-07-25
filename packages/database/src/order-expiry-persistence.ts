import type {
  ExpirableOrder,
  ExpireOrderInput,
  ExpireOrderResult,
  OrderExpiryRepository
} from "@ticket-platform/application";
import {
  PostgresOutboxWriter
} from "./telegram-start-persistence.js";
import {
  PostgresUnitOfWork,
  TransactionSession,
  type SqlConnectionPool
} from "./postgres.js";

interface ExpirableOrderRow {
  readonly id: string;
  readonly user_id: string;
  readonly event_id: string;
  readonly status: ExpirableOrder["status"];
  readonly expires_at: Date;
  readonly wallet_applied_kopecks: string;
}

interface WalletHoldRow {
  readonly id: string;
  readonly wallet_account_id: string;
  readonly amount_kopecks: string;
  readonly cached_held_kopecks: string;
}

export class PostgresOrderExpiryRepository implements OrderExpiryRepository {
  constructor(private readonly session: TransactionSession) {}

  async claimExpiredOrders(
    at: Date,
    batchSize: number
  ): Promise<readonly ExpirableOrder[]> {
    const result = await this.session.query<ExpirableOrderRow>(
      `select
         id,
         user_id,
         event_id,
         status,
         expires_at,
         wallet_applied_kopecks::text
       from public.orders
       where expires_at <= $1
         and status in ('draft', 'awaiting_offer', 'awaiting_payment')
       order by expires_at, id
       for update skip locked
       limit $2`,
      [at, batchSize]
    );

    return result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      eventId: row.event_id,
      status: row.status,
      expiresAt: row.expires_at,
      walletApplied: BigInt(row.wallet_applied_kopecks)
    }));
  }

  async expireOrder(input: ExpireOrderInput): Promise<ExpireOrderResult> {
    const updatedOrder = await this.session.query(
      `update public.orders
       set status = 'expired',
           lock_version = lock_version + 1,
           updated_at = $2
       where id = $1
         and status = $3
         and expires_at <= $2`,
      [input.order.id, input.expiredAt, input.order.status]
    );
    if (updatedOrder.rowCount !== 1) {
      throw new Error(`Locked order could not be expired: ${input.order.id}`);
    }

    await this.session.query(
      `update public.inventory_reservations
       set status = 'expired',
           released_at = $2,
           updated_at = $2
       where order_id = $1
         and status = 'active'`,
      [input.order.id, input.expiredAt]
    );

    const walletReleased = await this.releaseWalletHold(input);

    await this.session.query(
      `insert into public.order_status_history (
         id, order_id, from_status, to_status, reason, actor_type,
         idempotency_key, occurred_at, metadata_schema_version, metadata
       ) values (
         $1, $2, $3, 'expired', 'reservation_expired', 'system',
         $4, $5, 1, $6::jsonb
       )`,
      [
        input.historyId,
        input.order.id,
        input.order.status,
        `order_expired:${input.order.id}`,
        input.expiredAt,
        JSON.stringify({
          schemaVersion: 1,
          walletReleasedKopecks: walletReleased.toString()
        })
      ]
    );

    return { walletReleased };
  }

  private async releaseWalletHold(input: ExpireOrderInput): Promise<bigint> {
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
      return 0n;
    }

    const amount = BigInt(hold.amount_kopecks);
    if (
      amount !== input.order.walletApplied
      || BigInt(hold.cached_held_kopecks) < amount
    ) {
      throw new Error(`Wallet hold requires reconciliation for order: ${input.order.id}`);
    }

    await this.session.query(
      `insert into public.wallet_transactions (
         id, wallet_account_id, transaction_type, status, idempotency_key,
         reference_type, reference_id, actor_type, reason, created_at, posted_at
       ) values (
         $1, $2, 'ORDER_RELEASE', 'posted', $3,
         'order', $4, 'system', 'reservation_expired', $5, $5
       )`,
      [
        input.walletTransactionId,
        hold.wallet_account_id,
        `order_release:${input.order.id}`,
        input.order.id,
        input.expiredAt
      ]
    );
    const updatedHold = await this.session.query(
      `update public.wallet_holds
       set status = 'expired',
           released_at = $2,
           updated_at = $2
       where id = $1
         and status = 'active'`,
      [hold.id, input.expiredAt]
    );
    if (updatedHold.rowCount !== 1) {
      throw new Error(`Wallet hold transition was lost for order: ${input.order.id}`);
    }

    const updatedAccount = await this.session.query(
      `update public.wallet_accounts
       set cached_available_kopecks = cached_available_kopecks + $2,
           cached_held_kopecks = cached_held_kopecks - $2,
           balance_version = balance_version + 1,
           updated_at = $3
       where id = $1
         and cached_held_kopecks >= $2`,
      [hold.wallet_account_id, amount.toString(), input.expiredAt]
    );
    if (updatedAccount.rowCount !== 1) {
      throw new Error(`Wallet account release failed for order: ${input.order.id}`);
    }

    return amount;
  }
}

export function createOrderExpiryPersistence(pool: SqlConnectionPool) {
  const session = new TransactionSession();

  return {
    orderExpiryRepository: new PostgresOrderExpiryRepository(session),
    outboxWriter: new PostgresOutboxWriter(session),
    unitOfWork: new PostgresUnitOfWork(pool, session)
  } as const;
}
