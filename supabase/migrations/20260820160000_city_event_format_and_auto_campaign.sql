-- Городской формат мероприятия, бесплатные события и своя кампания у каждого мероприятия.
--
-- Форма заведения мероприятия писалась под Бизнес-Пикник: выезд на два дня, палатки,
-- инвентарь, тарифы, оферта, сценарий бота. То, что мы проводим сейчас, — встреча на три
-- часа вечером в городе, чаще всего бесплатная. Половина полей формы к ней не относится, а
-- публикация требовала продукт с ценой, оферту и опубликованный сценарий: ничего этого у
-- бесплатной встречи нет и быть не должно.
--
-- Отсюда два признака, а не один. `format` отвечает за то, что показывать: ночёвка,
-- инвентарь и расселение остаются только у выездных. `is_free` отвечает за деньги: у
-- бесплатного мероприятия каталог, оферта и сценарий перестают быть условием публикации.
-- Признаки независимы — городская встреча может быть платной, а выездная бесплатной.
--
-- Кампания. Раньше её заводили руками и руками же нажимали «загрузить участников», из-за
-- чего люди с бесплатной встречи в обзвон не попадали вовсе. Теперь кампания заводится
-- вместе с мероприятием, а наполняет её работник сам. Связь односторонняя и такой задумана:
-- участник попадает в кампанию, но контакт кампании участником не становится — в обзвоне
-- сидят и те, кого только зовут, и те, кто отказался. По той же причине участник, убранный
-- из мероприятия, из кампании не исчезает: звонить ему всё ещё есть о чём.

alter table public.events
  add column if not exists format text not null default 'offsite',
  add column if not exists is_free boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'events_format_check'
  ) then
    alter table public.events
      add constraint events_format_check check (format in ('city', 'offsite'));
  end if;
end;
$$;

comment on column public.events.format is
  'Городская встреча на несколько часов или выездное мероприятие с ночёвкой. Определяет, какие разделы кабинета показывать.';
comment on column public.events.is_free is
  'Участие бесплатное: продажи не ведутся, каталог, оферта и сценарий не требуются для публикации.';

-- Новые мероприятия по умолчанию городские: их заводят каждую неделю, выездное — раз в год.
-- Существующие строки уже получили 'offsite' и остаются выездными, кроме еженедельных встреч
-- ниже.
alter table public.events alter column format set default 'city';

-- Еженедельные встречи «Среда». Слаг у них общий по договорённости: заявка с формы на сайте
-- ищет ближайшее мероприятие именно по началу слага (см. site-registration).
update public.events
set format = 'city',
    is_free = true,
    offer_required = false,
    ends_at = coalesce(ends_at, starts_at + interval '3 hours'),
    lock_version = lock_version + 1,
    updated_at = now()
where slug like 'sreda%';

alter table public.outreach_campaigns
  add column if not exists is_event_campaign boolean not null default false;

-- Когда работник в последний раз сверял кампанию со списком участников. По этой отметке он
-- и решает, есть ли что делать: без неё пришлось бы перебирать все мероприятия каждый круг.
alter table public.outreach_campaigns
  add column if not exists participants_synced_at timestamptz;

comment on column public.outreach_campaigns.participants_synced_at is
  'Время последней сверки со списком участников мероприятия. Пусто — кампания ещё не наполнялась.';

comment on column public.outreach_campaigns.is_event_campaign is
  'Кампания мероприятия: заведена вместе с ним и наполняется участниками автоматически. Такая кампания у мероприятия одна.';

create unique index if not exists outreach_campaigns_event_auto_idx
  on public.outreach_campaigns (event_id)
  where is_event_campaign;

-- Учётная запись, от имени которой работник наполняет кампании. Заводить контакты должен
-- кто-то, и это заведомо не человек. Запись помечена `suspended`, войти под ней в панель
-- нельзя, а `auth_subject` не совпадёт ни с одним UID Supabase.
insert into public.admin_accounts (id, auth_subject, display_name, status)
values (
  '00000000-0000-4000-8000-000000000002',
  'system:event-campaign-sync',
  'Автоматика мероприятий',
  'suspended'
)
on conflict (id) do nothing;

-- Кампании, уже привязанные к мероприятию руками, становятся его автоматической кампанией:
-- заводить рядом вторую значит развести обзвон по двум спискам. Если руками завели
-- несколько, автоматической становится самая ранняя, остальные остаются как есть.
update public.outreach_campaigns c
set is_event_campaign = true,
    updated_at = now()
from (
  select distinct on (event_id) id
  from public.outreach_campaigns
  where event_id is not null and archived_at is null
  order by event_id, created_at, id
) earliest
where c.id = earliest.id
  and not c.is_event_campaign;

-- Остальным мероприятиям кампания заводится здесь. Контактами она наполнится сама при
-- первом проходе работника: разбор телефонов и склейка с существующими контактами живут в
-- прикладном коде, повторять их запросом нельзя.
insert into public.outreach_campaigns (
  id, name, description, status, created_by_admin_id,
  created_at, updated_at, event_id, is_event_campaign
)
select
  gen_random_uuid(),
  left(btrim(e.title), 200),
  'Кампания мероприятия. Заведена автоматически вместе с ним.',
  'active',
  '00000000-0000-4000-8000-000000000002',
  now(),
  now(),
  e.id,
  true
from public.events e
where e.status <> 'archived'
  and not exists (
    select 1
    from public.outreach_campaigns c
    where c.event_id = e.id and c.is_event_campaign
  );
