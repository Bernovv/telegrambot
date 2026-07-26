import type {
  AdminPurchaseContext,
  ClaimNotificationDeliveryInput,
  ClaimNotificationDeliveryResult,
  NotificationContextRepository,
  NotificationDeliveryLedger,
  ScenarioDeliveryContext,
  TicketDeliveryContext
} from "@ticket-platform/application";
import type {
  SqlConnectionPool,
  SqlQueryResult
} from "./postgres.js";

interface TicketOrderContextRow {
  readonly order_id: string;
  readonly order_number: string;
  readonly event_title: string;
  readonly recipient_external_user_id: string | null;
  readonly recipient_blocked: boolean | null;
}

interface TicketRow {
  readonly id: string;
  readonly ticket_number: string;
}

interface AdminPurchaseContextRow {
  readonly order_id: string;
  readonly order_number: string;
  readonly user_id: string;
  readonly event_title: string;
  readonly username: string | null;
  readonly ticket_count: string;
  readonly total_kopecks: string;
  readonly wallet_applied_kopecks: string;
  readonly external_due_kopecks: string;
}

interface DeliveryStateRow {
  readonly id: string;
  readonly status: "pending" | "sending" | "sent" | "failed";
}

interface ScenarioDeliveryContextRow {
  readonly recipient_external_user_id: string | null;
  readonly recipient_blocked: boolean | null;
}

export class PostgresNotificationContextRepository
implements NotificationContextRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  async getTicketDeliveryContext(
    orderId: string,
    ticketIds: readonly string[],
    ownerUserId: string | null
  ): Promise<TicketDeliveryContext | null> {
    const orderResult = await query<TicketOrderContextRow>(
      this.pool,
      `select
         orders.id as order_id,
         orders.number as order_number,
         coalesce(nullif(orders.event_snapshot ->> 'title', ''), events.title) as event_title,
         identity.external_user_id as recipient_external_user_id,
         identity.is_bot_blocked as recipient_blocked
       from public.orders orders
       join public.events events on events.id = orders.event_id
       left join lateral (
         select external_user_id, is_bot_blocked
         from public.messenger_identities
         where user_id = orders.user_id
           and channel = 'telegram'
         order by last_seen_at desc, id
         limit 1
       ) identity on true
       where orders.id = $1
         and orders.status in ('paid', 'partially_refunded')
         and ($2::uuid is null or orders.user_id = $2)`,
      [orderId, ownerUserId]
    );
    const order = orderResult.rows[0];
    if (!order) {
      return null;
    }

    const ticketResult = await query<TicketRow>(
      this.pool,
      `select id, ticket_number
       from public.tickets
       where order_id = $1
         and id = any($2::uuid[])
         and ($3::uuid is null or owner_user_id = $3)
         and status = 'issued'
       order by ticket_number`,
      [orderId, ticketIds, ownerUserId]
    );

    return {
      orderId: order.order_id,
      orderNumber: order.order_number,
      eventTitle: order.event_title,
      recipientExternalUserId: order.recipient_external_user_id,
      recipientBlocked: order.recipient_blocked ?? false,
      tickets: ticketResult.rows.map((ticket) => ({
        id: ticket.id,
        ticketNumber: ticket.ticket_number
      }))
    };
  }

  async getAdminPurchaseContext(orderId: string): Promise<AdminPurchaseContext | null> {
    const result = await query<AdminPurchaseContextRow>(
      this.pool,
      `select
         orders.id as order_id,
         orders.number as order_number,
         orders.user_id,
         coalesce(nullif(orders.event_snapshot ->> 'title', ''), events.title) as event_title,
         identity.username,
         (select count(*)::text from public.tickets where order_id = orders.id) as ticket_count,
         orders.total_kopecks::text,
         orders.wallet_applied_kopecks::text,
         orders.external_due_kopecks::text
       from public.orders orders
       join public.events events on events.id = orders.event_id
       left join lateral (
         select username
         from public.messenger_identities
         where user_id = orders.user_id
           and channel = 'telegram'
         order by last_seen_at desc, id
         limit 1
       ) identity on true
       where orders.id = $1
         and orders.status = 'paid'`,
      [orderId]
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }

    const ticketCount = Number(row.ticket_count);
    if (!Number.isSafeInteger(ticketCount) || ticketCount < 1) {
      throw new Error(`Purchase notification ticket count is invalid: ${orderId}`);
    }

    return {
      orderId: row.order_id,
      orderNumber: row.order_number,
      userId: row.user_id,
      eventTitle: row.event_title,
      username: row.username,
      ticketCount,
      totalKopecks: BigInt(row.total_kopecks),
      walletKopecks: BigInt(row.wallet_applied_kopecks),
      externalKopecks: BigInt(row.external_due_kopecks)
    };
  }

  async getScenarioDeliveryContext(
    userId: string
  ): Promise<ScenarioDeliveryContext | null> {
    const result = await query<ScenarioDeliveryContextRow>(
      this.pool,
      `select
         identity.external_user_id as recipient_external_user_id,
         identity.is_bot_blocked as recipient_blocked
       from public.users users
       left join lateral (
         select external_user_id, is_bot_blocked
         from public.messenger_identities
         where user_id = users.id
           and channel = 'telegram'
         order by last_seen_at desc, id
         limit 1
       ) identity on true
       where users.id = $1`,
      [userId]
    );
    const row = result.rows[0];
    return row
      ? {
          recipientExternalUserId: row.recipient_external_user_id,
          recipientBlocked: row.recipient_blocked ?? false
        }
      : null;
  }
}

export class PostgresNotificationDeliveryLedger
implements NotificationDeliveryLedger {
  constructor(private readonly pool: SqlConnectionPool) {}

  async claim(
    input: ClaimNotificationDeliveryInput
  ): Promise<ClaimNotificationDeliveryResult> {
    const connection = await this.pool.connect();

    try {
      await connection.query("begin");
      await connection.query(
        `insert into public.notification_deliveries (
           id, idempotency_key, source_event_id, kind, aggregate_id,
           recipient_channel, recipient_id, status, created_at, updated_at
         ) values (
           $1, $2, $3, $4, $5,
           'telegram', $6, 'pending', $7, $7
         )
         on conflict (idempotency_key) do nothing`,
        [
          input.deliveryId,
          input.idempotencyKey,
          input.sourceEventId,
          input.kind,
          input.aggregateId,
          input.recipientId,
          input.claimedAt
        ]
      );
      const claimed = await connection.query<DeliveryStateRow>(
        `update public.notification_deliveries
         set status = 'sending',
             attempt_count = attempt_count + 1,
             lease_owner = $2,
             lease_expires_at = $3 + ($4 * interval '1 second'),
             last_error_code = null,
             updated_at = $3
         where idempotency_key = $1
           and (
             status in ('pending', 'failed')
             or (status = 'sending' and lease_expires_at <= $3)
           )
         returning id, status`,
        [
          input.idempotencyKey,
          input.workerId,
          input.claimedAt,
          input.leaseSeconds
        ]
      );
      const claimedRow = claimed.rows[0];
      if (claimedRow) {
        await connection.query("commit");
        return { state: "claimed", deliveryId: claimedRow.id };
      }

      const current = await connection.query<DeliveryStateRow>(
        `select id, status
         from public.notification_deliveries
         where idempotency_key = $1
         for update`,
        [input.idempotencyKey]
      );
      const currentRow = current.rows[0];
      if (!currentRow) {
        throw new Error("Notification delivery claim disappeared");
      }

      await connection.query("commit");
      return {
        state: currentRow.status === "sent" ? "sent" : "busy",
        deliveryId: currentRow.id
      };
    } catch (error) {
      await connection.query("rollback");
      throw error;
    } finally {
      connection.release();
    }
  }

  async markSent(
    deliveryId: string,
    workerId: string,
    providerMessageId: string,
    sentAt: Date
  ): Promise<void> {
    const result = await query(
      this.pool,
      `update public.notification_deliveries
       set status = 'sent',
           lease_owner = null,
           lease_expires_at = null,
           provider_message_id = $3,
           last_error_code = null,
           sent_at = $4,
           updated_at = $4
       where id = $1
         and status = 'sending'
         and lease_owner = $2`,
      [deliveryId, workerId, providerMessageId, sentAt]
    );
    if (result.rowCount !== 1) {
      throw new Error(`Notification delivery sent lease was lost: ${deliveryId}`);
    }
  }

  async markFailed(
    deliveryId: string,
    workerId: string,
    errorCode: string,
    failedAt: Date
  ): Promise<void> {
    const result = await query(
      this.pool,
      `update public.notification_deliveries
       set status = 'failed',
           lease_owner = null,
           lease_expires_at = null,
           last_error_code = $3,
           updated_at = $4
       where id = $1
         and status = 'sending'
         and lease_owner = $2`,
      [deliveryId, workerId, errorCode, failedAt]
    );
    if (result.rowCount !== 1) {
      throw new Error(`Notification delivery failed lease was lost: ${deliveryId}`);
    }
  }
}

export function createNotificationDeliveryPersistence(pool: SqlConnectionPool) {
  return {
    notificationContexts: new PostgresNotificationContextRepository(pool),
    notificationLedger: new PostgresNotificationDeliveryLedger(pool)
  } as const;
}

async function query<TRow = never>(
  pool: SqlConnectionPool,
  text: string,
  values: readonly unknown[] = []
): Promise<SqlQueryResult<TRow>> {
  const connection = await pool.connect();

  try {
    return await connection.query<TRow>(text, values);
  } finally {
    connection.release();
  }
}
