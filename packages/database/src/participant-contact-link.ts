import { parseTelegramUsername } from "@ticket-platform/domain";
import type { SqlConnection } from "./postgres.js";

/**
 * Связь участника мероприятия с человеком в общей базе.
 *
 * Колонка `event_participants.outreach_contact_id` появилась вместе с самой таблицей, но
 * заполнял её ровно один путь из нескольких — кнопка «Добавить участником» в карточке
 * кампании. Участник, заведённый руками на вкладке мероприятия или перенесённый таблицей,
 * приезжал без связи, и для базы это был другой человек: карточка не показывала его поездок,
 * а повторная загрузка заводила его заново.
 *
 * Здесь связь ищется, а если не нашлась — заводится. Участник мероприятия это человек,
 * которого мы точно знаем: держать его вне базы нет причин.
 */
/** Откуда человек попал в базу — видно в карточке и в отборе по источнику. */
export const PARTICIPANT_CONTACT_SOURCE = "Участник мероприятия";

export interface ParticipantContactSeed {
  /** Идентификатор для нового контакта, если заводить придётся. */
  readonly contactId: string;
  readonly displayName: string;
  /** Уже в E.164: и проверка таблицы, и схема запроса требуют этого от участника. */
  readonly phoneE164: string | null;
  /**
   * Ник как его записали — «@Nadinka88», ссылка на t.me, что угодно. Разбирается здесь, а не у
   * вызывающего: путей создания участника три, и правило должно остаться одно на всех.
   */
  readonly telegram: string | null;
  readonly adminId: string;
  readonly source: string;
}

/**
 * Возвращает id человека в базе или null, когда опознать его нечем — без телефона и ника
 * контакт создать нельзя, да и незачем: найти его потом всё равно не выйдет.
 */
export async function resolveParticipantContact(
  connection: SqlConnection,
  seed: ParticipantContactSeed
): Promise<string | null> {
  const telegramUsername = parseTelegramUsername(seed.telegram);
  const telegramNormalized = telegramUsername?.toLowerCase() ?? null;
  if (seed.phoneE164 === null && telegramNormalized === null) {
    return null;
  }

  const existing = await connection.query<{ readonly id: string }>(
    // Указатель на главного: после объединения дубль остаётся со своими признаками, и без
    // coalesce участник привязался бы к надгробию вместо человека.
    `select coalesce(merged_into_contact_id, id) as id
       from public.outreach_contacts
      where ($1::text is not null and phone_e164 = $1::text)
         or ($2::text is not null and telegram_username_normalized = $2::text)
      order by created_at
      limit 1`,
    [seed.phoneE164, telegramNormalized]
  );
  const found = existing.rows[0];
  if (found) {
    // Архивных тоже связываем: это тот же человек, а возвращать его из архива только потому,
    // что он поехал на мероприятие, — не наше решение.
    return found.id;
  }

  const created = await connection.query<{ readonly id: string }>(
    `insert into public.outreach_contacts (
       id, display_name, phone_e164,
       telegram_username, telegram_username_normalized,
       source, created_by_admin_id
     ) values (
       $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text, $7::uuid
     )
     on conflict do nothing
     returning id`,
    [
      seed.contactId,
      seed.displayName,
      seed.phoneE164,
      telegramUsername,
      telegramNormalized,
      seed.source,
      seed.adminId
    ]
  );
  const inserted = created.rows[0];
  if (inserted) {
    return inserted.id;
  }

  // Сюда попадаем, если между поиском и вставкой контакт завёл кто-то другой. Читаем ещё раз:
  // потерять связь из-за гонки хуже, чем сделать лишний запрос на редком пути.
  const race = await connection.query<{ readonly id: string }>(
    `select coalesce(merged_into_contact_id, id) as id
       from public.outreach_contacts
      where ($1::text is not null and phone_e164 = $1::text)
         or ($2::text is not null and telegram_username_normalized = $2::text)
      order by created_at
      limit 1`,
    [seed.phoneE164, telegramNormalized]
  );
  return race.rows[0]?.id ?? null;
}
