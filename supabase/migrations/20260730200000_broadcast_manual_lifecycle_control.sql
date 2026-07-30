alter table public.broadcasts
  add column cancelled_at timestamptz;

create or replace function public.protect_broadcast_schedule()
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
       or (old.lifecycle_status = 'preparing' and new.lifecycle_status in ('sending', 'paused', 'completed', 'cancelled', 'failed'))
       or (old.lifecycle_status = 'sending' and new.lifecycle_status in ('paused', 'completed', 'cancelled', 'failed'))
       or (old.lifecycle_status = 'paused' and new.lifecycle_status in ('sending', 'cancelled'))
     ) then
    raise exception 'invalid broadcast lifecycle transition';
  end if;

  return new;
end;
$$;
