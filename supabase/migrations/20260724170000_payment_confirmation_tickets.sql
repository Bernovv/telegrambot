create table public.payment_attempts (
  id uuid primary key,
  order_id uuid not null references public.orders(id),
  attempt_number integer not null,
  provider text not null,
  status text not null,
  amount_kopecks bigint not null,
  currency text not null,
  idempotency_key text not null unique,
  confirmation_request_hash text,
  merchant_order_id text,
  provider_payment_id text,
  provider_event_id text,
  confirmed_at timestamptz,
  metadata_schema_version smallint not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_attempts_attempt_number_check check (attempt_number > 0),
  constraint payment_attempts_provider_check check (
    provider in ('tbank', 'manual', 'fake')
  ),
  constraint payment_attempts_status_check check (
    status in (
      'creating',
      'pending',
      'authorized',
      'succeeded',
      'failed',
      'cancelled',
      'unknown',
      'partially_refunded',
      'refunded'
    )
  ),
  constraint payment_attempts_amount_check check (amount_kopecks >= 0),
  constraint payment_attempts_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint payment_attempts_idempotency_key_check check (
    length(idempotency_key) between 8 and 200
  ),
  constraint payment_attempts_confirmation_hash_check check (
    confirmation_request_hash is null
    or confirmation_request_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint payment_attempts_confirmation_lifecycle_check check (
    (
      status in ('succeeded', 'partially_refunded', 'refunded')
      and confirmed_at is not null
      and confirmation_request_hash is not null
    )
    or (
      status not in ('succeeded', 'partially_refunded', 'refunded')
      and confirmed_at is null
    )
  ),
  constraint payment_attempts_metadata_schema_check check (
    metadata_schema_version > 0
  ),
  constraint payment_attempts_metadata_check check (
    jsonb_typeof(metadata) = 'object'
  ),
  unique (order_id, attempt_number)
);

create unique index payment_attempts_provider_payment_unique
  on public.payment_attempts (provider, provider_payment_id)
  where provider_payment_id is not null;

create unique index payment_attempts_provider_event_unique
  on public.payment_attempts (provider, provider_event_id)
  where provider_event_id is not null;

create index payment_attempts_order_created_idx
  on public.payment_attempts (order_id, created_at desc);

create index payment_attempts_pending_idx
  on public.payment_attempts (updated_at)
  where status in ('creating', 'pending', 'authorized', 'unknown');

create table public.manual_payments (
  id uuid primary key,
  payment_attempt_id uuid not null unique references public.payment_attempts(id),
  order_id uuid not null references public.orders(id),
  confirmed_by_admin_id uuid not null references public.admin_accounts(id),
  method text not null,
  external_reference text not null,
  reason text not null,
  request_id text,
  recorded_at timestamptz not null,
  metadata_schema_version smallint not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  constraint manual_payments_method_check check (
    method in ('cash', 'bank_transfer', 'other')
  ),
  constraint manual_payments_reference_check check (
    length(btrim(external_reference)) between 1 and 120
  ),
  constraint manual_payments_reason_check check (
    length(btrim(reason)) between 3 and 500
  ),
  constraint manual_payments_request_id_check check (
    request_id is null or length(request_id) <= 200
  ),
  constraint manual_payments_metadata_schema_check check (
    metadata_schema_version > 0
  ),
  constraint manual_payments_metadata_check check (
    jsonb_typeof(metadata) = 'object'
  )
);

create index manual_payments_order_recorded_idx
  on public.manual_payments (order_id, recorded_at desc);

create function public.protect_payment_attempt_record()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'payment attempts cannot be deleted';
  end if;

  if old.status in ('succeeded', 'partially_refunded', 'refunded') and (
    new.order_id is distinct from old.order_id
    or new.attempt_number is distinct from old.attempt_number
    or new.provider is distinct from old.provider
    or new.amount_kopecks is distinct from old.amount_kopecks
    or new.currency is distinct from old.currency
    or new.idempotency_key is distinct from old.idempotency_key
    or new.confirmation_request_hash is distinct from old.confirmation_request_hash
    or new.confirmed_at is distinct from old.confirmed_at
  ) then
    raise exception 'confirmed payment evidence is immutable';
  end if;

  return new;
end;
$$;

create trigger payment_attempts_protect_evidence
before update or delete on public.payment_attempts
for each row execute function public.protect_payment_attempt_record();

create function public.prevent_manual_payment_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'manual payment evidence is append-only';
end;
$$;

create trigger manual_payments_append_only
before update or delete on public.manual_payments
for each row execute function public.prevent_manual_payment_mutation();
