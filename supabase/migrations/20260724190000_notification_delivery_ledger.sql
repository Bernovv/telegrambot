create table public.notification_deliveries (
  id uuid primary key,
  idempotency_key text not null unique,
  source_event_id uuid not null references public.outbox_events(event_id),
  kind text not null,
  aggregate_id text not null,
  recipient_channel text not null,
  recipient_id text not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  lease_owner text,
  lease_expires_at timestamptz,
  provider_message_id text,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint notification_deliveries_idempotency_check check (
    length(idempotency_key) between 8 and 200
  ),
  constraint notification_deliveries_kind_check check (
    kind in ('ticket_user', 'admin_purchase')
  ),
  constraint notification_deliveries_aggregate_check check (
    length(aggregate_id) between 1 and 200
  ),
  constraint notification_deliveries_channel_check check (
    recipient_channel = 'telegram'
  ),
  constraint notification_deliveries_recipient_check check (
    length(recipient_id) between 1 and 100
  ),
  constraint notification_deliveries_status_check check (
    status in ('pending', 'sending', 'sent', 'failed')
  ),
  constraint notification_deliveries_attempt_check check (
    attempt_count >= 0
  ),
  constraint notification_deliveries_error_check check (
    last_error_code is null
    or last_error_code ~ '^[A-Za-z][A-Za-z0-9]{0,99}$'
  ),
  constraint notification_deliveries_lifecycle_check check (
    (
      status = 'pending'
      and lease_owner is null
      and lease_expires_at is null
      and provider_message_id is null
      and sent_at is null
    )
    or (
      status = 'sending'
      and lease_owner is not null
      and lease_expires_at is not null
      and provider_message_id is null
      and sent_at is null
    )
    or (
      status = 'failed'
      and lease_owner is null
      and lease_expires_at is null
      and provider_message_id is null
      and sent_at is null
      and last_error_code is not null
    )
    or (
      status = 'sent'
      and lease_owner is null
      and lease_expires_at is null
      and provider_message_id is not null
      and sent_at is not null
      and last_error_code is null
    )
  )
);

create index notification_deliveries_source_event_idx
  on public.notification_deliveries (source_event_id, created_at);

create index notification_deliveries_retry_idx
  on public.notification_deliveries (updated_at)
  where status in ('pending', 'failed');

create index notification_deliveries_stale_lease_idx
  on public.notification_deliveries (lease_expires_at)
  where status = 'sending';

create function public.protect_notification_delivery_record()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'notification deliveries cannot be deleted';
  end if;

  if new.idempotency_key is distinct from old.idempotency_key
    or new.source_event_id is distinct from old.source_event_id
    or new.kind is distinct from old.kind
    or new.aggregate_id is distinct from old.aggregate_id
    or new.recipient_channel is distinct from old.recipient_channel
    or new.recipient_id is distinct from old.recipient_id
    or new.created_at is distinct from old.created_at
  then
    raise exception 'notification delivery identity is immutable';
  end if;

  if old.status = 'sent' and new is distinct from old then
    raise exception 'sent notification delivery evidence is immutable';
  end if;

  return new;
end;
$$;

create trigger notification_deliveries_protect_record
before update or delete on public.notification_deliveries
for each row execute function public.protect_notification_delivery_record();
