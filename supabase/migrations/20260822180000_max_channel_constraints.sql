-- MAX как канал: снимаем ограничения, которые не пускают его писать.
--
-- План объединения говорит, что схема готова к двум каналам с самого начала, и это верно
-- ровно наполовину. `messenger_identities.channel` действительно разрешает `'max'` — а
-- четыре другие таблицы разрешают только Telegram, и любая запись MAX упёрлась бы в них.
--
-- Найдено не по README, а перебором чек-констрейнтов: ошибка такого рода не видна ни типам,
-- ни тестам на поддельном соединении. Она проявляется на первом же боевом диалоге в MAX,
-- когда Postgres отвергает вставку целиком.
--
-- Ничего, кроме перечня допустимых значений, здесь не меняется. Строк в этих таблицах со
-- значением `'max'` пока нет и быть не может — канал ещё не подключён.

-- Диалог. Состояние сценария у MAX то же самое, что у Telegram: без этого значения бот в
-- MAX не сможет даже начать разговор.
alter table public.scenario_sessions
  drop constraint scenario_sessions_channel_check;

alter table public.scenario_sessions
  add constraint scenario_sessions_channel_check check (
    channel in ('telegram', 'max', 'web')
  );

-- Согласие с офертой. Канал у акцепта фиксируется намеренно: по нему видно, где именно
-- человек нажал кнопку. Без `'max'` покупка в MAX останавливалась бы на оферте — то есть
-- ровно там, где терять её дороже всего.
alter table public.offer_acceptances
  drop constraint offer_acceptances_channel_check;

alter table public.offer_acceptances
  add constraint offer_acceptances_channel_check check (
    channel in ('telegram', 'max', 'admin', 'web')
  );

-- Телефон, которым человек поделился в MAX.
--
-- План предлагал импортировать такие телефоны как `'import'`, и это было бы неправдой:
-- `'import'` значит «приехал таблицей», а здесь человек нажал кнопку в мессенджере. Разница
-- существенная — на источнике телефона держится ответ на вопрос, есть ли у нас основание
-- звонить. Поэтому отдельное значение, а не подгонка под существующее.
alter table public.user_contacts
  drop constraint user_contacts_source_check;

alter table public.user_contacts
  add constraint user_contacts_source_check check (
    source in ('telegram_contact', 'max_contact', 'import', 'admin')
  );

-- Доставка уведомлений. Очередь с ретраями и журнал доставок общие на оба канала — иначе у
-- MAX появилась бы своя вторая очередь со своими граблями.
alter table public.notification_deliveries
  drop constraint notification_deliveries_channel_check;

alter table public.notification_deliveries
  add constraint notification_deliveries_channel_check check (
    recipient_channel in ('telegram', 'max')
  );

-- Дедупликация апдейтов MAX.
--
-- В старом MAX-боте за это отвечала своя таблица `webhook_events` с отпечатком события; в
-- общей схеме тем же занимается `idempotency_keys`. Своя область у канала нужна не для
-- порядка, а по существу: номера апдейтов Telegram и MAX живут в разных пространствах, и
-- при общей области апдейт MAX однажды совпал бы с уже обработанным телеграмным — и молча
-- пропал бы, потому что «уже обработано».
alter table public.idempotency_keys
  drop constraint idempotency_keys_scope_check;

alter table public.idempotency_keys
  add constraint idempotency_keys_scope_check check (
    scope in (
      'telegram_update',
      'telegram_callback',
      'max_update',
      'max_callback',
      'tbank_webhook',
      'payment_init',
      'phone_bonus',
      'wallet',
      'commission',
      'ticket_issue',
      'import',
      'broadcast_recipient',
      'scheduled_job'
    )
  );
