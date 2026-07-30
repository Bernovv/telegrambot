create table public.user_import_row_decisions (
  id uuid primary key,
  analysis_id uuid not null,
  batch_id uuid not null,
  row_number integer not null,
  decision_version integer not null,
  action text not null,
  target_user_id uuid references public.users(id),
  supersedes_decision_id uuid,
  decided_by_admin_id uuid not null
    references public.admin_accounts(id),
  reason varchar(500) not null,
  created_at timestamptz not null,
  constraint user_import_row_decisions_analysis_fk foreign key (
    analysis_id, batch_id
  ) references public.user_import_match_analyses(id, batch_id),
  constraint user_import_row_decisions_result_fk foreign key (
    analysis_id, row_number
  ) references public.user_import_match_results(analysis_id, row_number),
  constraint user_import_row_decisions_version_check check (
    decision_version between 1 and 1000000
  ),
  constraint user_import_row_decisions_reason_check check (
    length(btrim(reason)) between 1 and 500
  ),
  constraint user_import_row_decisions_action_check check (
    action in ('CREATE_NEW_USER', 'MERGE_SAFE_FIELDS', 'IGNORE_ROW')
  ),
  constraint user_import_row_decisions_target_check check (
    (
      action = 'MERGE_SAFE_FIELDS'
      and target_user_id is not null
    )
    or (
      action in ('CREATE_NEW_USER', 'IGNORE_ROW')
      and target_user_id is null
    )
  ),
  constraint user_import_row_decisions_chain_check check (
    (
      decision_version = 1
      and supersedes_decision_id is null
    )
    or (
      decision_version > 1
      and supersedes_decision_id is not null
    )
  ),
  constraint user_import_row_decisions_row_version_unique unique (
    analysis_id, row_number, decision_version
  ),
  constraint user_import_row_decisions_id_row_unique unique (
    id, analysis_id, row_number
  ),
  constraint user_import_row_decisions_supersedes_unique unique (
    supersedes_decision_id
  ),
  constraint user_import_row_decisions_supersedes_fk foreign key (
    supersedes_decision_id, analysis_id, row_number
  ) references public.user_import_row_decisions(
    id, analysis_id, row_number
  )
);

create index user_import_row_decisions_latest_idx
  on public.user_import_row_decisions (
    analysis_id, row_number, decision_version desc
  );

create function public.user_import_row_decisions_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'user import row decisions are append-only';
end;
$$;

create trigger user_import_row_decisions_append_only
before update or delete on public.user_import_row_decisions
for each row execute function public.user_import_row_decisions_append_only();
