alter table public.broadcasts
  add column lifecycle_status text not null default 'draft',
  add column scheduled_version_id uuid,
  add column scheduled_at timestamptz,
  add column schedule_timezone text,
  add column rate_per_second integer,
  add column prepared_at timestamptz,
  add column planned_recipient_count bigint,
  add column reachable_recipient_count bigint,
  add column skipped_recipient_count bigint;

alter table public.broadcasts
  add constraint broadcasts_lifecycle_status_check check (
    lifecycle_status in (
      'draft', 'scheduled', 'preparing', 'sending', 'paused',
      'completed', 'cancelled', 'failed'
    )
  ),
  add constraint broadcasts_schedule_timezone_check check (
    schedule_timezone is null
    or (
      length(schedule_timezone) between 1 and 100
      and schedule_timezone ~ '^[A-Za-z_]+(?:/[A-Za-z0-9_+-]+)+$'
    )
  ),
  add constraint broadcasts_rate_check check (
    rate_per_second is null or rate_per_second between 1 and 25
  ),
  add constraint broadcasts_recipient_counts_check check (
    (planned_recipient_count is null or planned_recipient_count >= 0)
    and (reachable_recipient_count is null or reachable_recipient_count >= 0)
    and (skipped_recipient_count is null or skipped_recipient_count >= 0)
    and (
      planned_recipient_count is null
      or (
        reachable_recipient_count is not null
        and skipped_recipient_count is not null
        and planned_recipient_count
          = reachable_recipient_count + skipped_recipient_count
      )
    )
  ),
  add constraint broadcasts_schedule_lifecycle_check check (
    (
      lifecycle_status = 'draft'
      and scheduled_version_id is null
      and scheduled_at is null
      and schedule_timezone is null
      and rate_per_second is null
      and prepared_at is null
      and planned_recipient_count is null
    )
    or (
      lifecycle_status <> 'draft'
      and scheduled_version_id is not null
      and scheduled_at is not null
      and schedule_timezone is not null
      and rate_per_second is not null
    )
  );

alter table public.broadcasts
  add constraint broadcasts_scheduled_version_fk
  foreign key (scheduled_version_id)
  references public.broadcast_versions(id)
  not valid;

create index broadcasts_due_schedule_idx
  on public.broadcasts (scheduled_at, id)
  where lifecycle_status = 'scheduled';

create table public.broadcast_deliveries (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  broadcast_id uuid not null references public.broadcasts(id),
  broadcast_version_id uuid not null references public.broadcast_versions(id),
  audience_snapshot_id uuid not null references public.segment_audience_snapshots(id),
  user_id uuid not null references public.users(id),
  telegram_identity_id uuid references public.messenger_identities(id),
  recipient_external_user_id text,
  status text not null,
  attempt_count integer not null default 0,
  provider_message_id text,
  last_error_code text,
  scheduled_at timestamptz not null,
  first_attempt_at timestamptz,
  sent_at timestamptz,
  retry_at timestamptz,
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint broadcast_deliveries_identity_unique unique (broadcast_id, user_id),
  constraint broadcast_deliveries_idempotency_check check (
    length(idempotency_key) between 1 and 200
  ),
  constraint broadcast_deliveries_recipient_check check (
    recipient_external_user_id is null
    or recipient_external_user_id ~ '^-?[0-9]{1,20}$'
  ),
  constraint broadcast_deliveries_status_check check (
    status in ('pending', 'sending', 'retry', 'sent', 'failed', 'skipped')
  ),
  constraint broadcast_deliveries_attempt_check check (
    attempt_count between 0 and 20
  ),
  constraint broadcast_deliveries_provider_check check (
    provider_message_id is null
    or length(provider_message_id) between 1 and 200
  ),
  constraint broadcast_deliveries_error_check check (
    last_error_code is null
    or last_error_code ~ '^[A-Za-z][A-Za-z0-9_]{0,99}$'
  ),
  constraint broadcast_deliveries_lifecycle_check check (
    (
      status = 'pending'
      and attempt_count = 0
      and recipient_external_user_id is not null
      and provider_message_id is null
      and last_error_code is null
      and first_attempt_at is null
      and sent_at is null
      and retry_at is null
      and lease_owner is null
      and lease_expires_at is null
    )
    or (
      status = 'skipped'
      and attempt_count = 0
      and provider_message_id is null
      and last_error_code is not null
      and first_attempt_at is null
      and sent_at is null
      and retry_at is null
      and lease_owner is null
      and lease_expires_at is null
    )
    or status in ('sending', 'retry', 'sent', 'failed')
  )
);

create index broadcast_deliveries_pending_idx
  on public.broadcast_deliveries (scheduled_at, id)
  where status = 'pending';

create index broadcast_deliveries_retry_idx
  on public.broadcast_deliveries (retry_at, id)
  where status = 'retry';

create index broadcast_deliveries_broadcast_status_idx
  on public.broadcast_deliveries (broadcast_id, status, id);

create function public.validate_broadcast_schedule()
returns trigger
language plpgsql
as $$
begin
  if new.scheduled_version_id is not null
     and not exists (
       select 1
       from public.broadcast_versions versions
       join public.segment_audience_snapshots snapshots
         on snapshots.id = versions.audience_snapshot_id
       where versions.id = new.scheduled_version_id
         and versions.broadcast_id = new.id
         and versions.status = 'published'
         and snapshots.status = 'ready'
     ) then
    raise exception 'broadcast schedule requires its published version and ready snapshot';
  end if;

  return new;
end;
$$;

create trigger broadcasts_validate_schedule
before insert or update of scheduled_version_id on public.broadcasts
for each row execute function public.validate_broadcast_schedule();

create function public.protect_broadcast_schedule()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.lifecycle_status <> 'draft' then
      raise exception 'scheduled broadcast cannot be deleted';
    end if;
    return old;
  end if;

  if old.lifecycle_status <> 'draft'
     and (
       old.scheduled_version_id is distinct from new.scheduled_version_id
       or old.scheduled_at is distinct from new.scheduled_at
       or old.schedule_timezone is distinct from new.schedule_timezone
       or old.rate_per_second is distinct from new.rate_per_second
     ) then
    raise exception 'broadcast schedule is immutable after scheduling';
  end if;

  if old.lifecycle_status <> new.lifecycle_status
     and not (
       (old.lifecycle_status = 'draft' and new.lifecycle_status = 'scheduled')
       or (old.lifecycle_status = 'scheduled' and new.lifecycle_status in ('preparing', 'cancelled'))
       or (old.lifecycle_status = 'preparing' and new.lifecycle_status in ('sending', 'completed', 'failed'))
       or (old.lifecycle_status = 'sending' and new.lifecycle_status in ('paused', 'completed', 'cancelled', 'failed'))
       or (old.lifecycle_status = 'paused' and new.lifecycle_status in ('sending', 'cancelled'))
     ) then
    raise exception 'invalid broadcast lifecycle transition';
  end if;

  return new;
end;
$$;

create trigger broadcasts_protect_schedule
before update or delete on public.broadcasts
for each row execute function public.protect_broadcast_schedule();

create function public.protect_broadcast_delivery()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'broadcast delivery records cannot be deleted';
  end if;

  if old.status = 'sent' then
    raise exception 'sent broadcast delivery is immutable';
  end if;

  if old.idempotency_key <> new.idempotency_key
     or old.broadcast_id <> new.broadcast_id
     or old.broadcast_version_id <> new.broadcast_version_id
     or old.audience_snapshot_id <> new.audience_snapshot_id
     or old.user_id <> new.user_id
     or old.telegram_identity_id is distinct from new.telegram_identity_id
     or old.recipient_external_user_id is distinct from new.recipient_external_user_id
     or old.scheduled_at <> new.scheduled_at
     or old.created_at <> new.created_at
     or new.attempt_count < old.attempt_count then
    raise exception 'broadcast delivery identity is immutable';
  end if;

  return new;
end;
$$;

create trigger broadcast_deliveries_protect_record
before update or delete on public.broadcast_deliveries
for each row execute function public.protect_broadcast_delivery();
