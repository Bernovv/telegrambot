-- Расселение по палаткам: что везём на выездное мероприятие.
--
-- Считаем не по головам, а по компаниям — заказ это люди, которые едут вместе. Незнакомых
-- автоматически не подселяем, поэтому объединение компаний это ручное решение, и оно
-- хранится здесь же (accommodation_groups). Зафиксированный план — снимок с датой:
-- продажи идут дальше, а палатки грузят один раз.
--
-- Ресурсов как отдельной сущности пока нет (это следующая фаза). Единственное, что нужно
-- знать про билет прямо сейчас — даёт ли он спальное место; для этого одна колонка на
-- ticket_products вместо зашитого в код списка «VIP значит с ночёвкой».

alter table public.ticket_products
  add column if not exists includes_sleeping_place boolean not null default false;

comment on column public.ticket_products.includes_sleeping_place is
  'Билет даёт спальное место в нашей палатке. Число мест равно inventory_units_per_item: ребёнок занимает полноценное место.';

-- Бизнес-Пикник: спальное место входит в оба тарифа «Все включено» и ни в один другой.
update public.ticket_products
set includes_sleeping_place = true,
    updated_at = now()
where product_type in ('adult_vip', 'family_vip')
  and includes_sleeping_place = false;

create table if not exists public.accommodation_groups (
  id uuid primary key,
  event_id uuid not null references public.events(id),
  note text not null default '',
  created_by_admin_id uuid not null references public.admin_accounts(id),
  created_at timestamptz not null default now(),
  constraint accommodation_groups_note_check check (length(note) <= 500)
);

create index if not exists accommodation_groups_event_idx
  on public.accommodation_groups (event_id, created_at desc);

-- Заказ живёт максимум в одной группе: две палатки одновременно ему не нужны.
create table if not exists public.accommodation_group_orders (
  group_id uuid not null references public.accommodation_groups(id) on delete cascade,
  order_id uuid not null references public.orders(id),
  added_at timestamptz not null default now(),
  primary key (group_id, order_id),
  unique (order_id)
);

create table if not exists public.accommodation_plans (
  id uuid primary key,
  event_id uuid not null references public.events(id),
  fixed_by_admin_id uuid not null references public.admin_accounts(id),
  fixed_at timestamptz not null,
  note text not null default '',
  required_berths integer not null,
  total_tents integer not null,
  snapshot_schema_version smallint not null default 1,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  constraint accommodation_plans_note_check check (length(note) <= 500),
  constraint accommodation_plans_berths_check check (required_berths >= 0),
  constraint accommodation_plans_tents_check check (total_tents >= 0),
  constraint accommodation_plans_snapshot_schema_check check (snapshot_schema_version > 0),
  constraint accommodation_plans_snapshot_check check (jsonb_typeof(snapshot) = 'object')
);

create index if not exists accommodation_plans_event_idx
  on public.accommodation_plans (event_id, fixed_at desc);

-- Зафиксированный план — свидетельство того, на что мы рассчитывали, когда грузили машину.
-- Переписывать его задним числом нельзя, ошиблись — фиксируем новый.
create or replace function public.prevent_accommodation_plan_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'accommodation_plans is append-only';
end;
$$;

drop trigger if exists accommodation_plans_prevent_update on public.accommodation_plans;
create trigger accommodation_plans_prevent_update
before update on public.accommodation_plans
for each row execute function public.prevent_accommodation_plan_mutation();

drop trigger if exists accommodation_plans_prevent_delete on public.accommodation_plans;
create trigger accommodation_plans_prevent_delete
before delete on public.accommodation_plans
for each row execute function public.prevent_accommodation_plan_mutation();

insert into public.admin_permissions (code, description) values
  ('accommodation.read', 'Read the accommodation and logistics summary for an event'),
  ('accommodation.manage', 'Merge accommodation parties and fix the tent plan')
on conflict (code) do nothing;

-- Смотреть, что везём, полезно всем, кто работает с мероприятием. Решение о подселении
-- принимает владелец, поэтому accommodation.manage только у супер-администратора.
insert into public.admin_role_permissions (role_code, permission_code) values
  ('content_manager', 'accommodation.read'),
  ('sales_manager', 'accommodation.read'),
  ('super_admin', 'accommodation.read'),
  ('super_admin', 'accommodation.manage')
on conflict (role_code, permission_code) do nothing;
