create table public.user_import_batches (
  id uuid primary key,
  import_kind text not null default 'users_csv',
  file_name varchar(120) not null,
  file_checksum varchar(64) not null unique,
  byte_size integer not null,
  delimiter text not null,
  status text not null default 'preview_ready',
  total_row_count integer not null,
  new_row_count integer not null,
  invalid_row_count integer not null,
  ignored_row_count integer not null,
  created_by_admin_id uuid not null
    references public.admin_accounts(id),
  reason varchar(500) not null,
  created_at timestamptz not null,
  constraint user_import_batches_kind_check check (
    import_kind = 'users_csv'
  ),
  constraint user_import_batches_checksum_check check (
    file_checksum ~ '^[0-9a-f]{64}$'
  ),
  constraint user_import_batches_byte_size_check check (
    byte_size between 1 and 524288
  ),
  constraint user_import_batches_delimiter_check check (
    delimiter in (',', ';', E'\t')
  ),
  constraint user_import_batches_status_check check (
    status = 'preview_ready'
  ),
  constraint user_import_batches_counts_check check (
    total_row_count between 1 and 5000
    and new_row_count >= 0
    and invalid_row_count >= 0
    and ignored_row_count >= 0
    and new_row_count + invalid_row_count + ignored_row_count
      = total_row_count
  )
);

create table public.user_import_rows (
  batch_id uuid not null
    references public.user_import_batches(id),
  row_number integer not null,
  normalized_content_hash varchar(64) not null,
  status text not null,
  normalized_data jsonb,
  issue_codes text[] not null default '{}',
  created_at timestamptz not null,
  primary key (batch_id, row_number, normalized_content_hash),
  constraint user_import_rows_batch_row_unique unique (
    batch_id, row_number
  ),
  constraint user_import_rows_number_check check (
    row_number between 2 and 5001
  ),
  constraint user_import_rows_hash_check check (
    normalized_content_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint user_import_rows_status_check check (
    status in ('NEW', 'INVALID', 'IGNORED')
  ),
  constraint user_import_rows_payload_check check (
    (
      status = 'INVALID'
      and normalized_data is null
      and cardinality(issue_codes) > 0
    )
    or (
      status = 'NEW'
      and jsonb_typeof(normalized_data) = 'object'
      and cardinality(issue_codes) = 0
    )
    or (
      status = 'IGNORED'
      and jsonb_typeof(normalized_data) = 'object'
      and cardinality(issue_codes) > 0
    )
  )
);

create index user_import_batches_created_at_idx
  on public.user_import_batches (created_at desc, id);

create index user_import_rows_status_idx
  on public.user_import_rows (batch_id, status, row_number);

create function public.user_import_staging_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'user import staging records are append-only';
end;
$$;

create trigger user_import_batches_append_only
before update or delete on public.user_import_batches
for each row execute function public.user_import_staging_append_only();

create trigger user_import_rows_append_only
before update or delete on public.user_import_rows
for each row execute function public.user_import_staging_append_only();
