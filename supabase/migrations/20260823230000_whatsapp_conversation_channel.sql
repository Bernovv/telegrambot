-- WhatsApp как канал переписки — и только переписки.
--
-- Решение от 23.08.2026, фаза 3в плана: в WhatsApp разговаривает аккаунт компании, как в
-- Telegram и MAX. Отказ от 21.08 держался на двух доводах, и оба для нашей аудитории
-- неверны — подробности в шапке плана.
--
-- Меняется ровно одна проверка. Это не совпадение и не экономия: словарь каналов в базе
-- намеренно не один. `outreach_activities` знает `'whatsapp'` с июля — там перечислены
-- способы коснуться человека, и звонок с телефоном стоят в том же ряду. А `orders`,
-- `scenario_sessions`, `offer_acceptances`, `notification_deliveries` перечисляют места,
-- где можно **продать билет**, и WhatsApp туда не входит: оплата, QR и напоминания живут в
-- ботах, у аккаунта их нет и не будет. Дописать значение и туда значило бы завести
-- возможность заказа в WhatsApp — состояние, которого не бывает, но которое пришлось бы
-- обрабатывать везде.
--
-- Та же граница проведена в коде: `MessengerChannel` остаётся двухканальным, а переписка
-- получает свой `ConversationChannel`.
--
-- Очереди ответов и вложений своей проверки канала не имеют — они берут его из диалога,
-- поэтому здесь их нет.

alter table public.conversations
  drop constraint conversations_channel_check;

alter table public.conversations
  add constraint conversations_channel_check check (
    channel in ('telegram', 'max', 'whatsapp')
  );

comment on column public.conversations.channel is
  'Мессенджер разговора: telegram, max, whatsapp. Продажа билетов идёт только в первых двух.';
