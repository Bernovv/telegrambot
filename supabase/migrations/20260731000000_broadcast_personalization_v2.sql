alter table public.broadcast_versions
  drop constraint broadcast_versions_schema_check;

alter table public.broadcast_versions
  add constraint broadcast_versions_schema_check check (
    schema_version in (1, 2)
  );

alter table public.broadcast_deliveries
  add column personalization_context jsonb not null default '{}'::jsonb,
  add constraint broadcast_deliveries_personalization_context_check check (
    jsonb_typeof(personalization_context) = 'object'
  );

alter table public.broadcast_test_deliveries
  add column schema_version smallint not null default 1,
  add column personalization_context jsonb not null default '{}'::jsonb,
  add constraint broadcast_test_deliveries_schema_check check (
    schema_version in (1, 2)
  ),
  add constraint broadcast_test_deliveries_personalization_context_check check (
    jsonb_typeof(personalization_context) = 'object'
  );

create function public.broadcast_personalization_context(
  profile_user_id uuid,
  profile_identity_id uuid
)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'firstName', users.first_name,
    'lastName', users.last_name,
    'displayName', users.display_name,
    'telegramUsername', identity.username
  )
  from public.users users
  left join public.messenger_identities identity
    on identity.id = profile_identity_id
   and identity.user_id = users.id
   and identity.channel = 'telegram'
  where users.id = profile_user_id
$$;

create function public.capture_broadcast_delivery_personalization()
returns trigger
language plpgsql
as $$
begin
  if new.personalization_context = '{}'::jsonb then
    new.personalization_context = coalesce(
      public.broadcast_personalization_context(
        new.user_id,
        new.telegram_identity_id
      ),
      jsonb_build_object(
        'firstName', null,
        'lastName', null,
        'displayName', null,
        'telegramUsername', null
      )
    );
  end if;
  return new;
end;
$$;

create trigger broadcast_deliveries_capture_personalization
before insert on public.broadcast_deliveries
for each row execute function public.capture_broadcast_delivery_personalization();

create function public.capture_broadcast_test_delivery_personalization()
returns trigger
language plpgsql
as $$
declare
  profile_user_id uuid;
begin
  if new.personalization_context = '{}'::jsonb then
    select user_id into profile_user_id
    from public.messenger_identities
    where id = new.recipient_messenger_identity_id;

    new.personalization_context = coalesce(
      public.broadcast_personalization_context(
        profile_user_id,
        new.recipient_messenger_identity_id
      ),
      jsonb_build_object(
        'firstName', null,
        'lastName', null,
        'displayName', null,
        'telegramUsername', null
      )
    );
  end if;
  return new;
end;
$$;

create trigger broadcast_test_deliveries_capture_personalization
before insert on public.broadcast_test_deliveries
for each row execute function public.capture_broadcast_test_delivery_personalization();

create or replace function public.protect_broadcast_delivery()
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
     or old.personalization_context <> new.personalization_context
     or old.scheduled_at <> new.scheduled_at
     or old.created_at <> new.created_at
     or new.attempt_count < old.attempt_count then
    raise exception 'broadcast delivery identity is immutable';
  end if;

  return new;
end;
$$;

create or replace function public.protect_broadcast_test_delivery()
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
     or old.schema_version <> new.schema_version
     or old.requested_by_admin_id <> new.requested_by_admin_id
     or old.recipient_messenger_identity_id <> new.recipient_messenger_identity_id
     or old.recipient_external_user_id <> new.recipient_external_user_id
     or old.content <> new.content
     or old.personalization_context <> new.personalization_context
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
