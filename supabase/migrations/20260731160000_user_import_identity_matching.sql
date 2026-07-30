create table public.user_external_identities (
  id uuid primary key,
  user_id uuid not null references public.users(id),
  source_system varchar(50) not null,
  external_user_id varchar(100) not null,
  source text not null,
  created_by_import_batch_id uuid
    references public.user_import_batches(id),
  created_at timestamptz not null,
  constraint user_external_identities_source_system_check check (
    source_system ~ '^[a-z][a-z0-9_-]{1,49}$'
  ),
  constraint user_external_identities_external_id_check check (
    external_user_id = btrim(external_user_id)
    and length(external_user_id) between 1 and 100
  ),
  constraint user_external_identities_source_check check (
    source in ('import', 'admin', 'crm_sync')
  ),
  constraint user_external_identities_system_id_unique unique (
    source_system, external_user_id
  )
);

create index user_external_identities_user_idx
  on public.user_external_identities (user_id, created_at desc);

create table public.user_import_match_analyses (
  id uuid primary key,
  batch_id uuid not null unique
    references public.user_import_batches(id),
  status text not null default 'completed',
  total_row_count integer not null,
  new_row_count integer not null,
  exact_no_change_row_count integer not null,
  merge_new_fields_row_count integer not null,
  possible_match_row_count integer not null,
  conflict_row_count integer not null,
  invalid_row_count integer not null,
  ignored_row_count integer not null,
  observed_at timestamptz not null,
  created_by_admin_id uuid not null
    references public.admin_accounts(id),
  reason varchar(500) not null,
  created_at timestamptz not null,
  constraint user_import_match_analyses_status_check check (
    status = 'completed'
  ),
  constraint user_import_match_analyses_counts_check check (
    total_row_count between 1 and 5000
    and new_row_count >= 0
    and exact_no_change_row_count >= 0
    and merge_new_fields_row_count >= 0
    and possible_match_row_count >= 0
    and conflict_row_count >= 0
    and invalid_row_count >= 0
    and ignored_row_count >= 0
    and new_row_count
      + exact_no_change_row_count
      + merge_new_fields_row_count
      + possible_match_row_count
      + conflict_row_count
      + invalid_row_count
      + ignored_row_count
      = total_row_count
  ),
  constraint user_import_match_analyses_time_check check (
    created_at >= observed_at
  ),
  constraint user_import_match_analyses_id_batch_unique unique (
    id, batch_id
  )
);

create table public.user_import_match_results (
  analysis_id uuid not null,
  batch_id uuid not null,
  row_number integer not null,
  status text not null,
  matched_user_id uuid references public.users(id),
  candidate_user_ids uuid[] not null default '{}',
  match_kinds text[] not null default '{}',
  issue_codes text[] not null default '{}',
  created_at timestamptz not null,
  primary key (analysis_id, row_number),
  constraint user_import_match_results_analysis_fk foreign key (
    analysis_id, batch_id
  ) references public.user_import_match_analyses(id, batch_id),
  constraint user_import_match_results_staging_fk foreign key (
    batch_id, row_number
  ) references public.user_import_rows(batch_id, row_number),
  constraint user_import_match_results_status_check check (
    status in (
      'NEW',
      'EXACT_MATCH_NO_CHANGE',
      'MERGE_NEW_FIELDS',
      'POSSIBLE_MATCH',
      'CONFLICT',
      'INVALID',
      'IGNORED'
    )
  ),
  constraint user_import_match_results_match_kinds_check check (
    array_position(candidate_user_ids, null) is null
    and array_position(match_kinds, null) is null
    and array_position(issue_codes, null) is null
    and match_kinds <@ array[
      'telegram_id',
      'verified_phone',
      'imported_phone',
      'external_crm_id',
      'telegram_username'
    ]::text[]
  ),
  constraint user_import_match_results_payload_check check (
    (
      status = 'NEW'
      and matched_user_id is null
      and cardinality(candidate_user_ids) = 0
      and cardinality(match_kinds) = 0
      and cardinality(issue_codes) = 0
    )
    or (
      status in ('EXACT_MATCH_NO_CHANGE', 'MERGE_NEW_FIELDS')
      and matched_user_id is not null
      and matched_user_id = any(candidate_user_ids)
      and cardinality(match_kinds) > 0
    )
    or (
      status = 'POSSIBLE_MATCH'
      and matched_user_id is null
      and cardinality(candidate_user_ids) = 1
      and match_kinds && array[
        'telegram_username',
        'imported_phone'
      ]::text[]
      and cardinality(issue_codes) > 0
    )
    or (
      status = 'CONFLICT'
      and matched_user_id is null
      and cardinality(candidate_user_ids) > 0
      and cardinality(match_kinds) > 0
      and cardinality(issue_codes) > 0
    )
    or (
      status in ('INVALID', 'IGNORED')
      and matched_user_id is null
      and cardinality(candidate_user_ids) = 0
      and cardinality(match_kinds) = 0
      and cardinality(issue_codes) > 0
    )
  )
);

create index user_import_match_results_status_idx
  on public.user_import_match_results (
    analysis_id, status, row_number
  );

create function public.user_import_matching_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'user import matching records are append-only';
end;
$$;

create trigger user_import_match_analyses_append_only
before update or delete on public.user_import_match_analyses
for each row execute function public.user_import_matching_append_only();

create trigger user_import_match_results_append_only
before update or delete on public.user_import_match_results
for each row execute function public.user_import_matching_append_only();
