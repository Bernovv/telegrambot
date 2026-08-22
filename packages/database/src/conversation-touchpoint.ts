import type { SqlExecutor } from "./postgres.js";

/** Строка выборки по идентификатору — та же форма, что и в соседних запросах. */
interface IdRow {
  readonly id: string;
}

interface TouchpointInput {
  readonly contactId: string | null;
  readonly channel: "telegram" | "max";
  readonly actorAdminId: string | null;
  readonly result: "answered" | "sent";
  readonly note: string | null;
  readonly occurredAt: Date;
  readonly activityId: string;
}

/**
 * Касание по сообщению — своей строкой на каждое.
 *
 * Сначала здесь была склейка: сообщения подряд от одного человека сливались в одно касание
 * за полчаса, чтобы лента не превратилась в переписку без текста. На боевом это оказалось
 * неправильным решением, и вот почему: **пока нет окна диалога, лента касаний — это
 * единственное место, где переписку вообще видно.** Человек писал три сообщения, в карточке
 * появлялось одно, и выглядело это как сломанная запись. Скрывать сказанное ради опрятности
 * ленты — не тот размен: потерянный вопрос дороже лишней строки.
 *
 * Когда окно диалога появится (фаза 4), к вопросу стоит вернуться: там переписка будет
 * видна целиком, и лента касаний сможет снова стать сводкой, а не расшифровкой.
 *
 * Без карточки касание не пишется: колонка `contact_id` обязательна, и это правильно —
 * касание без человека не касание. Такой диалог виден в списке неопознанных.
 */
export async function recordTouchpoint(
  connection: SqlExecutor,
  input: TouchpointInput
): Promise<void> {
  if (input.contactId === null) {
    return;
  }

  // Участие в кампании, если оно есть: с ним касание видно и в карточке воронки. Берём
  // самое свежее не убранное — человек может состоять в нескольких направлениях сразу.
  const member = await connection.query<IdRow>(
    `select id
       from public.outreach_campaign_contacts
      where contact_id = $1::uuid and removed_at is null
      order by created_at desc
      limit 1`,
    [input.contactId]
  );

  const note = (input.note ?? "").trim();
  // Идентификатор касания — это идентификатор реплики. Повтор вебхука сюда не доходит
  // (реплика не записалась бы вторично), но если однажды дойдёт, он упрётся в первичный
  // ключ, а не заведёт второе касание об одном и том же сообщении.
  await connection.query(
    `insert into public.outreach_activities (
       id, campaign_contact_id, contact_id, actor_admin_id,
       action, channel, result, note, occurred_at
     ) values (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid,
       'message', $5::text, $6::text, $7::text, $8::timestamptz
     )
     on conflict (id) do nothing`,
    [
      input.activityId,
      member.rows[0]?.id ?? null,
      input.contactId,
      input.actorAdminId,
      input.channel,
      input.result,
      // Выдержка из сказанного: пока окна диалога нет, это и есть текст сообщения в карточке.
      note === "" ? null : note.slice(0, 200),
      input.occurredAt
    ]
  );
}
