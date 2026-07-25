alter table public.payment_attempts
  add column payment_url text,
  add column provider_status text,
  add column initialization_error_code text,
  add column initialized_at timestamptz;

alter table public.payment_attempts
  add constraint payment_attempts_payment_url_check check (
    payment_url is null
    or (
      length(payment_url) <= 2048
      and payment_url ~ '^https://'
    )
  ),
  add constraint payment_attempts_provider_status_check check (
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
  add constraint payment_attempts_initialization_error_check check (
    initialization_error_code is null
    or initialization_error_code ~ '^[A-Za-z0-9_-]{1,40}$'
  ),
  add constraint payment_attempts_tbank_lifecycle_check check (
    provider <> 'tbank'
    or (
      merchant_order_id is not null
      and length(merchant_order_id) between 1 and 50
      and merchant_order_id ~ '^[A-Za-z0-9._-]+$'
    )
  ) not valid;

create unique index payment_attempts_tbank_order_unique
  on public.payment_attempts (merchant_order_id)
  where provider = 'tbank';

create table public.payment_provider_events (
  id uuid primary key,
  payment_attempt_id uuid references public.payment_attempts(id),
  provider text not null,
  event_key text not null,
  provider_payment_id text not null,
  merchant_order_id text not null,
  provider_status text not null,
  success boolean not null,
  error_code text not null,
  amount_kopecks bigint not null,
  payload_hash text not null,
  outcome text not null,
  received_at timestamptz not null,
  metadata_schema_version smallint not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  constraint payment_provider_events_provider_check check (
    provider = 'tbank'
  ),
  constraint payment_provider_events_event_key_check check (
    event_key ~ '^[a-f0-9]{64}$'
  ),
  constraint payment_provider_events_payment_id_check check (
    provider_payment_id ~ '^\d{1,20}$'
  ),
  constraint payment_provider_events_merchant_order_check check (
    length(merchant_order_id) between 1 and 50
    and merchant_order_id ~ '^[A-Za-z0-9._-]+$'
  ),
  constraint payment_provider_events_status_check check (
    provider_status in (
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
  constraint payment_provider_events_error_code_check check (
    length(error_code) between 1 and 20
  ),
  constraint payment_provider_events_amount_check check (
    amount_kopecks >= 0
  ),
  constraint payment_provider_events_payload_hash_check check (
    payload_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint payment_provider_events_outcome_check check (
    outcome in ('processed', 'review')
  ),
  constraint payment_provider_events_metadata_schema_check check (
    metadata_schema_version > 0
  ),
  constraint payment_provider_events_metadata_check check (
    jsonb_typeof(metadata) = 'object'
  ),
  unique (provider, event_key)
);

create index payment_provider_events_attempt_received_idx
  on public.payment_provider_events (payment_attempt_id, received_at desc);

create index payment_provider_events_review_idx
  on public.payment_provider_events (received_at)
  where outcome = 'review';

create function public.prevent_payment_provider_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'payment provider events are append-only';
end;
$$;

create trigger payment_provider_events_append_only
before update or delete on public.payment_provider_events
for each row execute function public.prevent_payment_provider_event_mutation();
