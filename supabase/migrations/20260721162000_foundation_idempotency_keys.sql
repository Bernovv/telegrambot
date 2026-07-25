create table public.idempotency_keys (
  key text primary key,
  scope text not null,
  status text not null default 'processed',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz,
  request_hash text,
  response_snapshot jsonb,
  metadata jsonb not null default '{}'::jsonb,
  constraint idempotency_keys_scope_check check (
    scope in (
      'telegram_update',
      'telegram_callback',
      'tbank_webhook',
      'payment_init',
      'phone_bonus',
      'wallet',
      'commission',
      'ticket_issue',
      'import',
      'broadcast_recipient',
      'scheduled_job'
    )
  ),
  constraint idempotency_keys_status_check check (
    status in ('processing', 'processed', 'failed')
  ),
  constraint idempotency_keys_valid_expiry_check check (
    expires_at is null or expires_at > first_seen_at
  )
);

create index idempotency_keys_scope_seen_idx
  on public.idempotency_keys (scope, first_seen_at desc);

create index idempotency_keys_expires_idx
  on public.idempotency_keys (expires_at)
  where expires_at is not null;
