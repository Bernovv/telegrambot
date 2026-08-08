-- Анкеты для покупателей бота.
--
-- Анкету раздают на мероприятии на бумаге и переносят в панель руками. Ответы ручного
-- участника уже есть — `event_participant_field_values`; у покупателя бота участника нет,
-- он есть только как заказ. Отсюда вторая таблица, точное зеркало первой, но с ключом на
-- заказ.
--
-- Складывать оба вида в одну таблицу с «или заказ, или участник» мы не стали: тогда вместо
-- двух настоящих внешних ключей остаётся один проверяемый вручную, а данные не переезжают.
-- Вопросы у обеих таблиц общие: определения полей лежат в
-- `event_participant_field_definitions` и служат и тем, и другим.

create table if not exists public.event_order_field_values (
  order_id uuid not null references public.orders(id),
  field_definition_id uuid not null
    references public.event_participant_field_definitions(id) on delete cascade,
  value_text text,
  updated_by_admin_id uuid not null references public.admin_accounts(id),
  updated_at timestamptz not null default now(),
  primary key (order_id, field_definition_id),
  constraint event_order_field_values_text_check check (
    value_text is null or length(value_text) <= 500
  )
);

create index if not exists event_order_field_values_definition_idx
  on public.event_order_field_values (field_definition_id);

comment on table public.event_order_field_values is
  'Ответы бумажной анкеты покупателя бота. Вопросы общие с event_participant_field_values.';
