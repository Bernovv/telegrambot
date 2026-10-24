import type {
  GreetingLookupStatus,
  PendingGreeting,
  RegistrationGreetingRepository
} from "@ticket-platform/application";
import type { ConversationChannel } from "@ticket-platform/domain";
import { recordTouchpoint } from "./conversation-touchpoint.js";
import type { SqlConnectionPool } from "./postgres.js";

interface PendingRow {
  readonly registration_id: string;
  readonly contact_id: string;
  readonly registered_at: Date | string;
  readonly display_name: string;
  readonly title: string;
  readonly starts_at: Date | string;
  readonly timezone: string;
  readonly location_name: string | null;
  readonly location_address: string | null;
  readonly greeting_enabled: boolean;
  readonly event_phrase: string | null;
  readonly body_template: string | null;
  readonly lookups: Readonly<Record<string, GreetingLookupStatus>> | null;
  readonly conversations: Readonly<Record<string, string>> | null;
  readonly contacted: boolean;
}

/**
 * Приветствия по заявкам с сайта.
 *
 * Читается всё, что нужно для решения, одним запросом: ответы проверки номера и ветки
 * переписки по каналам. Решение принимает прикладной слой, а здесь — только его запись.
 */
export class PostgresRegistrationGreetingRepository
implements RegistrationGreetingRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  async listPending(input: {
    readonly batchSize: number;
  }): Promise<readonly PendingGreeting[]> {
    const connection = await this.pool.connect();
    try {
      // Ветка — от аккаунта и самая свежая на канал: у человека, который когда-то писал
      // аккаунту сам, ветка могла завестись раньше проверки, и писать надо в неё же.
      //
      // «Уже писали» — любая исходящая реплика после заявки, от аккаунта или от бота.
      // Менеджер, позвонивший и написавший сам, сделал работу приветствия лучше него.
      const result = await connection.query<PendingRow>(
        `select greeting.registration_id,
                greeting.contact_id,
                greeting.created_at as registered_at,
                registration.display_name,
                event.title,
                event.starts_at,
                event.timezone,
                event.location_name,
                event.location_address,
                coalesce(settings.is_enabled, true) as greeting_enabled,
                settings.event_phrase,
                settings.body_template,
                (select json_object_agg(lookup.channel, lookup.status)
                   from public.contact_channel_lookups lookup
                  where lookup.contact_id = greeting.contact_id) as lookups,
                (select json_object_agg(latest.channel, latest.id)
                   from (
                     select distinct on (conversation.channel)
                            conversation.channel, conversation.id
                       from public.conversations conversation
                      where conversation.contact_id = greeting.contact_id
                        and conversation.transport = 'account'
                      order by conversation.channel,
                               conversation.last_message_at desc nulls last,
                               conversation.created_at desc
                   ) latest) as conversations,
                exists (
                  select 1
                    from public.conversation_messages message
                    join public.conversations conversation
                      on conversation.id = message.conversation_id
                   where conversation.contact_id = greeting.contact_id
                     and message.direction = 'outbound'
                     and message.occurred_at >= greeting.created_at
                ) as contacted
           from public.registration_greetings greeting
           join public.site_registrations registration
             on registration.id = greeting.registration_id
           join public.events event on event.id = greeting.event_id
           left join public.event_greetings settings on settings.event_id = greeting.event_id
          where greeting.status = 'pending'
          order by greeting.created_at
          limit $1::int`,
        [input.batchSize]
      );

      return result.rows.map((row) => ({
        registrationId: row.registration_id,
        contactId: row.contact_id,
        registeredAt: new Date(row.registered_at),
        name: row.display_name,
        event: {
          title: row.title,
          phrase: row.event_phrase,
          startsAt: new Date(row.starts_at),
          timeZone: row.timezone,
          locationName: row.location_name,
          locationAddress: row.location_address,
          greetingEnabled: row.greeting_enabled,
          template: row.body_template
        },
        lookups: row.lookups ?? {},
        conversations: row.conversations ?? {},
        contactedSinceRegistration: row.contacted
      }));
    } finally {
      connection.release();
    }
  }

  async countQueuedSince(input: {
    readonly since: Date;
  }): Promise<Readonly<Partial<Record<ConversationChannel, number>>>> {
    const connection = await this.pool.connect();
    try {
      const result = await connection.query<{
        readonly channel: ConversationChannel;
        readonly queued: string;
      }>(
        `select channel, count(*)::text as queued
           from public.registration_greetings
          where status = 'queued'
            and decided_at >= $1::timestamptz
          group by channel`,
        [input.since]
      );

      return Object.fromEntries(
        result.rows.map((row) => [row.channel, Number(row.queued)])
      );
    } finally {
      connection.release();
    }
  }

  /**
   * Реплика, ветка, касание и решение — одной транзакцией.
   *
   * Строку приветствия запираем первой и проверяем, что она всё ещё ждёт: два прохода,
   * взявших одну заявку, иначе положили бы человеку два одинаковых сообщения. Реплика
   * ложится в очередь от имени бота, а не менеджера: её никто не писал руками, и в ленте
   * это должно быть видно. Отправит её процесс аккаунта, как любой ответ из панели.
   */
  async queueGreeting(input: {
    readonly registrationId: string;
    readonly contactId: string;
    readonly actorAdminId: string;
    readonly channel: ConversationChannel;
    readonly conversationId: string;
    readonly messageId: string;
    readonly body: string;
    readonly at: Date;
  }): Promise<boolean> {
    const connection = await this.pool.connect();
    try {
      await connection.query("begin");
      try {
        const locked = await connection.query<{ readonly registration_id: string }>(
          `select registration_id
             from public.registration_greetings
            where registration_id = $1::uuid and status = 'pending'
            for update`,
          [input.registrationId]
        );
        if (locked.rows.length === 0) {
          await connection.query("rollback");
          return false;
        }

        await connection.query(
          `insert into public.conversation_messages (
             id, conversation_id, direction, author_kind, author_admin_id, body,
             delivery_status, occurred_at
           ) values (
             $1::uuid, $2::uuid, 'outbound', 'bot', null, $3::text,
             'queued', $4::timestamptz
           )`,
          [input.messageId, input.conversationId, input.body, input.at]
        );
        // Ветка, заведённая проверкой номера, до сих пор была пустой и в «Переписках» не
        // показывалась. С первой репликой она становится разговором — и там появляется.
        await connection.query(
          `update public.conversations
              set last_message_at = greatest(coalesce(last_message_at, $2::timestamptz), $2::timestamptz),
                  status = 'open',
                  updated_at = now()
            where id = $1::uuid`,
          [input.conversationId, input.at]
        );
        await connection.query(
          `update public.registration_greetings
              set status = 'queued',
                  channel = $2::text,
                  message_id = $3::uuid,
                  decided_at = $4::timestamptz,
                  updated_at = $4::timestamptz
            where registration_id = $1::uuid`,
          [input.registrationId, input.channel, input.messageId, input.at]
        );
        await recordTouchpoint(connection, {
          contactId: input.contactId,
          channel: input.channel,
          actorAdminId: input.actorAdminId,
          result: "sent",
          note: input.body,
          occurredAt: input.at,
          activityId: input.messageId
        });

        await connection.query("commit");
        return true;
      } catch (error) {
        await connection.query("rollback");
        throw error;
      }
    } finally {
      connection.release();
    }
  }

  async markNoChannel(input: {
    readonly registrationId: string;
    readonly at: Date;
  }): Promise<void> {
    const connection = await this.pool.connect();
    try {
      await connection.query(
        `update public.registration_greetings
            set status = 'no_channel',
                decided_at = $2::timestamptz,
                updated_at = $2::timestamptz
          where registration_id = $1::uuid and status = 'pending'`,
        [input.registrationId, input.at]
      );
    } finally {
      connection.release();
    }
  }

  async markSkipped(input: {
    readonly registrationId: string;
    readonly reason: string;
    readonly at: Date;
  }): Promise<void> {
    const connection = await this.pool.connect();
    try {
      await connection.query(
        `update public.registration_greetings
            set status = 'skipped',
                skip_reason = $2::text,
                decided_at = $3::timestamptz,
                updated_at = $3::timestamptz
          where registration_id = $1::uuid and status = 'pending'`,
        [input.registrationId, input.reason.slice(0, 500), input.at]
      );
    } finally {
      connection.release();
    }
  }
}

export function createRegistrationGreetingPersistence(pool: SqlConnectionPool) {
  return { repository: new PostgresRegistrationGreetingRepository(pool) } as const;
}
