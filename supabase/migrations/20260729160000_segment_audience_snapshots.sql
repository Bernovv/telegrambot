create table public.segment_audience_snapshots (
  id uuid primary key,
  segment_id uuid not null references public.segments(id),
  segment_version_id uuid not null references public.segment_versions(id),
  status text not null default 'pending',
  total_count bigint,
  requested_by_admin_id uuid references public.admin_accounts(id),
  request_reason text not null,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint segment_audience_snapshots_status_check check (
    status in ('pending', 'ready')
  ),
  constraint segment_audience_snapshots_count_check check (
    total_count is null or total_count >= 0
  ),
  constraint segment_audience_snapshots_reason_check check (
    length(btrim(request_reason)) between 1 and 500
  ),
  constraint segment_audience_snapshots_completion_check check (
    (status = 'pending' and total_count is null and completed_at is null)
    or (status = 'ready' and total_count is not null and completed_at is not null)
  )
);

create unique index segment_audience_snapshots_one_pending_idx
  on public.segment_audience_snapshots (segment_version_id)
  where status = 'pending';

create index segment_audience_snapshots_history_idx
  on public.segment_audience_snapshots (segment_id, requested_at desc, id);

create table public.segment_audience_snapshot_members (
  snapshot_id uuid not null references public.segment_audience_snapshots(id),
  user_id uuid not null references public.users(id),
  captured_at timestamptz not null,
  primary key (snapshot_id, user_id)
);

create index segment_audience_snapshot_members_user_idx
  on public.segment_audience_snapshot_members (user_id, snapshot_id);

create function public.validate_segment_audience_snapshot_version()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from public.segment_versions versions
    where versions.id = new.segment_version_id
      and versions.segment_id = new.segment_id
      and versions.status = 'published'
  ) then
    raise exception 'audience snapshot must reference a published segment version';
  end if;

  return new;
end;
$$;

create trigger segment_audience_snapshots_validate_version
before insert or update of segment_id, segment_version_id
on public.segment_audience_snapshots
for each row execute function public.validate_segment_audience_snapshot_version();

create function public.protect_ready_segment_audience_snapshot()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'ready' then
    raise exception 'ready segment audience snapshot is immutable';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if old.segment_id <> new.segment_id
     or old.segment_version_id <> new.segment_version_id
     or old.requested_at <> new.requested_at
     or old.requested_by_admin_id is distinct from new.requested_by_admin_id
     or old.request_reason <> new.request_reason then
    raise exception 'segment audience snapshot identity is immutable';
  end if;

  return new;
end;
$$;

create trigger segment_audience_snapshots_protect_mutation
before update or delete on public.segment_audience_snapshots
for each row execute function public.protect_ready_segment_audience_snapshot();

create function public.protect_segment_audience_snapshot_member()
returns trigger
language plpgsql
as $$
declare
  snapshot_status text;
begin
  if tg_op <> 'INSERT' then
    raise exception 'segment audience snapshot members are append-only';
  end if;

  select status
    into snapshot_status
    from public.segment_audience_snapshots
   where id = new.snapshot_id;

  if snapshot_status is distinct from 'pending' then
    raise exception 'members can only be added to a pending audience snapshot';
  end if;

  return new;
end;
$$;

create trigger segment_audience_snapshot_members_protect_mutation
before insert or update or delete on public.segment_audience_snapshot_members
for each row execute function public.protect_segment_audience_snapshot_member();

