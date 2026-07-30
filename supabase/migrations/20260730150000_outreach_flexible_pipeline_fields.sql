-- Pipeline columns become fully manager-editable: any number of stages, free
-- labels, and an explicit "outcome" flag (open/won/lost) replaces the old
-- assumption that the literal stage ids 'won'/'lost' carry business meaning.
alter table public.outreach_pipeline_columns
  add column outcome text not null default 'open';

update public.outreach_pipeline_columns
set outcome = case stage
  when 'won' then 'won'
  when 'lost' then 'lost'
  else 'open'
end;

alter table public.outreach_pipeline_columns
  add constraint outreach_pipeline_columns_outcome_check check (
    outcome in ('open', 'won', 'lost')
  );

alter table public.outreach_pipeline_columns
  drop constraint outreach_pipeline_columns_stage_check;

alter table public.outreach_pipeline_columns
  add constraint outreach_pipeline_columns_stage_format_check check (
    stage ~ '^[a-z0-9_]{1,40}$'
  );

alter table public.outreach_pipeline_columns
  drop constraint outreach_pipeline_columns_position_check;

alter table public.outreach_pipeline_columns
  add constraint outreach_pipeline_columns_position_check check (
    position between 1 and 30
  );

-- New campaigns still start from the same seven familiar stages, but now
-- the two terminal ones are seeded with their outcome flag set so campaign
-- summary counts and the lost-reason rule work correctly from creation.
create or replace function public.seed_outreach_pipeline_columns(target_campaign_id uuid)
returns void
language sql
as $$
  insert into public.outreach_pipeline_columns (
    campaign_id, stage, label, position, outcome
  ) values
    (target_campaign_id, 'new', 'Новые', 1, 'open'),
    (target_campaign_id, 'first_contact', 'Первичный контакт', 2, 'open'),
    (target_campaign_id, 'dialogue', 'В диалоге', 3, 'open'),
    (target_campaign_id, 'follow_up', 'Думает / перезвонить', 4, 'open'),
    (target_campaign_id, 'interested', 'Заинтересован', 5, 'open'),
    (target_campaign_id, 'won', 'Оплатил / зарегистрировался', 6, 'won'),
    (target_campaign_id, 'lost', 'Закрыто без результата', 7, 'lost')
  on conflict (campaign_id, stage) do nothing;
$$;

-- Contacts now point at whatever stage id currently exists for their
-- campaign. The composite foreign key guarantees a contact can never sit in
-- a stage that was renamed away or never existed, and blocks deleting a
-- stage while contacts still reference it (the application must move them
-- first).
alter table public.outreach_campaign_contacts
  drop constraint outreach_campaign_contacts_pipeline_stage_check;

alter table public.outreach_campaign_contacts
  add constraint outreach_campaign_contacts_pipeline_stage_format_check check (
    pipeline_stage ~ '^[a-z0-9_]{1,40}$'
  );

-- Not deferrable: a delete of a still-referenced stage must fail
-- immediately (inside the same statement) so the application can catch it
-- and report "stage still has contacts" instead of aborting at commit.
alter table public.outreach_campaign_contacts
  add constraint outreach_campaign_contacts_pipeline_stage_fkey
  foreign key (campaign_id, pipeline_stage)
  references public.outreach_pipeline_columns (campaign_id, stage);

-- The old lost_reason rule hard-coded the literal stage id 'lost'. Replace it
-- with a trigger that looks up whichever stage is currently flagged as the
-- 'lost' outcome for that campaign, so any admin-renamed/added stage keeps
-- the same guarantee: a lost-outcome stage always carries a reason, and no
-- other stage ever does.
alter table public.outreach_campaign_contacts
  drop constraint outreach_campaign_contacts_lost_state_check;

create function public.validate_outreach_contact_lost_state()
returns trigger
language plpgsql
as $$
declare
  stage_outcome text;
begin
  select outcome into stage_outcome
  from public.outreach_pipeline_columns
  where campaign_id = new.campaign_id and stage = new.pipeline_stage;

  if stage_outcome = 'lost' and new.lost_reason is null then
    raise exception 'outreach lost reason is required for a lost-outcome stage';
  end if;
  if stage_outcome is distinct from 'lost' and new.lost_reason is not null then
    raise exception 'outreach lost reason is only valid for a lost-outcome stage';
  end if;
  return new;
end;
$$;

create trigger outreach_campaign_contacts_validate_lost_state
before insert or update of pipeline_stage, lost_reason
on public.outreach_campaign_contacts
for each row execute function public.validate_outreach_contact_lost_state();

-- Stage history is an append-only audit trail; it must keep recording
-- whatever stage id existed at the time even after that stage is later
-- renamed or deleted, so it only keeps a format check, not a foreign key.
alter table public.outreach_stage_history
  drop constraint outreach_stage_history_from_check;

alter table public.outreach_stage_history
  drop constraint outreach_stage_history_to_check;

alter table public.outreach_stage_history
  drop constraint outreach_stage_history_lost_state_check;

alter table public.outreach_stage_history
  add constraint outreach_stage_history_from_format_check check (
    from_stage is null or from_stage ~ '^[a-z0-9_]{1,40}$'
  );

alter table public.outreach_stage_history
  add constraint outreach_stage_history_to_format_check check (
    to_stage ~ '^[a-z0-9_]{1,40}$'
  );

-- Custom fields on the client card: an admin-defined set of extra fields,
-- either global (campaign_id is null, applies to every campaign) or scoped
-- to one campaign, matching amoCRM's per-pipeline custom field sets.
create table public.outreach_custom_field_definitions (
  id uuid primary key,
  campaign_id uuid references public.outreach_campaigns(id),
  field_key text not null,
  label text not null,
  field_type text not null,
  options jsonb,
  position integer not null,
  created_by_admin_id uuid not null references public.admin_accounts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outreach_custom_field_definitions_type_check check (
    field_type in ('text', 'number', 'date', 'select')
  ),
  constraint outreach_custom_field_definitions_key_check check (
    field_key ~ '^[a-z0-9_]{1,60}$'
  ),
  constraint outreach_custom_field_definitions_label_check check (
    length(btrim(label)) between 1 and 80
  ),
  constraint outreach_custom_field_definitions_options_check check (
    (field_type = 'select' and jsonb_typeof(options) = 'array')
    or (field_type <> 'select' and options is null)
  ),
  constraint outreach_custom_field_definitions_position_check check (
    position between 1 and 200
  )
);

create unique index outreach_custom_field_definitions_scope_key_idx
  on public.outreach_custom_field_definitions (
    coalesce(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid),
    field_key
  );

create index outreach_custom_field_definitions_campaign_idx
  on public.outreach_custom_field_definitions (campaign_id, position);

create table public.outreach_custom_field_values (
  campaign_contact_id uuid not null
    references public.outreach_campaign_contacts(id),
  field_definition_id uuid not null
    references public.outreach_custom_field_definitions(id),
  value_text text,
  value_number numeric,
  value_date date,
  updated_at timestamptz not null default now(),
  primary key (campaign_contact_id, field_definition_id),
  constraint outreach_custom_field_values_text_check check (
    value_text is null or length(value_text) <= 500
  )
);

create index outreach_custom_field_values_definition_idx
  on public.outreach_custom_field_values (field_definition_id);

create index outreach_custom_field_values_contact_idx
  on public.outreach_custom_field_values (campaign_contact_id);
