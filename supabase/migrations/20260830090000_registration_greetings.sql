-- Приветствие по заявке с сайта: первое сообщение человеку от аккаунта компании.
--
-- Решение владельца от 24.10.2026: как только с сайта пришла заявка, проверить номер в
-- мессенджерах по порядку — Telegram, затем MAX, WhatsApp позже — и написать в первый, где
-- человек нашёлся: «получили заявку, ждём вас». Проверка номеров и отправка от аккаунта уже
-- есть (`contact_channel_lookups` и очередь реплик); здесь только память о решении — куда
-- написали или почему не стали.
--
-- **Строка на заявку, а не на человека.** Повод написать — эта заявка на это мероприятие.
-- Человек, записавшийся в ноябре и в декабре, получит два приветствия, и это правильно.
-- Повторная заявка на ту же встречу строки не заводит вовсе: она `duplicate`, и второе
-- «получили заявку» было бы эхом.
--
-- **Решение записывается и тогда, когда писать не стали.** «Ни в одном мессенджере не
-- нашли» и «менеджер успел написать сам» — это ответы. Без строки пустая лента в карточке
-- означала бы что угодно, включая «приветствие сломалось».

create table public.registration_greetings (
  registration_id uuid primary key references public.site_registrations(id),
  contact_id uuid not null references public.outreach_contacts(id),
  event_id uuid not null references public.events(id),
  -- `pending` — ждём ответов проверки номера или утра;
  -- `queued` — реплика легла в очередь аккаунта. Дальше её судьба записана в самой реплике:
  --   отправлено, не дошло, почему — второй раз здесь это не хранится;
  -- `no_channel` — ни один из каналов человека не нашёл;
  -- `skipped` — писать не стали, причина рядом.
  status text not null default 'pending',
  channel text,
  message_id uuid references public.conversation_messages(id),
  skip_reason text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint registration_greetings_status_check check (
    status in ('pending', 'queued', 'no_channel', 'skipped')
  ),
  constraint registration_greetings_channel_check check (
    channel is null or channel in ('telegram', 'max', 'whatsapp')
  ),
  -- Ушло — значит известно, куда и какой репликой. Не ушло — ни того, ни другого нет.
  constraint registration_greetings_queued_check check (
    (status = 'queued' and channel is not null and message_id is not null)
    or (status <> 'queued' and channel is null and message_id is null)
  ),
  constraint registration_greetings_skip_check check (
    (status = 'skipped' and skip_reason is not null)
    or (status <> 'skipped' and skip_reason is null)
  ),
  constraint registration_greetings_skip_reason_check check (
    skip_reason is null or length(btrim(skip_reason)) between 1 and 500
  ),
  -- Решено — значит известно когда. Ждёт — значит ещё не решено.
  constraint registration_greetings_decided_check check (
    (status = 'pending') = (decided_at is null)
  )
);

-- Что ещё ждёт решения. Частичный: ждущих всегда единицы, а таблица растёт с каждой заявкой.
create index registration_greetings_pending_idx
  on public.registration_greetings (created_at)
  where status = 'pending';

-- Сколько приветствий канал отправил за сутки — потолок считается по нему.
create index registration_greetings_queued_idx
  on public.registration_greetings (channel, decided_at)
  where status = 'queued';

create index registration_greetings_contact_idx
  on public.registration_greetings (contact_id, created_at desc);

comment on table public.registration_greetings is
  'Приветствие по заявке с сайта: куда написали или почему не стали. Строка на заявку.';

-- Как назвать мероприятие в приветствии и каким текстом писать.
--
-- Отдельной таблицей, а не колонками `events`: приветствие правят и у опубликованного
-- мероприятия, а у опубликованного содержимое под защитой. Строки может не быть вовсе —
-- тогда текст общий из кода, а мероприятие называется «мероприятии «Название»», что
-- грамматически верно при любом названии.
create table public.event_greetings (
  event_id uuid primary key references public.events(id),
  -- Выключено — по заявкам на это мероприятие не пишем. Например, платный пикник, где
  -- первым пишет бот продажи, а не аккаунт.
  is_enabled boolean not null default true,
  -- Название в предложном падеже, под «на участие в …»: «Открытой встрече предпринимателей».
  -- Склонять автоматически ненадёжно, а ошибка в падеже в первом же сообщении — первое, что
  -- человек о нас узнаёт.
  event_phrase text,
  -- Свой текст для этого мероприятия. Пусто — общий текст из кода. У мастер-класса одного
  -- спикера, например, «программа от наших спикеров» звучала бы неправдой.
  body_template text,
  updated_by_admin_id uuid references public.admin_accounts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_greetings_phrase_check check (
    event_phrase is null or length(btrim(event_phrase)) between 1 and 250
  ),
  constraint event_greetings_template_check check (
    body_template is null or length(btrim(body_template)) between 1 and 4000
  )
);

comment on table public.event_greetings is
  'Настройки приветствия по заявке: включено ли, как назвать мероприятие, свой текст.';
