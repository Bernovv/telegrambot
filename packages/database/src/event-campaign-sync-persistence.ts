import type {
  EventCampaignSyncRepository,
  PendingEventCampaign
} from "@ticket-platform/application";
import type { SqlConnectionPool } from "./postgres.js";

interface PendingCampaignRow {
  readonly campaign_id: string;
  readonly event_id: string;
  readonly event_title: string;
}

/**
 * Кампании, чей список участников ушёл вперёд отметки сверки.
 *
 * Отбор идёт по отметке, а не «все подряд каждый круг»: мероприятий со временем станет
 * много, а меняются в них считаные строки. Пусто в `participants_synced_at` означает
 * кампанию, которую ещё ни разу не наполняли, — их берём в первую очередь.
 *
 * Мероприятия, закончившиеся больше месяца назад, не трогаем: обзванивать по ним уже нечего,
 * а состав участников больше не меняется.
 */
export class PostgresEventCampaignSyncRepository
implements EventCampaignSyncRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  async listPendingCampaigns(input: {
    readonly at: Date;
    readonly limit: number;
  }): Promise<readonly PendingEventCampaign[]> {
    const connection = await this.pool.connect();
    try {
      const result = await connection.query<PendingCampaignRow>(
        `select campaign.id as campaign_id,
                event.id as event_id,
                event.title as event_title
         from public.outreach_campaigns campaign
         join public.events event on event.id = campaign.event_id
         where campaign.is_event_campaign
           and campaign.archived_at is null
           and campaign.status <> 'completed'
           and event.status <> 'archived'
           and coalesce(event.ends_at, event.starts_at)
               > $1::timestamptz - interval '30 days'
           and (
             campaign.participants_synced_at is null
             or exists (
               select 1
               from public.event_participants participant
               where participant.event_id = event.id
                 and participant.deleted_at is null
                 and participant.updated_at > campaign.participants_synced_at
             )
             or exists (
               select 1
               from public.orders paid
               where paid.event_id = event.id
                 and paid.status = 'paid'
                 and paid.excluded_at is null
                 and paid.updated_at > campaign.participants_synced_at
             )
           )
         order by campaign.participants_synced_at asc nulls first,
                  campaign.created_at asc,
                  campaign.id asc
         limit $2::int`,
        [input.at, input.limit]
      );
      return result.rows.map((row) => ({
        campaignId: row.campaign_id,
        eventId: row.event_id,
        eventTitle: row.event_title
      }));
    } finally {
      connection.release();
    }
  }

  async markSynced(input: {
    readonly campaignId: string;
    readonly at: Date;
  }): Promise<void> {
    const connection = await this.pool.connect();
    try {
      await connection.query(
        `update public.outreach_campaigns
         set participants_synced_at = $2::timestamptz
         where id = $1::uuid`,
        [input.campaignId, input.at]
      );
    } finally {
      connection.release();
    }
  }
}

export function createEventCampaignSyncPersistence(
  pool: SqlConnectionPool
): EventCampaignSyncRepository {
  return new PostgresEventCampaignSyncRepository(pool);
}
