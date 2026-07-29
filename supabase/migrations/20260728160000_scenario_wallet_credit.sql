alter table public.wallet_transactions
  add constraint wallet_transactions_type_v2_check check (
    transaction_type in (
      'PHONE_BONUS',
      'SCENARIO_CREDIT',
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
  ) not valid;

alter table public.wallet_transactions
  validate constraint wallet_transactions_type_v2_check;

alter table public.wallet_transactions
  drop constraint wallet_transactions_type_check;

alter table public.wallet_transactions
  rename constraint wallet_transactions_type_v2_check
  to wallet_transactions_type_check;
