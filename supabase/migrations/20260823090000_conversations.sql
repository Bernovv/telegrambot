-- Ядро переписки: диалоги и сообщения, общие на все каналы.
--
-- Сегодня переписки у нас нет вообще. Входящий текст проходит через сценарий и исчезает:
-- если человек написал «а с ребёнком можно?», а сценарий такого шага не ждал, — от вопроса
-- не остаётся ни строки. Менеджер об этом не узнает никогда.
--
-- Таблицы две, и делятся они не по каналам, а по смыслу: диалог — это ветка разговора с
-- человеком в одном месте, сообщение — реплика в ней. Канал у диалога есть, но он колонка,
-- а не отдельная таблица: лента в карточке обязана показывать Telegram и MAX одной лентой,
-- и двумя таблицами она собиралась бы двумя запросами с ручным слиянием по времени.
--
-- Почему сообщения только добавляются. Переписка — такой же первичный документ, как касание
-- в ленте и согласие с офертой: по ней через полгода решают, что человеку обещали. Правка
-- сообщения клиентом — это новая строка со ссылкой на исходную, а не переписанная старая;
-- в чате человек видит одно, а у нас остаётся и то, что он написал сначала.
--
-- Ни один канал этой миграцией не подключается: она только даёт куда складывать. Приём
-- входящего, отправка от менеджера и окно диалога — следующие шаги фазы 1 и фаз 2–4.

create table public.conversations (
  id uuid primary key,
  -- Карточка человека в CRM. Пусто — человека опознать нечем: в Telegram у него нет ни
  -- ника, ни телефона, а карточка без единого опознавателя не заводится (см. ограничение
  -- outreach_contacts_identity_check). Диалог при этом существует и пишется: сообщения
  -- терять нельзя даже тогда, когда неизвестно, чьи они. Как только ник или телефон
  -- появятся, диалог привяжется к карточке, и вся его история придёт вместе с ним.
  contact_id uuid references public.outreach_contacts(id),
  -- Личность в боте, если человек бота открывал. У разговора через аккаунт компании её не
  -- будет: тот, кому мы пишем первыми, в боте не заводился.
  messenger_identity_id uuid references public.messenger_identities(id),
  -- Мессенджер. Словарь тот же, что у домена и у ленты касаний, — двух правд о том, что
  -- такое канал, в базе быть не должно.
  channel text not null,
  -- Чьими руками идёт разговор: бот или аккаунт компании. Различать обязательно, и это не
  -- бухгалтерия: бот и аккаунт — два разных собеседника у одного и того же человека, и
  -- лента, где они слиты, читается как разговор с раздвоением личности. Фаза 2 добавит
  -- Telegram-аккаунт, и он придёт в эту же таблицу с transport = 'account'.
  transport text not null default 'bot',
  -- Идентификатор чата у мессенджера. У бота совпадает с идентификатором человека, у
  -- аккаунта — свой. Хранится текстом: у Telegram это число, у MAX тоже, но собственного
  -- смысла для нас в нём нет, а числовые типы у мессенджеров разъезжаются.
  external_chat_id text not null,
  -- `open` — разговор идёт, `closed` — закрыт менеджером. Новое входящее открывает заново:
  -- человек, написавший после закрытия, начал новый разговор, а не воскресил старый.
  status text not null default 'open',
  -- Кто взял диалог в работу. Двое менеджеров не должны отвечать одному человеку
  -- одновременно; колонка — то, на чём это правило будет стоять в фазе 4.
  assigned_admin_id uuid references public.admin_accounts(id),
  assigned_at timestamptz,
  -- Время последней реплики в любую сторону и последней входящей отдельно. Вторая нужна
  -- ровно для одного вопроса, который менеджер задаёт себе каждое утро: кому не ответили.
  last_message_at timestamptz,
  last_inbound_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversations_channel_check check (channel in ('telegram', 'max')),
  constraint conversations_transport_check check (transport in ('bot', 'account')),
  constraint conversations_status_check check (status in ('open', 'closed')),
  constraint conversations_external_chat_check check (
    length(btrim(external_chat_id)) between 1 and 200
  ),
  -- Ответственный и время назначения появляются и исчезают вместе: «взял в работу, но
  -- неизвестно когда» — это состояние, из которого потом не собрать, кто сидел на диалоге.
  constraint conversations_assignment_check check (
    (assigned_admin_id is null and assigned_at is null)
    or (assigned_admin_id is not null and assigned_at is not null)
  )
);

-- Один разговор на человека в канале. Ключ включает transport: бот и аккаунт компании — это
-- два разных чата с одним и тем же человеком, и без transport второй перезаписал бы первый.
create unique index conversations_channel_chat_unique
  on public.conversations (channel, transport, external_chat_id);

-- Лента в карточке: все диалоги человека, свежие сверху.
create index conversations_contact_idx
  on public.conversations (contact_id, last_message_at desc nulls last)
  where contact_id is not null;

-- Общий список диалогов в панели.
create index conversations_status_idx
  on public.conversations (status, last_message_at desc nulls last);

create index conversations_assigned_idx
  on public.conversations (assigned_admin_id, last_message_at desc nulls last)
  where assigned_admin_id is not null;

-- Кого ещё не опознали. Список короткий и его разбирают руками — отсюда частичный индекс.
create index conversations_unlinked_idx
  on public.conversations (last_inbound_at desc)
  where contact_id is null;

comment on table public.conversations is
  'Ветка разговора с человеком в одном мессенджере. Бот и аккаунт компании — разные ветки.';
comment on column public.conversations.contact_id is
  'Карточка в CRM. Пусто — опознать нечем; сообщения всё равно пишутся и привяжутся позже.';

create table public.conversation_messages (
  id uuid primary key,
  conversation_id uuid not null references public.conversations(id),
  -- `inbound` — от человека, `outbound` — от нас.
  direction text not null,
  -- Кто написал. `client` — человек, `manager` — живой менеджер из панели, `bot` — сценарий.
  -- Разделение менеджера и бота важнее, чем кажется: в ленте это разница между «мы ответили»
  -- и «ему ответила машина», и по ней же считается, сколько разговоров вообще велось руками.
  author_kind text not null,
  -- Кто именно из менеджеров. Ради этой колонки и живёт аккаунт компании: писать все будут
  -- с одного имени, а знать, кто ответил, обязана CRM.
  author_admin_id uuid references public.admin_accounts(id),
  -- Текст. Пусто — сообщение состояло из одного вложения: голосовое, фото, кружок.
  body text,
  -- Идентификатор сообщения у мессенджера. По нему ловится повтор вебхука и по нему же
  -- находится исходное сообщение, когда человек его правит.
  external_message_id text,
  -- Правка: ссылка на строку, которую человек переписал. Сама строка остаётся нетронутой.
  edits_message_id uuid references public.conversation_messages(id),
  -- Судьба исходящего. У входящего всегда `received`: оно уже пришло, доставлять нечего.
  delivery_status text not null default 'received',
  failure_reason text,
  -- Обновление целиком, как его прислал мессенджер. Та же причина, что у вебхука Звонобота:
  -- разобрать пришедшее мы умеем не всё и не сразу, а сохранить обязаны сразу и целиком.
  -- Разбор — второй проход, и он читает эту же строку, ничего не потеряв.
  payload jsonb not null default '{}'::jsonb,
  -- Когда сообщение случилось у мессенджера и когда мы его записали. Расходятся они на
  -- задержку доставки, и сортировать ленту надо по первому, а искать потери — по разнице.
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint conversation_messages_direction_check check (
    direction in ('inbound', 'outbound')
  ),
  constraint conversation_messages_author_kind_check check (
    author_kind in ('client', 'manager', 'bot')
  ),
  -- Входящее пишет только человек, исходящее — только мы. Обратное означало бы, что в
  -- ленте кто-то говорит не своим голосом, и в панели это уже не починить.
  constraint conversation_messages_direction_author_check check (
    (direction = 'inbound' and author_kind = 'client')
    or (direction = 'outbound' and author_kind in ('manager', 'bot'))
  ),
  -- Менеджер обязан быть назван, бот и клиент — обязаны не быть.
  constraint conversation_messages_author_admin_check check (
    (author_kind = 'manager' and author_admin_id is not null)
    or (author_kind <> 'manager' and author_admin_id is null)
  ),
  constraint conversation_messages_delivery_status_check check (
    delivery_status in ('received', 'queued', 'sent', 'delivered', 'failed')
  ),
  -- `received` — это про входящее и только про него.
  constraint conversation_messages_direction_delivery_check check (
    (direction = 'inbound' and delivery_status = 'received')
    or (direction = 'outbound' and delivery_status <> 'received')
  ),
  constraint conversation_messages_failure_check check (
    (delivery_status = 'failed' and failure_reason is not null)
    or (delivery_status <> 'failed' and failure_reason is null)
  ),
  constraint conversation_messages_body_check check (
    body is null or length(body) <= 20000
  ),
  constraint conversation_messages_external_id_check check (
    external_message_id is null or length(btrim(external_message_id)) between 1 and 200
  ),
  constraint conversation_messages_failure_reason_check check (
    failure_reason is null or length(failure_reason) <= 500
  )
);

-- Лента диалога: свежие сверху, порядок доопределён по id — время у мессенджера идёт
-- секундами, и два сообщения подряд сплошь и рядом приходят одной секундой.
create index conversation_messages_conversation_idx
  on public.conversation_messages (conversation_id, occurred_at desc, id desc);

-- Повтор вебхука не должен раздваивать реплику. Правки из индекса исключены: у правки тот же
-- идентификатор сообщения, что у оригинала, и общий индекс запретил бы саму правку.
create unique index conversation_messages_external_unique
  on public.conversation_messages (conversation_id, external_message_id)
  where external_message_id is not null and edits_message_id is null;

-- Повтор правки ловится по времени правки: мессенджер сообщает его отдельным полем, и у
-- второй правки оно другое.
create unique index conversation_messages_edit_unique
  on public.conversation_messages (conversation_id, external_message_id, occurred_at)
  where external_message_id is not null and edits_message_id is not null;

-- Что не дошло. Список, ради которого колонку и завели.
create index conversation_messages_failed_idx
  on public.conversation_messages (occurred_at desc)
  where delivery_status = 'failed';

comment on table public.conversation_messages is
  'Реплики в диалоге, только на добавление. Правка клиента — новая строка со ссылкой на старую.';
comment on column public.conversation_messages.payload is
  'Обновление целиком, как прислал мессенджер. Неизменяемо: спор о том, что написали, решается им.';

create table public.conversation_attachments (
  id uuid primary key,
  message_id uuid not null references public.conversation_messages(id),
  -- Что это. `other` — тип, которого мы не знаем: мессенджеры добавляют их и не спрашивают.
  kind text not null,
  file_name text,
  mime_type text,
  size_bytes bigint,
  -- Путь к файлу на нашем диске. Пусто, пока файл не скачан.
  --
  -- Файлы храним у себя, а не ссылками на мессенджер, и это решение из плана: Telegram
  -- отдаёт файл по идентификатору не вечно, а MAX — тем более, и через год половина
  -- вложений превратилась бы в битые ссылки. Голосовые и фото — сотни килобайт; при нашем
  -- потоке это единицы гигабайт в год, диск сервера это выдержит.
  storage_path text,
  -- Идентификатор файла у мессенджера: по нему он и скачивается.
  external_file_id text,
  -- Контрольная сумма скачанного. Нужна, чтобы не хранить одно и то же по десять раз и
  -- чтобы было чем доказать, что файл не подменён.
  sha256 text,
  -- Скачивание — отдельный проход, как разбор у Звонобота: приём вебхука не имеет права
  -- ждать сеть чужого мессенджера, а `200` ему нужен сразу.
  download_status text not null default 'pending',
  failure_reason text,
  created_at timestamptz not null default now(),
  downloaded_at timestamptz,
  constraint conversation_attachments_kind_check check (
    kind in ('photo', 'video', 'voice', 'audio', 'document', 'sticker', 'contact', 'location', 'other')
  ),
  constraint conversation_attachments_download_status_check check (
    download_status in ('pending', 'stored', 'failed', 'skipped')
  ),
  -- Скачанное обязано лежать где-то и сообщать когда; нескачанное — молчать про то и другое.
  constraint conversation_attachments_stored_check check (
    (download_status = 'stored' and storage_path is not null and downloaded_at is not null)
    or (download_status <> 'stored' and storage_path is null and downloaded_at is null)
  ),
  constraint conversation_attachments_failure_check check (
    (download_status = 'failed' and failure_reason is not null)
    or (download_status <> 'failed' and failure_reason is null)
  ),
  constraint conversation_attachments_size_check check (
    size_bytes is null or size_bytes between 0 and 2147483648
  ),
  constraint conversation_attachments_sha_check check (
    sha256 is null or sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint conversation_attachments_file_name_check check (
    file_name is null or length(file_name) <= 300
  ),
  constraint conversation_attachments_mime_check check (
    mime_type is null or length(mime_type) <= 200
  ),
  constraint conversation_attachments_external_id_check check (
    external_file_id is null or length(btrim(external_file_id)) between 1 and 400
  ),
  constraint conversation_attachments_storage_path_check check (
    storage_path is null or length(storage_path) between 1 and 500
  ),
  constraint conversation_attachments_failure_reason_check check (
    failure_reason is null or length(failure_reason) <= 500
  )
);

create index conversation_attachments_message_idx
  on public.conversation_attachments (message_id);

-- Очередь скачивания: проход берёт самые старые нескачанные.
create index conversation_attachments_pending_idx
  on public.conversation_attachments (created_at)
  where download_status = 'pending';

comment on table public.conversation_attachments is
  'Вложения к репликам. Файл хранится у нас: ссылка на мессенджер через год мертва.';

-- Сказанное не переписывают.
--
-- Защищено то, что пришло снаружи или ушло наружу: направление, автор, текст, вложенность,
-- идентификатор у мессенджера, время и тело обновления. Меняться разрешено только судьбе
-- отправки: `queued` → `sent` → `delivered` или `failed`. Полный запрет на update сделал бы
-- журнал доставки невозможным, а он и есть смысл колонки.
--
-- Удаление запрещено целиком и для всех — включая нас: «удалите эту переписку» решается
-- закрытием диалога, а не забыванием того, что было сказано.
create function public.prevent_conversation_message_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'conversation messages are append-only';
  end if;
  if new.conversation_id is distinct from old.conversation_id
     or new.direction is distinct from old.direction
     or new.author_kind is distinct from old.author_kind
     or new.author_admin_id is distinct from old.author_admin_id
     or new.body is distinct from old.body
     or new.external_message_id is distinct from old.external_message_id
     or new.edits_message_id is distinct from old.edits_message_id
     or new.payload is distinct from old.payload
     or new.occurred_at is distinct from old.occurred_at
     or new.created_at is distinct from old.created_at then
    raise exception 'conversation message content is immutable';
  end if;
  return new;
end;
$$;

create trigger conversation_messages_immutable
before update or delete on public.conversation_messages
for each row execute function public.prevent_conversation_message_mutation();

-- У вложения та же логика: чем оно было — неизменно, чем кончилось скачивание — меняется.
create function public.prevent_conversation_attachment_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'conversation attachments are append-only';
  end if;
  if new.message_id is distinct from old.message_id
     or new.kind is distinct from old.kind
     or new.external_file_id is distinct from old.external_file_id
     or new.created_at is distinct from old.created_at then
    raise exception 'conversation attachment origin is immutable';
  end if;
  return new;
end;
$$;

create trigger conversation_attachments_immutable
before update or delete on public.conversation_attachments
for each row execute function public.prevent_conversation_attachment_mutation();

-- Право видеть и вести переписку.
--
-- Отдельное от `outreach.read` / `outreach.write` намеренно: переписка — это содержание
-- личных разговоров, а не карточка со стадией и телефоном, и день, когда её захочется
-- открыть не всем, наступает раньше, чем кажется. Пока обе роли получают оба права, и
-- разница ничего не стоит; разделить потом — строка в таблице, а не миграция с разбором,
-- кто что уже видел.
insert into public.admin_permissions (code, description) values
  ('conversations.read', 'Read customer conversations across messengers'),
  ('conversations.write', 'Reply to customers and manage conversation assignment')
on conflict (code) do nothing;

insert into public.admin_role_permissions (role_code, permission_code) values
  ('sales_manager', 'conversations.read'),
  ('sales_manager', 'conversations.write'),
  ('super_admin', 'conversations.read'),
  ('super_admin', 'conversations.write')
on conflict (role_code, permission_code) do nothing;

-- Учётная запись, от имени которой в ленту касаний пишется разговор, который вёл не человек.
-- Рядом с «Регистрацией с сайта» и «Звоноботом»: у каждого автоматического источника своё
-- имя, иначе в карточке они сливаются в одно безымянное «система». Запись `suspended` —
-- войти под ней в панель нельзя.
insert into public.admin_accounts (id, auth_subject, display_name, status)
values (
  '00000000-0000-4000-8000-000000000004',
  'system:messenger',
  'Бот',
  'suspended'
)
on conflict (id) do nothing;
