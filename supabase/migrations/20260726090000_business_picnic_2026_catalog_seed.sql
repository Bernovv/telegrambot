-- Initial event catalog for "Бизнес-Пикник" (8-9 августа 2026), seeded directly because the
-- Phase 2 admin-web content screens are not built yet (see docs/implementation-plan.md, "Event
-- catalog administration ... remain in Phase 2"). Prices and tiers match docs/bots/BOT_FLOWS.md
-- and docs/mvp/MVP_PLAN.md exactly. This is real catalog data, not the dev-only fixtures in
-- supabase/seed.sql — it is safe to re-run (every insert is idempotent) and safe to follow up
-- with a later migration if prices, dates, or capacity change before launch.
--
-- Once the admin-web catalog screens exist, this data should be editable there instead; this
-- migration is a deliberate bridge to let the Telegram/MAX bots sell real tickets before that UI
-- ships.

insert into public.events (
  id, slug, title, description, timezone, starts_at, ends_at,
  sales_starts_at, sales_ends_at, location_name, status, capacity,
  reservation_ttl_minutes, phone_required_for_purchase, offer_required,
  published_at
) values (
  '019c7a20-0000-7000-8000-000000000001',
  'business-picnic-2026',
  'Бизнес-Пикник 8-9 августа 2026',
  'Бизнес-пикник/бизнес-уикенд для экспертов и предпринимателей на берегу Ладожского озера. 2 дня / 1 ночь: выступления, нетворкинг, бизнес-игры, баня, вечер у костра.',
  'Europe/Moscow',
  '2026-08-08T12:00:00+03:00',
  '2026-08-09T20:00:00+03:00',
  '2026-07-25T00:00:00+03:00',
  '2026-08-09T23:59:00+03:00',
  'Берег Ладожского озера',
  'published',
  1000,
  30,
  true,
  true,
  '2026-07-26T09:00:00+03:00'
)
on conflict (slug) do nothing;

-- Offer document + immutable published version, so events.offer_required (above) can be satisfied.
-- source_url reuses DEFAULT_OFFER_SOURCE_URL from .env.example; replace with the real reviewed
-- offer through the admin "offer.publish" flow before go-live if this Google Doc changes.
insert into public.offer_documents (
  id, event_id, title, source_type, source_url, status
) values (
  '019c7a20-0000-7000-8000-000000000010',
  '019c7a20-0000-7000-8000-000000000001',
  'Оферта — Бизнес-Пикник 2026',
  'google_docs',
  'https://docs.google.com/document/d/1rNFUhIlL2ZNp8dY9gOdycmYYXmlP3iJZpA7laW9HMBI/edit?tab=t.0',
  'published'
)
on conflict (id) do nothing;

insert into public.offer_versions (
  id, offer_document_id, version_number, public_url, storage_path, content_type,
  sha256, published_at, is_active, display_text_snapshot
) values (
  '019c7a20-0000-7000-8000-000000000011',
  '019c7a20-0000-7000-8000-000000000010',
  1,
  'https://docs.google.com/document/d/1rNFUhIlL2ZNp8dY9gOdycmYYXmlP3iJZpA7laW9HMBI/edit?tab=t.0',
  'seed/business-picnic-2026/offer-v1',
  'text/html',
  encode(sha256('business-picnic-2026-offer-v1-seed'::bytea), 'hex'),
  '2026-07-26T09:00:00+03:00',
  true,
  'Актуальный текст оферты доступен по ссылке выше. Замените этот снапшот реальным текстом до старта продаж.'
)
on conflict (id) do nothing;

update public.events
set active_offer_version_id = '019c7a20-0000-7000-8000-000000000011'
where id = '019c7a20-0000-7000-8000-000000000001'
  and active_offer_version_id is null;

-- Products. inventory_units_per_item reflects headcount for capacity accounting: family bundles
-- consume 3 units (2 adults + 1 child), everything else consumes 1 per ticket.
insert into public.ticket_products (
  id, event_id, code, product_type, title, currency,
  bundle_composition, inventory_units_per_item, maximum_quantity_per_order, sort_order
) values
  (
    '019c7a20-0000-7000-8000-000000000002', '019c7a20-0000-7000-8000-000000000001',
    'adult_standard', 'adult_standard', 'Стандарт', 'RUB',
    '[{"role": "adult", "quantity": 1}]'::jsonb, 1, 50, 1
  ),
  (
    '019c7a20-0000-7000-8000-000000000003', '019c7a20-0000-7000-8000-000000000001',
    'adult_vip', 'adult_vip', 'Все включено', 'RUB',
    '[{"role": "adult", "quantity": 1}]'::jsonb, 1, 50, 2
  ),
  (
    '019c7a20-0000-7000-8000-000000000004', '019c7a20-0000-7000-8000-000000000001',
    'child', 'child', 'Детский билет', 'RUB',
    '[{"role": "child", "quantity": 1}]'::jsonb, 1, 50, 3
  ),
  (
    '019c7a20-0000-7000-8000-000000000005', '019c7a20-0000-7000-8000-000000000001',
    'family_standard', 'family_standard', 'Семейный Стандарт (2 взрослых + ребёнок)', 'RUB',
    '[{"role": "adult", "quantity": 2}, {"role": "child", "quantity": 1}]'::jsonb, 3, 20, 4
  ),
  (
    '019c7a20-0000-7000-8000-000000000006', '019c7a20-0000-7000-8000-000000000001',
    'family_vip', 'family_vip', 'Семейный Все включено (2 взрослых + ребёнок)', 'RUB',
    '[{"role": "adult", "quantity": 2}, {"role": "child", "quantity": 1}]'::jsonb, 3, 20, 5
  )
on conflict (event_id, code) do nothing;

-- Pricing rules — exact tiers from BOT_FLOWS.md / MVP_PLAN.md.
insert into public.pricing_rules (
  id, product_id, currency, minimum_quantity, maximum_quantity, unit_price_kopecks,
  priority, specificity, explanation
) values
  -- Стандарт: 1-2 билета 2490, 3-4 билета 1990, 5+ 1710 (руб/чел)
  (
    '019c7a20-0000-7000-8000-000000000100', '019c7a20-0000-7000-8000-000000000002',
    'RUB', 1, 2, 249000, 0, 1, 'Стандарт: 1-2 билета — 2490 ₽/чел'
  ),
  (
    '019c7a20-0000-7000-8000-000000000101', '019c7a20-0000-7000-8000-000000000002',
    'RUB', 3, 4, 199000, 0, 1, 'Стандарт: 3-4 билета — 1990 ₽/чел'
  ),
  (
    '019c7a20-0000-7000-8000-000000000102', '019c7a20-0000-7000-8000-000000000002',
    'RUB', 5, null, 171000, 0, 1, 'Стандарт: 5+ билетов — 1710 ₽/чел'
  ),
  -- Все включено (VIP): 1..5+ билетов, руб/чел
  (
    '019c7a20-0000-7000-8000-000000000110', '019c7a20-0000-7000-8000-000000000003',
    'RUB', 1, 1, 399000, 0, 1, 'Все включено: 1 билет — 3990 ₽/чел'
  ),
  (
    '019c7a20-0000-7000-8000-000000000111', '019c7a20-0000-7000-8000-000000000003',
    'RUB', 2, 2, 374500, 0, 1, 'Все включено: 2 билета — 3745 ₽/чел'
  ),
  (
    '019c7a20-0000-7000-8000-000000000112', '019c7a20-0000-7000-8000-000000000003',
    'RUB', 3, 3, 283000, 0, 1, 'Все включено: 3 билета — 2830 ₽/чел'
  ),
  (
    '019c7a20-0000-7000-8000-000000000113', '019c7a20-0000-7000-8000-000000000003',
    'RUB', 4, 4, 275000, 0, 1, 'Все включено: 4 билета — 2750 ₽/чел'
  ),
  (
    '019c7a20-0000-7000-8000-000000000114', '019c7a20-0000-7000-8000-000000000003',
    'RUB', 5, null, 260000, 0, 1, 'Все включено: 5+ билетов — 2600 ₽/чел'
  ),
  -- Детский билет: фиксированная цена, не влияет на скидку по взрослым
  (
    '019c7a20-0000-7000-8000-000000000120', '019c7a20-0000-7000-8000-000000000004',
    'RUB', 1, null, 49000, 0, 1, 'Детский билет — 490 ₽'
  ),
  -- Семейные тарифы: фиксированная цена за бандл (2 взрослых + ребёнок), без скидки за объём
  (
    '019c7a20-0000-7000-8000-000000000130', '019c7a20-0000-7000-8000-000000000005',
    'RUB', 1, null, 399000, 0, 1, 'Семейный Стандарт — 3990 ₽ за бандл'
  ),
  (
    '019c7a20-0000-7000-8000-000000000131', '019c7a20-0000-7000-8000-000000000006',
    'RUB', 1, null, 649000, 0, 1, 'Семейный Все включено — 6490 ₽ за бандл'
  )
on conflict (id) do nothing;
