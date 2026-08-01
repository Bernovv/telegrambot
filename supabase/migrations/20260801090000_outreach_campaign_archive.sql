-- Кампании можно убирать с глаз, а контакты — переносить между ними.
--
-- Общая база и кампании это разные вещи: контакт живёт в базе постоянно, а кампания —
-- это временная работа по нему. Поэтому кампанию не удаляем: в ней остаётся история
-- звонков и переписки, по которой потом видно, что человеку уже говорили. Убираем из
-- списка, вернуть можно.

alter table public.outreach_campaigns
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by_admin_id uuid references public.admin_accounts(id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'outreach_campaigns_archived_check'
  ) then
    alter table public.outreach_campaigns
      add constraint outreach_campaigns_archived_check check (
        (archived_at is null and archived_by_admin_id is null)
        or (archived_at is not null and archived_by_admin_id is not null)
      );
  end if;
end;
$$;

comment on column public.outreach_campaigns.archived_at is
  'Кампания убрана из списка. История активностей сохраняется, кампанию можно вернуть.';

create index if not exists outreach_campaigns_active_idx
  on public.outreach_campaigns (created_at desc)
  where archived_at is null;
