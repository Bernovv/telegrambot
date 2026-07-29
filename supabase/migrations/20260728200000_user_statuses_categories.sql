create table public.user_statuses (
  id uuid primary key,
  code text not null unique,
  display_name text not null,
  color text not null,
  description text,
  is_system boolean not null default false,
  exclusivity_group text,
  allowed_transition_codes text[],
  is_active boolean not null default true,
  lock_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_statuses_code_check check (
    code ~ '^[a-z][a-z0-9_]{1,63}$'
  ),
  constraint user_statuses_display_name_check check (
    length(btrim(display_name)) between 1 and 120
  ),
  constraint user_statuses_color_check check (
    color ~ '^#[0-9A-F]{6}$'
  ),
  constraint user_statuses_description_check check (
    description is null or length(btrim(description)) between 1 and 500
  ),
  constraint user_statuses_exclusivity_group_check check (
    exclusivity_group is null
    or exclusivity_group ~ '^[a-z][a-z0-9_]{1,63}$'
  ),
  constraint user_statuses_allowed_transitions_check check (
    allowed_transition_codes is null
    or cardinality(allowed_transition_codes) between 1 and 64
  ),
  constraint user_statuses_lock_version_check check (
    lock_version > 0
  )
);

create table public.user_categories (
  id uuid primary key,
  code text not null unique,
  display_name text not null,
  color text not null,
  description text,
  is_system boolean not null default false,
  is_active boolean not null default true,
  lock_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_categories_code_check check (
    code ~ '^[a-z][a-z0-9_]{1,63}$'
  ),
  constraint user_categories_display_name_check check (
    length(btrim(display_name)) between 1 and 120
  ),
  constraint user_categories_color_check check (
    color ~ '^#[0-9A-F]{6}$'
  ),
  constraint user_categories_description_check check (
    description is null or length(btrim(description)) between 1 and 500
  ),
  constraint user_categories_lock_version_check check (
    lock_version > 0
  )
);

create table public.user_status_assignments (
  id uuid primary key,
  user_id uuid not null references public.users(id),
  status_id uuid not null references public.user_statuses(id),
  status_code text not null,
  status_display_name text not null,
  status_color text not null,
  exclusivity_group text,
  source_type text not null,
  source_reference text not null,
  actor_admin_id uuid references public.admin_accounts(id),
  reason text not null,
  assigned_at timestamptz not null,
  removed_at timestamptz,
  removal_source_type text,
  removal_source_reference text,
  removal_reason text,
  created_at timestamptz not null default now(),
  constraint user_status_assignments_source_check check (
    source_type in ('manual', 'scenario', 'survey', 'import', 'payment')
  ),
  constraint user_status_assignments_source_reference_check check (
    length(source_reference) between 8 and 250
  ),
  constraint user_status_assignments_reason_check check (
    length(btrim(reason)) between 3 and 500
  ),
  constraint user_status_assignments_removal_check check (
    (
      removed_at is null
      and removal_source_type is null
      and removal_source_reference is null
      and removal_reason is null
    )
    or (
      removed_at >= assigned_at
      and removal_source_type in ('manual', 'scenario', 'survey', 'import', 'payment')
      and length(removal_source_reference) between 8 and 250
      and length(btrim(removal_reason)) between 3 and 500
    )
  ),
  constraint user_status_assignments_source_unique unique (
    source_type,
    source_reference
  )
);

create table public.user_category_assignments (
  id uuid primary key,
  user_id uuid not null references public.users(id),
  category_id uuid not null references public.user_categories(id),
  category_code text not null,
  category_display_name text not null,
  category_color text not null,
  source_type text not null,
  source_reference text not null,
  actor_admin_id uuid references public.admin_accounts(id),
  reason text not null,
  assigned_at timestamptz not null,
  removed_at timestamptz,
  removal_source_type text,
  removal_source_reference text,
  removal_reason text,
  created_at timestamptz not null default now(),
  constraint user_category_assignments_source_check check (
    source_type in ('manual', 'scenario', 'survey', 'import', 'payment')
  ),
  constraint user_category_assignments_source_reference_check check (
    length(source_reference) between 8 and 250
  ),
  constraint user_category_assignments_reason_check check (
    length(btrim(reason)) between 3 and 500
  ),
  constraint user_category_assignments_removal_check check (
    (
      removed_at is null
      and removal_source_type is null
      and removal_source_reference is null
      and removal_reason is null
    )
    or (
      removed_at >= assigned_at
      and removal_source_type in ('manual', 'scenario', 'survey', 'import', 'payment')
      and length(removal_source_reference) between 8 and 250
      and length(btrim(removal_reason)) between 3 and 500
    )
  ),
  constraint user_category_assignments_source_unique unique (
    source_type,
    source_reference
  )
);

create unique index user_status_assignments_active_status_idx
  on public.user_status_assignments (user_id, status_id)
  where removed_at is null;

create unique index user_status_assignments_active_group_idx
  on public.user_status_assignments (user_id, exclusivity_group)
  where removed_at is null and exclusivity_group is not null;

create index user_status_assignments_user_history_idx
  on public.user_status_assignments (user_id, assigned_at desc, id desc);

create unique index user_category_assignments_active_category_idx
  on public.user_category_assignments (user_id, category_id)
  where removed_at is null;

create index user_category_assignments_user_history_idx
  on public.user_category_assignments (user_id, assigned_at desc, id desc);

create function public.protect_user_classification_catalog()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'User classification catalog rows must be deactivated, not deleted';
  end if;

  if new.code is distinct from old.code
     or new.is_system is distinct from old.is_system then
    raise exception 'User classification codes and system flags are immutable';
  end if;

  if old.is_system and not new.is_active then
    raise exception 'System user classification rows cannot be deactivated';
  end if;

  return new;
end;
$$;

create trigger protect_user_status_catalog
before update or delete on public.user_statuses
for each row execute function public.protect_user_classification_catalog();

create trigger protect_user_category_catalog
before update or delete on public.user_categories
for each row execute function public.protect_user_classification_catalog();

create function public.protect_user_classification_assignment()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'User classification assignment history is append-only';
  end if;

  if old.removed_at is not null
     or new.removed_at is null
     or (
       to_jsonb(new)
       - array[
           'removed_at',
           'removal_source_type',
           'removal_source_reference',
           'removal_reason'
         ]
       is distinct from
       to_jsonb(old)
       - array[
           'removed_at',
           'removal_source_type',
           'removal_source_reference',
           'removal_reason'
         ]
     ) then
    raise exception 'User classification assignment history is immutable';
  end if;

  return new;
end;
$$;

create trigger protect_user_status_assignment
before update or delete on public.user_status_assignments
for each row execute function public.protect_user_classification_assignment();

create trigger protect_user_category_assignment
before update or delete on public.user_category_assignments
for each row execute function public.protect_user_classification_assignment();

insert into public.user_statuses (
  id,
  code,
  display_name,
  color,
  description,
  is_system,
  exclusivity_group
) values
  (
    '00000000-0000-4000-8000-000000001001',
    'new',
    'Новый',
    '#64748B',
    'Новый пользователь без подтвержденного контакта.',
    true,
    'lifecycle'
  ),
  (
    '00000000-0000-4000-8000-000000001002',
    'phone_received',
    'Телефон получен',
    '#2563EB',
    'Пользователь подтвердил номер телефона.',
    true,
    'lifecycle'
  ),
  (
    '00000000-0000-4000-8000-000000001003',
    'interested',
    'Заинтересован',
    '#7C3AED',
    'Пользователь проявил интерес к мероприятию.',
    true,
    'lifecycle'
  ),
  (
    '00000000-0000-4000-8000-000000001004',
    'order_created',
    'Заказ создан',
    '#D97706',
    'Пользователь создал заказ.',
    true,
    'lifecycle'
  ),
  (
    '00000000-0000-4000-8000-000000001005',
    'payment_pending',
    'Ожидает оплату',
    '#EA580C',
    'Заказ пользователя ожидает оплату.',
    true,
    'lifecycle'
  ),
  (
    '00000000-0000-4000-8000-000000001006',
    'paid',
    'Оплатил',
    '#16A34A',
    'Пользователь оплатил заказ.',
    true,
    'lifecycle'
  ),
  (
    '00000000-0000-4000-8000-000000001007',
    'attendee',
    'Участник',
    '#0F766E',
    'Пользователь зарегистрирован как участник.',
    true,
    'lifecycle'
  ),
  (
    '00000000-0000-4000-8000-000000001008',
    'asked_question',
    'Задал вопрос',
    '#0891B2',
    'Пользователь обратился в поддержку.',
    true,
    'engagement'
  ),
  (
    '00000000-0000-4000-8000-000000001009',
    'bot_blocked',
    'Бот заблокирован',
    '#DC2626',
    'Пользователь заблокировал бота.',
    true,
    'reachability'
  );
