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
        `with pending as (
           -- Кампания одного мероприятия: как было.
           select campaign.id as campaign_id,
                  campaign.participants_synced_at,
                  campaign.created_at,
                  event.id as event_id,
                  event.title as event_title
             from public.outreach_campaigns campaign
             join public.events event on event.id = campaign.event_id
            where campaign.is_event_campaign
              and campaign.archived_at is null
              and campaign.status <> 'completed'
              and event.status <> 'archived'
           union all
           -- Постоянная воронка направления: столько строк, сколько у неё мероприятий.
           -- Участники всех встреч едут в одну воронку, поэтому и сверять надо каждую.
           select campaign.id as campaign_id,
                  campaign.participants_synced_at,
                  campaign.created_at,
                  event.id as event_id,
                  event.title as event_title
             from public.outreach_campaigns campaign
             join public.events event
               on event.slug like campaign.event_slug_prefix || '%'
            where campaign.event_slug_prefix is not null
              and campaign.archived_at is null
              and campaign.status <> 'completed'
              and event.status <> 'archived'
         )
         select pending.campaign_id, pending.event_id, pending.event_title
           from pending
           join public.events event on event.id = pending.event_id
          where coalesce(event.ends_at, event.starts_at)
                > $1::timestamptz - interval '30 days'
            and (
              pending.participants_synced_at is null
              or exists (
                select 1
                  from public.event_participants participant
                 where participant.event_id = pending.event_id
                   and participant.deleted_at is null
                   and participant.updated_at > pending.participants_synced_at
              )
              or exists (
                select 1
                  from public.orders paid
                 where paid.event_id = pending.event_id
                   and paid.status = 'paid'
                   and paid.excluded_at is null
                   and paid.updated_at > pending.participants_synced_at
              )
            )
          order by pending.participants_synced_at asc nulls first,
                   pending.created_at asc,
                   pending.campaign_id asc,
                   pending.event_id asc
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
