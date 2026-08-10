-- Склад компании, потребность на мероприятие и пометка «живут одни».
--
-- Три вещи, которых системе не хватало, чтобы собрать машину:
--
-- 1. Что у нас уже есть. Склад общий для всех мероприятий: только так работает вопрос
--    «что куплено в прошлые разы, а что надо купить».
-- 2. Комплекты. У подрядчика палатка приезжает со спальниками и пенками по числу мест —
--    заказали три трёхместные, значит нужно девять спальников и девять пенок.
-- 3. Кто живёт один. Люди часто просят палатку на себя, а расчёт считал одиночек ошибкой
--    и предлагал их подселить.

create table if not exists public.inventory_items (
  id uuid primary key,
  title text not null,
  category_code text not null references public.expense_categories(code),
  unit text not null default 'шт',
  -- Считается из движений и обновляется вместе с ними: держать отдельно проще, чем
  -- пересчитывать историю на каждом экране.
  quantity_owned numeric(12, 3) not null default 0,
  storage_location text not null default '',
  condition text not null default 'good',
  note text not null default '',
  is_archived boolean not null default false,
  created_by_admin_id uuid not null references public.admin_accounts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_items_title_check check (length(btrim(title)) between 1 and 200),
  constraint inventory_items_unit_check check (length(btrim(unit)) between 1 and 40),
  constraint inventory_items_quantity_check check (quantity_owned >= 0),
  constraint inventory_items_condition_check check (
    condition in ('new', 'good', 'worn', 'broken')
  ),
  constraint inventory_items_location_check check (length(storage_location) <= 200),
  constraint inventory_items_note_check check (length(note) <= 1000)
);

create unique index if not exists inventory_items_title_unique_idx
  on public.inventory_items (lower(btrim(title)));

create index if not exists inventory_items_active_idx
  on public.inventory_items (is_archived, category_code, lower(btrim(title)));

-- Комплект: палатка тянет за собой спальники и пенки по числу мест.
create table if not exists public.inventory_item_components (
  parent_item_id uuid not null references public.inventory_items(id) on delete cascade,
  child_item_id uuid not null references public.inventory_items(id),
  quantity_per_parent numeric(12, 3) not null,
  primary key (parent_item_id, child_item_id),
  constraint inventory_item_components_quantity_check check (
    quantity_per_parent > 0 and quantity_per_parent <= 1000
  ),
  -- Комплект внутри самого себя развернуть невозможно: запрещаем сразу.
  constraint inventory_item_components_self_check check (parent_item_id <> child_item_id)
);

create index if not exists inventory_item_components_child_idx
  on public.inventory_item_components (child_item_id);

-- Движения только добавляются. Пропавшая палатка обязана остаться в истории списанием,
-- а не тихим уменьшением числа на складе.
create table if not exists public.inventory_movements (
  id uuid primary key,
  item_id uuid not null references public.inventory_items(id),
  event_id uuid references public.events(id),
  kind text not null,
  quantity_delta numeric(12, 3) not null,
  note text not null default '',
  admin_id uuid not null references public.admin_accounts(id),
  occurred_at timestamptz not null default now(),
  constraint inventory_movements_kind_check check (
    kind in ('purchase', 'loaded', 'returned', 'written_off', 'audit')
  ),
  constraint inventory_movements_delta_check check (quantity_delta <> 0),
  constraint inventory_movements_note_check check (length(note) <= 500)
);

create index if not exists inventory_movements_item_idx
  on public.inventory_movements (item_id, occurred_at desc);

create index if not exists inventory_movements_event_idx
  on public.inventory_movements (event_id, occurred_at desc)
  where event_id is not null;

create or replace function public.prevent_inventory_movement_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'inventory_movements is append-only';
end;
$$;

drop trigger if exists inventory_movements_prevent_update on public.inventory_movements;
create trigger inventory_movements_prevent_update
before update on public.inventory_movements
for each row execute function public.prevent_inventory_movement_mutation();

drop trigger if exists inventory_movements_prevent_delete on public.inventory_movements;
create trigger inventory_movements_prevent_delete
before delete on public.inventory_movements
for each row execute function public.prevent_inventory_movement_mutation();

-- Что нужно на конкретное мероприятие. Позиции ещё нет на складе — пишем названием:
-- заводить карточку под то, что только собираются купить, рано.
create table if not exists public.event_inventory_needs (
  id uuid primary key,
  event_id uuid not null references public.events(id),
  item_id uuid references public.inventory_items(id),
  title text not null,
  quantity_needed numeric(12, 3) not null,
  source text not null default 'stock',
  status text not null default 'needed',
  expense_id uuid references public.event_expenses(id),
  note text not null default '',
  created_by_admin_id uuid not null references public.admin_accounts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_inventory_needs_title_check check (
    length(btrim(title)) between 1 and 200
  ),
  constraint event_inventory_needs_quantity_check check (
    quantity_needed > 0 and quantity_needed <= 100000
  ),
  constraint event_inventory_needs_source_check check (
    source in ('stock', 'buy', 'rent')
  ),
  constraint event_inventory_needs_status_check check (
    status in ('needed', 'ordered', 'ready', 'loaded', 'returned')
  ),
  constraint event_inventory_needs_note_check check (length(note) <= 500)
);

create index if not exists event_inventory_needs_event_idx
  on public.event_inventory_needs (event_id, status, created_at);

create index if not exists event_inventory_needs_item_idx
  on public.event_inventory_needs (item_id)
  where item_id is not null;

-- Живут одни. Пометка на заказ, а не на компанию: компания собирается заново при каждом
-- расчёте, а заказ живёт.
create table if not exists public.accommodation_private_tents (
  event_id uuid not null references public.events(id),
  order_id uuid not null references public.orders(id),
  note text not null default '',
  set_by_admin_id uuid not null references public.admin_accounts(id),
  set_at timestamptz not null default now(),
  primary key (event_id, order_id),
  constraint accommodation_private_tents_note_check check (length(note) <= 500)
);

insert into public.admin_permissions (code, description) values
  ('inventory.read', 'Read the company stock and what an event needs from it'),
  ('inventory.manage', 'Edit stock items, event needs and loading status')
on conflict (code) do nothing;

insert into public.admin_role_permissions (role_code, permission_code) values
  ('content_manager', 'inventory.read'),
  ('sales_manager', 'inventory.read'),
  ('sales_manager', 'inventory.manage'),
  ('super_admin', 'inventory.read'),
  ('super_admin', 'inventory.manage')
on conflict (role_code, permission_code) do nothing;
