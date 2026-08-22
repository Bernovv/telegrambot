-- Человек написал — у менеджера появилась задача ответить.
--
-- Переписка есть, но узнать о новом сообщении можно только открыв карточку. Ответ клиента
-- может пролежать сутки просто потому, что никто не заглянул. Задача — тот сигнал, который
-- у менеджера уже перед глазами: доска задач открыта у него всегда.
--
-- **Почему не правилом кампании.** Автозадачи живут в `outreach_task_rules`, и это хорошая
-- механика, но правило там принадлежит воронке (`campaign_id not null`). Разговор воронке не
-- принадлежит: человек, написавший боту, может не состоять ни в одной кампании, и правило,
-- привязанное к «Бизнес-среде», до него не дотянется. Поэтому у переписки свои настройки —
-- одна строка на весь приёмник, как у Звонобота.
--
-- **Почему задача, а не уведомление.** Уведомление можно пропустить, и оно ничего не помнит.
-- Задача видна в списке, у неё есть срок и ответственный, и она закрывается сама, когда
-- менеджер ответил. Это и есть разница между «мигнуло» и «не потеряется».

alter table public.outreach_tasks
  add column if not exists conversation_id uuid references public.conversations(id);

comment on column public.outreach_tasks.conversation_id is
  'Диалог, из-за которого появилась задача. Пусто — задача не про переписку.';

-- Одна открытая задача на диалог. Человек, написавший пять сообщений подряд, — это один
-- повод ответить, а не пять; без этого индекса доска менеджера превратилась бы в ленту
-- сообщений, только без текста.
create unique index if not exists outreach_tasks_one_open_per_conversation
  on public.outreach_tasks (conversation_id)
  where status = 'open' and conversation_id is not null;

create index if not exists outreach_tasks_conversation_idx
  on public.outreach_tasks (conversation_id, created_at desc)
  where conversation_id is not null;

-- Настройки. Одна строка: приёмник один, и правило одно на оба мессенджера.
create table public.conversation_task_settings (
  id boolean primary key default true,
  -- Выключатель. Пригодится в первый же день, когда окажется, что задач слишком много.
  is_enabled boolean not null default true,
  -- Через сколько минут задача считается просроченной. Пятнадцать: ответ в чате ждут
  -- сегодня, а не в ближайшее окно обзвона, как звонок.
  due_after_minutes integer not null default 15,
  task_text text not null default 'Ответить в переписке',
  -- «Общий» менеджер: кому падает задача, если за человеком никто не закреплён. Пусто —
  -- задача не заводится вовсе. Это осознанно: задача без ответственного невидима в
  -- фильтрах «мои», то есть не видна никому, и создавать её значит делать вид, что сигнал
  -- есть, когда его нет.
  fallback_admin_id uuid references public.admin_accounts(id),
  updated_at timestamptz not null default now(),
  constraint conversation_task_settings_singleton_check check (id),
  constraint conversation_task_settings_due_check check (
    due_after_minutes between 0 and 10080
  ),
  constraint conversation_task_settings_text_check check (
    length(btrim(task_text)) between 1 and 200
  )
);

insert into public.conversation_task_settings (id) values (true)
on conflict (id) do nothing;

comment on table public.conversation_task_settings is
  'Задача менеджеру на входящее сообщение: включена ли, через сколько срок и кому падает ничья.';
comment on column public.conversation_task_settings.fallback_admin_id is
  'Кому задача, если за человеком никто не закреплён. Пусто — задача не заводится.';
