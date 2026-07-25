import type {
  RedeliverableTicket,
  TelegramTicketAccessRepository
} from "@ticket-platform/application";
import type { TelegramTicketSummary } from "@ticket-platform/contracts";
import {
  PostgresIdempotencyRepository,
  PostgresOutboxWriter
} from "./telegram-start-persistence.js";
import {
  PostgresUnitOfWork,
  TransactionSession,
  type SqlConnectionPool
} from "./postgres.js";

interface IdentityRow {
  readonly user_id: string;
}

interface TicketSummaryRow {
  readonly ticket_id: string;
  readonly ticket_number: string;
  readonly order_number: string;
  readonly event_title: string;
  readonly status: TelegramTicketSummary["status"];
  readonly issued_at: Date;
}

interface RedeliverableTicketRow {
  readonly ticket_id: string;
  readonly ticket_number: string;
  readonly order_id: string;
  readonly owner_user_id: string;
  readonly status: TelegramTicketSummary["status"];
}

export class PostgresTelegramTicketAccessRepository
implements TelegramTicketAccessRepository {
  constructor(
    private readonly pool: SqlConnectionPool,
    private readonly session: TransactionSession
  ) {}

  async listForTelegramUser(
    senderExternalUserId: string
  ): Promise<readonly TelegramTicketSummary[] | null> {
    const connection = await this.pool.connect();

    try {
      const identityResult = await connection.query<IdentityRow>(
        `select identity.user_id
         from public.messenger_identities identity
         join public.users users on users.id = identity.user_id
         where identity.channel = 'telegram'
           and identity.external_user_id = $1
           and users.is_deleted = false`,
        [senderExternalUserId]
      );
      const identity = identityResult.rows[0];
      if (!identity) {
        return null;
      }

      const tickets = await connection.query<TicketSummaryRow>(
        `select
           tickets.id as ticket_id,
           tickets.ticket_number,
           orders.number as order_number,
           coalesce(nullif(orders.event_snapshot ->> 'title', ''), events.title) as event_title,
           tickets.status,
           tickets.issued_at
         from public.tickets tickets
         join public.orders orders on orders.id = tickets.order_id
         join public.events events on events.id = tickets.event_id
         where tickets.owner_user_id = $1
         order by tickets.issued_at desc, tickets.ticket_number`,
        [identity.user_id]
      );

      return tickets.rows.map(mapTicketSummary);
    } finally {
      connection.release();
    }
  }

  async lockOwnedTicketForRedelivery(
    ticketId: string,
    senderExternalUserId: string
  ): Promise<RedeliverableTicket | null> {
    const result = await this.session.query<RedeliverableTicketRow>(
      `select
         tickets.id as ticket_id,
         tickets.ticket_number,
         tickets.order_id,
         tickets.owner_user_id,
         tickets.status
       from public.tickets tickets
       join public.messenger_identities identity
         on identity.user_id = tickets.owner_user_id
        and identity.channel = 'telegram'
       join public.users users on users.id = tickets.owner_user_id
       where tickets.id = $1
         and identity.external_user_id = $2
         and users.is_deleted = false
       for update of tickets`,
      [ticketId, senderExternalUserId]
    );
    const row = result.rows[0];

    return row
      ? {
          ticketId: row.ticket_id,
          ticketNumber: row.ticket_number,
          orderId: row.order_id,
          ownerUserId: row.owner_user_id,
          status: row.status
        }
      : null;
  }
}

export function createTelegramTicketAccessPersistence(
  pool: SqlConnectionPool
) {
  const session = new TransactionSession();

  return {
    ticketAccessRepository: new PostgresTelegramTicketAccessRepository(pool, session),
    idempotencyRepository: new PostgresIdempotencyRepository(session),
    outboxWriter: new PostgresOutboxWriter(session),
    unitOfWork: new PostgresUnitOfWork(pool, session)
  } as const;
}

function mapTicketSummary(row: TicketSummaryRow): TelegramTicketSummary {
  return {
    ticketId: row.ticket_id,
    ticketNumber: row.ticket_number,
    orderNumber: row.order_number,
    eventTitle: row.event_title,
    status: row.status,
    issuedAt: row.issued_at.toISOString()
  };
}
