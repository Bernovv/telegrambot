-- Заводит кампанию «100 ₽ за подтверждённый телефон» на всех окружениях.
--
-- Механика начисления в коде есть (packages/application/src/phone.ts), но включается она
-- строкой в wallet_credit_campaigns, а такая строка была заведена только в supabase/seed.sql —
-- файле с пометкой «development-only», который на продакшене не применяется. То есть на боевой
-- базе бонус не начислялся никому и ни разу, причём молча: сервис возвращает
-- reason='campaign_inactive' и идёт дальше.
--
-- Это понадобилось, потому что тексты MAX-бота, согласованные с заказчиком, обещают бонус
-- прямо при запросе номера телефона. Сначала деньги должны реально начисляться, и только
-- потом бот может про них говорить.
--
-- Сумма — 10000 копеек (100 ₽), та же, что в MAX-боте и в seed.sql. Срок сгорания не задан:
-- в MAX бонусы не сгорают, и вводить разное поведение в двух каналах перед объединением
-- незачем. Идентификатор и код совпадают с seed.sql, поэтому на средах разработки, где сид
-- уже применён, миграция ничего не сделает.

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

-- Страховка на случай, если строка уже существует, но выключена: частичный уникальный индекс
-- wallet_credit_campaigns_one_active_type_currency гарантирует, что активной останется одна.
update public.wallet_credit_campaigns
set is_active = true,
    updated_at = now()
where code = 'phone-bonus-default'
  and is_active = false
  and not exists (
    select 1
    from public.wallet_credit_campaigns active
    where active.transaction_type = 'PHONE_BONUS'
      and active.currency = 'RUB'
      and active.is_active = true
  );
