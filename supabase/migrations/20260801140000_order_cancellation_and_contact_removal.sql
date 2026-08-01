-- Отмена зависших заказов и удаление контакта из кампании.
--
-- Контакт убирается из кампании мягко: к строке участия привязаны звонки, сообщения,
-- задачи и история стадий. Удалить строку — потерять их, а именно они отвечают на вопрос
-- «что человеку уже говорили». Сам контакт при этом остаётся в общей базе и в других
-- кампаниях: база и кампании живут отдельно.

alter table public.outreach_campaign_contacts
  add column if not exists removed_at timestamptz,
  add column if not exists removed_by_admin_id uuid references public.admin_accounts(id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'outreach_campaign_contacts_removed_check'
  ) then
    alter table public.outreach_campaign_contacts
      add constraint outreach_campaign_contacts_removed_check check (
        (removed_at is null and removed_by_admin_id is null)
        or (removed_at is not null and removed_by_admin_id is not null)
      );
  end if;
end;
$$;

comment on column public.outreach_campaign_contacts.removed_at is
  'Контакт убран из кампании. История звонков сохраняется, вернуть можно повторным добавлением.';

create index if not exists outreach_campaign_contacts_active_idx
  on public.outreach_campaign_contacts (campaign_id, pipeline_stage)
  where removed_at is null;

insert into public.admin_permissions (code, description) values
  ('orders.cancel', 'Cancel an unpaid order and release its reservation and wallet hold')
on conflict (code) do nothing;

-- Отмена возвращает покупателю захолдированные бонусы и снимает бронь мест, поэтому
-- право отдаём тому же кругу, что и прочие операции с кошельком.
insert into public.admin_role_permissions (role_code, permission_code) values
  ('super_admin', 'orders.cancel'),
  ('financial_admin', 'orders.cancel')
on conflict (role_code, permission_code) do nothing;
