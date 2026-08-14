-- Связать оставшихся участников по нику Telegram из примечания.
--
-- Прошлый проход (20260813210000) связывал по телефону — единственному признаку, который у
-- участника лежит в своей колонке. Но телефона нет у заметной части людей: они пришли из
-- таблицы, где был только ник. У таблицы event_participants колонки под ник нет, поэтому при
-- переносе он дописывался в примечание текстом, вида «@Nadinka88; с ним: Муж, Ребенок».
--
-- Из-за этого участник и человек в базе оставались разными людьми: карточка не показывала его
-- поездку, а ответы анкеты некуда было отнести.
--
-- Ник достаём тем же правилом, что и везде: латиница, цифры и подчёркивание, 5–32 символа.
-- Более вольная выборка потащила бы за собой куски вроде «@ним» и связала не тех.

-- Шаг первый: подтянуть связь там, где человек с таким ником в базе уже есть.
with handles as (
  select
    participant.id as participant_id,
    lower((regexp_match(participant.note, '@([A-Za-z0-9_]{5,32})'))[1]) as handle
  from public.event_participants participant
  where participant.outreach_contact_id is null
    and participant.deleted_at is null
    and participant.note ~ '@[A-Za-z0-9_]{5,32}'
)
update public.event_participants participant
set outreach_contact_id = matched.id
from handles, (
  select distinct on (telegram_username_normalized) telegram_username_normalized, id
  from public.outreach_contacts
  where telegram_username_normalized is not null
  order by telegram_username_normalized, created_at
) matched
where participant.id = handles.participant_id
  and matched.telegram_username_normalized = handles.handle
  and participant.outreach_contact_id is null;

-- Шаг второй: завести в базе тех, чей ник ни с кем не совпал. Участник мероприятия — человек,
-- которого мы точно знаем, и держать его вне базы незачем.
--
-- Имя берём от участника, ник — из примечания в исходном регистре: в базе хранится как
-- написано, а ищут по нижнему.
with candidates as (
  select distinct on (lower((regexp_match(participant.note, '@([A-Za-z0-9_]{5,32})'))[1]))
    (regexp_match(participant.note, '@([A-Za-z0-9_]{5,32})'))[1] as handle,
    participant.display_name,
    participant.created_by_admin_id
  from public.event_participants participant
  where participant.outreach_contact_id is null
    and participant.deleted_at is null
    and participant.note ~ '@[A-Za-z0-9_]{5,32}'
  order by
    lower((regexp_match(participant.note, '@([A-Za-z0-9_]{5,32})'))[1]),
    participant.created_at
)
insert into public.outreach_contacts (
  id, display_name, telegram_username, telegram_username_normalized,
  source, created_by_admin_id
)
select
  gen_random_uuid(),
  candidates.display_name,
  candidates.handle,
  lower(candidates.handle),
  'Участник мероприятия',
  candidates.created_by_admin_id
from candidates
on conflict do nothing;

-- Шаг третий: связать вновь заведённых. Повтор первого запроса — теперь он находит всех.
with handles as (
  select
    participant.id as participant_id,
    lower((regexp_match(participant.note, '@([A-Za-z0-9_]{5,32})'))[1]) as handle
  from public.event_participants participant
  where participant.outreach_contact_id is null
    and participant.deleted_at is null
    and participant.note ~ '@[A-Za-z0-9_]{5,32}'
)
update public.event_participants participant
set outreach_contact_id = matched.id
from handles, (
  select distinct on (telegram_username_normalized) telegram_username_normalized, id
  from public.outreach_contacts
  where telegram_username_normalized is not null
  order by telegram_username_normalized, created_at
) matched
where participant.id = handles.participant_id
  and matched.telegram_username_normalized = handles.handle
  and participant.outreach_contact_id is null;
