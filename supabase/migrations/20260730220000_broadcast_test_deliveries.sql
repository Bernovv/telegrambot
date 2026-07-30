create table public.broadcast_test_deliveries (
  id uuid primary key,
  broadcast_id uuid not null references public.broadcasts(id),
  broadcast_version_id uuid not null references public.broadcast_versions(id),
  version_number integer not null,
  requested_by_admin_id uuid not null references public.admin_accounts(id),
  recipient_messenger_identity_id uuid not null
    references public.messenger_identities(id),
  recipient_external_user_id text not null,
  content jsonb not null,
  status text not null default 'queued',
  attempt_count integer not null default 0,
  lease_owner text,
  lease_expires_at timestamptz,
  provider_message_id text,
  error_code text,
  requested_at timestamptz not null,
  started_at timestamptz,
  finished_at timestamptz,
  constraint broadcast_test_deliveries_version_check check (
    version_number > 0
  ),
  constraint broadcast_test_deliveries_recipient_check check (
    recipient_external_user_id ~ '^[0-9]{1,20}$'
  ),
  constraint broadcast_test_deliveries_content_check check (
    jsonb_typeof(content) = 'object'
  ),
  constraint broadcast_test_deliveries_status_check check (
    status in ('queued', 'sending', 'sent', 'failed', 'uncertain')
  ),
  constraint broadcast_test_deliveries_attempt_check check (
    attempt_count between 0 and 1
  ),
  constraint broadcast_test_deliveries_state_check check (
    (
      status = 'queued'
      and attempt_count = 0
      and lease_owner is null
      and lease_expires_at is null
      and provider_message_id is null
      and error_code is null
      and started_at is null
      and finished_at is null
    )
    or (
      status = 'sending'
      and attempt_count = 1
      and lease_owner is not null
      and lease_expires_at is not null
      and provider_message_id is null
      and error_code is null
      and started_at is not null
      and finished_at is null
    )
    or (
      status = 'sent'
      and attempt_count = 1
      and lease_owner is null
      and lease_expires_at is null
      and provider_message_id is not null
      and error_code is null
      and started_at is not null
      and finished_at is not null
    )
    or (
      status in ('failed', 'uncertain')
      and attempt_count = 1
      and lease_owner is null
      and lease_expires_at is null
      and provider_message_id is null
      and error_code is not null
      and started_at is not null
      and finished_at is not null
    )
  )
);

create index broadcast_test_deliveries_queue_idx
  on public.broadcast_test_deliveries (requested_at, id)
  where status = 'queued';

create index broadcast_test_deliveries_expired_lease_idx
  on public.broadcast_test_deliveries (lease_expires_at, id)
  where status = 'sending';

create index broadcast_test_deliveries_history_idx
  on public.broadcast_test_deliveries (broadcast_id, requested_at desc, id desc);

create function public.protect_broadcast_test_delivery()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'broadcast test deliveries cannot be deleted';
  end if;

  if old.broadcast_id <> new.broadcast_id
     or old.broadcast_version_id <> new.broadcast_version_id
     or old.version_number <> new.version_number
     or old.requested_by_admin_id <> new.requested_by_admin_id
     or old.recipient_messenger_identity_id <> new.recipient_messenger_identity_id
     or old.recipient_external_user_id <> new.recipient_external_user_id
     or old.content <> new.content
     or old.requested_at <> new.requested_at
     or old.attempt_count > new.attempt_count
     or old.status in ('sent', 'failed', 'uncertain')
     or (
       old.status = 'queued'
       and new.status not in ('queued', 'sending')
     )
     or (
       old.status = 'sending'
       and new.status not in ('sending', 'sent', 'failed', 'uncertain')
     ) then
    raise exception 'broadcast test delivery is immutable or transition is invalid';
  end if;

  return new;
end;
$$;

create trigger broadcast_test_deliveries_protect
before update or delete on public.broadcast_test_deliveries
for each row execute function public.protect_broadcast_test_delivery();
