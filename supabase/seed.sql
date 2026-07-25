-- Development-only defaults. Production configuration is managed separately.
-- This seed is idempotent and contains no PII.

insert into public.wallet_credit_campaigns (
  id,
  code,
  transaction_type,
  amount_kopecks,
  currency,
  is_active
) values (
  '019c7a10-0000-7000-8000-000000000001',
  'phone-bonus-default',
  'PHONE_BONUS',
  10000,
  'RUB',
  true
)
on conflict (code) do nothing;
