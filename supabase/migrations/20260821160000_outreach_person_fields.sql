-- Поля, которые принадлежат человеку, а не его работе в одной воронке.
--
-- Дополнительные поля до сих пор висели на участии в кампании
-- (`outreach_custom_field_values.campaign_contact_id`). Для полей воронки это верно: «когда
-- перезвонить по этой кампании» вне её не значит ничего. Но ниша и запрос — это про самого
-- человека: они одни и те же во всех воронках, и у того, кто ни в одной не состоит, тоже
-- есть. В прежней схеме такое поле пришлось бы заполнять заново в каждой кампании, а у
-- человека без кампании оно бы просто негде было хранить.
--
-- Определения полей уже умеют быть общими (`campaign_id is null`) — не хватало места для
-- значения. Эта таблица его и даёт. Значение уровня человека может быть только у общего
-- поля: поле, заведённое в одной кампании, вне её ничего не описывает.

create table public.outreach_contact_field_values (
  contact_id uuid not null references public.outreach_contacts(id),
  field_definition_id uuid not null
    references public.outreach_custom_field_definitions(id),
  value_text text,
  value_number numeric,
  value_date date,
  updated_at timestamptz not null default now(),
  primary key (contact_id, field_definition_id),
  constraint outreach_contact_field_values_text_check check (
    value_text is null or length(value_text) <= 500
  )
);

create index outreach_contact_field_values_definition_idx
  on public.outreach_contact_field_values (field_definition_id);

-- Внешним ключом это не выражается: ссылаться пришлось бы на частичный уникальный индекс
-- «id там, где campaign_id пуст», а такие индексы целями внешних ключей быть не могут.
create or replace function public.check_outreach_contact_field_is_shared()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1
    from public.outreach_custom_field_definitions definition
    where definition.id = new.field_definition_id
      and definition.campaign_id is not null
  ) then
    raise exception 'Outreach field % belongs to a campaign and has no person-level value',
      new.field_definition_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger outreach_contact_field_values_shared
  before insert or update on public.outreach_contact_field_values
  for each row execute function public.check_outreach_contact_field_is_shared();

-- Ответственный за человека — «чей это клиент».
--
-- Ответственный за участие в воронке остаётся как был: он про работу в конкретной кампании.
-- Но задачи и автозадачи должны знать, кому достаётся звонок, когда человек не состоит ни в
-- одной кампании или состоит сразу в трёх, — а на это ответственный за участие не отвечает.
alter table public.outreach_contacts
  add column if not exists assigned_admin_id uuid
    references public.admin_accounts(id),
  -- Личная встреча менеджера с клиентом. Не мероприятие: на мероприятие человек попадает
  -- участником, а это разговор один на один, о котором надо напомнить накануне.
  add column if not exists next_meeting_at timestamptz;

create index if not exists outreach_contacts_assigned_idx
  on public.outreach_contacts (assigned_admin_id)
  where assigned_admin_id is not null;

create index if not exists outreach_contacts_meeting_idx
  on public.outreach_contacts (next_meeting_at)
  where next_meeting_at is not null;

comment on column public.outreach_contacts.assigned_admin_id is
  'Ответственный за человека целиком. Ему достаются автозадачи и задачи без выбранного менеджера.';
comment on column public.outreach_contacts.next_meeting_at is
  'Личная встреча менеджера с клиентом. Мероприятия живут отдельно, в участниках.';

-- Ниша и запрос — то, ради чего эта таблица и заводится.
--
-- Оба поля текстовые, а не списком: список ниш заранее неизвестен, а выбор, варианты
-- которого потом нельзя дописать, хуже свободного текста. Когда ниши накопятся и станет
-- видно настоящий список, поле переводится в выбор отдельной миграцией.
insert into public.outreach_custom_field_definitions (
  id, campaign_id, field_key, label, field_type, options, position,
  created_by_admin_id, created_at, updated_at
)
select
  gen_random_uuid(),
  null,
  seed.field_key,
  seed.label,
  'text',
  null,
  seed.position,
  '00000000-0000-4000-8000-000000000002'::uuid,
  now(),
  now()
from (values
  ('nisha', 'Ниша', 1),
  ('zapros', 'Запрос', 2)
) as seed(field_key, label, position)
where not exists (
  select 1 from public.outreach_custom_field_definitions existing
  where existing.campaign_id is null and existing.field_key = seed.field_key
);
