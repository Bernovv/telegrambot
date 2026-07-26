create table public.scenario_sessions (
  id uuid primary key,
  user_id uuid not null references public.users(id),
  messenger_identity_id uuid not null references public.messenger_identities(id),
  event_id uuid not null references public.events(id),
  scenario_version_id uuid not null references public.scenario_versions(id),
  current_node_id uuid not null,
  channel text not null,
  status text not null default 'active',
  context_schema_version smallint not null default 1,
  context jsonb not null default '{}'::jsonb,
  last_input jsonb,
  blocked_reason text,
  expires_at timestamptz not null,
  lock_version integer not null default 1,
  started_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz,
  constraint scenario_sessions_channel_check check (
    channel in ('telegram', 'web')
  ),
  constraint scenario_sessions_status_check check (
    status in ('active', 'waiting_input', 'completed', 'blocked', 'expired')
  ),
  constraint scenario_sessions_context_schema_check check (
    context_schema_version > 0
  ),
  constraint scenario_sessions_context_check check (
    jsonb_typeof(context) = 'object'
  ),
  constraint scenario_sessions_last_input_check check (
    last_input is null or jsonb_typeof(last_input) = 'object'
  ),
  constraint scenario_sessions_blocked_reason_check check (
    (
      status = 'blocked'
      and blocked_reason is not null
      and length(btrim(blocked_reason)) > 0
    )
    or (status <> 'blocked' and blocked_reason is null)
  ),
  constraint scenario_sessions_lifecycle_check check (
    (status = 'completed' and completed_at is not null)
    or (status <> 'completed' and completed_at is null)
  ),
  constraint scenario_sessions_expiry_check check (
    expires_at > started_at
  ),
  constraint scenario_sessions_lock_version_check check (
    lock_version > 0
  ),
  constraint scenario_sessions_current_node_fk
    foreign key (scenario_version_id, current_node_id)
    references public.scenario_nodes(scenario_version_id, id)
);

create unique index scenario_sessions_one_open_idx
  on public.scenario_sessions (user_id, event_id, channel)
  where status in ('active', 'waiting_input');

create index scenario_sessions_identity_status_idx
  on public.scenario_sessions (messenger_identity_id, status, updated_at desc);

create index scenario_sessions_expiry_idx
  on public.scenario_sessions (expires_at)
  where status in ('active', 'waiting_input');

create table public.scenario_events (
  id uuid primary key,
  session_id uuid not null references public.scenario_sessions(id),
  event_type text not null,
  node_id uuid,
  edge_id uuid,
  idempotency_key text,
  schema_version smallint not null default 1,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  constraint scenario_events_type_check check (
    event_type in (
      'command_received',
      'session_started',
      'session_resumed',
      'transition_selected',
      'node_entered',
      'session_waiting',
      'session_completed',
      'session_blocked'
    )
  ),
  constraint scenario_events_idempotency_key_check check (
    idempotency_key is null
    or length(idempotency_key) between 8 and 200
  ),
  constraint scenario_events_schema_check check (
    schema_version > 0
  ),
  constraint scenario_events_payload_check check (
    jsonb_typeof(payload) = 'object'
  )
);

create unique index scenario_events_idempotency_idx
  on public.scenario_events (idempotency_key)
  where idempotency_key is not null;

create index scenario_events_session_time_idx
  on public.scenario_events (session_id, occurred_at, id);

create function public.protect_scenario_session_identity()
returns trigger
language plpgsql
as $$
begin
  if (
    new.user_id,
    new.messenger_identity_id,
    new.event_id,
    new.scenario_version_id,
    new.channel,
    new.started_at
  ) is distinct from (
    old.user_id,
    old.messenger_identity_id,
    old.event_id,
    old.scenario_version_id,
    old.channel,
    old.started_at
  ) then
    raise exception 'scenario session identity and version are immutable';
  end if;

  return new;
end;
$$;

create trigger scenario_sessions_protect_identity
before update on public.scenario_sessions
for each row execute function public.protect_scenario_session_identity();

create function public.prevent_scenario_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'scenario_events are append-only';
end;
$$;

create trigger scenario_events_prevent_update
before update on public.scenario_events
for each row execute function public.prevent_scenario_event_mutation();

create trigger scenario_events_prevent_delete
before delete on public.scenario_events
for each row execute function public.prevent_scenario_event_mutation();
