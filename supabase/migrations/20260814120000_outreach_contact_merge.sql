-- Объединение дублей: два контакта на одного человека.
--
-- Дубли берутся из выгрузок. Импорт узнаёт человека по телефону, нику Telegram, MAX и почте,
-- но если телефон ведёт на один контакт, а ник на другой, свести их автоматически нельзя —
-- какой из двух правильный, знает только человек. Такие строки импорт пропускает и называет
-- их номера, а разрешить спор до сих пор было нечем.
--
-- Проигравший контакт не удаляется. Во-первых, на него ссылаются журнал активностей и история
-- стадий, а они защищены триггерами «только на добавление»: переписать им contact_id нельзя
-- физически. Во-вторых, так и правильнее — звонок был сделан по той карточке, которая была, и
-- задним числом это не меняется. Вместо удаления ставится указатель на главного: старые ссылки
-- продолжают открываться, а карточка главного собирает историю по всей цепочке.

alter table public.outreach_contacts
  add column if not exists merged_into_contact_id uuid
    references public.outreach_contacts(id),
  add column if not exists merged_at timestamptz,
  add column if not exists merged_by_admin_id uuid references public.admin_accounts(id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'outreach_contacts_merged_check'
  ) then
    alter table public.outreach_contacts
      add constraint outreach_contacts_merged_check check (
        (merged_into_contact_id is null and merged_at is null and merged_by_admin_id is null)
        or (merged_into_contact_id is not null and merged_at is not null
            and merged_by_admin_id is not null)
      );
  end if;
  -- Сам в себя контакт объединиться не может: получилось бы кольцо, по которому обход
  -- истории зациклится.
  if not exists (
    select 1 from pg_constraint where conname = 'outreach_contacts_merged_self_check'
  ) then
    alter table public.outreach_contacts
      add constraint outreach_contacts_merged_self_check check (
        merged_into_contact_id is null or merged_into_contact_id <> id
      );
  end if;
end;
$$;

comment on column public.outreach_contacts.merged_into_contact_id is
  'Контакт признан дублем и указывает на главного. Строка остаётся: на неё ссылается журнал активностей, который нельзя переписать.';

-- По этой связи карточка главного собирает свою историю — обход идёт от главного вниз.
create index if not exists outreach_contacts_merged_into_idx
  on public.outreach_contacts (merged_into_contact_id)
  where merged_into_contact_id is not null;
