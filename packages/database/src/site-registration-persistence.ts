import type {
  CreateSiteParticipantInput,
  RecordSiteRegistrationInput,
  SiteRegistrationCampaign,
  SiteRegistrationEvent,
  SiteRegistrationRepository
} from "@ticket-platform/application";
import { siteRegistrationWindowStart } from "@ticket-platform/application";
import {
  PARTICIPANT_CONTACT_SOURCE,
  resolveParticipantContact
} from "./participant-contact-link.js";
import { PostgresOutboxWriter } from "./telegram-start-persistence.js";
import {
  PostgresUnitOfWork,
  TransactionSession,
  type SqlConnectionPool
} from "./postgres.js";

interface StandingCampaignRow {
  readonly campaign_id: string;
  readonly stage: string;
  readonly call_window_start: number;
  readonly call_window_end: number;
  readonly call_window_timezone: string;
  readonly rule_id: string | null;
  readonly is_enabled: boolean | null;
  readonly task_text: string | null;
}

interface RegistrationEventRow {
  readonly id: string;
  readonly title: string;
  readonly starts_at: Date | string;
}

/**
 * Куда пишет форма сайта.
 *
 * Встреча выбирается по слагу и времени, а не приходит из запроса: открытая форма, которой
 * можно указать мероприятие, — это форма, через которую в платный пикник запишется кто угодно.
 * Слаг сравнивается с началом строки, поэтому выпуск заводят как `sreda-2026-08-26`, и запись
 * с сайта переезжает на него сама, без правки кода и перезапуска.
 *
 * Черновики тоже годятся: у бесплатной встречи нет ни каталога, ни оферты, и публиковать её
 * незачем. Отбрасываем только завершённые и архивные — они уже история.
 */
export class PostgresSiteRegistrationRepository implements SiteRegistrationRepository {
  constructor(
    private readonly session: TransactionSession,
    private readonly pool: SqlConnectionPool
  ) {}

  async findRegistrationEvent(input: {
    readonly slugPrefix: string;
    readonly now: Date;
  }): Promise<SiteRegistrationEvent | null> {
    const connection = await this.pool.connect();
    try {
      const result = await connection.query<RegistrationEventRow>(
        `select id, title, starts_at
           from public.events
          where slug like $1::text
            and status not in ('finished', 'archived')
            and starts_at >= $2::timestamptz
          order by starts_at
          limit 1`,
        [
          `${input.slugPrefix}%`,
          siteRegistrationWindowStart(input.now)
        ]
      );
      const row = result.rows[0];
      return row
        ? { id: row.id, title: row.title, startsAt: new Date(row.starts_at) }
        : null;
    } finally {
      connection.release();
    }
  }

  /**
   * Постоянная воронка направления вместе с её окном обзвона.
   *
   * Стадия — первая колонка воронки: у среды это «Новые заявки». Имя стадии в коде не
   * зашито намеренно — колонки переименовывают из кабинета, и заявка должна попадать туда,
   * куда её кладут сейчас, а не туда, как колонка называлась при написании этой строки.
   */
  async findStandingCampaign(
    slugPrefix: string
  ): Promise<SiteRegistrationCampaign | null> {
    const connection = await this.pool.connect();
    try {
      const result = await connection.query<StandingCampaignRow>(
        `select campaign.id as campaign_id,
                pipeline_column.stage,
                campaign.call_window_start,
                campaign.call_window_end,
                campaign.call_window_timezone,
                rule.id as rule_id,
                rule.is_enabled,
                rule.task_text
           from public.outreach_campaigns campaign
           left join public.outreach_task_rules rule
             on rule.campaign_id = campaign.id
            and rule.trigger_code = 'site_registration'
           join lateral (
             select stage
               from public.outreach_pipeline_columns
              where campaign_id = campaign.id
              order by position
              limit 1
           ) pipeline_column on true
          where campaign.event_slug_prefix = $1::text
            and campaign.archived_at is null
            and campaign.status <> 'completed'
          limit 1`,
        [slugPrefix]
      );
      const row = result.rows[0];
      return row
        ? {
            campaignId: row.campaign_id,
            stage: row.stage,
            callWindowStart: row.call_window_start,
            callWindowEnd: row.call_window_end,
            callWindowTimezone: row.call_window_timezone,
            taskRule: row.rule_id
              ? {
                  ruleId: row.rule_id,
                  isEnabled: row.is_enabled ?? false,
                  taskText: row.task_text ?? ""
                }
              : null
          }
        : null;
    } finally {
      connection.release();
    }
  }

  async findParticipantByPhone(input: {
    readonly eventId: string;
    readonly phoneE164: string;
  }): Promise<string | null> {
    const connection = await this.pool.connect();
    try {
      const result = await connection.query<{ readonly id: string }>(
        `select id
           from public.event_participants
          where event_id = $1::uuid
            and phone_e164 = $2::text
            and deleted_at is null
          order by created_at
          limit 1`,
        [input.eventId, input.phoneE164]
      );
      return result.rows[0]?.id ?? null;
    } finally {
      connection.release();
    }
  }

  /**
   * Участник, контакт базы и сама заявка — одной транзакцией вместе с событием исходящих.
   * Половина записанного здесь хуже, чем ничего: заявка без участника уводит организатора в
   * список, где человека нет, а участник без заявки теряет согласие на связь.
   */
  async createParticipant(input: CreateSiteParticipantInput): Promise<void> {
    const contactId = await resolveParticipantContact(this.session, {
      contactId: input.contactSeedId,
      displayName: input.name,
      phoneE164: input.phoneE164,
      telegram: null,
      email: null,
      adminId: input.createdByAdminId,
      source: PARTICIPANT_CONTACT_SOURCE
    });

    await this.session.query(
      `insert into public.event_participants (
         id, event_id, outreach_contact_id, display_name, phone_e164,
         source, ticket_title, adults, children, sleeping_places,
         note, amount_kopecks, created_by_admin_id
       ) values (
         $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text,
         'site', '', 1, 0, 0,
         $6::text, 0, $7::uuid
       )`,
      [
        input.participantId,
        input.eventId,
        contactId,
        input.name,
        input.phoneE164,
        siteNote(input.page),
        input.createdByAdminId
      ]
    );

    await this.session.query(
      `insert into public.site_registrations (
         id, event_id, participant_id, display_name, phone_e164,
         consent_at, page, status
       ) values (
         $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text,
         $6::timestamptz, $7::text, 'registered'
       )`,
      [
        input.registrationId,
        input.eventId,
        input.participantId,
        input.name,
        input.phoneE164,
        input.consentAt,
        input.page
      ]
    );

    // Контакта может не быть: он заводится по опознавателю, а у заявки с сайта его роль
    // играет телефон. Без него класть в воронку нечего.
    if (input.enrollment && contactId !== null) {
      await this.enroll(contactId, input.enrollment);
    }
  }

  /**
   * Карточка в воронке направления и звонок по ней.
   *
   * Человек мог быть в воронке и раньше — приходил на прошлую встречу или его завели
   * руками. Тогда карточка остаётся как есть, со своей стадией и историей: заявка не
   * повод отматывать работу к началу. А вот задача нужна в обоих случаях — если открытой
   * нет, звонить по свежей заявке всё равно надо.
   */
  private async enroll(
    contactId: string,
    enrollment: NonNullable<CreateSiteParticipantInput["enrollment"]>
  ): Promise<void> {
    const membership = await this.session.query<{ readonly id: string }>(
      `insert into public.outreach_campaign_contacts (
         id, campaign_id, contact_id, pipeline_stage, current_status
       ) values ($1::uuid, $2::uuid, $3::uuid, $4::text, 'new')
       on conflict (campaign_id, contact_id) do update
          set removed_at = null,
              updated_at = now()
       returning id`,
      [
        enrollment.campaignContactId,
        enrollment.campaignId,
        contactId,
        enrollment.stage
      ]
    );
    const campaignContactId = membership.rows[0]?.id;
    if (!campaignContactId || enrollment.task === null) {
      return;
    }
    await this.session.query(
      `insert into public.outreach_tasks (
         id, contact_id, campaign_contact_id, assigned_admin_id,
         created_by_admin_id, task_type, task_text, due_at, status, created_at,
         auto_rule_id, auto_key
       )
       select $1::uuid, $2::uuid, $3::uuid,
              coalesce(contact.assigned_admin_id, member.assigned_admin_id, $4::uuid),
              $4::uuid, 'call', $5::text, $6::timestamptz, 'open', now(),
              $7::uuid, $8::text
         from public.outreach_campaign_contacts member
         join public.outreach_contacts contact on contact.id = member.contact_id
        where member.id = $3::uuid
          and not exists (
            select 1 from public.outreach_tasks open_task
             where open_task.campaign_contact_id = member.id
               and open_task.status = 'open'
          )
       on conflict do nothing`,
      [
        enrollment.task.taskId,
        contactId,
        campaignContactId,
        enrollment.assignedAdminId,
        enrollment.task.text,
        enrollment.task.dueAt,
        enrollment.task.ruleId,
        // Ключ повтора описывает повод: одна заявка — один звонок. Повторная отправка
        // формы тем же человеком заводит новую заявку и новый ключ, но задача всё равно
        // не встанет, пока открыта прежняя.
        enrollment.task.ruleId ? `registration:${enrollment.task.taskId}` : null
      ]
    );
  }

  async recordRegistration(input: RecordSiteRegistrationInput): Promise<void> {
    await this.session.query(
      `insert into public.site_registrations (
         id, event_id, participant_id, display_name, phone_e164,
         consent_at, page, status
       ) values (
         $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text,
         $6::timestamptz, $7::text, $8::text
       )`,
      [
        input.registrationId,
        input.eventId,
        input.participantId,
        input.name,
        input.phoneE164,
        input.consentAt,
        input.page,
        input.status
      ]
    );
  }
}

export function createSiteRegistrationPersistence(pool: SqlConnectionPool) {
  const session = new TransactionSession();

  return {
    repository: new PostgresSiteRegistrationRepository(session, pool),
    outboxWriter: new PostgresOutboxWriter(session),
    unitOfWork: new PostgresUnitOfWork(pool, session)
  } as const;
}

/** Примечание участника: откуда он взялся. Видно прямо в списке, без похода в заявки. */
function siteNote(page: string): string {
  return (page === "" ? "Заявка с сайта" : `Заявка с сайта: ${page}`).slice(0, 500);
}
