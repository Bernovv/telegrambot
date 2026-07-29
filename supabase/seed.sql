-- Development-only defaults. Production configuration is managed separately.
-- This seed is idempotent, contains only synthetic PII, and never updates existing rows.

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

create temporary table local_seed_new_users (
  id uuid primary key
);

with inserted as (
  insert into public.users (
    id,
    display_name,
    first_name,
    last_name,
    preferred_language,
    phone_status,
    metadata
  ) values (
    '019d0000-0000-7000-8000-000000000200',
    'Демо-пользователь',
    'Демо',
    'Пользователь',
    'ru',
    'imported',
    '{"synthetic":true,"seed":"local-demo-v1"}'::jsonb
  )
  on conflict do nothing
  returning id
)
insert into local_seed_new_users (id)
select id from inserted;

insert into public.messenger_identities (
  id,
  user_id,
  channel,
  external_user_id,
  username,
  username_normalized
)
select
  '019d0000-0000-7000-8000-000000000201',
  id,
  'telegram',
  'local-demo-user',
  'local_demo_user',
  'local_demo_user'
from local_seed_new_users;

insert into public.user_contacts (
  id,
  user_id,
  contact_type,
  value_normalized,
  source,
  verification_status,
  is_primary,
  metadata
)
select
  '019d0000-0000-7000-8000-000000000202',
  id,
  'phone',
  '+79990000001',
  'import',
  'imported',
  true,
  '{"synthetic":true,"seed":"local-demo-v1"}'::jsonb
from local_seed_new_users;

insert into public.wallet_accounts (
  id,
  user_id,
  currency
)
select
  '019d0000-0000-7000-8000-000000000203',
  id,
  'RUB'
from local_seed_new_users;

create temporary table local_seed_new_events (
  id uuid primary key
);

with inserted as (
  insert into public.events (
    id,
    slug,
    title,
    description,
    timezone,
    starts_at,
    ends_at,
    sales_starts_at,
    sales_ends_at,
    location_name,
    location_address,
    support_contact,
    status,
    capacity,
    reservation_ttl_minutes,
    phone_required_for_purchase,
    offer_required
  ) values (
    '019d0000-0000-7000-8000-000000000100',
    'business-picnic-demo',
    'Business Picnic: демо',
    'Локальное демонстрационное мероприятие. Не использовать для реальных продаж.',
    'Europe/Moscow',
    clock_timestamp() + interval '90 days',
    clock_timestamp() + interval '90 days 8 hours',
    clock_timestamp() - interval '1 day',
    clock_timestamp() + interval '89 days',
    'Демо-площадка',
    'Тестовый адрес',
    '@local_demo_support',
    'draft',
    500,
    30,
    true,
    true
  )
  on conflict do nothing
  returning id
)
insert into local_seed_new_events (id)
select id from inserted;

insert into public.event_content_blocks (
  id,
  event_id,
  block_type,
  title,
  content,
  sort_order
)
select
  '019d0000-0000-7000-8000-000000000101',
  id,
  'description',
  'О мероприятии',
  '{"text":"Демонстрационная карточка для проверки локальной админки и сценария покупки."}'::jsonb,
  0
from local_seed_new_events;

insert into public.event_content_blocks (
  id,
  event_id,
  block_type,
  title,
  content,
  sort_order
)
select
  '019d0000-0000-7000-8000-000000000102',
  id,
  'program',
  'Программа',
  '{"items":[{"time":"10:00","title":"Регистрация"},{"time":"11:00","title":"Деловая программа"},{"time":"18:00","title":"Завершение"}]}'::jsonb,
  1
from local_seed_new_events;

insert into public.event_content_blocks (
  id,
  event_id,
  block_type,
  title,
  content,
  sort_order
)
select
  '019d0000-0000-7000-8000-000000000103',
  id,
  'faq',
  'Частые вопросы',
  '{"items":[{"question":"Это настоящее мероприятие?","answer":"Нет, запись предназначена только для local/test."}]}'::jsonb,
  2
from local_seed_new_events;

insert into public.ticket_products (
  id,
  event_id,
  code,
  product_type,
  title,
  description,
  currency,
  capacity,
  maximum_quantity_per_order,
  sort_order
)
select
  '019d0000-0000-7000-8000-000000000110',
  id,
  'standard',
  'adult_standard',
  'Standard',
  'Стандартный взрослый билет',
  'RUB',
  350,
  20,
  0
from local_seed_new_events;

insert into public.ticket_products (
  id,
  event_id,
  code,
  product_type,
  title,
  description,
  currency,
  capacity,
  maximum_quantity_per_order,
  sort_order
)
select
  '019d0000-0000-7000-8000-000000000111',
  id,
  'all_inclusive',
  'adult_vip',
  'All-inclusive',
  'Расширенный взрослый билет',
  'RUB',
  100,
  20,
  1
from local_seed_new_events;

insert into public.ticket_products (
  id,
  event_id,
  code,
  product_type,
  title,
  description,
  currency,
  capacity,
  maximum_quantity_per_order,
  sort_order
)
select
  '019d0000-0000-7000-8000-000000000112',
  id,
  'child',
  'child',
  'Детский',
  'Детский билет, не влияющий на взрослый ценовой диапазон',
  'RUB',
  50,
  10,
  2
from local_seed_new_events;

insert into public.pricing_rules (
  id,
  product_id,
  currency,
  minimum_quantity,
  maximum_quantity,
  unit_price_kopecks,
  priority,
  specificity,
  explanation
)
select *
from (
  values
    ('019d0000-0000-7000-8000-000000000120'::uuid, '019d0000-0000-7000-8000-000000000110'::uuid, 'RUB'::text, 1, 2, 249000::bigint, 100, 100, 'Standard: 1–2 взрослых'),
    ('019d0000-0000-7000-8000-000000000121'::uuid, '019d0000-0000-7000-8000-000000000110'::uuid, 'RUB'::text, 3, 4, 199000::bigint, 100, 100, 'Standard: 3–4 взрослых'),
    ('019d0000-0000-7000-8000-000000000122'::uuid, '019d0000-0000-7000-8000-000000000110'::uuid, 'RUB'::text, 5, null::integer, 171000::bigint, 100, 100, 'Standard: 5 и более взрослых'),
    ('019d0000-0000-7000-8000-000000000123'::uuid, '019d0000-0000-7000-8000-000000000111'::uuid, 'RUB'::text, 1, 1, 399000::bigint, 100, 100, 'All-inclusive: 1 взрослый'),
    ('019d0000-0000-7000-8000-000000000124'::uuid, '019d0000-0000-7000-8000-000000000111'::uuid, 'RUB'::text, 2, 2, 374500::bigint, 100, 100, 'All-inclusive: 2 взрослых'),
    ('019d0000-0000-7000-8000-000000000125'::uuid, '019d0000-0000-7000-8000-000000000111'::uuid, 'RUB'::text, 3, 3, 283000::bigint, 100, 100, 'All-inclusive: 3 взрослых'),
    ('019d0000-0000-7000-8000-000000000126'::uuid, '019d0000-0000-7000-8000-000000000111'::uuid, 'RUB'::text, 4, 4, 275000::bigint, 100, 100, 'All-inclusive: 4 взрослых'),
    ('019d0000-0000-7000-8000-000000000127'::uuid, '019d0000-0000-7000-8000-000000000111'::uuid, 'RUB'::text, 5, null::integer, 260000::bigint, 100, 100, 'All-inclusive: 5 и более взрослых'),
    ('019d0000-0000-7000-8000-000000000128'::uuid, '019d0000-0000-7000-8000-000000000112'::uuid, 'RUB'::text, 1, null::integer, 49000::bigint, 100, 100, 'Детский билет')
) as rules (
  id,
  product_id,
  currency,
  minimum_quantity,
  maximum_quantity,
  unit_price_kopecks,
  priority,
  specificity,
  explanation
)
where exists (select 1 from local_seed_new_events);

insert into public.offer_documents (
  id,
  event_id,
  title,
  source_type,
  source_url,
  status
)
select
  '019d0000-0000-7000-8000-000000000130',
  id,
  'Договор оферты мероприятия',
  'google_docs',
  'https://docs.google.com/document/d/1rNFUhIlL2ZNp8dY9gOdycmYYXmlP3iJZpA7laW9HMBI/edit?tab=t.0',
  'draft'
from local_seed_new_events;

insert into public.scenarios (
  id,
  event_id,
  title
)
select
  '019d0000-0000-7000-8000-000000000140',
  id,
  'Business Picnic: базовая покупка'
from local_seed_new_events;

insert into public.scenario_versions (
  id,
  scenario_id,
  version_number,
  status,
  schema_version,
  validation_issues
)
select
  '019d0000-0000-7000-8000-000000000141',
  '019d0000-0000-7000-8000-000000000140',
  1,
  'draft',
  1,
  '[]'::jsonb
from local_seed_new_events;

insert into public.scenario_nodes (
  scenario_version_id,
  id,
  node_type,
  payload,
  sort_order
)
select
  '019d0000-0000-7000-8000-000000000141',
  nodes.id,
  nodes.node_type,
  nodes.payload,
  nodes.sort_order
from (
  values
    ('019d0000-0000-7000-8000-000000000150'::uuid, 'start'::text, '{}'::jsonb, 0),
    ('019d0000-0000-7000-8000-000000000151'::uuid, 'message'::text, '{"text":"Демо-покупка Business Picnic"}'::jsonb, 1),
    ('019d0000-0000-7000-8000-000000000152'::uuid, 'number_input'::text, '{"text":"Сколько взрослых билетов Standard?","contextKey":"adultQuantity","minimum":1,"maximum":20}'::jsonb, 2),
    ('019d0000-0000-7000-8000-000000000153'::uuid, 'number_input'::text, '{"text":"Сколько детских билетов? Введите 0, если они не нужны.","contextKey":"childQuantity","minimum":0,"maximum":10}'::jsonb, 3),
    ('019d0000-0000-7000-8000-000000000154'::uuid, 'order_start'::text, '{"currency":"RUB","items":[{"productId":"019d0000-0000-7000-8000-000000000110","quantityContextKey":"adultQuantity"},{"productId":"019d0000-0000-7000-8000-000000000112","quantityContextKey":"childQuantity","optional":true}]}'::jsonb, 4),
    ('019d0000-0000-7000-8000-000000000155'::uuid, 'offer_acceptance'::text, '{}'::jsonb, 5),
    ('019d0000-0000-7000-8000-000000000156'::uuid, 'payment_start'::text, '{}'::jsonb, 6),
    ('019d0000-0000-7000-8000-000000000157'::uuid, 'end'::text, '{"text":"Оплата подтверждена. Билеты доступны в разделе «Мои билеты»."}'::jsonb, 7)
) as nodes (id, node_type, payload, sort_order)
where exists (select 1 from local_seed_new_events);

insert into public.scenario_edges (
  scenario_version_id,
  id,
  from_node_id,
  to_node_id,
  label,
  priority,
  condition
)
select
  '019d0000-0000-7000-8000-000000000141',
  edges.id,
  edges.from_node_id,
  edges.to_node_id,
  null,
  0,
  '{}'::jsonb
from (
  values
    ('019d0000-0000-7000-8000-000000000160'::uuid, '019d0000-0000-7000-8000-000000000150'::uuid, '019d0000-0000-7000-8000-000000000151'::uuid),
    ('019d0000-0000-7000-8000-000000000161'::uuid, '019d0000-0000-7000-8000-000000000151'::uuid, '019d0000-0000-7000-8000-000000000152'::uuid),
    ('019d0000-0000-7000-8000-000000000162'::uuid, '019d0000-0000-7000-8000-000000000152'::uuid, '019d0000-0000-7000-8000-000000000153'::uuid),
    ('019d0000-0000-7000-8000-000000000163'::uuid, '019d0000-0000-7000-8000-000000000153'::uuid, '019d0000-0000-7000-8000-000000000154'::uuid),
    ('019d0000-0000-7000-8000-000000000164'::uuid, '019d0000-0000-7000-8000-000000000154'::uuid, '019d0000-0000-7000-8000-000000000155'::uuid),
    ('019d0000-0000-7000-8000-000000000165'::uuid, '019d0000-0000-7000-8000-000000000155'::uuid, '019d0000-0000-7000-8000-000000000156'::uuid),
    ('019d0000-0000-7000-8000-000000000166'::uuid, '019d0000-0000-7000-8000-000000000156'::uuid, '019d0000-0000-7000-8000-000000000157'::uuid)
) as edges (id, from_node_id, to_node_id)
where exists (select 1 from local_seed_new_events);
