-- Рассылка от рабочего аккаунта Telegram: текстом и кружочками.
--
-- Рассылка от бота у нас есть давно, но у неё два предела, которые аккаунт снимает. Бот
-- пишет только тем, кто его открывал, — а участники с сайта бота не открывали никогда. И
-- бот не умеет кружок так, как его записывает человек: кружок — это видео с телефона, а не
-- файл из панели.
--
-- Поэтому содержимое рассылки не набирается в панели, а **берётся из «Избранного»
-- аккаунта** (решение владельца от 19.11.2026). Кружок записывают в Telegram с телефона,
-- где открыт рабочий аккаунт, и кидают в «Избранное»; процесс `tg-account` видит его там и
-- показывает панели, а рассылка копирует выбранное как есть — без пометки «переслано», в
-- родном качестве, с тем же оформлением текста.
--
-- Таблиц четыре:
--
-- - `account_saved_messages` — что сейчас лежит в «Избранном». Снимок, который обновляет
--   процесс аккаунта: у панели своей сессии Telegram нет и не будет.
-- - `account_broadcasts` — сама рассылка: кто запустил, по какому мероприятию, что с ней.
-- - `account_broadcast_parts` — из каких сообщений «Избранного» она состоит и в каком
--   порядке (кружок, потом текст).
-- - `account_broadcast_recipients` — кому. Список снимается в момент запуска и дальше не
--   меняется: человек, записавшийся через час после запуска, рассылку не получает, а
--   история показывает ровно тех, кому её отправляли.

create table public.account_saved_messages (
  id uuid primary key,
  channel text not null default 'telegram',
  -- Номер сообщения у TDLib. Серверный, а значит постоянный: по нему рассылка и копирует.
  external_message_id text not null,
  -- Что это. `other` — то, что копировать можно, но описать в панели нечем.
  kind text not null,
  -- Текст сообщения или подпись к медиа.
  body text,
  -- Длительность кружка, голосового, видео — в секундах.
  duration_seconds integer,
  -- Размытая превьюшка, которую Telegram кладёт прямо в сообщение: несколько сотен байт
  -- JPEG в base64. Её хватает, чтобы узнать свой кружок в списке, не качая видео.
  minithumbnail_base64 text,
  -- Файл у TDLib — число внутри сессии. Нужен только самому процессу аккаунта, чтобы
  -- скачать копию к нам.
  external_file_id text,
  -- Наша копия файла — в той же папке, что вложения переписки. Одна на сообщение: у каждого
  -- получателя рассылки в ленте лежит ссылка на неё, а не своя копия того же кружка.
  storage_path text,
  file_name text,
  mime_type text,
  size_bytes bigint,
  sha256 text,
  -- Скачивание — отдельный шаг, как у вложений переписки.
  file_status text not null default 'none',
  file_attempts integer not null default 0,
  -- Когда сообщение положили в «Избранное» и когда мы его последний раз там видели.
  sent_at timestamptz not null,
  synced_at timestamptz not null default now(),
  -- Сообщение из «Избранного» удалили. Строка остаётся: на неё ссылаются рассылки.
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint account_saved_messages_channel_check check (channel in ('telegram')),
  constraint account_saved_messages_kind_check check (
    kind in ('text', 'video_note', 'photo', 'video', 'voice', 'audio', 'document', 'animation', 'other')
  ),
  constraint account_saved_messages_external_id_check check (
    length(btrim(external_message_id)) between 1 and 40
  ),
  constraint account_saved_messages_body_check check (body is null or length(body) <= 5000),
  constraint account_saved_messages_duration_check check (
    duration_seconds is null or duration_seconds between 0 and 86400
  ),
  constraint account_saved_messages_minithumbnail_check check (
    minithumbnail_base64 is null or length(minithumbnail_base64) <= 20000
  ),
  constraint account_saved_messages_file_status_check check (
    file_status in ('none', 'pending', 'stored', 'failed')
  ),
  -- Лежит у нас — значит известно где; не лежит — пути нет.
  constraint account_saved_messages_stored_check check (
    (file_status = 'stored' and storage_path is not null and sha256 is not null)
    or (file_status <> 'stored' and storage_path is null)
  ),
  constraint account_saved_messages_file_attempts_check check (file_attempts between 0 and 100),
  constraint account_saved_messages_sha_check check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  constraint account_saved_messages_size_check check (
    size_bytes is null or size_bytes between 0 and 2147483648
  ),
  constraint account_saved_messages_file_name_check check (
    file_name is null or length(file_name) <= 300
  ),
  constraint account_saved_messages_mime_check check (mime_type is null or length(mime_type) <= 200),
  constraint account_saved_messages_storage_path_check check (
    storage_path is null or length(storage_path) between 1 and 500
  ),
  constraint account_saved_messages_external_file_check check (
    external_file_id is null or length(btrim(external_file_id)) between 1 and 40
  )
);

create unique index account_saved_messages_external_unique
  on public.account_saved_messages (channel, external_message_id);

-- Список в панели: свежие сверху, удалённые не показываем.
create index account_saved_messages_recent_idx
  on public.account_saved_messages (channel, sent_at desc)
  where deleted_at is null;

create index account_saved_messages_file_pending_idx
  on public.account_saved_messages (created_at)
  where file_status = 'pending';

comment on table public.account_saved_messages is
  'Что лежит в «Избранном» рабочего аккаунта. Отсюда рассылка берёт содержимое и копирует его как есть.';

create table public.account_broadcasts (
  id uuid primary key,
  channel text not null default 'telegram',
  -- Мероприятие, участникам которого пишем. У пробной рассылки его нет: она идёт одному
  -- человеку, которого назвали в панели.
  target_event_id uuid references public.events(id),
  is_test boolean not null default false,
  -- `sending` — идёт; `completed` — каждому получателю либо отправили, либо записали, почему
  -- нет; `cancelled` — остановили (руками или сама, когда отправлять стало нечего).
  status text not null default 'sending',
  created_by_admin_id uuid not null references public.admin_accounts(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by_admin_id uuid references public.admin_accounts(id),
  -- Почему остановлена. Остановить может и сам отправитель: например, сообщение удалили из
  -- «Избранного», и копировать стало нечего.
  stop_reason text,
  -- Telegram попросил подождать или ограничил аккаунт. Отправка встаёт целиком, а не только
  -- у этого получателя: лимит у аккаунта общий.
  paused_until timestamptz,
  pause_reason text,
  updated_at timestamptz not null default now(),
  constraint account_broadcasts_channel_check check (channel in ('telegram')),
  constraint account_broadcasts_status_check check (
    status in ('sending', 'completed', 'cancelled')
  ),
  -- Боевая рассылка всегда про мероприятие: «всем подряд» от живого имени не пишем.
  constraint account_broadcasts_target_check check (is_test or target_event_id is not null),
  constraint account_broadcasts_lifecycle_check check (
    (status = 'sending' and completed_at is null and cancelled_at is null)
    or (status = 'completed' and completed_at is not null and cancelled_at is null)
    or (status = 'cancelled' and cancelled_at is not null and stop_reason is not null)
  ),
  constraint account_broadcasts_stop_reason_check check (
    stop_reason is null or length(btrim(stop_reason)) between 1 and 500
  ),
  constraint account_broadcasts_pause_check check (
    (paused_until is null and pause_reason is null)
    or (paused_until is not null and length(btrim(pause_reason)) between 1 and 500)
  )
);

create index account_broadcasts_active_idx
  on public.account_broadcasts (channel, created_at)
  where status = 'sending';

create index account_broadcasts_created_idx
  on public.account_broadcasts (created_at desc);

comment on table public.account_broadcasts is
  'Рассылка от рабочего аккаунта: копия сообщений из «Избранного» участникам мероприятия.';
comment on column public.account_broadcasts.paused_until is
  'Telegram попросил подождать (FLOOD_WAIT) или ограничил аккаунт. До этого времени не шлём ничего.';

create table public.account_broadcast_parts (
  broadcast_id uuid not null references public.account_broadcasts(id),
  position integer not null,
  saved_message_id uuid not null references public.account_saved_messages(id),
  primary key (broadcast_id, position),
  constraint account_broadcast_parts_position_check check (position between 1 and 10)
);

create unique index account_broadcast_parts_message_unique
  on public.account_broadcast_parts (broadcast_id, saved_message_id);

comment on table public.account_broadcast_parts is
  'Сообщения «Избранного», из которых состоит рассылка, по порядку.';

create table public.account_broadcast_recipients (
  id uuid primary key,
  broadcast_id uuid not null references public.account_broadcasts(id),
  contact_id uuid references public.outreach_contacts(id),
  -- Ветка переписки аккаунта с человеком. Рассылка пишет только туда, где ветка уже есть:
  -- её заводит проверка номера или первое сообщение самого человека.
  conversation_id uuid not null references public.conversations(id),
  external_chat_id text not null,
  display_name text,
  -- `pending` — ждёт очереди; `sending` — взят отправителем, срок аренды в `next_attempt_at`;
  -- `sent`, `failed` — судьба; `cancelled` — рассылку остановили раньше.
  status text not null default 'pending',
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  failure_reason text,
  -- Реплика в ленте переписки: там рассылку и видно в карточке человека.
  message_id uuid references public.conversation_messages(id),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_broadcast_recipients_status_check check (
    status in ('pending', 'sending', 'sent', 'failed', 'cancelled')
  ),
  constraint account_broadcast_recipients_attempts_check check (attempts between 0 and 100),
  constraint account_broadcast_recipients_sent_check check (
    (status = 'sent' and sent_at is not null)
    or (status <> 'sent' and sent_at is null)
  ),
  constraint account_broadcast_recipients_failure_check check (
    (status = 'failed' and failure_reason is not null)
    or status <> 'failed'
  ),
  constraint account_broadcast_recipients_failure_reason_check check (
    failure_reason is null or length(failure_reason) <= 500
  ),
  constraint account_broadcast_recipients_chat_check check (
    length(btrim(external_chat_id)) between 1 and 200
  ),
  constraint account_broadcast_recipients_name_check check (
    display_name is null or length(display_name) <= 200
  )
);

-- Одному человеку одна копия: двух веток у аккаунта с одним чатом не бывает, а двух
-- строк на один чат — тем более.
create unique index account_broadcast_recipients_chat_unique
  on public.account_broadcast_recipients (broadcast_id, external_chat_id);

-- Очередь отправителя.
create index account_broadcast_recipients_queue_idx
  on public.account_broadcast_recipients (broadcast_id, next_attempt_at nulls first, created_at)
  where status in ('pending', 'sending');

-- «Уже получал эти сообщения» — проверка при подсчёте и при запуске следующей рассылки.
create index account_broadcast_recipients_conversation_idx
  on public.account_broadcast_recipients (conversation_id);

-- Суточный потолок: сколько ушло за последние сутки.
create index account_broadcast_recipients_sent_idx
  on public.account_broadcast_recipients (sent_at)
  where status = 'sent';

comment on table public.account_broadcast_recipients is
  'Получатели рассылки аккаунта, снятые в момент запуска, и судьба каждой копии.';
