import type {
  CreateSiteParticipantInput,
  RecordSiteRegistrationInput,
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
