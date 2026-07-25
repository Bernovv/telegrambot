create table public.payment_refund_requests (
  id uuid primary key,
  order_id uuid not null references public.orders(id),
  payment_attempt_id uuid not null references public.payment_attempts(id),
  refund_type text not null default 'full',
  status text not null,
  idempotency_key text not null unique,
  request_hash text not null,
  external_request_id uuid not null unique,
  external_amount_kopecks bigint not null,
  wallet_amount_kopecks bigint not null,
  currency text not null,
  reason text not null,
  requested_by_admin_id uuid not null references public.admin_accounts(id),
  requested_at timestamptz not null,
  provider_status text,
  last_result_code text,
  response_hash text,
  completed_at timestamptz,
  reconciliation_attempt_count integer not null default 0,
  reconciliation_next_attempt_at timestamptz,
  reconciliation_locked_by text,
  reconciliation_locked_until timestamptz,
  metadata_schema_version smallint not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint payment_refund_requests_type_check check (refund_type = 'full'),
  constraint payment_refund_requests_status_check check (
    status in ('created', 'submitted', 'unknown', 'review', 'failed', 'succeeded')
  ),
  constraint payment_refund_requests_idempotency_check check (
    length(idempotency_key) between 8 and 200
  ),
  constraint payment_refund_requests_hash_check check (
    request_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint payment_refund_requests_external_id_check check (
    external_request_id::text
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint payment_refund_requests_amount_check check (
    external_amount_kopecks > 0
    and wallet_amount_kopecks >= 0
  ),
  constraint payment_refund_requests_currency_check check (
    currency ~ '^[A-Z]{3}$'
  ),
  constraint payment_refund_requests_reason_check check (
    length(btrim(reason)) between 3 and 500
  ),
  constraint payment_refund_requests_provider_status_check check (
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
  constraint payment_refund_requests_result_check check (
    last_result_code is null
    or last_result_code ~ '^[A-Z0-9_:-]{1,80}$'
  ),
  constraint payment_refund_requests_response_hash_check check (
    response_hash is null
    or response_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint payment_refund_requests_completion_check check (
    (status = 'succeeded' and completed_at is not null)
    or (status <> 'succeeded' and completed_at is null)
  ),
  constraint payment_refund_requests_reconciliation_count_check check (
    reconciliation_attempt_count between 0 and 1000000
  ),
  constraint payment_refund_requests_lock_check check (
    (
      reconciliation_locked_by is null
      and reconciliation_locked_until is null
    )
    or (
      reconciliation_locked_by ~ '^[A-Za-z0-9._:-]{3,200}$'
      and reconciliation_locked_until is not null
    )
  ),
  constraint payment_refund_requests_metadata_schema_check check (
    metadata_schema_version > 0
  ),
  constraint payment_refund_requests_metadata_check check (
    jsonb_typeof(metadata) = 'object'
  )
);

create unique index payment_refund_requests_one_active_full_idx
  on public.payment_refund_requests (payment_attempt_id)
  where status in ('created', 'submitted', 'unknown', 'review', 'succeeded');

create index payment_refund_requests_order_requested_idx
  on public.payment_refund_requests (order_id, requested_at desc);

create index payment_refund_requests_reconciliation_idx
  on public.payment_refund_requests (
    reconciliation_next_attempt_at,
    requested_at,
    id
  )
  where status in ('submitted', 'unknown');

create table public.payment_refund_events (
  id uuid primary key,
  refund_request_id uuid not null references public.payment_refund_requests(id),
  origin text not null,
  event_type text not null,
  event_key text,
  result_code text not null,
  provider_status text,
  response_hash text,
  observed_at timestamptz not null,
  metadata_schema_version smallint not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  constraint payment_refund_events_origin_check check (
    origin in ('cancel_response', 'webhook', 'reconciliation', 'system')
  ),
  constraint payment_refund_events_type_check check (
    event_type in ('provider_result', 'finalized')
  ),
  constraint payment_refund_events_key_check check (
    event_key is null or event_key ~ '^[a-f0-9]{64}$'
  ),
  constraint payment_refund_events_result_check check (
    result_code ~ '^[A-Z0-9_:-]{1,80}$'
  ),
  constraint payment_refund_events_status_check check (
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
  constraint payment_refund_events_hash_check check (
    response_hash is null
    or response_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint payment_refund_events_metadata_schema_check check (
    metadata_schema_version > 0
  ),
  constraint payment_refund_events_metadata_check check (
    jsonb_typeof(metadata) = 'object'
  )
);

create unique index payment_refund_events_key_unique
  on public.payment_refund_events (event_key)
  where event_key is not null;

create index payment_refund_events_request_observed_idx
  on public.payment_refund_events (refund_request_id, observed_at desc);

create function public.protect_payment_refund_request()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'payment refund requests cannot be deleted';
  end if;

  if (
    new.order_id is distinct from old.order_id
    or new.payment_attempt_id is distinct from old.payment_attempt_id
    or new.refund_type is distinct from old.refund_type
    or new.idempotency_key is distinct from old.idempotency_key
    or new.request_hash is distinct from old.request_hash
    or new.external_request_id is distinct from old.external_request_id
    or new.external_amount_kopecks is distinct from old.external_amount_kopecks
    or new.wallet_amount_kopecks is distinct from old.wallet_amount_kopecks
    or new.currency is distinct from old.currency
    or new.reason is distinct from old.reason
    or new.requested_by_admin_id is distinct from old.requested_by_admin_id
    or new.requested_at is distinct from old.requested_at
  ) then
    raise exception 'payment refund request evidence is immutable';
  end if;

  return new;
end;
$$;

create trigger payment_refund_requests_protect_evidence
before update or delete on public.payment_refund_requests
for each row execute function public.protect_payment_refund_request();

create function public.prevent_payment_refund_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'payment refund events are append-only';
end;
$$;

create trigger payment_refund_events_append_only
before update or delete on public.payment_refund_events
for each row execute function public.prevent_payment_refund_event_mutation();
