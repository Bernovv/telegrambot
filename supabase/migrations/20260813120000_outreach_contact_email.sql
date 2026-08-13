-- Почта у контакта базы.
--
-- Выгрузка из Timepad — 254 человека, у всех есть почта, а телефона нет у двоих. Без
-- почты такой контакт вообще нельзя сохранить: проверка требует хотя бы один признак, и
-- ни телефона, ни ника у них нет.
--
-- Почта становится четвёртым признаком, по которому человека узнают при повторном
-- импорте, — наравне с телефоном, ником Telegram и MAX.

alter table public.outreach_contacts
  add column if not exists email text,
  add column if not exists email_normalized text;

comment on column public.outreach_contacts.email_normalized is
  'Почта в нижнем регистре — по ней ищут совпадение при импорте. Отображается email.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'outreach_contacts_email_check'
  ) then
    alter table public.outreach_contacts
      add constraint outreach_contacts_email_check check (
        email is null
        or (length(btrim(email)) between 3 and 320 and position('@' in email) > 1)
      );
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'outreach_contacts_email_normalized_check'
  ) then
    alter table public.outreach_contacts
      add constraint outreach_contacts_email_normalized_check check (
        email_normalized is null
        or (
          email_normalized = lower(email_normalized)
          and length(email_normalized) between 3 and 320
        )
      );
  end if;
end;
$$;

-- Одна почта — один контакт: две карточки на одного человека это способ разослать ему
-- всё дважды и потерять историю разговора.
create unique index if not exists outreach_contacts_email_unique
  on public.outreach_contacts (email_normalized)
  where email_normalized is not null;

-- Признаков теперь четыре. Старая проверка требовала один из трёх и не пускала контакт,
-- у которого есть только почта.
alter table public.outreach_contacts
  drop constraint if exists outreach_contacts_identity_check;

alter table public.outreach_contacts
  add constraint outreach_contacts_identity_check check (
    phone_e164 is not null
    or telegram_username_normalized is not null
    or max_identifier_normalized is not null
    or email_normalized is not null
  );
