-- Задачи по триггеру заводит кабинет, и один из триггеров — сама воронка.
--
-- Правила автозадач до сих пор были списком из шести поводов, заведённым миграцией:
-- кабинет их включал и переписывал, но добавить не мог. Между тем самый частый повод
-- поставить следующий шаг — переход карточки в стадию: «подтвердил участие» значит
-- позвонить накануне, «не дошёл» значит позвать на следующую встречу. Стадии заводит
-- менеджер, поэтому и правило по стадии может завести только он.
--
-- Отсюда две правки: у правила появляется стадия, а «одно правило на повод» становится
-- «одно правило на повод и стадию» — иначе на всю воронку было бы одно правило по
-- переходу, и оно означало бы «любая стадия».

alter table public.outreach_task_rules
  add column if not exists stage text;

comment on column public.outreach_task_rules.stage is
  'Стадия, переход в которую ставит задачу. Заполнена только у повода stage_entered.';

alter table public.outreach_task_rules
  drop constraint outreach_task_rules_trigger_check;

alter table public.outreach_task_rules
  add constraint outreach_task_rules_trigger_check check (
    trigger_code in (
      'site_registration',
      'no_answer',
      'event_upcoming',
      'attended',
      'no_show',
      'meeting_upcoming',
      'stage_entered'
    )
  ),
  -- Стадия имеет смысл ровно у одного повода. У остальных она была бы настройкой, которая
  -- ни на что не влияет, а такие настройки читаются как влияющие.
  add constraint outreach_task_rules_stage_scope_check check (
    (trigger_code = 'stage_entered' and stage is not null)
    or (trigger_code <> 'stage_entered' and stage is null)
  );

-- Внешнего ключа на колонку воронки здесь намеренно нет.
--
-- Он выглядит уместным, но ведёт себя плохо: снятое правило — это строка, на которую
-- ссылаются уже поставленные задачи, и каскад от удаления колонки упёрся бы в них, а
-- удаление колонки со стадией — обычное дело. Поэтому правила снимает та же операция,
-- что удаляет колонку (см. `applyPipelineColumns`), а стадия без колонки читается как
-- «стадия удалена».

alter table public.outreach_task_rules
  drop constraint outreach_task_rules_unique;

-- Снятое правило.
--
-- Строка остаётся, потому что на неё ссылаются уже поставленные задачи: по ним видно, что
-- задачу поставила не рука, и стирать эту разницу задним числом нельзя. Из списка правил
-- и из отбора автоматики снятое уходит, а место в воронке освобождает — иначе повод,
-- заведённый по ошибке, занимал бы своё место навсегда.
alter table public.outreach_task_rules
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_admin_id uuid references public.admin_accounts(id);

create unique index outreach_task_rules_unique_idx
  on public.outreach_task_rules (campaign_id, trigger_code, coalesce(stage, ''))
  where deleted_at is null;

-- Отбор автоматики идёт по включённым и не снятым правилам: прежний индекс про снятые
-- ничего не знал, потому что снимать было нельзя.
drop index if exists outreach_task_rules_campaign_idx;

create index outreach_task_rules_campaign_idx
  on public.outreach_task_rules (campaign_id)
  where is_enabled and deleted_at is null;
