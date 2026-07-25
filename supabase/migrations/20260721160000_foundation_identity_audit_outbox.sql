create table public.users (
  id uuid primary key,
  display_name text,
  first_name text,
  last_name text,
  preferred_language text,
  phone_status text not null default 'unknown',
  registered_at timestamptz not null default now(),
  last_seen_at timestamptz,
  is_blocked boolean not null default false,
  is_deleted boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_phone_status_check check (
    phone_status in ('unknown', 'imported', 'verified', 'rejected')
  )
);

create table public.messenger_identities (
  id uuid primary key,
  user_id uuid not null references public.users(id),
  channel text not null,
  external_user_id text not null,
  username text,
  username_normalized text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  is_bot_blocked boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  constraint messenger_identities_channel_check check (channel in ('telegram', 'max')),
  constraint messenger_identities_channel_external_user_unique unique (channel, external_user_id)
);

create table public.messenger_username_history (
  id uuid primary key,
  messenger_identity_id uuid not null references public.messenger_identities(id),
  username text,
  username_normalized text,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  created_at timestamptz not null default now(),
  constraint messenger_username_history_valid_range_check check (
    valid_to is null or valid_to > valid_from
  )
);

create table public.user_touchpoints (
  id uuid primary key,
  user_id uuid not null references public.users(id),
  channel text not null,
  raw_payload text,
  source text,
  campaign text,
  partner_code text,
  event_slug text,
  occurred_at timestamptz not null default now(),
  is_first_touch boolean not null default false,
  is_last_touch boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  constraint user_touchpoints_channel_check check (channel in ('telegram', 'max', 'admin', 'import'))
);

create table public.audit_log (
  id uuid primary key,
  actor_user_id uuid,
  actor_role text,
  action text not null,
  target_type text not null,
  target_id text not null,
  reason text,
  before_masked jsonb,
  after_masked jsonb,
  request_id text,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create table public.outbox_events (
  event_id uuid primary key,
  aggregate_type text not null,
  aggregate_id text not null,
  event_type text not null,
  schema_version integer not null,
  payload jsonb not null,
  occurred_at timestamptz not null default now(),
  processed_at timestamptz,
  retry_count integer not null default 0,
  last_error text,
  locked_at timestamptz,
  locked_by text,
  constraint outbox_events_schema_version_check check (schema_version > 0),
  constraint outbox_events_retry_count_check check (retry_count >= 0)
);

create table public.worker_heartbeats (
  worker_id text primary key,
  service_name text not null,
  queues text[] not null default array[]::text[],
  version text not null,
  started_at timestamptz not null,
  last_seen_at timestamptz not null,
  current_job_id text,
  metadata jsonb not null default '{}'::jsonb
);

create index users_registered_at_idx on public.users (registered_at);
create index users_last_seen_at_idx on public.users (last_seen_at);

create index messenger_identities_user_id_idx on public.messenger_identities (user_id);
create index messenger_identities_username_normalized_idx
  on public.messenger_identities (username_normalized)
  where username_normalized is not null;

create index messenger_username_history_identity_idx
  on public.messenger_username_history (messenger_identity_id, valid_from desc);

create index user_touchpoints_user_occurred_idx
  on public.user_touchpoints (user_id, occurred_at desc);
create index user_touchpoints_partner_code_idx
  on public.user_touchpoints (partner_code)
  where partner_code is not null;

create index audit_log_target_idx on public.audit_log (target_type, target_id, created_at desc);
create index audit_log_actor_idx on public.audit_log (actor_user_id, created_at desc);

create index outbox_events_unprocessed_idx
  on public.outbox_events (occurred_at)
  where processed_at is null;
create index outbox_events_aggregate_idx
  on public.outbox_events (aggregate_type, aggregate_id, occurred_at desc);

create index worker_heartbeats_last_seen_idx on public.worker_heartbeats (last_seen_at);
