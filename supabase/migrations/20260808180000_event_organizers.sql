-- Команда мероприятия и доли от прибыли.
--
-- Доля считается от прибыли: выручка минус фактические расходы. Пока расходы внесены не
-- целиком, прибыль завышена, поэтому расчёт помечается предварительным — само число тут
-- не хранится, оно считается на лету по расходам и заказам.
--
-- Фиксированных оплат здесь нет намеренно. Повар и фотограф с твёрдой ценой — это строка
-- в расходах по статье «Персонал и подряд». Держать их сумму ещё и на карточке
-- организатора значило бы завести второй источник правды об одних и тех же деньгах и
-- однажды посчитать их дважды.

create table if not exists public.event_organizers (
  id uuid primary key,
  event_id uuid not null references public.events(id),
  admin_account_id uuid references public.admin_accounts(id),
  person_name text not null,
  role_label text not null default '',
  share_percent numeric(5, 2) not null default 0,
  responsibilities text not null default '',
  note text not null default '',
  created_by_admin_id uuid not null references public.admin_accounts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_organizers_person_check check (
    length(btrim(person_name)) between 1 and 200
  ),
  constraint event_organizers_role_check check (length(role_label) <= 80),
  constraint event_organizers_share_check check (
    share_percent >= 0 and share_percent <= 100
  ),
  constraint event_organizers_responsibilities_check check (
    length(responsibilities) <= 1000
  ),
  constraint event_organizers_note_check check (length(note) <= 1000)
);

-- Один человек в команде мероприятия один раз: две строки на одного — это способ
-- незаметно удвоить его долю.
create unique index if not exists event_organizers_person_unique_idx
  on public.event_organizers (event_id, lower(btrim(person_name)));

create index if not exists event_organizers_event_idx
  on public.event_organizers (event_id, share_percent desc);

insert into public.admin_permissions (code, description) values
  ('event_finance.read', 'See the profit of an event and how it splits between organizers'),
  ('event_finance.manage', 'Edit the organizer roster and their profit shares')
on conflict (code) do nothing;

-- Кто сколько заработал видит только владелец: это не операционные данные, и остальным
-- ролям они не нужны ни для продаж, ни для контента.
insert into public.admin_role_permissions (role_code, permission_code) values
  ('super_admin', 'event_finance.read'),
  ('super_admin', 'event_finance.manage')
on conflict (role_code, permission_code) do nothing;
