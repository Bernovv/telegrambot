import type {
  ParticipantExportRow,
  ParticipantsExportRepository
} from "@ticket-platform/application";
import type { SqlConnectionPool, SqlQueryResult } from "./postgres.js";

interface ParticipantExportRowResult {
  readonly order_number: string;
  readonly paid_at: string;
  readonly ticket_number: string;
  readonly ticket_status: string;
  readonly user_display_name: string | null;
  readonly telegram_username: string | null;
  readonly phone: string | null;
  readonly q_name: string | null;
  readonly q_city: string | null;
  readonly q_niche: string | null;
  readonly q_stage: string | null;
  readonly q_wish: string | null;
  readonly q_focus_area: string | null;
  readonly q_join_chat: boolean | null;
}

export class PostgresParticipantsExportRepository
  implements ParticipantsExportRepository
{
  constructor(private readonly pool: SqlConnectionPool) {}

  async listPaidParticipants(
    eventId: string
  ): Promise<readonly ParticipantExportRow[]> {
    const result = await query<ParticipantExportRowResult>(
      this.pool,
      `select
         o.number as order_number,
         o.paid_at as paid_at,
         t.ticket_number as ticket_number,
         t.status as ticket_status,
         u.display_name as user_display_name,
         identity.username as telegram_username,
         contact.value_normalized as phone,
         q.name as q_name,
         q.city as q_city,
         q.niche as q_niche,
         q.stage as q_stage,
         q.wish as q_wish,
         q.focus_area as q_focus_area,
         q.join_chat as q_join_chat
       from public.orders o
       join public.tickets t on t.order_id = o.id
       join public.users u on u.id = o.user_id
       left join public.participant_questionnaire_responses q
         on q.order_id = o.id
       left join lateral (
         select username
         from public.messenger_identities
         where user_id = o.user_id and channel = 'telegram'
         order by last_seen_at desc, id
         limit 1
       ) identity on true
       left join lateral (
         select value_normalized
         from public.user_contacts
         where user_id = o.user_id and contact_type = 'phone'
         order by is_primary desc, created_at
         limit 1
       ) contact on true
       where o.event_id = $1
         and o.paid_at is not null
         and t.status <> 'revoked'
       order by o.paid_at, t.sequence`,
      [eventId]
    );

    return result.rows.map((row) => ({
      orderNumber: row.order_number,
      paidAt: new Date(row.paid_at).toISOString(),
      ticketNumber: row.ticket_number,
      ticketStatus: row.ticket_status,
      userDisplayName: row.user_display_name,
      telegramUsername: row.telegram_username,
      phone: row.phone,
      questionnaire:
        row.q_name !== null
          && row.q_city !== null
          && row.q_niche !== null
          && row.q_stage !== null
          && row.q_wish !== null
          && row.q_focus_area !== null
          && row.q_join_chat !== null
          ? {
            name: row.q_name,
            city: row.q_city,
            niche: row.q_niche,
            stage: row.q_stage,
            wish: row.q_wish,
            focusArea: row.q_focus_area,
            joinChat: row.q_join_chat
          }
          : null
    }));
  }
}

export function createParticipantsExportPersistence(
  pool: SqlConnectionPool
): ParticipantsExportRepository {
  return new PostgresParticipantsExportRepository(pool);
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
