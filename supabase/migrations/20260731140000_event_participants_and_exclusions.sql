-- Кто едет на мероприятие — отдельно от того, кто заплатил через Telegram-бота.
--
-- До этой миграции «участник» был синонимом оплаченного заказа в этой базе. Из-за этого
-- в отчёты не попадали покупатели из MAX, с сайта и те, с кем договорились напрямую, зато
-- попадали тестовые заказы. Теперь источников два: оплаченные заказы (кроме исключённых)
-- и участники, заведённые руками.
--
-- Ничего не удаляем: тестовый заказ помечается исключённым и пропадает из отчётов, но
-- остаётся в финансовой истории. Контакт в «Работе с базой» скрывается с возможностью
-- вернуть, а его история звонков и сообщений остаётся нетронутой.

alter table public.orders
  add column if not exists excluded_at timestamptz,
  add column if not exists excluded_reason text,
  add column if not exists excluded_by_admin_id uuid references public.admin_accounts(id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_excluded_check'
  ) then
    alter table public.orders
      add constraint orders_excluded_check check (
        (excluded_at is null and excluded_reason is null and excluded_by_admin_id is null)
        or (
          excluded_at is not null
          and excluded_by_admin_id is not null
          and length(btrim(coalesce(excluded_reason, ''))) between 3 and 500
        )
      );
  end if;
end;
$$;

comment on column public.orders.excluded_at is
  'Заказ исключён из отчётов и списков участников (тестовый или ошибочный). Финансовые записи при этом не трогаются.';

create index if not exists orders_event_included_idx
  on public.orders (event_id, status)
  where excluded_at is null;

alter table public.outreach_contacts
  add column if not exists archived_at timestamptz,
  add column if not exists archived_reason text,
  add column if not exists archived_by_admin_id uuid references public.admin_accounts(id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'outreach_contacts_archived_check'
  ) then
    alter table public.outreach_contacts
      add constraint outreach_contacts_archived_check check (
        (archived_at is null and archived_reason is null and archived_by_admin_id is null)
        or (archived_at is not null and archived_by_admin_id is not null)
      );
  end if;
end;
$$;

comment on column public.outreach_contacts.archived_at is
  'Контакт убран из списков работы с базой. История активностей сохраняется, контакт можно вернуть.';

create table if not exists public.event_participants (
  id uuid primary key,
  event_id uuid not null references public.events(id),
  outreach_contact_id uuid references public.outreach_contacts(id),
  display_name text not null,
  phone_e164 text,
  source text not null,
  ticket_title text not null default '',
  adults integer not null default 1,
  children integer not null default 0,
  sleeping_places integer not null default 0,
  amount_kopecks bigint,
  note text not null default '',
  created_by_admin_id uuid not null references public.admin_accounts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_reason text,
  deleted_by_admin_id uuid references public.admin_accounts(id),
  constraint event_participants_display_name_check check (
    length(btrim(display_name)) between 1 and 200
  ),
  constraint event_participants_phone_check check (
    phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
  ),
  constraint event_participants_source_check check (
    source in ('max', 'site', 'direct', 'other')
  ),
  constraint event_participants_ticket_title_check check (length(ticket_title) <= 200),
  constraint event_participants_note_check check (length(note) <= 500),
  constraint event_participants_headcount_check check (
    adults >= 0
    and children >= 0
    and adults + children > 0
  ),
  -- Спальных мест не может быть больше, чем людей: ребёнок занимает полноценное место,
  -- но лишних мест мы не везём.
  constraint event_participants_sleeping_check check (
    sleeping_places >= 0 and sleeping_places <= adults + children
  ),
  constraint event_participants_amount_check check (
    amount_kopecks is null or amount_kopecks >= 0
  ),
  constraint event_participants_deleted_check check (
    (deleted_at is null and deleted_reason is null and deleted_by_admin_id is null)
    or (
      deleted_at is not null
      and deleted_by_admin_id is not null
      and length(btrim(coalesce(deleted_reason, ''))) between 3 and 500
    )
  )
);

create index if not exists event_participants_event_idx
  on public.event_participants (event_id, created_at desc)
  where deleted_at is null;

create index if not exists event_participants_contact_idx
  on public.event_participants (outreach_contact_id)
  where outreach_contact_id is not null and deleted_at is null;

insert into public.admin_permissions (code, description) values
  ('participants.manage', 'Add and remove manually entered event participants'),
  ('orders.exclude', 'Exclude a test or mistaken order from reports')
on conflict (code) do nothing;

insert into public.admin_role_permissions (role_code, permission_code) values
  ('sales_manager', 'participants.manage'),
  ('super_admin', 'participants.manage'),
  ('super_admin', 'orders.exclude')
on conflict (role_code, permission_code) do nothing;
