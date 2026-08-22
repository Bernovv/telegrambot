import type { SqlExecutor } from "./postgres.js";

/**
 * Задача «ответить», которая появляется сама, когда человек написал.
 *
 * Кому она достаётся — цепочка из трёх шагов, и порядок в ней не случайный:
 *
 * 1. **Кто ведёт диалог.** Ответственный за разговор появляется в тот момент, когда
 *    менеджер впервые ответил, и это самый точный ответ на вопрос «чей это человек».
 * 2. **Кто ведёт его в воронке.** У людей, которым ещё не отвечали, разговора нет, но
 *    ответственный в кампании может быть — им и займётся.
 * 3. **Общий.** Ничья достаётся дежурному из настроек. Если дежурный не назначен, задача
 *    не заводится: задача без ответственного не видна ни в одном фильтре «мои», то есть
 *    не видна никому, и заводить её значит делать вид, что сигнал есть.
 *
 * Служебные учётки (`Звонобот`, `Регистрация с сайта`, `Бот`) ответственными быть не могут:
 * под ними нельзя войти, и задача на них — то же самое, что задача в никуда. Отсюда отбор
 * по `status = 'active'`.
 */

export interface ReplyTaskInput {
  readonly taskId: string;
  readonly conversationId: string;
  readonly contactId: string;
  readonly occurredAt: Date;
}

interface SettingsRow {
  readonly is_enabled: boolean;
  readonly due_after_minutes: number;
  readonly task_text: string;
  readonly fallback_admin_id: string | null;
}

/** Учётная запись, от имени которой автоматика заводит задачи. Та же, что у автозадач. */
const AUTO_TASK_ADMIN_ID = "00000000-0000-4000-8000-000000000002";

export async function ensureReplyTask(
  connection: SqlExecutor,
  input: ReplyTaskInput
): Promise<void> {
  const settings = await connection.query<SettingsRow>(
    `select is_enabled, due_after_minutes, task_text, fallback_admin_id
       from public.conversation_task_settings
      where id
      limit 1`
  );
  const rules = settings.rows[0];
  if (!rules || !rules.is_enabled) {
    return;
  }

  const assignee = await connection.query<{ readonly admin_id: string }>(
    `select admin_id from (
       select conversation.assigned_admin_id as admin_id, 1 as rank
         from public.conversations conversation
         join public.admin_accounts account
           on account.id = conversation.assigned_admin_id and account.status = 'active'
        where conversation.id = $1::uuid
       union all
       select member.assigned_admin_id, 2
         from public.outreach_campaign_contacts member
         join public.admin_accounts account
           on account.id = member.assigned_admin_id and account.status = 'active'
        where member.contact_id = $2::uuid and member.removed_at is null
       union all
       select account.id, 3
         from public.admin_accounts account
        where account.id = $3::uuid and account.status = 'active'
     ) candidates
     where admin_id is not null
     order by rank, admin_id
     limit 1`,
    [input.conversationId, input.contactId, rules.fallback_admin_id]
  );
  const adminId = assignee.rows[0]?.admin_id;
  if (adminId === undefined) {
    return;
  }

  // `on conflict do nothing` закрывает сразу два случая, и оба — норма, а не сбой.
  // Первый: по этому диалогу задача уже открыта, человек просто пишет второй раз подряд.
  // Второй: у человека уже есть открытая задача без кампании — её поставил менеджер, и
  // затирать её мы не имеем права. Правило «не трогать открытую задачу» здесь то же, что
  // у автозадач: за ней стоит чьё-то решение.
  await connection.query(
    `insert into public.outreach_tasks (
       id, contact_id, conversation_id, assigned_admin_id, created_by_admin_id,
       task_type, task_text, due_at, status, created_at
     ) values (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
       'message', $6::text,
       $7::timestamptz + make_interval(mins => $8::int),
       'open', $7::timestamptz
     )
     on conflict do nothing`,
    [
      input.taskId,
      input.contactId,
      input.conversationId,
      adminId,
      AUTO_TASK_ADMIN_ID,
      rules.task_text,
      input.occurredAt,
      rules.due_after_minutes
    ]
  );
}

/**
 * Менеджер ответил — задача закрыта.
 *
 * Закрывается в той же транзакции, что и постановка ответа в очередь, а не после успешной
 * отправки. Разница в том, что считать выполненным: менеджер своё сделал, а доставка — уже
 * забота очереди, и не доставленный ответ он увидит в ленте красным.
 *
 * Закрывает только свои задачи — те, что заведены по этому диалогу. Ручную задачу
 * «позвонить», стоящую на человеке, ответ в чате не отменяет.
 */
export async function completeReplyTasks(
  connection: SqlExecutor,
  input: {
    readonly conversationId: string;
    readonly adminId: string;
    readonly at: Date;
  }
): Promise<void> {
  await connection.query(
    `update public.outreach_tasks
        set status = 'completed',
            completed_by_admin_id = $2::uuid,
            completed_at = $3::timestamptz
      where conversation_id = $1::uuid and status = 'open'`,
    [input.conversationId, input.adminId, input.at]
  );
}
