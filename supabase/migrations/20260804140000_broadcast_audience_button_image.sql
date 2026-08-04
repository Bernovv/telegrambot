-- Рассылка получает три вещи: выбор аудитории, кнопку-ссылку и картинку.
--
-- Картинка лежит в отдельной таблице, а не колонкой в кампании, потому что загружается
-- раньше: админ выбирает файл, тот уходит на сервер, и только потом создаётся сама рассылка.
-- Байты хранятся в базе, а не на диске: Telegram получает их от воркера напрямую, наружу
-- картинка не отдаётся и публичного адреса ей не нужно — значит не нужно ни место в nginx,
-- ни права на файлы, ни забота о том, что делать со ссылкой после события.
--
-- Ограничение в мегабайт — не про Telegram (он принимает до десяти), а про путь до него:
-- картинка идёт в теле JSON-запроса через админку, и предел тела запроса общий на весь API.

create table public.admin_broadcast_images (
  id uuid primary key,
  uploaded_by_admin_id uuid not null references public.admin_accounts(id),
  mime_type text not null,
  byte_size integer not null,
  width integer not null,
  height integer not null,
  bytes bytea not null,
  created_at timestamptz not null default now(),
  constraint admin_broadcast_images_mime_check check (mime_type in ('image/png', 'image/jpeg')),
  constraint admin_broadcast_images_size_check check (byte_size between 100 and 1048576),
  -- Требования Telegram к фотографии: сумма сторон не больше 10000, соотношение не круче 1:20.
  constraint admin_broadcast_images_dimensions_check check (
    width between 1 and 10000
    and height between 1 and 10000
    and width + height <= 10000
    and width <= height * 20
    and height <= width * 20
  )
);

alter table public.admin_broadcasts
  add column if not exists target_audience text not null default 'orders',
  add column if not exists button_text text,
  add column if not exists button_url text,
  add column if not exists image_id uuid references public.admin_broadcast_images(id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'admin_broadcasts_audience_check'
  ) then
    alter table public.admin_broadcasts
      add constraint admin_broadcasts_audience_check check (
        target_audience in ('orders', 'bot_users')
      );
  end if;

  -- Фильтры по мероприятию и статусу заказа существуют только для аудитории по заказам.
  -- Оставить их заполненными для «всех, кто открывал бота» — значит показать в истории
  -- условия, которые на отправку не влияли.
  if not exists (
    select 1 from pg_constraint where conname = 'admin_broadcasts_audience_filters_check'
  ) then
    alter table public.admin_broadcasts
      add constraint admin_broadcasts_audience_filters_check check (
        target_audience = 'orders'
        or (target_event_id is null and target_order_status is null)
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'admin_broadcasts_button_check'
  ) then
    alter table public.admin_broadcasts
      add constraint admin_broadcasts_button_check check (
        (button_text is null and button_url is null)
        or (
          length(btrim(button_text)) between 1 and 64
          and button_url ~ '^https://'
          and length(button_url) <= 2048
        )
      );
  end if;

  -- У сообщения с картинкой лимит не 4096, а 1024: Telegram считает текст подписью к фото.
  if not exists (
    select 1 from pg_constraint where conname = 'admin_broadcasts_caption_length_check'
  ) then
    alter table public.admin_broadcasts
      add constraint admin_broadcasts_caption_length_check check (
        image_id is null or length(btrim(message_text)) <= 1024
      );
  end if;
end;
$$;

comment on column public.admin_broadcasts.target_audience is
  'orders — у кого есть заказ под фильтрами; bot_users — все, кто открывал бота.';
comment on column public.admin_broadcasts.image_id is
  'Картинка сообщения. Если задана, текст уходит подписью к фото и ограничен 1024 символами.';

create index admin_broadcasts_created_idx on public.admin_broadcasts (created_at desc);
