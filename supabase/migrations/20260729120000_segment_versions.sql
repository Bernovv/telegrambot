create table public.segments (
  id uuid primary key,
  name text not null,
  description text,
  lock_version integer not null default 1,
  published_version_id uuid,
  created_by_admin_id uuid references public.admin_accounts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint segments_name_check check (length(btrim(name)) between 1 and 120),
  constraint segments_description_check check (
    description is null or length(btrim(description)) between 1 and 1000
  ),
  constraint segments_lock_version_check check (lock_version > 0)
);

create table public.segment_versions (
  id uuid primary key,
  segment_id uuid not null references public.segments(id),
  version_number integer not null,
  status text not null default 'draft',
  schema_version smallint not null default 1,
  name text not null,
  description text,
  expression jsonb not null,
  created_by_admin_id uuid references public.admin_accounts(id),
  published_by_admin_id uuid references public.admin_accounts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  constraint segment_versions_number_check check (version_number > 0),
  constraint segment_versions_status_check check (
    status in ('draft', 'published')
  ),
  constraint segment_versions_schema_check check (schema_version = 1),
  constraint segment_versions_name_check check (
    length(btrim(name)) between 1 and 120
  ),
  constraint segment_versions_description_check check (
    description is null or length(btrim(description)) between 1 and 1000
  ),
  constraint segment_versions_expression_check check (
    jsonb_typeof(expression) = 'object'
  ),
  constraint segment_versions_publication_check check (
    (status = 'published' and published_at is not null)
    or (status = 'draft' and published_at is null)
  ),
  unique (segment_id, version_number)
);

create unique index segment_versions_one_draft_idx
  on public.segment_versions (segment_id)
  where status = 'draft';

create index segment_versions_history_idx
  on public.segment_versions (segment_id, version_number desc);

create index segments_updated_idx
  on public.segments (updated_at desc, id);

alter table public.segments
  add constraint segments_published_version_fk
  foreign key (published_version_id)
  references public.segment_versions(id)
  not valid;

create function public.protect_segment_version_identity_and_publication()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'published' then
    raise exception 'published segment version is immutable';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if old.segment_id <> new.segment_id
     or old.version_number <> new.version_number
     or old.created_at <> new.created_at
     or old.created_by_admin_id is distinct from new.created_by_admin_id then
    raise exception 'segment version identity is immutable';
  end if;

  return new;
end;
$$;

create trigger segment_versions_protect_mutation
before update or delete on public.segment_versions
for each row execute function public.protect_segment_version_identity_and_publication();

create function public.validate_segment_published_version()
returns trigger
language plpgsql
as $$
begin
  if new.published_version_id is not null
     and not exists (
       select 1
       from public.segment_versions versions
       where versions.id = new.published_version_id
         and versions.segment_id = new.id
         and versions.status = 'published'
     ) then
    raise exception 'segment published version must reference its published version';
  end if;

  return new;
end;
$$;

create trigger segments_validate_published_version
before insert or update of published_version_id on public.segments
for each row execute function public.validate_segment_published_version();

