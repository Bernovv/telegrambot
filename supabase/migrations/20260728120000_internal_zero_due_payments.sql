alter table public.payment_attempts
  add constraint payment_attempts_provider_v2_check check (
    provider in ('tbank', 'manual', 'fake', 'internal')
  ) not valid;

alter table public.payment_attempts
  validate constraint payment_attempts_provider_v2_check;

alter table public.payment_attempts
  drop constraint payment_attempts_provider_check;

alter table public.payment_attempts
  rename constraint payment_attempts_provider_v2_check
  to payment_attempts_provider_check;
