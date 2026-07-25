alter table public.payment_attempts
  add column reconciliation_attempt_count integer not null default 0,
  add column reconciliation_empty_count integer not null default 0,
  add column reconciliation_last_attempt_at timestamptz,
  add column reconciliation_next_attempt_at timestamptz,
  add column reconciliation_locked_by text,
  add column reconciliation_locked_until timestamptz,
  add column reconciliation_last_result text;

alter table public.payment_attempts
  add constraint payment_attempts_reconciliation_counts_check check (
    reconciliation_attempt_count between 0 and 1000000
    and reconciliation_empty_count between 0 and 1000000
  ),
  add constraint payment_attempts_reconciliation_lock_check check (
    (
      reconciliation_locked_by is null
      and reconciliation_locked_until is null
    )
    or (
      reconciliation_locked_by ~ '^[A-Za-z0-9._:-]{3,200}$'
      and reconciliation_locked_until is not null
    )
  ),
  add constraint payment_attempts_reconciliation_result_check check (
    reconciliation_last_result is null
    or reconciliation_last_result ~ '^[A-Z0-9_:-]{1,80}$'
  );

create index payment_attempts_tbank_reconciliation_claim_idx
  on public.payment_attempts (
    reconciliation_next_attempt_at,
    created_at,
    id
  )
  where provider = 'tbank'
    and status in ('creating', 'pending', 'authorized', 'unknown');

create table public.payment_reconciliation_events (
  id uuid primary key,
  payment_attempt_id uuid not null references public.payment_attempts(id),
  event_type text not null,
  result_code text not null,
  response_hash text,
  payment_count integer not null,
  provider_payment_id text,
  provider_status text,
  observed_at timestamptz not null,
  metadata_schema_version smallint not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  constraint payment_reconciliation_events_type_check check (
    event_type in ('retry', 'empty', 'observed', 'review')
  ),
  constraint payment_reconciliation_events_result_check check (
    result_code ~ '^[A-Z0-9_:-]{1,80}$'
  ),
  constraint payment_reconciliation_events_hash_check check (
    response_hash is null
    or response_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint payment_reconciliation_events_count_check check (
    payment_count between 0 and 20
  ),
  constraint payment_reconciliation_events_payment_id_check check (
    provider_payment_id is null
    or provider_payment_id ~ '^\d{1,20}$'
  ),
  constraint payment_reconciliation_events_status_check check (
    provider_status is null
    or provider_status in (
      'NEW',
      'FORM_SHOWED',
      'DEADLINE_EXPIRED',
      'CANCELED',
      'PREAUTHORIZING',
      'AUTHORIZING',
      'AUTHORIZED',
      'AUTH_FAIL',
      'REJECTED',
      '3DS_CHECKING',
      '3DS_CHECKED',
      'REVERSING',
      'PARTIAL_REVERSED',
      'REVERSED',
      'CONFIRMING',
      'CONFIRMED',
      'REFUNDING',
      'PARTIAL_REFUNDED',
      'REFUNDED'
    )
  ),
  constraint payment_reconciliation_events_metadata_schema_check check (
    metadata_schema_version > 0
  ),
  constraint payment_reconciliation_events_metadata_check check (
    jsonb_typeof(metadata) = 'object'
  )
);

create index payment_reconciliation_events_attempt_idx
  on public.payment_reconciliation_events (payment_attempt_id, observed_at desc);

create index payment_reconciliation_events_review_idx
  on public.payment_reconciliation_events (observed_at)
  where event_type = 'review';

create function public.prevent_payment_reconciliation_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'payment reconciliation events are append-only';
end;
$$;

create trigger payment_reconciliation_events_append_only
before update or delete on public.payment_reconciliation_events
for each row execute function public.prevent_payment_reconciliation_event_mutation();
