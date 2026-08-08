-- Расходы выездного мероприятия: подрядчики, статьи, смета и факт.
--
-- До сих пор система знала только приход. Расход — вторая половина ответа на вопрос
-- «сколько мы заработали», и без него доли организаторов посчитать не от чего.
--
-- Три решения, заложенные в схему:
--
-- 1. Подрядчики общие для всех мероприятий, а не внутри одного. Иначе «у кого арендовали
--    палатки в прошлом году» остаётся вопросом к памяти, а не к системе.
-- 2. У расхода нет «кто заплатил из своего кармана»: касса общая, взаиморасчётов между
--    организаторами не ведём. Есть только чем платили и кто внёс запись.
-- 3. Оплаченный расход не удаляется. Это финансовая история мероприятия: ошиблись —
--    отменяем с причиной, и строка остаётся видна.

create table if not exists public.vendors (
  id uuid primary key,
  name text not null,
  kind text not null default 'other',
  contact_name text,
  phone_e164 text,
  telegram text,
  note text not null default '',
  is_archived boolean not null default false,
  created_by_admin_id uuid not null references public.admin_accounts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vendors_name_check check (length(btrim(name)) between 1 and 200),
  constraint vendors_kind_check check (
    kind in ('rent', 'catering', 'transport', 'venue', 'staff', 'other')
  ),
  constraint vendors_contact_name_check check (
    contact_name is null or length(btrim(contact_name)) between 1 and 200
  ),
  constraint vendors_phone_check check (
    phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
  ),
  constraint vendors_telegram_check check (
    telegram is null or length(btrim(telegram)) between 1 and 100
  ),
  constraint vendors_note_check check (length(note) <= 1000)
);

-- Имя подрядчика уникально без учёта регистра: два «Палатки Урала» в списке — это способ
-- потерять историю, по которой к нему и обращаются.
create unique index if not exists vendors_name_unique_idx
  on public.vendors (lower(btrim(name)));

create index if not exists vendors_active_idx
  on public.vendors (is_archived, lower(btrim(name)));

create table if not exists public.expense_categories (
  code text primary key,
  label text not null,
  position integer not null,
  is_system boolean not null default false,
  constraint expense_categories_code_check check (code ~ '^[a-z][a-z0-9_]{0,39}$'),
  constraint expense_categories_label_check check (
    length(btrim(label)) between 1 and 80
  ),
  constraint expense_categories_position_check check (position between 1 and 100)
);

insert into public.expense_categories (code, label, position, is_system) values
  ('rent', 'Аренда', 1, true),
  ('food', 'Продукты и питание', 2, true),
  ('equipment', 'Оборудование и инвентарь', 3, true),
  ('transport', 'Транспорт', 4, true),
  ('staff', 'Персонал и подряд', 5, true),
  ('decor', 'Декор и оформление', 6, true),
  ('marketing', 'Реклама и продвижение', 7, true),
  ('other', 'Прочее', 8, true)
on conflict (code) do nothing;

create table if not exists public.event_expenses (
  id uuid primary key,
  event_id uuid not null references public.events(id),
  category_code text not null references public.expense_categories(code),
  vendor_id uuid references public.vendors(id),
  title text not null,
  quantity numeric(12, 3) not null default 1,
  unit text not null default '',
  -- Смета и факт живут в одной строке: «планировали 30 000, отдали 34 500» — это одна
  -- запись с двумя числами, а не две записи, которые потом надо сопоставлять глазами.
  planned_kopecks bigint not null default 0,
  actual_kopecks bigint,
  status text not null default 'planned',
  paid_at timestamptz,
  payment_method text,
  note text not null default '',
  cancelled_at timestamptz,
  cancelled_reason text,
  created_by_admin_id uuid not null references public.admin_accounts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  lock_version integer not null default 1,
  constraint event_expenses_title_check check (length(btrim(title)) between 1 and 200),
  constraint event_expenses_quantity_check check (quantity > 0 and quantity <= 100000),
  constraint event_expenses_unit_check check (length(unit) <= 40),
  constraint event_expenses_planned_check check (planned_kopecks >= 0),
  constraint event_expenses_actual_check check (
    actual_kopecks is null or actual_kopecks >= 0
  ),
  constraint event_expenses_status_check check (
    status in ('planned', 'committed', 'paid', 'cancelled')
  ),
  -- Оплачено — значит известно сколько и когда. Без этого «оплачено» ничего не значит,
  -- а в сумму фактических расходов попадает пустота.
  constraint event_expenses_paid_complete_check check (
    status <> 'paid' or (actual_kopecks is not null and paid_at is not null)
  ),
  constraint event_expenses_cancelled_check check (
    (status = 'cancelled') = (cancelled_at is not null)
  ),
  constraint event_expenses_cancelled_reason_check check (
    cancelled_at is null
    or length(btrim(coalesce(cancelled_reason, ''))) between 3 and 500
  ),
  constraint event_expenses_payment_method_check check (
    payment_method is null or length(btrim(payment_method)) between 1 and 80
  ),
  constraint event_expenses_note_check check (length(note) <= 1000),
  constraint event_expenses_lock_version_check check (lock_version > 0)
);

create index if not exists event_expenses_event_idx
  on public.event_expenses (event_id, category_code, created_at);

create index if not exists event_expenses_vendor_idx
  on public.event_expenses (vendor_id, created_at desc)
  where vendor_id is not null;

-- Оплаченный расход не удаляется: это финансовая история мероприятия, по ней потом
-- считаются доли. Ошиблись — статус 'cancelled' с причиной.
create or replace function public.prevent_paid_expense_delete()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'paid' then
    raise exception 'paid expenses cannot be deleted, cancel them instead';
  end if;
  return old;
end;
$$;

drop trigger if exists event_expenses_prevent_paid_delete on public.event_expenses;
create trigger event_expenses_prevent_paid_delete
before delete on public.event_expenses
for each row execute function public.prevent_paid_expense_delete();

insert into public.admin_permissions (code, description) values
  ('expenses.read', 'Read the expense estimate and actuals of an event'),
  ('expenses.manage', 'Add, edit and cancel event expenses and vendors')
on conflict (code) do nothing;

-- Смотреть расходы полезно всем, кто работает с мероприятием; вносить их — решение
-- владельца, поэтому expenses.manage только у супер-администратора.
insert into public.admin_role_permissions (role_code, permission_code) values
  ('content_manager', 'expenses.read'),
  ('sales_manager', 'expenses.read'),
  ('super_admin', 'expenses.read'),
  ('super_admin', 'expenses.manage')
on conflict (role_code, permission_code) do nothing;
