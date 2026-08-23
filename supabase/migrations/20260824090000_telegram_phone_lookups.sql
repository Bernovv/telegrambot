-- Поиск человека в Telegram по номеру телефона.
--
-- Задача, ради которой всё: у большинства людей в базе есть телефон и нет ника, а написать
-- первым в Telegram можно только тому, чей идентификатор мы знаем. Ни Bot API, ни какая-либо
-- другая открытая ручка по номеру никого не находит — умеет это только живой клиент, и
-- ровно этим менеджеры пользовались руками: отправить номер в любой чат, зажать его и
-- посмотреть, предложит ли Telegram написать. У нас такой клиент уже есть — аккаунт
-- компании на TDLib, — и вызов там называется `searchUserByPhoneNumber`.
--
-- **Почему таблица, а не колонки в `outreach_contacts`.** Панель вызвать TDLib не может:
-- сессия принадлежит процессу `telegram-account`, и второй экземпляр на той же сессии
-- Telegram считает вторым устройством. Значит, между кнопкой и поиском обязана быть
-- очередь, а у очереди есть состояние, которого в карточке человека быть не должно: число
-- попыток, срок аренды строки, время следующей попытки. Держать это в `outreach_contacts`
-- значит переписывать карточку человека каждый раз, когда воркер потрогал строку.
--
-- **Почему по одной строке на человека, а не журнал.** Ответ Telegram — не событие, а
-- текущее состояние: человек мог год назад не иметь Telegram, а сегодня иметь. Нужен
-- последний ответ, а не их история; повторный поиск переписывает ту же строку.
--
-- **Про массовость.** Обхода базы здесь нет и не предполагается: строка появляется только
-- когда менеджер нажал кнопку в конкретной карточке. Перебор номеров пачкой Telegram
-- считает разведкой и отвечает сначала задержками, а потом запретом писать незнакомым, —
-- и это тот самый аккаунт, на котором держится вся переписка с клиентами.

create table public.telegram_phone_lookups (
  id uuid primary key,
  -- По одному поиску на человека. Телефон в `outreach_contacts` и так уникален, так что
  -- ключ по человеку и ключ по номеру — одно и то же, а по человеку карточке читать проще.
  contact_id uuid not null unique references public.outreach_contacts(id),
  -- Номер, по которому искали, копией. У карточки телефон могут поправить, и тогда прежний
  -- ответ относится к другому номеру: сравнение с текущим — это и есть признак, что
  -- сохранённый ответ протух.
  phone_e164 text not null,
  -- `queued` — ждёт своей очереди у аккаунта;
  -- `found` — нашли, идентификатор рядом;
  -- `not_found` — Telegram ответил «нет такого». Это ответ сразу на два разных вопроса:
  --   либо у номера нет Telegram, либо человек закрылся настройкой «кто может найти меня
  --   по номеру». Различить их нельзя — Telegram отвечает одинаково нарочно, иначе по
  --   ответам можно было бы перебирать номера. В панели так и написано;
  -- `failed` — не дозвонились до самого Telegram: прокси, лимит, обрыв. Это про нас, а не
  --   про человека, и повторить имеет смысл.
  status text not null default 'queued',
  -- Идентификатор пользователя у Telegram. Текстом — по той же причине, что и
  -- `conversations.external_chat_id`: числовые типы у мессенджеров разъезжаются.
  telegram_user_id text,
  attempts integer not null default 0,
  -- Раньше этого времени не пробуем. Он же срок аренды строки процессом аккаунта.
  next_attempt_at timestamptz,
  -- Кто попросил и когда. Поиск по чужому номеру — действие, за которое кто-то отвечает,
  -- и через полгода на вопрос «откуда у нас его Telegram» должен быть ответ.
  requested_by_admin_id uuid not null references public.admin_accounts(id),
  requested_at timestamptz not null default now(),
  checked_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint telegram_phone_lookups_status_check check (
    status in ('queued', 'found', 'not_found', 'failed')
  ),
  constraint telegram_phone_lookups_phone_check check (
    phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
  ),
  -- Найден — значит есть кого показать. Не найден — значит показывать нечего. Строка
  -- «нашли, но идентификатор пуст» означала бы кнопку «написать», ведущую в никуда.
  constraint telegram_phone_lookups_found_check check (
    (status = 'found' and telegram_user_id is not null)
    or (status <> 'found' and telegram_user_id is null)
  ),
  constraint telegram_phone_lookups_user_id_check check (
    telegram_user_id is null or telegram_user_id ~ '^[0-9]{1,20}$'
  ),
  constraint telegram_phone_lookups_attempts_check check (attempts between 0 and 100),
  constraint telegram_phone_lookups_reason_check check (
    failure_reason is null or length(failure_reason) <= 500
  )
);

-- Очередь: самые старые первыми. Частичный индекс — потому что очередь всегда короткая,
-- а таблица со временем станет длинной.
create index telegram_phone_lookups_queued_idx
  on public.telegram_phone_lookups (next_attempt_at nulls first, requested_at)
  where status = 'queued';

comment on table public.telegram_phone_lookups is
  'Ответ Telegram на вопрос «есть ли у этого номера аккаунт». Одна строка на человека.';
comment on column public.telegram_phone_lookups.status is
  'queued | found | not_found (нет Telegram либо закрыт настройками — неразличимо) | failed';
comment on column public.telegram_phone_lookups.phone_e164 is
  'Номер, по которому искали. Разошёлся с телефоном карточки — ответ устарел.';
