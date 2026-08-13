-- Связать уже заведённых участников с людьми в общей базе.
--
-- Колонка event_participants.outreach_contact_id существовала с самого начала, но заполнял её
-- ровно один путь — кнопка «Добавить участником» в карточке кампании. Участники, заведённые
-- руками на вкладке мероприятия и перенесённые таблицей, лежали без связи, и для базы это были
-- другие люди: карточка человека не показывала его поездок, а проверка перед удалением
-- держалась только на подстраховке по телефону.
--
-- Код теперь проставляет связь при создании. Здесь — разовый проход по тому, что уже лежит.

-- Шаг первый: подтянуть связь там, где человек в базе уже есть. Совпадение по телефону:
-- у участника это единственный признак, приведённый к E.164 и проверенный ограничением.
--
-- distinct on нужен из-за архивных дублей: телефон уникален только среди живых контактов,
-- поэтому на один номер теоретически приходится несколько строк. Берём самую раннюю — она же
-- та, на которую ссылаются остальные связи.
update public.event_participants participant
set outreach_contact_id = matched.id
from (
  select distinct on (phone_e164) phone_e164, id
  from public.outreach_contacts
  where phone_e164 is not null
  order by phone_e164, created_at
) matched
where participant.outreach_contact_id is null
  and participant.phone_e164 is not null
  and participant.phone_e164 = matched.phone_e164;

-- Шаг второй: завести в базе тех, кого там не было. Участник мероприятия — человек, которого
-- мы точно знаем, и держать его вне базы незачем.
--
-- Заводим только тех, у кого есть телефон: без него контакт не пройдёт проверку признаков, да
-- и найти его потом всё равно не выйдет. Участники без телефона остаются без связи — это
-- честнее, чем плодить карточки, которые ни с чем не сопоставить.
--
-- Автор — тот, кто завёл участника: колонка created_by_admin_id обязательна, а выдумывать
-- системного администратора ради этого прохода не стоит.
with candidates as (
  select distinct on (participant.phone_e164)
    participant.phone_e164,
    participant.display_name,
    participant.created_by_admin_id
  from public.event_participants participant
  where participant.outreach_contact_id is null
    and participant.phone_e164 is not null
    and participant.deleted_at is null
  order by participant.phone_e164, participant.created_at
)
insert into public.outreach_contacts (
  id, display_name, phone_e164, source, created_by_admin_id
)
select
  gen_random_uuid(),
  candidates.display_name,
  candidates.phone_e164,
  'Участник мероприятия',
  candidates.created_by_admin_id
from candidates
on conflict do nothing;

-- Шаг третий: связать вновь заведённых. Повтор первого запроса — теперь он находит всех.
update public.event_participants participant
set outreach_contact_id = matched.id
from (
  select distinct on (phone_e164) phone_e164, id
  from public.outreach_contacts
  where phone_e164 is not null
  order by phone_e164, created_at
) matched
where participant.outreach_contact_id is null
  and participant.phone_e164 is not null
  and participant.phone_e164 = matched.phone_e164;
