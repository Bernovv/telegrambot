import type {
  AdminOperationsRepository,
  AdminOrderDetail,
  AdminOrderSummary,
  AdminUserDetail,
  AdminUserSummary
} from "@ticket-platform/application";
import type {
  SqlConnection,
  SqlConnectionPool
} from "./postgres.js";

interface UserSummaryRow {
  readonly id: string;
  readonly display_name: string | null;
  readonly telegram_username: string | null;
  readonly phone_normalized: string | null;
  readonly phone_status: string;
  readonly is_blocked: boolean;
  readonly registered_at: Date | string;
  readonly last_seen_at: Date | string | null;
  readonly order_count: string;
  readonly paid_order_count: string;
  readonly wallet_available_kopecks: string;
  readonly wallet_held_kopecks: string;
  readonly channels: readonly AdminUserSummary["channels"][number][] | null;
}

interface OrderSummaryRow {
  readonly id: string;
  readonly number: string;
  readonly status: AdminOrderSummary["status"];
  readonly user_id: string;
  readonly user_display_name: string | null;
  readonly event_id: string;
  readonly event_title: string;
  readonly total_kopecks: string;
  readonly wallet_applied_kopecks: string;
  readonly external_due_kopecks: string;
  readonly currency: string;
  readonly ticket_count: string;
  readonly channel: AdminOrderSummary["channel"];
  readonly created_at: Date | string;
  readonly paid_at: Date | string | null;
  readonly excluded_at: Date | string | null;
  readonly excluded_reason: string | null;
}

interface UserIdentityRow {
  readonly channel: string;
  readonly external_user_id: string;
  readonly username: string | null;
  readonly first_seen_at: Date | string;
  readonly last_seen_at: Date | string;
  readonly is_bot_blocked: boolean;
}

interface UserContactRow {
  readonly contact_type: string;
  readonly value_normalized: string;
  readonly verification_status: string;
  readonly is_primary: boolean;
}

interface UserTouchpointRow {
  readonly channel: string;
  readonly source: string | null;
  readonly campaign: string | null;
  readonly partner_code: string | null;
  readonly occurred_at: Date | string;
  readonly is_first_touch: boolean;
}

interface WalletAccountRow {
  readonly currency: string;
  readonly cached_available_kopecks: string;
  readonly cached_held_kopecks: string;
  readonly status: string;
  readonly balance_version: string;
}

interface OrderDetailRow extends OrderSummaryRow {
  readonly expires_at: Date | string;
  readonly source: string;
  readonly lock_version: number;
}

export class PostgresAdminOperationsRepository
implements AdminOperationsRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  listUsers(
    input: Parameters<AdminOperationsRepository["listUsers"]>[0]
  ): Promise<readonly AdminUserSummary[]> {
    return this.read(async (connection) => {
      const result = await connection.query<UserSummaryRow>(
        `${USER_SUMMARY_SELECT}
         where users.is_deleted = false
           and ($1::text is null or (
             coalesce(users.display_name, '') ilike $1 escape '\\'
             or coalesce(identity.username_normalized, '') ilike $1 escape '\\'
             or coalesce(identity.external_user_id, '') = $2
             or coalesce(contact.value_normalized, '') ilike $1 escape '\\'
           ))
           and ($3::boolean is null or users.is_blocked = $3)
           and (
             $4::timestamptz is null
             or (users.registered_at, users.id) < ($4, $5::uuid)
           )
         order by users.registered_at desc, users.id desc
         limit $6`,
        [
          input.search ? `%${escapeLike(input.search.toLowerCase())}%` : null,
          input.search,
          input.blocked,
          input.cursor?.occurredAt ?? null,
          input.cursor?.id ?? null,
          input.limit
        ]
      );
      return result.rows.map(mapUserSummary);
    });
  }

  getUser(userId: string): Promise<AdminUserDetail | null> {
    return this.read(async (connection) => {
      const summaryResult = await connection.query<UserSummaryRow>(
        `${USER_SUMMARY_SELECT}
         where users.id = $1 and users.is_deleted = false`,
        [userId]
      );
      const summary = summaryResult.rows[0];
      if (!summary) {
        return null;
      }
      const [identities, contacts, wallets, orders, touchpoints] = await Promise.all([
        connection.query<UserIdentityRow>(
          `select channel, external_user_id, username, first_seen_at,
                  last_seen_at, is_bot_blocked
           from public.messenger_identities
           where user_id = $1
           order by channel, first_seen_at`,
          [userId]
        ),
        connection.query<UserContactRow>(
          `select contact_type, value_normalized, verification_status, is_primary
           from public.user_contacts
           where user_id = $1
           order by is_primary desc, created_at`,
          [userId]
        ),
        connection.query<WalletAccountRow>(
          `select currency, cached_available_kopecks::text,
                  cached_held_kopecks::text, status, balance_version::text
           from public.wallet_accounts
           where user_id = $1
           order by currency`,
          [userId]
        ),
        connection.query<OrderSummaryRow>(
          `${ORDER_SUMMARY_SELECT}
           where orders.user_id = $1
           order by orders.created_at desc, orders.id desc
           limit 20`,
          [userId]
        ),
        // Первое касание важнее последнего: оно отвечает на вопрос «откуда человек пришёл».
        // Берём десяток последних записей — их обычно одна-две.
        connection.query<UserTouchpointRow>(
          `select channel, source, campaign, partner_code, occurred_at, is_first_touch
           from public.user_touchpoints
           where user_id = $1
           order by is_first_touch desc, occurred_at
           limit 10`,
          [userId]
        )
      ]);
      return {
        ...mapUserSummary(summary),
        identities: identities.rows.map((row) => ({
          channel: row.channel,
          externalUserId: row.external_user_id,
          username: row.username,
          firstSeenAt: toIso(row.first_seen_at),
          lastSeenAt: toIso(row.last_seen_at),
          isBotBlocked: row.is_bot_blocked
        })),
        contacts: contacts.rows.map((row) => ({
          type: row.contact_type,
          value: row.value_normalized,
          verificationStatus: row.verification_status,
          isPrimary: row.is_primary
        })),
        touchpoints: touchpoints.rows.map((row) => ({
          channel: row.channel,
          source: row.source,
          campaign: row.campaign,
          partnerCode: row.partner_code,
          occurredAt: toIso(row.occurred_at),
          isFirstTouch: row.is_first_touch
        })),
        walletAccounts: wallets.rows.map((row) => ({
          currency: row.currency,
          availableKopecks: row.cached_available_kopecks,
          heldKopecks: row.cached_held_kopecks,
          status: row.status,
          version: row.balance_version
        })),
        recentOrders: orders.rows.map(mapOrderSummary)
      };
    });
  }

  listOrders(
    input: Parameters<AdminOperationsRepository["listOrders"]>[0]
  ): Promise<readonly AdminOrderSummary[]> {
    return this.read(async (connection) => {
      const result = await connection.query<OrderSummaryRow>(
        `${ORDER_SUMMARY_SELECT}
         left join lateral (
           select identity.username_normalized, identity.external_user_id
           from public.messenger_identities identity
           where identity.user_id = users.id and identity.channel = 'telegram'
           order by identity.first_seen_at
           limit 1
         ) identity on true
         where ($1::text is null or (
           orders.number ilike $1 escape '\\'
           or coalesce(users.display_name, '') ilike $1 escape '\\'
           or coalesce(identity.username_normalized, '') ilike $1 escape '\\'
           or coalesce(identity.external_user_id, '') = $2
         ))
           and ($3::text is null or orders.status = $3)
           and ($4::uuid is null or orders.user_id = $4)
           and ($5::uuid is null or orders.event_id = $5)
           and ($6::boolean or orders.excluded_at is null)
           and (
             $7::timestamptz is null
             or (orders.created_at, orders.id) < ($7, $8::uuid)
           )
         order by orders.created_at desc, orders.id desc
         limit $9`,
        [
          input.search ? `%${escapeLike(input.search.toLowerCase())}%` : null,
          input.search,
          input.status,
          input.userId,
          input.eventId,
          input.includeExcluded,
          input.cursor?.occurredAt ?? null,
          input.cursor?.id ?? null,
          input.limit
        ]
      );
      return result.rows.map(mapOrderSummary);
    });
  }

  getOrder(orderId: string): Promise<AdminOrderDetail | null> {
    return this.read(async (connection) => {
      const summaryResult = await connection.query<OrderDetailRow>(
        `${ORDER_SUMMARY_SELECT}
         where orders.id = $1`,
        [orderId]
      );
      const summary = summaryResult.rows[0];
      if (!summary) {
        return null;
      }
      const [items, attempts, tickets, history] = await Promise.all([
        connection.query<{
          readonly id: string;
          readonly title: string | null;
          readonly quantity: number;
          readonly unit_price_kopecks: string;
          readonly line_total_kopecks: string;
        }>(
          `select id, product_snapshot ->> 'title' as title, quantity,
                  unit_price_kopecks::text, line_total_kopecks::text
           from public.order_items
           where order_id = $1
           order by created_at, id`,
          [orderId]
        ),
        connection.query<{
          readonly id: string;
          readonly provider: string;
          readonly status: string;
          readonly amount_kopecks: string;
          readonly currency: string;
          readonly provider_status: string | null;
          readonly created_at: Date | string;
          readonly confirmed_at: Date | string | null;
        }>(
          `select id, provider, status, amount_kopecks::text, currency,
                  provider_status, created_at, confirmed_at
           from public.payment_attempts
           where order_id = $1
           order by attempt_number`,
          [orderId]
        ),
        connection.query<{
          readonly id: string;
          readonly ticket_number: string;
          readonly status: string;
          readonly issued_at: Date | string;
          readonly checked_in_at: Date | string | null;
          readonly revoked_at: Date | string | null;
        }>(
          `select id, ticket_number, status, issued_at, checked_in_at, revoked_at
           from public.tickets
           where order_id = $1
           order by sequence`,
          [orderId]
        ),
        connection.query<{
          readonly from_status: string | null;
          readonly to_status: string;
          readonly reason: string;
          readonly actor_type: string;
          readonly occurred_at: Date | string;
        }>(
          `select from_status, to_status, reason, actor_type, occurred_at
           from public.order_status_history
           where order_id = $1
           order by occurred_at, id`,
          [orderId]
        )
      ]);
      return {
        ...mapOrderSummary(summary),
        expiresAt: toIso(summary.expires_at),
        source: summary.source,
        lockVersion: summary.lock_version,
        items: items.rows.map((row) => ({
          id: row.id,
          title: row.title ?? "Untitled product",
          quantity: row.quantity,
          unitPriceKopecks: row.unit_price_kopecks,
          lineTotalKopecks: row.line_total_kopecks
        })),
        paymentAttempts: attempts.rows.map((row) => ({
          id: row.id,
          provider: row.provider,
          status: row.status,
          amountKopecks: row.amount_kopecks,
          currency: row.currency,
          providerStatus: row.provider_status,
          createdAt: toIso(row.created_at),
          confirmedAt: toNullableIso(row.confirmed_at)
        })),
        tickets: tickets.rows.map((row) => ({
          id: row.id,
          number: row.ticket_number,
          status: row.status,
          issuedAt: toIso(row.issued_at),
          checkedInAt: toNullableIso(row.checked_in_at),
          revokedAt: toNullableIso(row.revoked_at)
        })),
        history: history.rows.map((row) => ({
          fromStatus: row.from_status,
          toStatus: row.to_status,
          reason: row.reason,
          actorType: row.actor_type,
          occurredAt: toIso(row.occurred_at)
        }))
      };
    });
  }

  private async read<TResult>(
    work: (connection: SqlConnection) => Promise<TResult>
  ): Promise<TResult> {
    const connection = await this.pool.connect();
    try {
      await connection.query(
        "begin transaction isolation level repeatable read read only"
      );
      try {
        const result = await work(connection);
        await connection.query("commit");
        return result;
      } catch (error) {
        await connection.query("rollback");
        throw error;
      }
    } finally {
      connection.release();
    }
  }
}

export function createAdminOperationsPersistence(
  pool: SqlConnectionPool
): AdminOperationsRepository {
  return new PostgresAdminOperationsRepository(pool);
}

function mapUserSummary(row: UserSummaryRow): AdminUserSummary {
  return {
    id: row.id,
    displayName: row.display_name,
    telegramUsername: row.telegram_username,
    phone: row.phone_normalized,
    phoneStatus: row.phone_status,
    isBlocked: row.is_blocked,
    registeredAt: toIso(row.registered_at),
    lastSeenAt: toNullableIso(row.last_seen_at),
    orderCount: toCount(row.order_count),
    paidOrderCount: toCount(row.paid_order_count),
    walletAvailableKopecks: row.wallet_available_kopecks,
    walletHeldKopecks: row.wallet_held_kopecks,
    channels: row.channels ?? []
  };
}

function mapOrderSummary(row: OrderSummaryRow): AdminOrderSummary {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    userId: row.user_id,
    userDisplayName: row.user_display_name,
    eventId: row.event_id,
    eventTitle: row.event_title,
    totalKopecks: row.total_kopecks,
    walletAppliedKopecks: row.wallet_applied_kopecks,
    externalDueKopecks: row.external_due_kopecks,
    currency: row.currency,
    ticketCount: toCount(row.ticket_count),
    channel: row.channel,
    createdAt: toIso(row.created_at),
    paidAt: toNullableIso(row.paid_at),
    excludedAt: toNullableIso(row.excluded_at),
    excludedReason: row.excluded_reason ?? null
  };
}

function toIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Administrator read model contains an invalid timestamp");
  }
  return date.toISOString();
}

function toNullableIso(value: Date | string | null | undefined): string | null {
  return value === null || value === undefined ? null : toIso(value);
}

function toCount(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("Administrator read model contains an invalid count");
  }
  return parsed;
}



function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

const USER_SUMMARY_SELECT = `select
  users.id,
  users.display_name,
  identity.username as telegram_username,
  contact.value_normalized as phone_normalized,
  users.phone_status,
  users.is_blocked,
  users.registered_at,
  users.last_seen_at,
  coalesce(order_totals.order_count, 0)::text as order_count,
  coalesce(order_totals.paid_order_count, 0)::text as paid_order_count,
  coalesce(wallet.cached_available_kopecks, 0)::text as wallet_available_kopecks,
  coalesce(wallet.cached_held_kopecks, 0)::text as wallet_held_kopecks,
  coalesce(channels.list, array[]::text[]) as channels
from public.users users
left join lateral (
  select identity.username, identity.username_normalized, identity.external_user_id
  from public.messenger_identities identity
  where identity.user_id = users.id and identity.channel = 'telegram'
  order by identity.first_seen_at
  limit 1
) identity on true
-- Каналы человека одним подзапросом, а не join'ом: join размножил бы строку пользователя
-- на число его опознавателей, и постраничный отбор поехал бы.
left join lateral (
  select array_agg(distinct identity.channel order by identity.channel) as list
  from public.messenger_identities identity
  where identity.user_id = users.id
) channels on true
left join lateral (
  select contact.value_normalized
  from public.user_contacts contact
  where contact.user_id = users.id and contact.contact_type = 'phone'
  order by contact.is_primary desc, contact.created_at
  limit 1
) contact on true
left join lateral (
  select count(*) as order_count,
         count(*) filter (
           where orders.status in ('paid', 'partially_refunded', 'refunded')
         ) as paid_order_count
  from public.orders orders
  where orders.user_id = users.id
) order_totals on true
left join public.wallet_accounts wallet
  on wallet.user_id = users.id and wallet.currency = 'RUB'`;

const ORDER_SUMMARY_SELECT = `select
  orders.id,
  orders.number,
  orders.status,
  orders.user_id,
  users.display_name as user_display_name,
  orders.event_id,
  events.title as event_title,
  orders.total_kopecks::text,
  orders.wallet_applied_kopecks::text,
  orders.external_due_kopecks::text,
  orders.currency,
  (
    select count(*)::text
    from public.tickets ticket
    where ticket.order_id = orders.id
  ) as ticket_count,
  orders.created_at,
  orders.paid_at,
  orders.excluded_at,
  orders.excluded_reason,
  orders.expires_at,
  orders.source,
  orders.channel,
  orders.lock_version
from public.orders orders
join public.users users on users.id = orders.user_id
join public.events events on events.id = orders.event_id`;
