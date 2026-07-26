create table public.scenarios (
  id uuid primary key,
  event_id uuid not null unique references public.events(id),
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scenarios_title_check check (length(btrim(title)) between 1 and 250)
);

create table public.scenario_versions (
  id uuid primary key,
  scenario_id uuid not null references public.scenarios(id),
  version_number integer not null,
  status text not null default 'draft',
  schema_version smallint not null default 1,
  validation_issues jsonb not null default '[]'::jsonb,
  created_by_admin_id uuid references public.admin_accounts(id),
  published_by_admin_id uuid references public.admin_accounts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  constraint scenario_versions_number_check check (version_number > 0),
  constraint scenario_versions_status_check check (
    status in ('draft', 'validating', 'published', 'retired')
  ),
  constraint scenario_versions_schema_check check (schema_version > 0),
  constraint scenario_versions_validation_check check (
    jsonb_typeof(validation_issues) = 'array'
  ),
  constraint scenario_versions_publication_check check (
    (status in ('published', 'retired') and published_at is not null)
    or (status in ('draft', 'validating') and published_at is null)
  ),
  unique (scenario_id, version_number)
);

create unique index scenario_versions_one_draft_idx
  on public.scenario_versions (scenario_id)
  where status = 'draft';

create index scenario_versions_history_idx
  on public.scenario_versions (scenario_id, version_number desc);

create table public.scenario_nodes (
  scenario_version_id uuid not null references public.scenario_versions(id),
  id uuid not null,
  node_type text not null,
  schema_version smallint not null default 1,
  payload jsonb not null default '{}'::jsonb,
  sort_order integer not null,
  primary key (scenario_version_id, id),
  constraint scenario_nodes_type_check check (
    node_type in (
      'start', 'message', 'media', 'menu', 'choice', 'text_input',
      'number_input', 'phone_request', 'condition', 'set_status',
      'add_category', 'wallet_credit', 'event_selector', 'order_start',
      'order_add_item', 'order_summary', 'offer_acceptance',
      'payment_start', 'survey_start', 'support_request', 'notification',
      'delay', 'subflow', 'end'
    )
  ),
  constraint scenario_nodes_schema_check check (schema_version > 0),
  constraint scenario_nodes_payload_check check (jsonb_typeof(payload) = 'object'),
  constraint scenario_nodes_sort_order_check check (sort_order >= 0),
  unique (scenario_version_id, sort_order)
);

create table public.scenario_edges (
  scenario_version_id uuid not null references public.scenario_versions(id),
  id uuid not null,
  from_node_id uuid not null,
  to_node_id uuid not null,
  label text,
  priority integer not null default 0,
  condition_schema_version smallint not null default 1,
  condition jsonb not null default '{}'::jsonb,
  primary key (scenario_version_id, id),
  constraint scenario_edges_label_check check (
    label is null or length(btrim(label)) between 1 and 250
  ),
  constraint scenario_edges_condition_schema_check check (
    condition_schema_version > 0
  ),
  constraint scenario_edges_condition_check check (
    jsonb_typeof(condition) = 'object'
  )
);

create index scenario_edges_from_idx
  on public.scenario_edges (scenario_version_id, from_node_id, priority desc, id);

alter table public.events
  add constraint events_published_scenario_version_fk
  foreign key (published_scenario_version_id)
  references public.scenario_versions(id)
  not valid;

create function public.protect_scenario_version_identity_and_publication()
returns trigger
language plpgsql
as $$
begin
  if old.status in ('published', 'retired') then
    raise exception 'published scenario version is immutable';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if old.scenario_id <> new.scenario_id
     or old.version_number <> new.version_number then
    raise exception 'scenario version identity is immutable';
  end if;

  return new;
end;
$$;

create trigger scenario_versions_protect_mutation
before update or delete on public.scenario_versions
for each row execute function public.protect_scenario_version_identity_and_publication();

create function public.protect_published_scenario_graph()
returns trigger
language plpgsql
as $$
declare
  target_version_id uuid;
  target_status text;
  source_status text;
begin
  if tg_op = 'DELETE' then
    target_version_id := old.scenario_version_id;
  else
    target_version_id := new.scenario_version_id;
  end if;

  if tg_op = 'UPDATE' then
    select status
      into source_status
      from public.scenario_versions
     where id = old.scenario_version_id;

    if source_status is distinct from 'draft' then
      raise exception 'published scenario graph is immutable';
    end if;
  end if;

  select status
    into target_status
    from public.scenario_versions
   where id = target_version_id;

  if target_status is distinct from 'draft' then
    raise exception 'published scenario graph is immutable';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger scenario_nodes_protect_mutation
before insert or update or delete on public.scenario_nodes
for each row execute function public.protect_published_scenario_graph();

create trigger scenario_edges_protect_mutation
before insert or update or delete on public.scenario_edges
for each row execute function public.protect_published_scenario_graph();

create function public.validate_event_scenario_assignment()
returns trigger
language plpgsql
as $$
begin
  if new.published_scenario_version_id is not null
     and not exists (
       select 1
         from public.scenario_versions versions
         join public.scenarios scenarios on scenarios.id = versions.scenario_id
        where versions.id = new.published_scenario_version_id
          and versions.status = 'published'
          and scenarios.event_id = new.id
     ) then
    raise exception 'event scenario assignment must reference its published scenario';
  end if;

  return new;
end;
$$;

create trigger events_validate_scenario_assignment
before insert or update of published_scenario_version_id on public.events
for each row execute function public.validate_event_scenario_assignment();
