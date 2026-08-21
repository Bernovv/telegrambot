import type {
  AutoTaskCandidate,
  AutoTaskRepository,
  AutoTaskToCreate
} from "@ticket-platform/application";
import type {
  OutreachTaskTrigger,
  OutreachTaskType
} from "@ticket-platform/contracts";
import type { SqlConnectionPool } from "./postgres.js";

interface CandidateRow {
  readonly rule_id: string;
  readonly trigger_code: OutreachTaskTrigger;
  readonly campaign_contact_id: string;
  readonly contact_id: string;
  readonly anchor_at: Date | string;
  readonly auto_key: string;
  readonly offset_days: number;
  readonly use_call_window: boolean;
  readonly at_hour: number | null;
  readonly task_type: OutreachTaskType;
  readonly task_text: string;
  readonly call_window_start: number;
  readonly call_window_end: number;
  readonly call_window_timezone: string;
}

/**
 * Отбор поводов для автозадач.
 *
 * Условий много и все они про строки: участник мероприятия, отметка явки, время встречи,
 * последний звонок. Поэтому отбирает база, а срок считает служба — время с часовыми
 * поясами и окном обзвона в SQL превратилось бы в нечитаемое выражение, которое нечем
 * проверить.
 *
 * Из выборки сразу выброшены две вещи: карточки с открытой задачей (автоматика не трогает
 * запланированное менеджером) и поводы, по которым задача уже ставилась (ключ повтора).
 */
const CANDIDATES_SQL = `
with scope as (
  select campaign.id as campaign_id,
         campaign.call_window_start,
         campaign.call_window_end,
         campaign.call_window_timezone
    from public.outreach_campaigns campaign
   where campaign.archived_at is null
     and campaign.status <> 'completed'
),
campaign_events as (
  -- Мероприятия воронки: у обычной кампании оно одно, у постоянной воронки направления
  -- их столько, сколько встреч прошло и пройдёт.
  select campaign.id as campaign_id, event.id as event_id,
         event.starts_at, coalesce(event.ends_at, event.starts_at) as ends_at
    from public.outreach_campaigns campaign
    join public.events event
      on event.id = campaign.event_id
      or (campaign.event_slug_prefix is not null
          and event.slug like campaign.event_slug_prefix || '%')
   where event.status <> 'archived'
),
rules as (
  select rule.*, scope.call_window_start, scope.call_window_end,
         scope.call_window_timezone
    from public.outreach_task_rules rule
    join scope on scope.campaign_id = rule.campaign_id
   where rule.is_enabled
     and rule.deleted_at is null
),
candidates as (
  -- Скоро мероприятие, на которое человек записан.
  select rule.id as rule_id, rule.trigger_code,
         member.id as campaign_contact_id, member.contact_id,
         campaign_event.starts_at as anchor_at,
         member.id::text || ':' || campaign_event.event_id::text as auto_key,
         rule.offset_days, rule.use_call_window, rule.at_hour,
         rule.task_type, rule.task_text,
         rule.call_window_start, rule.call_window_end, rule.call_window_timezone
    from rules rule
    join campaign_events campaign_event
      on campaign_event.campaign_id = rule.campaign_id
    join public.event_participants participant
      on participant.event_id = campaign_event.event_id
     and participant.deleted_at is null
    join public.outreach_campaign_contacts member
      on member.campaign_id = rule.campaign_id
     and member.contact_id = participant.outreach_contact_id
     and member.removed_at is null
   where rule.trigger_code = 'event_upcoming'
     and campaign_event.starts_at > $1::timestamptz

  union all

  -- Мероприятие прошло: дошёл или не дошёл.
  select rule.id, rule.trigger_code,
         member.id, member.contact_id,
         campaign_event.ends_at,
         member.id::text || ':' || campaign_event.event_id::text,
         rule.offset_days, rule.use_call_window, rule.at_hour,
         rule.task_type, rule.task_text,
         rule.call_window_start, rule.call_window_end, rule.call_window_timezone
    from rules rule
    join campaign_events campaign_event
      on campaign_event.campaign_id = rule.campaign_id
    join public.event_participants participant
      on participant.event_id = campaign_event.event_id
     and participant.deleted_at is null
    join public.outreach_campaign_contacts member
      on member.campaign_id = rule.campaign_id
     and member.contact_id = participant.outreach_contact_id
     and member.removed_at is null
    left join public.event_attendance attendance
      on attendance.participant_id = participant.id
   where rule.trigger_code in ('attended', 'no_show')
     and campaign_event.ends_at <= $1::timestamptz
     -- Мероприятия, законченные больше месяца назад, не догоняем: звать на следующую
     -- встречу через месяц молчания — это не работа по горячему следу.
     and campaign_event.ends_at > $1::timestamptz - interval '30 days'
     and (
       (rule.trigger_code = 'attended' and attendance.id is not null)
       or (rule.trigger_code = 'no_show' and attendance.id is null)
     )

  union all

  -- Назначена личная встреча с менеджером.
  select rule.id, rule.trigger_code,
         member.id, member.contact_id,
         contact.next_meeting_at,
         member.id::text || ':' || contact.next_meeting_at::text,
         rule.offset_days, rule.use_call_window, rule.at_hour,
         rule.task_type, rule.task_text,
         rule.call_window_start, rule.call_window_end, rule.call_window_timezone
    from rules rule
    join public.outreach_campaign_contacts member
      on member.campaign_id = rule.campaign_id
     and member.removed_at is null
    join public.outreach_contacts contact on contact.id = member.contact_id
   where rule.trigger_code = 'meeting_upcoming'
     and contact.next_meeting_at > $1::timestamptz

  union all

  -- Не дозвонились. Якорь — сам звонок: перезванивать надо от него, а не от того момента,
  -- когда до карточки дошёл проход.
  select rule.id, rule.trigger_code,
         member.id, member.contact_id,
         activity.occurred_at,
         member.id::text || ':' || activity.id::text,
         rule.offset_days, rule.use_call_window, rule.at_hour,
         rule.task_type, rule.task_text,
         rule.call_window_start, rule.call_window_end, rule.call_window_timezone
    from rules rule
    join public.outreach_campaign_contacts member
      on member.campaign_id = rule.campaign_id
     and member.removed_at is null
    join lateral (
      select id, occurred_at, result
        from public.outreach_activities
       where campaign_contact_id = member.id
       order by occurred_at desc, id desc
       limit 1
    ) activity on true
   where rule.trigger_code = 'no_answer'
     and activity.result = 'no_answer'
     and activity.occurred_at > $1::timestamptz - interval '30 days'

  union all

  -- Карточка перешла в стадию, за которой закреплено правило. Якорь — сам переход:
  -- «через день после того, как подтвердил участие» считается от подтверждения.
  --
  -- Переходы старше месяца не догоняем по той же причине, что и мероприятия: правило,
  -- включённое сегодня, не должно выдать пачку задач по прошлогодней истории.
  select rule.id, rule.trigger_code,
         member.id, member.contact_id,
         history.occurred_at,
         member.id::text || ':' || history.id::text,
         rule.offset_days, rule.use_call_window, rule.at_hour,
         rule.task_type, rule.task_text,
         rule.call_window_start, rule.call_window_end, rule.call_window_timezone
    from rules rule
    join public.outreach_campaign_contacts member
      on member.campaign_id = rule.campaign_id
     and member.removed_at is null
    join public.outreach_stage_history history
      on history.campaign_contact_id = member.id
     and history.to_stage = rule.stage
   where rule.trigger_code = 'stage_entered'
     and history.occurred_at > $1::timestamptz - interval '30 days'
)
select distinct on (candidate.rule_id, candidate.auto_key)
       candidate.rule_id, candidate.trigger_code,
       candidate.campaign_contact_id, candidate.contact_id,
       candidate.anchor_at, candidate.auto_key,
       candidate.offset_days, candidate.use_call_window, candidate.at_hour,
       candidate.task_type, candidate.task_text,
       candidate.call_window_start, candidate.call_window_end,
       candidate.call_window_timezone
  from candidates candidate
 where not exists (
         select 1 from public.outreach_tasks existing
          where existing.auto_rule_id = candidate.rule_id
            and existing.auto_key = candidate.auto_key
       )
   and not exists (
         select 1 from public.outreach_tasks open_task
          where open_task.campaign_contact_id = candidate.campaign_contact_id
            and open_task.status = 'open'
       )
 order by candidate.rule_id, candidate.auto_key, candidate.anchor_at
 limit $2::int`;

export class PostgresAutoTaskRepository implements AutoTaskRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  async listCandidates(input: {
    readonly at: Date;
    readonly limit: number;
  }): Promise<readonly AutoTaskCandidate[]> {
    const connection = await this.pool.connect();
    try {
      const result = await connection.query<CandidateRow>(
        CANDIDATES_SQL,
        [input.at, input.limit]
      );
      return result.rows.map((row) => ({
        ruleId: row.rule_id,
        trigger: row.trigger_code,
        campaignContactId: row.campaign_contact_id,
        contactId: row.contact_id,
        anchorAt: new Date(row.anchor_at),
        autoKey: row.auto_key,
        offsetDays: row.offset_days,
        useCallWindow: row.use_call_window,
        atHour: row.at_hour,
        taskType: row.task_type,
        taskText: row.task_text,
        callWindowStart: row.call_window_start,
        callWindowEnd: row.call_window_end,
        callWindowTimezone: row.call_window_timezone
      }));
    } finally {
      connection.release();
    }
  }

  /**
   * Заводит задачи по одной.
   *
   * Пачкой было бы быстрее, но тогда одна не вставшая строка отменяла бы остальные, а не
   * встать здесь — обычное дело: между отбором и записью менеджер мог поставить свою
   * задачу, и она главнее.
   *
   * Ответственным становится ответственный за человека, а если его нет — ответственный за
   * карточку в воронке. Не нашлось ни того, ни другого — задача остаётся ничьей и попадает
   * в «Разобрать» на «Моём дне»; служебная учётка в этом поле спрятала бы её ото всех.
   */
  async createTasks(input: {
    readonly tasks: readonly AutoTaskToCreate[];
    readonly createdByAdminId: string;
    readonly now: Date;
  }): Promise<number> {
    const connection = await this.pool.connect();
    let created = 0;
    try {
      for (const task of input.tasks) {
        const result = await connection.query(
          `insert into public.outreach_tasks (
             id, contact_id, campaign_contact_id, assigned_admin_id,
             created_by_admin_id, task_type, task_text, due_at, status,
             created_at, auto_rule_id, auto_key
           )
           select $1::uuid, $2::uuid, $3::uuid,
                  coalesce(
                    contact.assigned_admin_id,
                    member.assigned_admin_id,
                    $4::uuid
                  ),
                  $4::uuid, $5::text, $6::text, $7::timestamptz, 'open',
                  $8::timestamptz, $9::uuid, $10::text
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
            task.id,
            task.contactId,
            task.campaignContactId,
            input.createdByAdminId,
            task.taskType,
            task.taskText,
            task.dueAt,
            input.now,
            task.ruleId,
            task.autoKey
          ]
        );
        created += result.rowCount ?? 0;
      }
      return created;
    } finally {
      connection.release();
    }
  }
}

export function createAutoTaskPersistence(
  pool: SqlConnectionPool
): AutoTaskRepository {
  return new PostgresAutoTaskRepository(pool);
}
