-- Referral tier configuration and attribution, unifying the referral logic already running in
-- the MAX bot (max-bot/src/domain/referralTiers.ts) with this repository's schema. Commission
-- itself is credited through the existing wallet ledger: wallet_transactions.transaction_type
-- 'REFERRAL_REWARD' and wallet_entries.bucket 'referral' were already allowed by the check
-- constraints in 20260722100000_contacts_wallet_ledger.sql, so no ledger schema change is needed
-- here.

create table public.referral_tier_configs (
  id uuid primary key,
  tier_number integer not null,
  min_referrals integer not null,
  max_referrals integer,
  percent_basis_points integer not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint referral_tier_configs_tier_check check (tier_number > 0),
  constraint referral_tier_configs_min_check check (min_referrals >= 0),
  constraint referral_tier_configs_max_check check (
    max_referrals is null or max_referrals >= min_referrals
  ),
  constraint referral_tier_configs_percent_check check (
    percent_basis_points >= 0 and percent_basis_points <= 10000
  )
);

create unique index referral_tier_configs_active_tier_unique
  on public.referral_tier_configs (tier_number)
  where is_active = true;

-- Which user referred which. One row per referred user: the partner code that brought them in
-- (see packages/messenger-telegram/src/scenario-content.ts partnerLinkReply — the referrer's own
-- Telegram numeric user ID doubles as their partner code) is resolved to the referrer's internal
-- user_id once, lazily, the first time a referral commission needs to be settled for them.
-- `qualified_at` is set the first time one of the referred user's orders is paid; the referrer's
-- tier is computed from the count of OTHER referred users who already have a non-null
-- `qualified_at`, so a referred user's own first paid order is rated at the tier the referrer held
-- immediately before that order.
create table public.referral_attributions (
  id uuid primary key,
  referred_user_id uuid not null references public.users(id),
  referrer_user_id uuid not null references public.users(id),
  partner_code text not null,
  attributed_at timestamptz not null default now(),
  qualified_at timestamptz,
  created_at timestamptz not null default now(),
  constraint referral_attributions_referred_unique unique (referred_user_id),
  constraint referral_attributions_not_self check (referred_user_id <> referrer_user_id),
  constraint referral_attributions_partner_code_check check (length(btrim(partner_code)) between 1 and 100)
);

create index referral_attributions_referrer_idx
  on public.referral_attributions (referrer_user_id)
  where qualified_at is not null;

-- Defensive guard alongside ConfirmPaymentService's own idempotency key: at most one posted
-- REFERRAL_REWARD transaction per order, mirroring wallet_transactions_phone_bonus_account_unique.
create unique index wallet_transactions_referral_reward_order_unique
  on public.wallet_transactions (reference_id)
  where transaction_type = 'REFERRAL_REWARD' and reference_type = 'order' and status = 'posted';

insert into public.referral_tier_configs
  (id, tier_number, min_referrals, max_referrals, percent_basis_points, is_active)
values
  ('019804f1-0001-7000-8000-000000000001', 1, 0, 9, 700, true),
  ('019804f1-0001-7000-8000-000000000002', 2, 10, 29, 1000, true),
  ('019804f1-0001-7000-8000-000000000003', 3, 30, null, 1500, true);
