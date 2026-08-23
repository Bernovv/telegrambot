import type {
  QueuedPhoneLookup,
  TelegramPhoneLookupQueueRepository
} from "@ticket-platform/application";
import type { SqlConnectionPool } from "./postgres.js";

/**
 * Очередь поисков в Telegram по номеру со стороны того, кто их выполняет.
 *
 * Читает её только процесс аккаунта компании: спросить Telegram больше некому. Отбора по
 * каналу и транспорту здесь поэтому нет — в отличие от очереди ответов, где отправителей
 * несколько и чужую строку забирать нельзя.
 */

/**
 * На сколько строка считается занятой. Одна минута: сам запрос идёт доли секунды, а весь
 * запас времени здесь — на случай, если процесс умер сразу после того, как строку взял.
 */
const LOOKUP_LEASE_SECONDS = 60;

export class PostgresTelegramPhoneLookupQueueRepository
implements TelegramPhoneLookupQueueRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  async claimQueued(input: {
    readonly batchSize: number;
    readonly at: Date;
  }): Promise<readonly QueuedPhoneLookup[]> {
    const connection = await this.pool.connect();
    try {
      const result = await connection.query<{
        readonly id: string;
        readonly contact_id: string;
        readonly phone_e164: string;
        readonly attempts: number;
      }>(
        `with claimed as (
           select lookup.id
             from public.telegram_phone_lookups lookup
            where lookup.status = 'queued'
              and (lookup.next_attempt_at is null
                   or lookup.next_attempt_at <= $2::timestamptz)
            order by lookup.next_attempt_at nulls first, lookup.requested_at
            limit $1::int
            for update of lookup skip locked
         )
         update public.telegram_phone_lookups lookup
            set next_attempt_at = $2::timestamptz + make_interval(secs => $3::int),
                updated_at = $2::timestamptz
           from claimed
          where lookup.id = claimed.id
        returning lookup.id, lookup.contact_id, lookup.phone_e164, lookup.attempts`,
        [input.batchSize, input.at, LOOKUP_LEASE_SECONDS]
      );

      return result.rows.map((row) => ({
        lookupId: row.id,
        contactId: row.contact_id,
        phoneE164: row.phone_e164,
        attempts: row.attempts
      }));
    } finally {
      connection.release();
    }
  }

  /**
   * Нашли — и сразу заводим ветку переписки.
   *
   * Одной транзакцией с записью ответа: панель показывает «найден» и рядом поле ввода, а
   * поле ввода пишет в ветку. Разъехавшись, эти две записи дали бы менеджеру кнопку,
   * которая ни во что не ведёт, — ровно то, чего эта работа и должна была избежать.
   *
   * Ветка может уже существовать: человек когда-то написал аккаунту сам, а карточку тогда
   * опознать не смогли. Тогда мы её не создаём заново, а достраиваем — привязываем к
   * человеку, если она была ничьей. Вся история разговора при этом приезжает в карточку.
   */
  async markFound(input: {
    readonly lookupId: string;
    readonly contactId: string;
    readonly telegramUserId: string;
    readonly conversationId: string;
    readonly at: Date;
  }): Promise<void> {
    const connection = await this.pool.connect();
    try {
      await connection.query("begin");
      await connection.query(
        `update public.telegram_phone_lookups
            set status = 'found',
                telegram_user_id = $2::text,
                attempts = attempts + 1,
                next_attempt_at = null,
                failure_reason = null,
                checked_at = $3::timestamptz,
                updated_at = $3::timestamptz
          where id = $1::uuid`,
        [input.lookupId, input.telegramUserId, input.at]
      );
      await connection.query(
        `insert into public.conversations (
           id, contact_id, channel, transport, external_chat_id
         ) values ($1::uuid, $2::uuid, 'telegram', 'account', $3::text)
         on conflict (channel, transport, external_chat_id) do nothing`,
        [input.conversationId, input.contactId, input.telegramUserId]
      );
      await connection.query(
        `update public.conversations
            set contact_id = $2::uuid, updated_at = $3::timestamptz
          where channel = 'telegram'
            and transport = 'account'
            and external_chat_id = $1::text
            and contact_id is null`,
        [input.telegramUserId, input.contactId, input.at]
      );
      await connection.query("commit");
    } catch (error) {
      await connection.query("rollback");
      throw error;
    } finally {
      connection.release();
    }
  }

  async markNotFound(input: {
    readonly lookupId: string;
    readonly at: Date;
  }): Promise<void> {
    await this.settle(
      `update public.telegram_phone_lookups
          set status = 'not_found',
              telegram_user_id = null,
              attempts = attempts + 1,
              next_attempt_at = null,
              failure_reason = null,
              checked_at = $2::timestamptz,
              updated_at = $2::timestamptz
        where id = $1::uuid`,
      [input.lookupId, input.at]
    );
  }

  async markAttemptFailed(input: {
    readonly lookupId: string;
    readonly reason: string;
    readonly at: Date;
    readonly retryAt: Date;
  }): Promise<void> {
    await this.settle(
      `update public.telegram_phone_lookups
          set attempts = attempts + 1,
              next_attempt_at = $3::timestamptz,
              failure_reason = left($2::text, 500),
              updated_at = $4::timestamptz
        where id = $1::uuid`,
      [input.lookupId, input.reason, input.retryAt, input.at]
    );
  }

  async markFailed(input: {
    readonly lookupId: string;
    readonly reason: string;
    readonly at: Date;
  }): Promise<void> {
    await this.settle(
      `update public.telegram_phone_lookups
          set status = 'failed',
              attempts = attempts + 1,
              next_attempt_at = null,
              failure_reason = left($2::text, 500),
              checked_at = $3::timestamptz,
              updated_at = $3::timestamptz
        where id = $1::uuid`,
      [input.lookupId, input.reason, input.at]
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

export function createTelegramPhoneLookupQueue(pool: SqlConnectionPool) {
  return { queue: new PostgresTelegramPhoneLookupQueueRepository(pool) } as const;
}
