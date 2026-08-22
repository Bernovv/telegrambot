-- Скачивание вложений: попытки и когда пробовать снова.
--
-- Вложение приходит идентификатором файла у мессенджера, а не самим файлом, и скачивается
-- отдельным проходом — приём вебхука не имеет права ждать чужую сеть. Дальше начинается то,
-- ради чего эта миграция: чужая сеть моргает.
--
-- Без счётчика попыток одна сетевая заминка означала бы `failed` навсегда: очередь берёт
-- только `pending`, и вернуть строку обратно было бы некому. Без времени следующей попытки
-- проход крутил бы одну и ту же неудачу каждые полминуты, пока не кончится терпение у
-- Telegram — а он на такое отвечает временной блокировкой всего бота.
--
-- Поэтому `failed` теперь означает не «не получилось сейчас», а «пробовали столько раз,
-- сколько договорились, и хватит». Это состояние для человека: по нему видно, какие файлы
-- надо забирать руками, пока они ещё живы у мессенджера.

alter table public.conversation_attachments
  add column download_attempts integer not null default 0;

alter table public.conversation_attachments
  add column next_attempt_at timestamptz;

alter table public.conversation_attachments
  add constraint conversation_attachments_attempts_check check (
    download_attempts between 0 and 100
  );

comment on column public.conversation_attachments.download_attempts is
  'Сколько раз пробовали скачать. Упирается в потолок — строка становится failed насовсем.';
comment on column public.conversation_attachments.next_attempt_at is
  'Раньше этого времени не пробуем. Пусто — можно сейчас.';

-- Очередь скачивания с учётом отложенных повторов. Старый индекс по `created_at` для этого
-- уже не годится: отбор идёт по времени следующей попытки.
drop index if exists conversation_attachments_pending_idx;

create index conversation_attachments_pending_idx
  on public.conversation_attachments (next_attempt_at nulls first, created_at)
  where download_status = 'pending';
