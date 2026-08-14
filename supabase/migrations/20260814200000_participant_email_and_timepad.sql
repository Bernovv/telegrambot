-- Почта у участника мероприятия и Timepad как источник списка.
--
-- Регистрация на еженедельные встречи идёт через Timepad, форма там из четырёх полей: имя,
-- фамилия, телефон, почта. Телефон человек указывает не всегда, почта есть у всех — это
-- единственный признак, на который можно опереться.
--
-- Сейчас такой участник теряется дважды. В таблице участников колонки почты нет вовсе, а
-- связь с человеком в общей базе заводится только по телефону или нику: без них
-- `resolveParticipantContact` возвращает null, участник остаётся без карточки, и после
-- встречи ему некуда позвонить и незачем ставить стадию воронки. У контакта базы почта уже
-- есть — её завела миграция 20260813120000, — и дыра приходится ровно на стык.
--
-- Почта хранится дважды по тому же правилу, что и у контакта: `email` показываем как
-- написано, по `email_normalized` ищут совпадение при повторной загрузке. Повторная
-- загрузка здесь не редкость, а норма: список из Timepad выгружают до встречи и ещё раз
-- утром в день встречи, и второй раз не должен заводить тех же людей заново.

alter table public.event_participants
  add column if not exists email text,
  add column if not exists email_normalized text;

comment on column public.event_participants.email_normalized is
  'Почта в нижнем регистре — по ней узнают человека при повторной загрузке. Показываем email.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'event_participants_email_check'
  ) then
    alter table public.event_participants
      add constraint event_participants_email_check check (
        email is null
        or (length(btrim(email)) between 3 and 320 and position('@' in email) > 1)
      );
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'event_participants_email_normalized_check'
  ) then
    alter table public.event_participants
      add constraint event_participants_email_normalized_check check (
        email_normalized is null
        or (
          email_normalized = lower(email_normalized)
          and length(email_normalized) between 3 and 320
        )
      );
  end if;
end;
$$;

-- Одна почта — один участник в пределах мероприятия. Уникальность именно в пределах
-- мероприятия, а не по всей таблице: человек ходит на встречи каждую неделю, и каждая
-- неделя — своё участие. Удалённые не считаются, иначе вернуть человека после ошибочного
-- удаления будет нельзя.
create unique index if not exists event_participants_event_email_unique
  on public.event_participants (event_id, email_normalized)
  where email_normalized is not null and deleted_at is null;

-- Timepad встаёт рядом с остальными источниками списка. Отдельным значением, а не под
-- «сайтом»: сайт и Timepad — разные каналы с разной стоимостью привлечения, и смешивать их
-- в одном значении значит заранее отказаться от ответа на вопрос, какой из них работает.
alter table public.event_participants
  drop constraint if exists event_participants_source_check;

alter table public.event_participants
  add constraint event_participants_source_check check (
    source in ('max', 'site', 'direct', 'other', 'timepad')
  );
