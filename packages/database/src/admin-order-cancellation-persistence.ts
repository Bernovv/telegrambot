import type {
  AdminOrderCancellationRepository,
  CancellableOrder,
  CancelOrderInput,
  CancelOrderResult
} from "@ticket-platform/application";
import type { TransactionSession } from "./postgres.js";

interface CancellableOrderRow {
  readonly id: string;
  readonly number: string;
  readonly user_id: string;
  readonly event_id: string;
  readonly status: CancellableOrder["status"];
  readonly wallet_applied_kopecks: string;
}

interface WalletHoldRow {
  readonly id: string;
  readonly wallet_account_id: string;
  readonly amount_kopecks: string;
  readonly cached_held_kopecks: string;
}

/**
 * Ручная отмена повторяет шаги истечения брони: снять бронь мест, вернуть холд бонусов,
 * записать переход. Отличий два — статус `cancelled` вместо `expired` и автор-администратор
 * вместо системы.
 */
export class PostgresAdminOrderCancellationRepository
implements AdminOrderCancellationRepository {
  constructor(private readonly session: TransactionSession) {}

  async findCancellableOrder(orderId: string): Promise<CancellableOrder | null> {
    const result = await this.session.query<CancellableOrderRow>(
      `select id, number, user_id, event_id, status, wallet_applied_kopecks::text
         from public.orders
        where id = $1::uuid
          and status in ('draft', 'awaiting_offer', 'awaiting_payment')
        for update`,
      [orderId]
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      number: row.number,
      userId: row.user_id,
      eventId: row.event_id,
      status: row.status,
      walletApplied: BigInt(row.wallet_applied_kopecks)
    };
  }

  async cancelOrder(input: CancelOrderInput): Promise<CancelOrderResult> {
    const updated = await this.session.query(
      `update public.orders
          set status = 'cancelled',
              lock_version = lock_version + 1,
              updated_at = $2
        where id = $1
          and status = $3`,
      [input.order.id, input.cancelledAt, input.order.status]
    );
    if (updated.rowCount !== 1) {
      throw new Error(`Locked order could not be cancelled: ${input.order.id}`);
    }

    await this.session.query(
      `update public.inventory_reservations
          set status = 'released',
              released_at = $2,
              updated_at = $2
        where order_id = $1
          and status = 'active'`,
      [input.order.id, input.cancelledAt]
    );

    const walletReleased = await this.releaseWalletHold(input);

    await this.session.query(
      `insert into public.order_status_history (
         id, order_id, from_status, to_status, reason, actor_type, actor_admin_id,
         idempotency_key, occurred_at, metadata_schema_version, metadata
       ) values (
         $1, $2, $3, 'cancelled', 'admin_cancelled', 'admin', $7,
         $4, $5, 1, $6::jsonb
       )`,
      [
        input.historyId,
        input.order.id,
        input.order.status,
        `order_cancelled:${input.order.id}`,
        input.cancelledAt,
        JSON.stringify({
          schemaVersion: 1,
          walletReleasedKopecks: walletReleased.toString(),
          reason: input.reason
        }),
        input.adminId
      ]
    );

    return { walletReleased };
  }

  /**
   * Возврат холда слово в слово повторяет истечение брони: та же проверка на расхождение
   * сумм, та же проводка ORDER_RELEASE, тот же пересчёт кэшированных остатков. Расходиться
   * этим двум путям нельзя — они трогают одни и те же деньги.
   */
  private async releaseWalletHold(input: CancelOrderInput): Promise<bigint> {
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
      // Ключ идемпотентности тот же, что у истечения брони: освободить холд заказа можно
      // только один раз, и уникальность ключа это гарантирует на уровне базы.
      `insert into public.wallet_transactions (
         id, wallet_account_id, transaction_type, status, idempotency_key,
         reference_type, reference_id, actor_type, actor_id, reason,
         created_at, posted_at
       ) values (
         $1, $2, 'ORDER_RELEASE', 'posted', $3,
         'order', $4, 'admin', $6, 'admin_cancelled', $5, $5
       )`,
      [
        input.walletTransactionId,
        hold.wallet_account_id,
        `order_release:${input.order.id}`,
        input.order.id,
        input.cancelledAt,
        input.adminId
      ]
    );
    const updatedHold = await this.session.query(
      `update public.wallet_holds
          set status = 'released',
              released_at = $2,
              updated_at = $2
        where id = $1
          and status = 'active'`,
      [hold.id, input.cancelledAt]
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
      [hold.wallet_account_id, amount.toString(), input.cancelledAt]
    );
    if (updatedAccount.rowCount !== 1) {
      throw new Error(`Wallet account release failed for order: ${input.order.id}`);
    }

    return amount;
  }
}
