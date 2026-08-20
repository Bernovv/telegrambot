-- Задача переезжает на человека.
--
-- До сих пор она висела на строке участия в кампании, и поставить её тому, кто ни в одной
-- кампании не состоит, было физически некуда — а просят об этом именно из карточки клиента.
-- Кампания остаётся уточнением, а не условием: «позвонить по поводу пикника» и «позвонить»
-- — разные задачи, и первая по-прежнему видна в своей воронке.

alter table public.outreach_tasks
  add column if not exists contact_id uuid references public.outreach_contacts(id);

update public.outreach_tasks task
set contact_id = member.contact_id
from public.outreach_campaign_contacts member
where member.id = task.campaign_contact_id
  and task.contact_id is null;

alter table public.outreach_tasks
  alter column contact_id set not null,
  alter column campaign_contact_id drop not null;

-- Задача без кампании относится к человеку целиком, и такая у него одновременно одна.
-- Задачи внутри кампаний считаются по-прежнему по строке участия: existing
-- outreach_tasks_one_open_per_contact их и сторожит, а null-ы в уникальном индексе
-- Postgres считает различными и поэтому этих задач не касается.
create unique index if not exists outreach_tasks_one_open_without_campaign
  on public.outreach_tasks (contact_id)
  where status = 'open' and campaign_contact_id is null;

create index if not exists outreach_tasks_contact_idx
  on public.outreach_tasks (contact_id, created_at desc, id desc);

comment on column public.outreach_tasks.campaign_contact_id is
  'Кампания, в рамках которой поставлена задача. Пусто — задача про человека вообще.';

-- Примечания по человеку.
--
-- Поле note у самого контакта приезжает из импорта и перезаписывается целиком: вписать туда
-- «жена рожает, просил не звонить до августа» значит стереть то, что там было. Менеджеру
-- нужны короткие записи с автором и датой, которые копятся.
create table if not exists public.outreach_notes (
  id uuid primary key,
  contact_id uuid not null references public.outreach_contacts(id),
  author_admin_id uuid not null references public.admin_accounts(id),
  body text not null,
  created_at timestamptz not null default now(),
  -- Примечание — это комментарий, а не финансовая история: опечатку автор вправе убрать.
  -- Но убирается она пометкой, чтобы в базе осталось, что запись была и кто её снял.
  deleted_at timestamptz,
  deleted_by_admin_id uuid references public.admin_accounts(id),
  constraint outreach_notes_body_check check (
    length(btrim(body)) between 1 and 4000
  ),
  constraint outreach_notes_deleted_check check (
    (deleted_at is null and deleted_by_admin_id is null)
    or (deleted_at is not null and deleted_by_admin_id is not null)
  )
);

create index if not exists outreach_notes_contact_idx
  on public.outreach_notes (contact_id, created_at desc, id desc);

comment on table public.outreach_notes is
  'Заметки менеджеров по человеку. Копятся, у каждой есть автор и дата.';
