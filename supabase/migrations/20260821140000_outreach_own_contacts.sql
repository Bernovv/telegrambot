-- «Свои» — люди, которых обзванивать не надо.
--
-- Партнёры, родственники организаторов, сотрудники: они попадают в базу вместе со всеми,
-- их видно в кампаниях, и менеджер добросовестно набирает номер. Отдельной кампанией это
-- не решается — человек может быть и «своим», и участником, — поэтому признак живёт на
-- самом человеке и виден везде, где он показан.
alter table public.outreach_contacts
  add column if not exists is_own boolean not null default false,
  -- Кто именно: «жена организатора», «наш подрядчик». Плашка одна на всех, а объяснение
  -- нужно тому, кто видит карточку впервые.
  add column if not exists own_note text,
  add column if not exists own_marked_at timestamptz,
  add column if not exists own_marked_by_admin_id uuid references public.admin_accounts(id);

alter table public.outreach_contacts
  add constraint outreach_contacts_own_note_check check (
    own_note is null or length(btrim(own_note)) between 1 and 200
  ),
  -- Снятая пометка не оставляет за собой ни объяснения, ни автора: иначе в карточке
  -- висело бы «отметил Иван» рядом с отсутствующей плашкой.
  add constraint outreach_contacts_own_state_check check (
    is_own
    or (own_note is null and own_marked_at is null and own_marked_by_admin_id is null)
  );

create index if not exists outreach_contacts_own_idx
  on public.outreach_contacts (id)
  where is_own;

comment on column public.outreach_contacts.is_own is
  'Человек «свой»: менеджерам его обзванивать не надо. Плашка видна везде, где он показан.';
