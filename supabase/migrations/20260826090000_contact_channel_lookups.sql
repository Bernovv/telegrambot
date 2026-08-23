-- Есть ли этот человек в Telegram, MAX и WhatsApp.
--
-- Полтора месяца назад тот же вопрос задавали только Telegram и только по кнопке в
-- карточке — отсюда `telegram_phone_lookups`. Решение владельца от 23.08.2026: спрашивать
-- все три мессенджера и спрашивать самим, как только человек появился в базе. Одна таблица
-- на три канала вместо трёх одинаковых: вопрос один и тот же, отличается только тот, кому
-- он задан.
--
-- **Ключ — пара «человек и канал».** Ответ мессенджера это не событие, а текущее
-- состояние: год назад Telegram у человека не было, сегодня есть. Нужен последний ответ, а
-- не их история, поэтому повторная проверка переписывает ту же строку.
--
-- **Суррогатного идентификатора нет.** Строка адресуется тем, что её и определяет. Лишний
-- ключ здесь означал бы возможность завести человеку два ответа про один мессенджер, а
-- такой пары не бывает.
--
-- **`requested_by_admin_id` теперь может быть пустым**, и это главное отличие от прежней
-- таблицы: пустой значит «спросили сами, никто не нажимал». Раньше поле было обязательным,
-- потому что без кнопки менеджера строка не появлялась вовсе.
--
-- **Про массовость.** Осторожность, записанная в `20260824090000`, никуда не делась:
-- перебор чужих номеров мессенджеры считают разведкой и отвечают сначала задержками, а
-- потом запретом писать незнакомым — на тех самых аккаунтах, через которые идёт вся
-- переписка с клиентами. Поэтому очередь разбирается медленно и с паузами, а порядок в ней
-- не просто «кто раньше встал»: просьба менеджера идёт впереди автоматических. Иначе
-- загрузка тысячи строк из CSV задвинула бы живого человека, которому звонят сегодня, на
-- три недели назад.

create table public.contact_channel_lookups (
  contact_id uuid not null references public.outreach_contacts(id),
  channel text not null,
  -- Номер, по которому спрашивали, копией: у карточки телефон могут поправить, и тогда
  -- прежний ответ относится к другому номеру. Расхождение с карточкой — признак, что
  -- сохранённый ответ протух.
  phone_e164 text not null,
  -- `queued` — ждёт своей очереди;
  -- `found` — есть, идентификатор рядом;
  -- `not_found` — мессенджер ответил «нет такого». Это ответ сразу на два разных вопроса:
  --   либо аккаунта нет, либо человек закрылся настройкой приватности. Различить нельзя —
  --   отвечают одинаково нарочно, иначе по ответам можно было бы перебирать номера;
  -- `failed` — не дозвонились до самого мессенджера: прокси, лимит, обрыв. Это про нас, а
  --   не про человека, и повторить имеет смысл.
  status text not null default 'queued',
  -- Идентификатор человека у мессенджера. Текстом — числовые типы у них разъезжаются.
  external_user_id text,
  -- Ник, если канал его отдал. Ради него половина работы и затевалась: с ником карточку
  -- узнаёт человек, а не только запрос.
  username text,
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  -- Пусто — спросили сами, как только человек появился в базе.
  requested_by_admin_id uuid references public.admin_accounts(id),
  requested_at timestamptz not null default now(),
  checked_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (contact_id, channel),
  constraint contact_channel_lookups_channel_check check (
    channel in ('telegram', 'max', 'whatsapp')
  ),
  constraint contact_channel_lookups_status_check check (
    status in ('queued', 'found', 'not_found', 'failed')
  ),
  constraint contact_channel_lookups_phone_check check (
    phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
  ),
  -- Найден — значит есть кого показать. Не найден — показывать нечего. Строка «нашли, но
  -- идентификатор пуст» означала бы кнопку «написать», ведущую в никуда.
  constraint contact_channel_lookups_found_check check (
    (status = 'found' and external_user_id is not null)
    or (status <> 'found' and external_user_id is null)
  ),
  constraint contact_channel_lookups_username_check check (
    username is null or length(btrim(username)) between 1 and 100
  ),
  constraint contact_channel_lookups_attempts_check check (attempts between 0 and 100),
  constraint contact_channel_lookups_reason_check check (
    failure_reason is null or length(failure_reason) <= 500
  )
);

-- Очередь. Просьба менеджера впереди автоматических проверок, дальше — кто раньше встал.
-- Частичный индекс: очередь коротка, а таблица со временем станет длинной.
create index contact_channel_lookups_queued_idx
  on public.contact_channel_lookups (
    channel,
    (requested_by_admin_id is not null) desc,
    next_attempt_at nulls first,
    requested_at
  )
  where status = 'queued';

-- «Кому можно написать» — вопрос к базе целиком, а не к одному человеку.
create index contact_channel_lookups_found_idx
  on public.contact_channel_lookups (channel, contact_id)
  where status = 'found';

comment on table public.contact_channel_lookups is
  'Ответ мессенджера на вопрос «есть ли у этого номера аккаунт». Строка на человека и канал.';
comment on column public.contact_channel_lookups.requested_by_admin_id is
  'Кто попросил. Пусто — проверка автоматическая, по появлению человека в базе.';

-- Прежние ответы Telegram переезжают: они получены у живого аккаунта и стоили запросов,
-- которые незачем повторять. Ник там не хранился — его заполнит следующая проверка.
insert into public.contact_channel_lookups (
  contact_id, channel, phone_e164, status, external_user_id, attempts,
  next_attempt_at, requested_by_admin_id, requested_at, checked_at, failure_reason,
  created_at, updated_at
)
select contact_id, 'telegram', phone_e164, status, telegram_user_id, attempts,
       next_attempt_at, requested_by_admin_id, requested_at, checked_at, failure_reason,
       created_at, updated_at
  from public.telegram_phone_lookups
on conflict (contact_id, channel) do nothing;

comment on table public.telegram_phone_lookups is
  'Не используется с 26.08.2026: ответы переехали в contact_channel_lookups. Оставлена ради
   истории — удалять таблицу с боевыми ответами ради опрятности не стоит.';

-- Новый человек с телефоном сам встаёт в очередь на все три канала.
--
-- Триггером, а не вызовом из кода: людей заводят пятью разными путями — панель, загрузка
-- CSV, заявка с сайта, Звонобот, входящее сообщение, — и пятая ветка, где про очередь
-- забыли, обязательно однажды появится. У базы же путь один.
create or replace function public.enqueue_contact_channel_lookups()
returns trigger
language plpgsql
as $$
begin
  if new.phone_e164 is null or new.merged_into_contact_id is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.phone_e164 is not distinct from new.phone_e164 then
    return new;
  end if;

  insert into public.contact_channel_lookups (contact_id, channel, phone_e164)
  select new.id, channel
       , new.phone_e164
    from unnest(array['telegram', 'max', 'whatsapp']) as channel
  on conflict (contact_id, channel) do update
     set phone_e164 = excluded.phone_e164,
         status = 'queued',
         external_user_id = null,
         username = null,
         attempts = 0,
         next_attempt_at = null,
         checked_at = null,
         failure_reason = null,
         -- Автоматическая перепроверка не наследует чужую срочность: тот, кто нажимал
         -- кнопку месяц назад, не просил спрашивать снова.
         requested_by_admin_id = null,
         requested_at = now(),
         updated_at = now()
   where public.contact_channel_lookups.phone_e164 is distinct from excluded.phone_e164;

  return new;
end;
$$;

create trigger outreach_contacts_enqueue_lookups
after insert or update of phone_e164 on public.outreach_contacts
for each row
execute function public.enqueue_contact_channel_lookups();

comment on function public.enqueue_contact_channel_lookups() is
  'Ставит нового человека с телефоном в очередь проверки трёх мессенджеров.';
