-- Ответ менеджера уходит очередью, а не прямым вызовом из панели.
--
-- Соблазн понятен: нажали «Отправить» — вызвали api мессенджера — показали результат. Так
-- делать нельзя по трём причинам сразу, и каждая из них уже случалась в этом проекте.
--
-- **Сеть чужая.** Telegram с этого сервера доступен только через прокси, и когда прокси
-- моргает, прямая отправка отдаёт менеджеру ошибку, а сообщение теряется. Очередь в такой
-- ситуации просто пробует ещё раз.
--
-- **Скорость наша.** Менеджер, разославший десяток ответов подряд, для антиспама выглядит
-- как рассылка. Пауза между отправками — это то, что очередь умеет, а кнопка нет.
--
-- **Порядок разговора.** Два ответа, отправленные одновременно, приходят человеку в
-- случайном порядке. Очередь отправляет их по одному и в том порядке, в каком их написали.
--
-- Отдельной таблицы для очереди нет намеренно: очередь — это сами реплики со статусом
-- `queued`. Строка ответа появляется в ленте сразу, ещё до отправки, и менеджер видит своё
-- сообщение там же, где всё остальное; меняется у него только судьба доставки. Вторая
-- таблица означала бы, что до отправки сообщение живёт в одном месте, а после — в другом,
-- и в ленте его нет ни там, ни там.

alter table public.conversation_messages
  add column send_attempts integer not null default 0;

alter table public.conversation_messages
  add column next_attempt_at timestamptz;

alter table public.conversation_messages
  add constraint conversation_messages_send_attempts_check check (
    send_attempts between 0 and 100
  );

comment on column public.conversation_messages.send_attempts is
  'Сколько раз пробовали отправить. Упирается в потолок — реплика становится failed насовсем.';
comment on column public.conversation_messages.next_attempt_at is
  'Раньше этого времени не пробуем. Пусто — можно сейчас. Он же срок аренды строки воркером.';

-- Очередь отправки: самые старые первыми, чтобы разговор не перемешался.
create index conversation_messages_queued_idx
  on public.conversation_messages (next_attempt_at nulls first, occurred_at)
  where delivery_status = 'queued';

-- Идентификатор отправленного сообщения проставляется после отправки — и только он.
--
-- Реплика неизменяема, и это правильно: сказанное не переписывают. Но у ответа менеджера
-- идентификатора у мессенджера до отправки взять неоткуда — он приходит в ответе Telegram,
-- то есть уже после того, как строка легла в базу. Старый триггер запрещал и это, и первая
-- же отправка падала бы с «conversation message content is immutable».
--
-- Поэтому разрешено ровно одно: пустое поле один раз становится непустым. Подменить уже
-- проставленный идентификатор по-прежнему нельзя — иначе исчезла бы связь между нашей
-- строкой и сообщением в чате, а по ней разбирают спорные случаи.
create or replace function public.prevent_conversation_message_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'conversation messages are append-only';
  end if;
  if new.conversation_id is distinct from old.conversation_id
     or new.direction is distinct from old.direction
     or new.author_kind is distinct from old.author_kind
     or new.author_admin_id is distinct from old.author_admin_id
     or new.body is distinct from old.body
     or new.edits_message_id is distinct from old.edits_message_id
     or new.payload is distinct from old.payload
     or new.occurred_at is distinct from old.occurred_at
     or new.created_at is distinct from old.created_at then
    raise exception 'conversation message content is immutable';
  end if;
  if old.external_message_id is not null
     and new.external_message_id is distinct from old.external_message_id then
    raise exception 'conversation message external id is set once';
  end if;
  return new;
end;
$$;
