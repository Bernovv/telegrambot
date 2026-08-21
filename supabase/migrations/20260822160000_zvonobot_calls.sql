-- Звонобот: обратная связь с автообзвона становится новой заявкой.
--
-- Робот обзванивает список и спрашивает, интересно ли. Тот, кто нажал кнопку или ответил
-- «да», — это человек, который сам сказал «продолжайте»; сегодня он живёт в кабинете
-- Звонобота, и до воронки доезжает вручную и не весь.
--
-- Почему сырьё хранится отдельной таблицей, а не разбирается на лету. Формат вебхука мы
-- знаем не до конца: их документация неполная, и что именно приезжает — нажатая цифра,
-- длительность, распознанный ответ, — выяснится на первой же кампании. Поэтому приёмник
-- обязан принять и сохранить всё, что прислали, даже если разобрать это он не умеет.
-- Разбор — второй проход, и он читает ту же строку, ничего не теряя: телефон, по которому
-- не поняли, чья это кампания, всё равно останется в базе с полным телом запроса.
--
-- Второе следствие того же: `payload` неизменяем. Строку заводит внешняя сторона, и
-- переписать пришедшее нельзя — иначе через месяц спор «что там было на самом деле»
-- решать будет нечем. Меняются только колонки разбора.

create table public.zvonobot_calls (
  id uuid primary key,
  -- Идентификатор звонка на стороне Звонобота. Ключ идемпотентности: вебхук повторяют при
  -- любой сетевой заминке, и без него повтор завёл бы вторую заявку на того же человека.
  -- Пусто быть не может: если в теле такого поля нет, приёмник считает ключ по телу.
  external_call_id text not null,
  -- Кампания обзвона как её назвал Звонобот. Нужна в карточке: «Звонобот, кампания такая-то».
  campaign_name text not null default '',
  -- Телефон, если его удалось разобрать. Пусто — тело пришло в неизвестном виде; строка
  -- при этом сохраняется, и по ней видно, что именно приехало.
  phone_e164 text,
  -- Что человек сделал: нажатая цифра и длительность разговора. Оба — то, из чего решают,
  -- считать ли звонок заявкой.
  pressed_button text,
  duration_seconds integer,
  -- Тело запроса целиком, как прислали.
  payload jsonb not null,
  -- Чем кончился разбор. `pending` — ещё не разбирали; `lead` — завели заявку;
  -- `ignored` — разобрали, но по правилам это не заявка (сбросил, не нажал);
  -- `unparsed` — телефон достать не удалось, разбирать нечего и нужна рука.
  status text not null default 'pending',
  contact_id uuid references public.outreach_contacts(id),
  campaign_contact_id uuid references public.outreach_campaign_contacts(id),
  task_id uuid references public.outreach_tasks(id),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint zvonobot_calls_status_check check (
    status in ('pending', 'lead', 'ignored', 'unparsed')
  ),
  constraint zvonobot_calls_phone_check check (
    phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
  ),
  constraint zvonobot_calls_external_id_check check (
    length(btrim(external_call_id)) between 1 and 200
  ),
  constraint zvonobot_calls_campaign_check check (length(campaign_name) <= 200),
  constraint zvonobot_calls_button_check check (
    pressed_button is null or length(pressed_button) <= 32
  ),
  constraint zvonobot_calls_duration_check check (
    duration_seconds is null or duration_seconds between 0 and 86400
  ),
  -- Разобранная строка обязана сказать, когда её разобрали, а неразобранная — молчать.
  constraint zvonobot_calls_processed_check check (
    (status = 'pending' and processed_at is null)
    or (status <> 'pending' and processed_at is not null)
  )
);

-- Идемпотентность. Повтор вебхука — обычное дело, и он обязан упереться в этот индекс, а не
-- завести второго человека в воронке.
create unique index zvonobot_calls_external_idx
  on public.zvonobot_calls (external_call_id);

-- Очередь разбора: проход воркера берёт самые старые непрочитанные.
create index zvonobot_calls_pending_idx
  on public.zvonobot_calls (received_at)
  where status = 'pending';

create index zvonobot_calls_phone_idx
  on public.zvonobot_calls (phone_e164, received_at desc)
  where phone_e164 is not null;

comment on table public.zvonobot_calls is
  'Вебхуки Звонобота как их прислали. Заявка заводится вторым проходом и может не завестись.';
comment on column public.zvonobot_calls.payload is
  'Тело запроса целиком. Неизменяемо: спор о том, что прислали, решается этой колонкой.';

-- Пришедшее не переписывают.
--
-- Разбор меняет свои колонки, и запрет на всю строку сделал бы его невозможным. Поэтому
-- защищено ровно то, что пришло снаружи: тело, ключ, время получения. Удаление запрещено
-- целиком — строка вебхука это первичный документ, как и касание в ленте.
create function public.prevent_zvonobot_payload_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'zvonobot calls are append-only';
  end if;
  if new.payload is distinct from old.payload
     or new.external_call_id is distinct from old.external_call_id
     or new.received_at is distinct from old.received_at then
    raise exception 'zvonobot call payload is immutable';
  end if;
  return new;
end;
$$;

create trigger zvonobot_calls_immutable
before update or delete on public.zvonobot_calls
for each row execute function public.prevent_zvonobot_payload_mutation();

-- Что считается заявкой.
--
-- Константой это быть не может по двум причинам сразу. Первая: формат ответа Звонобота ещё
-- не подтверждён, и «нажал 1» может оказаться «нажал кнопку с меткой yes». Вторая, важнее:
-- порог «разговаривал дольше N секунд» — это решение про работу, а не про код, и менять его
-- будут после первой же кампании, глядя на то, что приехало.
--
-- Строка одна: настройка общая на приёмник, потому что приёмник один.
create table public.zvonobot_settings (
  id boolean primary key default true,
  -- Кнопки, нажатие которых считается согласием. Пустой список — по кнопке не судим.
  lead_buttons text[] not null default array['1'],
  -- Разговор дольше этого числа секунд считается заявкой сам по себе. Пусто — не считаем.
  lead_min_duration_seconds integer,
  -- Начало слага направления, в воронку которого падают заявки. Тот же признак, по которому
  -- заявку с сайта кладут в «Бизнес-среду»: двух правд о том, что такое направление, нет.
  campaign_slug_prefix text not null default 'sreda',
  updated_at timestamptz not null default now(),
  constraint zvonobot_settings_singleton_check check (id),
  constraint zvonobot_settings_duration_check check (
    lead_min_duration_seconds is null
    or lead_min_duration_seconds between 1 and 3600
  ),
  constraint zvonobot_settings_prefix_check check (
    campaign_slug_prefix ~ '^[a-z0-9][a-z0-9-]{0,40}$'
  )
);

insert into public.zvonobot_settings (id) values (true)
on conflict (id) do nothing;

comment on table public.zvonobot_settings is
  'Что считается заявкой из автообзвона. Одна строка: приёмник один.';

-- Новый повод автозадачи: обратная связь роботу. Стоит рядом с заявкой с сайта и работает
-- так же — звонок в ближайшее окно обзвона, без сдвига по дням.
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
      'stage_entered',
      'zvonobot_feedback'
    )
  );

insert into public.outreach_task_rules (
  campaign_id, trigger_code, offset_days, use_call_window, task_type, task_text
)
select campaign.id, 'zvonobot_feedback', 0, true, 'call',
       'Позвонить: человек ответил роботу'
  from public.outreach_campaigns campaign
 where campaign.event_slug_prefix = 'sreda'
on conflict do nothing;

-- Учётная запись, от имени которой заводится человек, карточка и звонок по обратной связи.
-- Отдельная от «Регистрации с сайта» намеренно: в карточке видно, откуда взялась строка, и
-- сваливать два источника в одно имя значит терять эту разницу. Запись помечена
-- `suspended`, войти под ней в панель нельзя, а `auth_subject` не совпадёт ни с одним UID
-- Supabase.
insert into public.admin_accounts (id, auth_subject, display_name, status)
values (
  '00000000-0000-4000-8000-000000000003',
  'system:zvonobot',
  'Звонобот',
  'suspended'
)
on conflict (id) do nothing;
