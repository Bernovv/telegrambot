-- Правка, архив и удаление контакта в общей базе.
--
-- Колонки архива (archived_at, archived_reason, archived_by_admin_id) появились ещё в
-- 20260731140000 и с тех пор фильтровались в запросах, но выставить их было нечем: кода,
-- который бы их писал, не существовало. Убрать контакт из базы было нельзя вообще.
--
-- Удаление вынесено в отдельное право. Архив обратим и потому идёт по общему outreach.write;
-- удаление стирает строку насовсем, и круг тех, кто на это способен, должен быть уже.

insert into public.admin_permissions (code, description) values
  ('outreach.delete', 'Permanently delete a contact that has no history worth keeping')
on conflict (code) do nothing;

insert into public.admin_role_permissions (role_code, permission_code) values
  ('super_admin', 'outreach.delete')
on conflict (role_code, permission_code) do nothing;

comment on column public.outreach_contacts.archived_reason is
  'Почему контакт убрали из базы. Виден в карточке, чтобы возврат был осознанным.';

-- Общий список базы отбирает по archived_at и сортирует по времени создания. На восьми
-- тысячах контактов это уже заметно, а дальше будет только хуже.
create index if not exists outreach_contacts_active_created_idx
  on public.outreach_contacts (created_at desc)
  where archived_at is null;
