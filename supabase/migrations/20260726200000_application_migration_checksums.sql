create table public.application_migration_checksums (
  version text primary key,
  name text not null,
  checksum_sha256 text not null,
  recorded_at timestamptz not null default clock_timestamp(),
  constraint application_migration_checksums_version_check check (
    version ~ '^[0-9]{14}$'
  ),
  constraint application_migration_checksums_name_check check (
    name ~ '^[a-z0-9_]+$'
  ),
  constraint application_migration_checksums_sha256_check check (
    checksum_sha256 ~ '^[0-9a-f]{64}$'
  )
);

create function public.reject_application_migration_checksum_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'application migration checksum evidence is append-only';
end;
$$;

create trigger application_migration_checksums_append_only
before update or delete on public.application_migration_checksums
for each row
execute function public.reject_application_migration_checksum_mutation();

comment on table public.application_migration_checksums is
  'Append-only SHA-256 evidence recorded by the guarded application migration runner.';
