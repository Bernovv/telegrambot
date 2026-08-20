-- Регистрация с сайта: заявка живёт своей строкой, а не только участником мероприятия.
--
-- Форма на sreda.biz-day.ru заменила виджет Timepad и спрашивает ровно две вещи — имя и
-- телефон. Дальше заявка должна попасть в два места сразу: организаторам в Telegram и в
-- список участников встречи в панели.
--
-- Почему отдельная таблица, а не только `event_participants`. Заявку принимает открытый
-- эндпоинт, за которым не стоит администратор, и он обязан принять её даже тогда, когда
-- мероприятие не нашлось: встречу на этой неделе могли не завести, завести с другим slug
-- или завести задним числом. Потерять при этом человека нельзя — он уже оставил телефон и
-- ждёт, что ему позвонят. Поэтому сырая заявка сохраняется всегда, а участник заводится,
-- когда есть куда. `status` показывает, чем кончилось: `registered` — участник заведён,
-- `duplicate` — этот телефон в списке встречи уже был, `unassigned` — мероприятия не нашлось
-- и заявка ждёт руки.
--
-- Здесь же лежит согласие: у бесплатной регистрации нет оферты, и `consent_at` — единственное
-- основание звонить и писать по собранной базе. Поэтому время согласия хранится, а не
-- выводится из времени создания строки.

create table if not exists public.site_registrations (
  id uuid primary key,
  event_id uuid references public.events(id),
  participant_id uuid references public.event_participants(id),
  display_name text not null,
  phone_e164 text not null,
  consent_at timestamptz not null,
  -- Откуда пришла заявка: имя страницы, а не полный адрес с метками. Полный адрес — это
  -- персональные данные пополам с мусором, а страниц с формой у нас пока одна.
  page text not null default '',
  status text not null default 'registered',
  created_at timestamptz not null default now(),
  constraint site_registrations_name_check check (
    length(btrim(display_name)) between 1 and 200
  ),
  constraint site_registrations_phone_check check (
    phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
  ),
  constraint site_registrations_page_check check (length(page) <= 200),
  constraint site_registrations_status_check check (
    status in ('registered', 'duplicate', 'unassigned')
  )
);

comment on table public.site_registrations is
  'Заявки с формы на сайте как их прислали. Участник мероприятия заводится отдельно и может отсутствовать.';
comment on column public.site_registrations.consent_at is
  'Когда человек отметил согласие на обработку данных и связь. Без него работать с контактом нельзя.';

create index if not exists site_registrations_event_idx
  on public.site_registrations (event_id, created_at desc);

create index if not exists site_registrations_phone_idx
  on public.site_registrations (phone_e164, created_at desc);

-- Учётная запись, от имени которой заводится участник и контакт базы. Заявку приносит не
-- администратор, а посетитель сайта, но `created_by_admin_id` обязателен — и это правильно:
-- по нему видно, что строку завела не рука. Запись помечена `suspended`, поэтому войти под
-- ней в панель нельзя ни при каких обстоятельствах, а `auth_subject` заведомо не совпадёт ни
-- с одним UID Supabase.
insert into public.admin_accounts (id, auth_subject, display_name, status)
values (
  '00000000-0000-4000-8000-000000000001',
  'system:site-registration',
  'Регистрация с сайта',
  'suspended'
)
on conflict (id) do nothing;

-- Новый вид уведомления: заявка с сайта организаторам. Значение добавляется к перечню, а не
-- заменяет его — старыми подписаны уже доставленные сообщения.
alter table public.notification_deliveries
  drop constraint notification_deliveries_kind_check;

alter table public.notification_deliveries
  add constraint notification_deliveries_kind_check check (
    kind in (
      'ticket_user', 'admin_purchase',
      'questionnaire_prompt', 'event_reminder', 'admin_broadcast',
      'site_registration'
    )
  );
