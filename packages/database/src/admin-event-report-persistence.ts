import type {
  EventReportRepository
} from "@ticket-platform/application";
import type {
  EventAttributionRow,
  EventParticipantsView
} from "@ticket-platform/contracts";
import { PostgresAdminEventOverviewRepository } from "./admin-event-overview-persistence.js";
import type { SqlConnection, SqlConnectionPool } from "./postgres.js";

interface AttributionRow {
  readonly key: string;
  readonly contact_source: string | null;
  readonly contacted_before: boolean;
}

/**
 * Данные отчёта по мероприятию.
 *
 * Список участников не собирается заново — берётся у того же репозитория, что кормит вкладку
 * «Участники». Своё здесь только то, чего в списке нет: откуда человек в базе и звонили ли
 * ему до встречи.
 */
export class PostgresAdminEventReportRepository implements EventReportRepository {
  private readonly overview: PostgresAdminEventOverviewRepository;

  constructor(private readonly pool: SqlConnectionPool) {
    this.overview = new PostgresAdminEventOverviewRepository(pool);
  }

  loadParticipants(eventId: string): Promise<EventParticipantsView> {
    return this.overview.loadParticipants(eventId);
  }

  loadAttribution(eventId: string): Promise<readonly EventAttributionRow[]> {
    return this.read(async (connection) => {
      // Ключи те же, что строит вкладка «Участники»: `manual:<id>` у заведённого руками и
      // `order:<id>` у оплаченного заказа. Строка, которой здесь не нашлось, в отчёте
      // попадёт в «источник не указан» — и это честно: про неё мы правда ничего не знаем.
      //
      // Источник берётся из метки первого касания, а если её нет — из текстового поля
      // карточки. Порядок именно такой: метка приехала с рекламы и означает то, что
      // написано, а поле карточки заполняли руками и импортом, и у большинства в нём
      // «amoCRM export 2026-07-30». Пока меток нет ни у кого, отчёт выглядит как раньше;
      // по мере того как люди приходят с лендинга, он начинает отвечать на вопрос
      // «что приводит людей», а не «когда мы их выгрузили».
      const result = await connection.query<AttributionRow>(
        `with called as (
           select distinct activity.contact_id
           from public.outreach_activities activity
           join public.events event on event.id = $1::uuid
           where activity.occurred_at < event.starts_at
         )
         select 'manual:' || participant.id as key,
                coalesce(attribution.utm_source, contact.source) as contact_source,
                (called.contact_id is not null) as contacted_before
           from public.event_participants participant
           left join public.outreach_contacts contact
             on contact.id = participant.outreach_contact_id
           left join public.contact_attributions attribution
             on attribution.contact_id = participant.outreach_contact_id
           left join called on called.contact_id = participant.outreach_contact_id
          where participant.event_id = $1::uuid
            and participant.deleted_at is null
         union all
         -- Покупателя бота узнаём по привязке контакта к пользователю: своей строки в
         -- участниках у него нет, а метка источника у человека та же самая.
         select 'order:' || orders.id as key,
                coalesce(attribution.utm_source, contact.source) as contact_source,
                (called.contact_id is not null) as contacted_before
           from public.orders orders
           left join public.outreach_contacts contact
             on contact.linked_user_id = orders.user_id
           left join public.contact_attributions attribution
             on attribution.contact_id = contact.id
           left join called on called.contact_id = contact.id
          where orders.event_id = $1::uuid
            and orders.status = 'paid'
            and orders.excluded_at is null`,
        [eventId]
      );
      return result.rows.map((row) => ({
        key: row.key,
        contactSource: row.contact_source,
        contactedBefore: row.contacted_before
      }));
    });
  }

  countSiteRequests(eventId: string): Promise<{
    readonly total: number;
    readonly duplicates: number;
  }> {
    return this.read(async (connection) => {
      const result = await connection.query<{
        readonly total: string;
        readonly duplicates: string;
      }>(
        `select count(*)::text as total,
                count(*) filter (where status = 'duplicate')::text as duplicates
           from public.site_registrations
          where event_id = $1::uuid`,
        [eventId]
      );
      const row = result.rows[0];
      return {
        total: Number(row?.total ?? "0"),
        duplicates: Number(row?.duplicates ?? "0")
      };
    });
  }

  private async read<T>(
    work: (connection: SqlConnection) => Promise<T>
  ): Promise<T> {
    const connection = await this.pool.connect();
    try {
      await connection.query(
        "begin transaction isolation level repeatable read read only"
      );
      const result = await work(connection);
      await connection.query("commit");
      return result;
    } catch (error) {
      await connection.query("rollback");
      throw error;
    } finally {
      connection.release();
    }
  }
}

export function createAdminEventReportPersistence(pool: SqlConnectionPool): {
  readonly repository: EventReportRepository;
} {
  return { repository: new PostgresAdminEventReportRepository(pool) };
}
