-- Журнал загрузок: строки, которые не легли, переживают закрытие вкладки.
--
-- До сих пор непрошедшие строки назывались номерами сразу после загрузки и жили только в
-- памяти браузера. Закрыл вкладку — забыл, какие строки чинить. Отсюда и файл
-- amocrm_contacts_needs_review.csv на ноутбуке: пятьдесят шесть человек, которых некуда было
-- деть внутри панели.
--
-- Храним только те строки, которые не легли. Складывать все восемь тысяч строк удачной
-- загрузки незачем: те, что легли, уже лежат контактами, и вторая их копия — это просто
-- мусор, который придётся чистить.

create table public.outreach_imports (
  id uuid primary key,
  created_by_admin_id uuid not null references public.admin_accounts(id),
  filename text,
  -- Пусто — грузили прямо в базу. Иначе кампания, в которую клали.
  campaign_id uuid references public.outreach_campaigns(id),
  received integer not null default 0,
  created_contacts integer not null default 0,
  updated_contacts integer not null default 0,
  invalid_rows integer not null default 0,
  ambiguous_rows integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outreach_imports_filename_check check (
    filename is null or length(btrim(filename)) between 1 and 260
  ),
  constraint outreach_imports_counts_check check (
    received >= 0 and created_contacts >= 0 and updated_contacts >= 0
    and invalid_rows >= 0 and ambiguous_rows >= 0
  )
);

create index outreach_imports_recent_idx
  on public.outreach_imports (created_at desc, id desc);

create table public.outreach_import_rows (
  id uuid primary key,
  import_id uuid not null references public.outreach_imports(id),
  -- Номер строки в файле: по нему человек находит её у себя в таблице.
  line_number integer not null,
  -- Что было в строке. Держим как есть, а не разобранным: чинить придётся именно исходное.
  raw jsonb not null,
  status text not null,
  reason text,
  resolved_contact_id uuid references public.outreach_contacts(id),
  resolved_by_admin_id uuid references public.admin_accounts(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint outreach_import_rows_status_check check (
    status in ('invalid', 'ambiguous', 'resolved', 'dismissed')
  ),
  constraint outreach_import_rows_line_check check (line_number >= 1),
  constraint outreach_import_rows_reason_check check (
    reason is null or length(reason) <= 200
  ),
  -- Разобранная строка обязана помнить, кто и когда её разобрал: иначе непонятно, почему она
  -- перестала мозолить глаза.
  constraint outreach_import_rows_resolved_check check (
    (status in ('invalid', 'ambiguous')
      and resolved_at is null and resolved_by_admin_id is null)
    or (status in ('resolved', 'dismissed')
      and resolved_at is not null and resolved_by_admin_id is not null)
  ),
  constraint outreach_import_rows_contact_check check (
    resolved_contact_id is null or status = 'resolved'
  )
);

-- Основной запрос панели — «что ещё не разобрано»: по загрузке и по всем сразу.
create index outreach_import_rows_pending_idx
  on public.outreach_import_rows (import_id, line_number)
  where status in ('invalid', 'ambiguous');

create index outreach_import_rows_pending_recent_idx
  on public.outreach_import_rows (created_at desc)
  where status in ('invalid', 'ambiguous');
