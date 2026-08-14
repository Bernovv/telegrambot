-- Кто дошёл до зала.
--
-- Отметка явки существует в системе только для билета: `tickets.checked_in_at` ставится
-- сканером на входе и защищает возврат — билет, по которому человек уже прошёл, вернуть
-- нельзя. На еженедельных встречах билета нет вовсе: вход бесплатный, регистрация идёт
-- через Timepad, и в системе такой человек живёт строкой `event_participants`.
--
-- Поэтому явка заводится отдельной таблицей, а не колонкой у билета. Ключ у неё тот же,
-- что у строки списка участников: либо оплаченный заказ, либо заведённый руками участник.
-- Список участников и сейчас собирается из этих двух источников, и явка просто ложится на
-- него сверху, ничего не дублируя.
--
-- Важно не путать её с отметкой билета. Билет — это место, а строка списка — человек или
-- компания: у пикника один заказ на семью из четверых. Отметка здесь означает «эти люди
-- пришли», а не «прошёл один из четверых».
--
-- Отметку можно снять: на входе отмечают с телефона, одним пальцем, и промах по соседней
-- строке — обычное дело. Финансовой историей это не является, поэтому снятие удаляет
-- строку, а не копит журнал исправлений.

create table if not exists public.event_attendance (
  id uuid primary key,
  event_id uuid not null references public.events(id),
  order_id uuid references public.orders(id),
  participant_id uuid references public.event_participants(id),
  checked_in_at timestamptz not null default now(),
  checked_in_by_admin_id uuid not null references public.admin_accounts(id),
  created_at timestamptz not null default now(),
  -- Ровно один из двух: строка списка приходит либо из заказа, либо из участника, и
  -- «ни того, ни другого» здесь так же бессмысленно, как «и то, и другое».
  constraint event_attendance_target_check check (
    (order_id is not null and participant_id is null)
    or (order_id is null and participant_id is not null)
  )
);

-- Дважды одного человека не отмечают: на входе легко нажать по второму разу, и счётчик
-- «пришло N из M» после этого начал бы врать в большую сторону.
create unique index if not exists event_attendance_order_unique
  on public.event_attendance (event_id, order_id)
  where order_id is not null;

create unique index if not exists event_attendance_participant_unique
  on public.event_attendance (event_id, participant_id)
  where participant_id is not null;

comment on table public.event_attendance is
  'Кто дошёл до зала. Строка на участника или заказ, а не на билет: на бесплатных встречах билета нет.';
