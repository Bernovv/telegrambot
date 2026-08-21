-- Автозадачи: следующий шаг ставится сам, когда с человеком что-то произошло.
--
-- До сих пор задачи ставились только руками. Половина работы менеджера при этом — не
-- решение, а обязанность: не дозвонился — перезвонить завтра; человек дошёл до встречи —
-- позвонить за обратной связью; не дошёл — позвать на следующую. Забыть об этом легко, и
-- забывается оно ровно про тех, кто и так почти ушёл.
--
-- Правила заводит кабинет, а не выкладка: иначе каждое «а давай ещё вот такую» — это
-- правка кода. Поэтому таблица, а не список констант.

create table public.outreach_task_rules (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.outreach_campaigns(id),
  -- Повод. Расширяется миграцией: у каждого свой якорь времени и свой способ найти,
  -- по кому ставить задачу.
  trigger_code text not null,
  is_enabled boolean not null default true,
  -- Сдвиг от якоря в днях: -1 — за день до, 1 — на следующий день, 0 — сразу.
  offset_days smallint not null default 0,
  -- Ставить срок в ближайшее окно обзвона воронки. Иначе — в указанный час.
  use_call_window boolean not null default true,
  at_hour smallint,
  task_type text not null default 'call',
  task_text text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outreach_task_rules_trigger_check check (
    trigger_code in (
      'site_registration',
      'no_answer',
      'event_upcoming',
      'attended',
      'no_show',
      'meeting_upcoming'
    )
  ),
  constraint outreach_task_rules_type_check check (
    task_type in ('call', 'message', 'other')
  ),
  constraint outreach_task_rules_text_check check (
    length(btrim(task_text)) between 1 and 500
  ),
  constraint outreach_task_rules_offset_check check (
    offset_days between -30 and 30
  ),
  constraint outreach_task_rules_hour_check check (
    use_call_window or (at_hour between 0 and 23)
  ),
  -- Один повод — одно правило на воронку. Два правила на один повод означали бы две
  -- задачи на одно событие, и вторая отменяла бы первую.
  constraint outreach_task_rules_unique unique (campaign_id, trigger_code)
);

create index outreach_task_rules_campaign_idx
  on public.outreach_task_rules (campaign_id)
  where is_enabled;

-- Откуда взялась задача.
--
-- Без этого автоматика неотличима от руки: в ленте карточки «задача поставлена» выглядит
-- одинаково, а разница существенная — за ручной задачей стоит решение менеджера.
--
-- `auto_key` — ключ повтора. Проход воркера идёт каждые несколько минут, и без ключа он
-- ставил бы одну и ту же задачу каждый круг. Ключ описывает повод целиком: карточка плюс
-- то событие, из-за которого задача появилась.
alter table public.outreach_tasks
  add column if not exists auto_rule_id uuid references public.outreach_task_rules(id),
  add column if not exists auto_key text;

create unique index if not exists outreach_tasks_auto_key_idx
  on public.outreach_tasks (auto_rule_id, auto_key)
  where auto_rule_id is not null;

comment on column public.outreach_tasks.auto_rule_id is
  'Правило, по которому задачу поставила автоматика. Пусто — задачу поставил человек.';
comment on column public.outreach_tasks.auto_key is
  'Ключ повтора: одна задача на связку «карточка и повод». Иначе проход плодил бы её каждый круг.';

-- Правила для «Бизнес-среды». Ровно те шесть, что просили, и все включены: воронка
-- заводилась под них.
insert into public.outreach_task_rules (
  campaign_id, trigger_code, offset_days, use_call_window, task_type, task_text
)
select
  campaign.id,
  seed.trigger_code,
  seed.offset_days,
  true,
  'call',
  seed.task_text
from public.outreach_campaigns campaign
cross join (values
  ('site_registration', 0, 'Позвонить по заявке с сайта'),
  ('no_answer', 1, 'Перезвонить, в прошлый раз не дозвонились'),
  ('event_upcoming', -1, 'Напомнить о встрече завтра'),
  ('attended', 1, 'Позвонить, собрать обратную связь о встрече'),
  ('no_show', 1, 'Позвонить, позвать на следующую встречу'),
  ('meeting_upcoming', -1, 'Напомнить о личной встрече завтра')
) as seed(trigger_code, offset_days, task_text)
where campaign.event_slug_prefix = 'sreda'
on conflict (campaign_id, trigger_code) do nothing;
