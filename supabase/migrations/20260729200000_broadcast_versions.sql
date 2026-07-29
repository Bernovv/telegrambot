create table public.broadcasts (
  id uuid primary key,
  name text not null,
  lock_version integer not null default 1,
  published_version_id uuid,
  created_by_admin_id uuid references public.admin_accounts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint broadcasts_name_check check (length(btrim(name)) between 1 and 120),
  constraint broadcasts_lock_version_check check (lock_version > 0)
);

create table public.broadcast_versions (
  id uuid primary key,
  broadcast_id uuid not null references public.broadcasts(id),
  version_number integer not null,
  status text not null default 'draft',
  schema_version smallint not null default 1,
  name text not null,
  audience_snapshot_id uuid not null
    references public.segment_audience_snapshots(id),
  content jsonb not null,
  created_by_admin_id uuid references public.admin_accounts(id),
  published_by_admin_id uuid references public.admin_accounts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  constraint broadcast_versions_number_check check (version_number > 0),
  constraint broadcast_versions_status_check check (
    status in ('draft', 'published')
  ),
  constraint broadcast_versions_schema_check check (schema_version = 1),
  constraint broadcast_versions_name_check check (
    length(btrim(name)) between 1 and 120
  ),
  constraint broadcast_versions_content_check check (
    jsonb_typeof(content) = 'object'
  ),
  constraint broadcast_versions_publication_check check (
    (status = 'published' and published_at is not null)
    or (status = 'draft' and published_at is null)
  ),
  unique (broadcast_id, version_number)
);

create unique index broadcast_versions_one_draft_idx
  on public.broadcast_versions (broadcast_id)
  where status = 'draft';

create index broadcast_versions_history_idx
  on public.broadcast_versions (broadcast_id, version_number desc);

create index broadcasts_updated_idx
  on public.broadcasts (updated_at desc, id);

alter table public.broadcasts
  add constraint broadcasts_published_version_fk
  foreign key (published_version_id)
  references public.broadcast_versions(id)
  not valid;

create function public.validate_broadcast_audience_snapshot()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from public.segment_audience_snapshots snapshots
    where snapshots.id = new.audience_snapshot_id
      and snapshots.status = 'ready'
  ) then
    raise exception 'broadcast version requires a ready audience snapshot';
  end if;

  return new;
end;
$$;

create trigger broadcast_versions_validate_audience
before insert or update of audience_snapshot_id on public.broadcast_versions
for each row execute function public.validate_broadcast_audience_snapshot();

create function public.protect_broadcast_version_identity_and_publication()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'published' then
    raise exception 'published broadcast version is immutable';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if old.broadcast_id <> new.broadcast_id
     or old.version_number <> new.version_number
     or old.created_at <> new.created_at
     or old.created_by_admin_id is distinct from new.created_by_admin_id then
    raise exception 'broadcast version identity is immutable';
  end if;

  return new;
end;
$$;

create trigger broadcast_versions_protect_mutation
before update or delete on public.broadcast_versions
for each row execute function public.protect_broadcast_version_identity_and_publication();

create function public.validate_broadcast_published_version()
returns trigger
language plpgsql
as $$
begin
  if new.published_version_id is not null
     and not exists (
       select 1
       from public.broadcast_versions versions
       where versions.id = new.published_version_id
         and versions.broadcast_id = new.id
         and versions.status = 'published'
     ) then
    raise exception 'broadcast published version must reference its published version';
  end if;

  return new;
end;
$$;

create trigger broadcasts_validate_published_version
before insert or update of published_version_id on public.broadcasts
for each row execute function public.validate_broadcast_published_version();

