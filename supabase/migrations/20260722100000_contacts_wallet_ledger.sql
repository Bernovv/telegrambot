create table public.user_contacts (
  id uuid primary key,
  user_id uuid not null references public.users(id),
  contact_type text not null,
  value_normalized text not null,
  source text not null,
  verification_status text not null,
  is_primary boolean not null default false,
  verified_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_contacts_type_check check (contact_type in ('phone')),
  constraint user_contacts_source_check check (source in ('telegram_contact', 'import', 'admin')),
  constraint user_contacts_verification_status_check check (
    verification_status in ('unverified', 'imported', 'verified', 'rejected')
  ),
  constraint user_contacts_verified_at_check check (
    verification_status <> 'verified' or verified_at is not null
  ),
  constraint user_contacts_phone_e164_check check (
    contact_type <> 'phone' or value_normalized ~ '^\+[1-9][0-9]{7,14}$'
  ),
  constraint user_contacts_user_value_unique unique (user_id, contact_type, value_normalized)
);

create unique index user_contacts_verified_phone_unique
  on public.user_contacts (value_normalized)
  where contact_type = 'phone' and verification_status in ('imported', 'verified');

create unique index user_contacts_primary_type_unique
  on public.user_contacts (user_id, contact_type)
  where is_primary = true;

create index user_contacts_user_idx on public.user_contacts (user_id, created_at desc);

create table public.wallet_credit_campaigns (
  id uuid primary key,
  code text not null unique,
  transaction_type text not null,
  amount_kopecks bigint not null,
  currency text not null default 'RUB',
  is_active boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  credit_expires_after interval,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wallet_credit_campaigns_type_check check (transaction_type in ('PHONE_BONUS')),
  constraint wallet_credit_campaigns_amount_check check (amount_kopecks > 0),
  constraint wallet_credit_campaigns_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint wallet_credit_campaigns_window_check check (
    starts_at is null or ends_at is null or ends_at > starts_at
  ),
  constraint wallet_credit_campaigns_expiry_check check (
    credit_expires_after is null or credit_expires_after > interval '0 seconds'
  )
);

create unique index wallet_credit_campaigns_one_active_type_currency
  on public.wallet_credit_campaigns (transaction_type, currency)
  where is_active = true;

create table public.wallet_accounts (
  id uuid primary key,
  user_id uuid not null references public.users(id),
  currency text not null default 'RUB',
  cached_available_kopecks bigint not null default 0,
  cached_held_kopecks bigint not null default 0,
  status text not null default 'active',
  balance_version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wallet_accounts_user_currency_unique unique (user_id, currency),
  constraint wallet_accounts_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint wallet_accounts_available_check check (cached_available_kopecks >= 0),
  constraint wallet_accounts_held_check check (cached_held_kopecks >= 0),
  constraint wallet_accounts_status_check check (status in ('active', 'blocked', 'closed')),
  constraint wallet_accounts_version_check check (balance_version >= 0)
);

create index wallet_accounts_user_idx on public.wallet_accounts (user_id);

create table public.wallet_transactions (
  id uuid primary key,
  wallet_account_id uuid not null references public.wallet_accounts(id),
  transaction_type text not null,
  status text not null default 'pending',
  idempotency_key text not null unique,
  reference_type text,
  reference_id text,
  actor_type text not null default 'system',
  actor_id text,
  reason text,
  reversal_of_transaction_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  posted_at timestamptz,
  constraint wallet_transactions_id_account_unique unique (id, wallet_account_id),
  constraint wallet_transactions_type_check check (
    transaction_type in (
      'PHONE_BONUS',
      'REFERRAL_REWARD',
      'ADMIN_ADJUSTMENT',
      'ORDER_HOLD',
      'ORDER_CAPTURE',
      'ORDER_RELEASE',
      'REFUND_CREDIT',
      'REFERRAL_REVERSAL',
      'EXPIRATION',
      'MIGRATION_OPENING_BALANCE'
    )
  ),
  constraint wallet_transactions_status_check check (status in ('pending', 'posted', 'failed')),
  constraint wallet_transactions_actor_type_check check (
    actor_type in ('system', 'user', 'admin', 'import')
  ),
  constraint wallet_transactions_posted_at_check check (
    (status = 'posted' and posted_at is not null) or (status <> 'posted' and posted_at is null)
  ),
  constraint wallet_transactions_reference_pair_check check (
    (reference_type is null) = (reference_id is null)
  ),
  constraint wallet_transactions_reversal_fk foreign key (
    reversal_of_transaction_id, wallet_account_id
  ) references public.wallet_transactions (id, wallet_account_id)
);

create unique index wallet_transactions_phone_bonus_account_unique
  on public.wallet_transactions (wallet_account_id)
  where transaction_type = 'PHONE_BONUS' and status = 'posted';

create index wallet_transactions_account_created_idx
  on public.wallet_transactions (wallet_account_id, created_at desc);

create index wallet_transactions_reference_idx
  on public.wallet_transactions (reference_type, reference_id)
  where reference_type is not null;

create table public.wallet_entries (
  id uuid primary key,
  wallet_account_id uuid not null references public.wallet_accounts(id),
  wallet_transaction_id uuid not null,
  direction text not null,
  amount_kopecks bigint not null,
  bucket text not null,
  source_entry_id uuid,
  effective_at timestamptz not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint wallet_entries_id_account_unique unique (id, wallet_account_id),
  constraint wallet_entries_transaction_fk foreign key (
    wallet_transaction_id, wallet_account_id
  ) references public.wallet_transactions (id, wallet_account_id),
  constraint wallet_entries_source_fk foreign key (
    source_entry_id, wallet_account_id
  ) references public.wallet_entries (id, wallet_account_id),
  constraint wallet_entries_direction_check check (direction in ('credit', 'debit')),
  constraint wallet_entries_amount_check check (amount_kopecks > 0),
  constraint wallet_entries_bucket_check check (
    bucket in ('bonus', 'referral', 'cash_equivalent', 'refund')
  ),
  constraint wallet_entries_source_check check (
    (direction = 'credit' and source_entry_id is null)
    or (direction = 'debit' and source_entry_id is not null)
  ),
  constraint wallet_entries_expiry_check check (
    expires_at is null or expires_at > effective_at
  )
);

create index wallet_entries_account_effective_idx
  on public.wallet_entries (wallet_account_id, effective_at desc);

create index wallet_entries_fifo_credit_idx
  on public.wallet_entries (wallet_account_id, expires_at, effective_at)
  where direction = 'credit';

create table public.wallet_holds (
  id uuid primary key,
  wallet_account_id uuid not null references public.wallet_accounts(id),
  reference_type text not null,
  reference_id text not null,
  amount_kopecks bigint not null,
  status text not null default 'active',
  idempotency_key text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  captured_at timestamptz,
  released_at timestamptz,
  constraint wallet_holds_id_account_unique unique (id, wallet_account_id),
  constraint wallet_holds_reference_unique unique (
    wallet_account_id, reference_type, reference_id
  ),
  constraint wallet_holds_amount_check check (amount_kopecks > 0),
  constraint wallet_holds_status_check check (status in ('active', 'captured', 'released', 'expired')),
  constraint wallet_holds_expiry_check check (expires_at > created_at),
  constraint wallet_holds_terminal_time_check check (
    (status = 'active' and captured_at is null and released_at is null)
    or (status = 'captured' and captured_at is not null and released_at is null)
    or (status in ('released', 'expired') and captured_at is null and released_at is not null)
  )
);

create index wallet_holds_active_expiry_idx
  on public.wallet_holds (expires_at)
  where status = 'active';

create table public.wallet_hold_entries (
  id uuid primary key,
  wallet_account_id uuid not null references public.wallet_accounts(id),
  wallet_hold_id uuid not null,
  source_entry_id uuid not null,
  amount_kopecks bigint not null,
  created_at timestamptz not null default now(),
  constraint wallet_hold_entries_source_unique unique (wallet_hold_id, source_entry_id),
  constraint wallet_hold_entries_hold_fk foreign key (
    wallet_hold_id, wallet_account_id
  ) references public.wallet_holds (id, wallet_account_id),
  constraint wallet_hold_entries_source_fk foreign key (
    source_entry_id, wallet_account_id
  ) references public.wallet_entries (id, wallet_account_id),
  constraint wallet_hold_entries_amount_check check (amount_kopecks > 0)
);

create function public.prevent_wallet_entry_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'wallet ledger entries are append-only';
end;
$$;

create trigger wallet_entries_append_only
before update or delete on public.wallet_entries
for each row execute function public.prevent_wallet_entry_mutation();

create trigger wallet_hold_entries_append_only
before update or delete on public.wallet_hold_entries
for each row execute function public.prevent_wallet_entry_mutation();

create function public.prevent_posted_wallet_transaction_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' or old.status = 'posted' then
    raise exception 'posted wallet transactions are immutable';
  end if;

  return new;
end;
$$;

create trigger wallet_transactions_protect_posted
before update or delete on public.wallet_transactions
for each row execute function public.prevent_posted_wallet_transaction_mutation();
