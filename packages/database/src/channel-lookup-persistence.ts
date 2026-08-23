import type {
  ChannelLookupKey,
  ChannelLookupQueueRepository,
  QueuedChannelLookup
} from "@ticket-platform/application";
import type { ConversationChannel } from "@ticket-platform/domain";
import type { SqlConnectionPool, SqlExecutor } from "./postgres.js";

/**
 * Очередь проверок «есть ли человек в мессенджере» со стороны того, кто их выполняет.
 *
 * Читает её процесс аккаунта компании — свой у каждого канала, — и берёт только строки
 * своего канала: спросить Telegram может лишь тот, у кого сессия Telegram.
 *
 * Порядок в очереди не «кто раньше встал»: **просьба менеджера идёт впереди автоматических
 * проверок.** Иначе загрузка тысячи строк из CSV задвинула бы живого человека, которому
 * звонят сегодня, на три недели назад.
 */

/**
 * На сколько строка считается занятой. Одна минута: сам запрос идёт доли секунды, а весь
 * запас времени здесь — на случай, если процесс умер сразу после того, как строку взял.
 */
const LOOKUP_LEASE_SECONDS = 60;

interface QueuedRow {
  readonly contact_id: string;
  readonly channel: ConversationChannel;
  readonly phone_e164: string;
  readonly attempts: number;
}

export class PostgresChannelLookupQueueRepository
implements ChannelLookupQueueRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  async claimQueued(input: {
    readonly channel: ConversationChannel;
    readonly batchSize: number;
    readonly at: Date;
  }): Promise<readonly QueuedChannelLookup[]> {
    const connection = await this.pool.connect();
    try {
      const result = await connection.query<QueuedRow>(
        `with claimed as (
           select lookup.contact_id, lookup.channel
             from public.contact_channel_lookups lookup
            where lookup.channel = $4::text
              and lookup.status = 'queued'
              and (lookup.next_attempt_at is null
                   or lookup.next_attempt_at <= $2::timestamptz)
            order by (lookup.requested_by_admin_id is not null) desc,
                     lookup.next_attempt_at nulls first,
                     lookup.requested_at
            limit $1::int
            for update of lookup skip locked
         )
         update public.contact_channel_lookups lookup
            set next_attempt_at = $2::timestamptz + make_interval(secs => $3::int),
                updated_at = $2::timestamptz
           from claimed
          where lookup.contact_id = claimed.contact_id
            and lookup.channel = claimed.channel
        returning lookup.contact_id, lookup.channel, lookup.phone_e164, lookup.attempts`,
        [input.batchSize, input.at, LOOKUP_LEASE_SECONDS, input.channel]
      );

      return result.rows.map((row) => ({
        contactId: row.contact_id,
        channel: row.channel,
        phoneE164: row.phone_e164,
        attempts: row.attempts
      }));
    } finally {
      connection.release();
    }
  }

  async countCheckedSince(input: {
    readonly channel: ConversationChannel;
    readonly since: Date;
  }): Promise<number> {
    const connection = await this.pool.connect();
    try {
      const result = await connection.query<{ readonly checked: string }>(
        `select count(*)::text as checked
           from public.contact_channel_lookups
          where channel = $1::text
            and checked_at is not null
            and checked_at >= $2::timestamptz`,
        [input.channel, input.since]
      );

      return Number(result.rows[0]?.checked ?? 0);
    } finally {
      connection.release();
    }
  }

  /**
   * Нашли — и сразу заводим ветку переписки.
   *
   * Одной транзакцией с записью ответа: панель показывает «найден» и рядом поле ввода, а
   * поле ввода пишет в ветку. Разъехавшись, эти две записи дали бы менеджеру кнопку,
   * которая ни во что не ведёт.
   *
   * Ветка может уже существовать: человек когда-то написал аккаунту сам, а карточку тогда
   * опознать не смогли. Тогда мы её не создаём заново, а достраиваем — привязываем к
   * человеку, если она была ничьей. Вся история разговора при этом приезжает в карточку.
   *
   * **Ник заодно уезжает в карточку.** Ради него половина работы и затевалась: колонку
   * «Telegram» в базе читают глазами, и ник в ней полезнее числа. Чужой ник не затираем —
   * записываем только там, где его не было.
   */
  async markFound(input: ChannelLookupKey & {
    readonly externalUserId: string;
    readonly externalChatId: string;
    readonly username: string | null;
    readonly conversationId: string;
    readonly at: Date;
  }): Promise<void> {
    const connection = await this.pool.connect();
    try {
      await connection.query("begin");
      await connection.query(
        `update public.contact_channel_lookups
            set status = 'found',
                external_user_id = $3::text,
                username = $4::text,
                attempts = attempts + 1,
                next_attempt_at = null,
                failure_reason = null,
                checked_at = $5::timestamptz,
                updated_at = $5::timestamptz
          where contact_id = $1::uuid and channel = $2::text`,
        [
          input.contactId,
          input.channel,
          input.externalUserId,
          input.username,
          input.at
        ]
      );
      await connection.query(
        `insert into public.conversations (
           id, contact_id, channel, transport, external_chat_id
         ) values ($1::uuid, $2::uuid, $3::text, 'account', $4::text)
         on conflict (channel, transport, external_chat_id) do nothing`,
        [input.conversationId, input.contactId, input.channel, input.externalChatId]
      );
      await connection.query(
        `update public.conversations
            set contact_id = $3::uuid, updated_at = $4::timestamptz
          where channel = $1::text
            and transport = 'account'
            and external_chat_id = $2::text
            and contact_id is null`,
        [input.channel, input.externalChatId, input.contactId, input.at]
      );
      await this.writeUsername(connection, input);
      await connection.query("commit");
    } catch (error) {
      await connection.query("rollback");
      throw error;
    } finally {
      connection.release();
    }
  }

  private async writeUsername(
    connection: SqlExecutor,
    input: ChannelLookupKey & { readonly username: string | null; readonly at: Date }
  ): Promise<void> {
    const username = (input.username ?? "").trim().replace(/^@/, "");
    if (username === "") {
      return;
    }
    if (input.channel === "telegram") {
      await connection.query(
        `update public.outreach_contacts
            set telegram_username = $2::text,
                telegram_username_normalized = lower($2::text),
                updated_at = $3::timestamptz
          where id = $1::uuid and telegram_username is null`,
        [input.contactId, username, input.at]
      );

      return;
    }
    if (input.channel === "max") {
      await connection.query(
        `update public.outreach_contacts
            set max_identifier = $2::text,
                max_identifier_normalized = lower($2::text),
                updated_at = $3::timestamptz
          where id = $1::uuid and max_identifier is null`,
        [input.contactId, username, input.at]
      );
    }
    // У WhatsApp ников нет: адрес человека там и есть его телефон, а он в карточке уже.
  }

  async markNotFound(input: ChannelLookupKey & { readonly at: Date }): Promise<void> {
    await this.settle(
      `update public.contact_channel_lookups
          set status = 'not_found',
              external_user_id = null,
              username = null,
              attempts = attempts + 1,
              next_attempt_at = null,
              failure_reason = null,
              checked_at = $3::timestamptz,
              updated_at = $3::timestamptz
        where contact_id = $1::uuid and channel = $2::text`,
      [input.contactId, input.channel, input.at]
    );
  }

  async markAttemptFailed(input: ChannelLookupKey & {
    readonly reason: string;
    readonly at: Date;
    readonly retryAt: Date;
  }): Promise<void> {
    await this.settle(
      `update public.contact_channel_lookups
          set attempts = attempts + 1,
              next_attempt_at = $4::timestamptz,
              failure_reason = left($3::text, 500),
              updated_at = $5::timestamptz
        where contact_id = $1::uuid and channel = $2::text`,
      [input.contactId, input.channel, input.reason, input.retryAt, input.at]
    );
  }

  async markFailed(input: ChannelLookupKey & {
    readonly reason: string;
    readonly at: Date;
  }): Promise<void> {
    await this.settle(
      `update public.contact_channel_lookups
          set status = 'failed',
              attempts = attempts + 1,
              next_attempt_at = null,
              failure_reason = left($3::text, 500),
              checked_at = $4::timestamptz,
              updated_at = $4::timestamptz
        where contact_id = $1::uuid and channel = $2::text`,
      [input.contactId, input.channel, input.reason, input.at]
    );
  }

  private async settle(text: string, values: readonly unknown[]): Promise<void> {
    const connection = await this.pool.connect();
    try {
      await connection.query(text, values);
    } finally {
      connection.release();
    }
  }
}

export function createChannelLookupQueue(pool: SqlConnectionPool) {
  return { queue: new PostgresChannelLookupQueueRepository(pool) } as const;
}
