-- Карточка участника: деньги, дата оплаты и свои поля.
--
-- Сумму мы уже хранили, но нигде не показывали, а даты оплаты не было вовсе — без неё нельзя
-- свести деньги по мероприятию целиком, а не только по боту. Свои поля устроены как в «Работе
-- с базой», но набор отдельный: у участника и у контакта разные вопросы, а объединить два
-- набора потом проще, чем разделить один.

alter table public.event_participants
  add column if not exists paid_at timestamptz,
  add column if not exists payment_method text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'event_participants_payment_method_check'
  ) then
    alter table public.event_participants
      add constraint event_participants_payment_method_check check (
        payment_method is null or length(btrim(payment_method)) between 1 and 80
      );
  end if;
end;
$$;

comment on column public.event_participants.paid_at is
  'Когда человек заплатил. Заполняется руками: платёж прошёл мимо бота.';

-- Определение поля без мероприятия действует на всех: «Откуда узнал» нужен везде,
-- «Аллергия на арахис» — только на выездном.
create table if not exists public.event_participant_field_definitions (
  id uuid primary key,
  event_id uuid references public.events(id),
  field_key text not null,
  label text not null,
  field_type text not null,
  options jsonb,
  position integer not null,
  created_by_admin_id uuid not null references public.admin_accounts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_participant_field_definitions_type_check check (
    field_type in ('text', 'number', 'date', 'select')
  ),
  constraint event_participant_field_definitions_key_check check (
    field_key ~ '^[a-z0-9_]{1,60}$'
  ),
  constraint event_participant_field_definitions_label_check check (
    length(btrim(label)) between 1 and 80
  ),
  constraint event_participant_field_definitions_options_check check (
    (field_type = 'select' and jsonb_typeof(options) = 'array')
    or (field_type <> 'select' and options is null)
  ),
  constraint event_participant_field_definitions_position_check check (
    position between 1 and 200
  )
);

create index if not exists event_participant_field_definitions_event_idx
  on public.event_participant_field_definitions (event_id, position);

create table if not exists public.event_participant_field_values (
  participant_id uuid not null references public.event_participants(id),
  field_definition_id uuid not null
    references public.event_participant_field_definitions(id) on delete cascade,
  value_text text,
  updated_at timestamptz not null default now(),
  primary key (participant_id, field_definition_id),
  constraint event_participant_field_values_text_check check (
    value_text is null or length(value_text) <= 500
  )
);

create index if not exists event_participant_field_values_definition_idx
  on public.event_participant_field_values (field_definition_id);
