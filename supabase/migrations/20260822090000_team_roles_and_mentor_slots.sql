-- Команда: три роли вместо пяти технических и календарь наставника.
--
-- Роли в базе были заведены под устройство системы: «content_manager», «technical_admin»,
-- «financial_admin». В работе людей делят иначе и всего на три группы: руководитель видит
-- всё, менеджер обзванивает и ведёт базу, наставник проводит личные встречи. Прежние роли
-- остаются: они уже выданы, и снимать их миграцией значит отобрать доступ у тех, кто
-- работает прямо сейчас. Новые роли просто добавляются рядом, и кабинет выдаёт их.
--
-- Наставник отличается от остальных не только правами: у него есть календарь. Менеджер,
-- договорившись о личной встрече, должен выбрать время из свободных окошек наставника, а
-- не назначить любое, — иначе двое менеджеров назначают на один час, и узнаётся это от
-- наставника.

insert into public.admin_permissions (code, description) values
  ('team.read', 'Read the team and mentor calendars'),
  ('team.manage', 'Grant and revoke team roles'),
  ('mentor_slots.manage', 'Add and remove mentor meeting slots'),
  ('mentor_slots.book', 'Book a mentor slot for a client')
on conflict (code) do nothing;

-- Второй фактор роли не требуют: он включается на весь кабинет переменной окружения и
-- отдельно на денежных разрешениях. Роль, помеченная `requires_mfa`, при выключенном
-- втором факторе не значит ничего, а при включённом — запирает руководителя из-за
-- настройки, о которой он не знает.
insert into public.admin_roles (code, display_name, requires_mfa) values
  ('head', 'Руководитель', false),
  ('manager', 'Менеджер', false),
  ('mentor', 'Наставник', false)
on conflict (code) do nothing;

-- Руководитель получает всё, что есть на момент миграции. Разрешение, добавленное
-- позже, придётся выдать ему следующей миграцией — иначе «полный доступ» тихо
-- перестанет быть полным.
insert into public.admin_role_permissions (role_code, permission_code)
select 'head', permission.code from public.admin_permissions permission
on conflict (role_code, permission_code) do nothing;

-- Менеджер: люди, базы, задачи, мероприятия. Денег он не двигает — возвраты, начисления
-- на кошелёк и подтверждение оплаты руками остаются у руководителя.
insert into public.admin_role_permissions (role_code, permission_code) values
  ('manager', 'users.read'),
  ('manager', 'users.write'),
  ('manager', 'contacts.export'),
  ('manager', 'participants.export'),
  ('manager', 'outreach.read'),
  ('manager', 'outreach.write'),
  ('manager', 'outreach.delete'),
  ('manager', 'events.read'),
  ('manager', 'events.write'),
  ('manager', 'accommodation.read'),
  ('manager', 'accommodation.manage'),
  ('manager', 'participants.manage'),
  ('manager', 'expenses.read'),
  ('manager', 'inventory.read'),
  ('manager', 'inventory.manage'),
  ('manager', 'orders.read'),
  ('manager', 'orders.create'),
  ('manager', 'broadcasts.send'),
  ('manager', 'imports.execute'),
  ('manager', 'team.read'),
  ('manager', 'mentor_slots.book')
on conflict (role_code, permission_code) do nothing;

-- Наставник ведёт свой календарь и видит человека, к которому идёт на встречу. Воронку
-- он не правит: работа по карточке — дело менеджера.
insert into public.admin_role_permissions (role_code, permission_code) values
  ('mentor', 'outreach.read'),
  ('mentor', 'events.read'),
  ('mentor', 'team.read'),
  ('mentor', 'mentor_slots.manage')
on conflict (role_code, permission_code) do nothing;

-- Прежним ролям новые разрешения тоже нужны: супер-администратор — это тот же
-- руководитель, а «Команда» не должна открываться пустой у того, кто вчера ею управлял.
insert into public.admin_role_permissions (role_code, permission_code) values
  ('super_admin', 'team.read'),
  ('super_admin', 'team.manage'),
  ('super_admin', 'mentor_slots.manage'),
  ('super_admin', 'mentor_slots.book'),
  ('sales_manager', 'team.read'),
  ('sales_manager', 'mentor_slots.book')
on conflict (role_code, permission_code) do nothing;

-- Окошко наставника.
--
-- Одна строка — один час в календаре. Свободное окошко — то, у которого нет клиента;
-- занятое хранит, кого и кто записал. Отмена не удаляет строку: «встречу отменили» —
-- это событие, а не отсутствие события, и по удалённой строке нельзя ответить, почему
-- человек не пришёл.
create table public.mentor_slots (
  id uuid primary key default gen_random_uuid(),
  mentor_admin_id uuid not null references public.admin_accounts(id),
  starts_at timestamptz not null,
  duration_minutes smallint not null default 60,
  -- Кого записали. Пусто — окошко свободно.
  contact_id uuid references public.outreach_contacts(id),
  booked_by_admin_id uuid references public.admin_accounts(id),
  booked_at timestamptz,
  note text,
  cancelled_at timestamptz,
  cancelled_by_admin_id uuid references public.admin_accounts(id),
  created_by_admin_id uuid not null references public.admin_accounts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mentor_slots_duration_check check (
    duration_minutes between 15 and 480
  ),
  -- Записанный клиент без времени записи и без того, кто записал, — это строка, по
  -- которой нельзя спросить «кто назначил». Либо окошко свободно целиком, либо занято
  -- целиком.
  constraint mentor_slots_booking_check check (
    (contact_id is null and booked_by_admin_id is null and booked_at is null)
    or (contact_id is not null and booked_by_admin_id is not null
        and booked_at is not null)
  ),
  constraint mentor_slots_cancel_check check (
    (cancelled_at is null and cancelled_by_admin_id is null)
    or (cancelled_at is not null and cancelled_by_admin_id is not null)
  ),
  constraint mentor_slots_note_check check (
    note is null or length(btrim(note)) between 1 and 500
  )
);

-- Двух окошек на одно время у наставника быть не может: это ровно та ошибка, ради
-- которой календарь и заводится.
create unique index mentor_slots_mentor_start_idx
  on public.mentor_slots (mentor_admin_id, starts_at)
  where cancelled_at is null;

create index mentor_slots_free_idx
  on public.mentor_slots (starts_at)
  where cancelled_at is null and contact_id is null;

create index mentor_slots_contact_idx
  on public.mentor_slots (contact_id, starts_at desc)
  where contact_id is not null;

comment on table public.mentor_slots is
  'Календарь наставника: свободные и занятые окошки личных встреч.';
