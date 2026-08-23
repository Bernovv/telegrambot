-- Откуда человек пришёл.
--
-- До сих пор ответа не было ни у кого: у карточки есть текстовое поле `source`, и у
-- большинства в нём написано «amoCRM export 2026-07-30». Слова `utm` не было ни в одной
-- строке кода.
--
-- Вся реклама ведёт на лендинг (ответ владельца от 23.08.2026), и это определяет всю
-- конструкцию: **лендинг — единственное место, где метка вообще существует.** Дальше её
-- надо донести до нас самим — форма заявки и ссылка на бота уносят её с собой, иначе она
-- теряется на первом же переходе.
--
-- **Первое касание, а не последнее.** Метка записывается один раз и больше не
-- переписывается: вопрос, на который отвечает отчёт, — «что привело человека», а привёл
-- его тот источник, по которому он пришёл впервые. Последнее касание отвечало бы на другой
-- вопрос и приписывало бы всех, кто вернулся по прямой ссылке, каналу «прямой заход».
--
-- **Отдельная таблица, а не колонки в карточке.** У карточки человека своя жизнь: её правят
-- менеджеры руками, сливают дубли, архивируют. Метка — это факт о приходе, и он не должен
-- меняться вместе с именем и телефоном.

create table public.contact_attributions (
  contact_id uuid primary key references public.outreach_contacts(id),
  -- Пять меток utm как они пришли. Ни одна не обязательна: прямой заход не несёт ни одной,
  -- а строка всё равно нужна — она отвечает «пришёл сам, без рекламы».
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  -- Страница, на которую человек попал. Без строки запроса: метки уже разобраны по
  -- колонкам, а остальное в адресе — мусор пополам с персональными данными.
  landing_page text,
  -- Откуда пришёл: только имя узла. Полный адрес чужой страницы хранить незачем.
  referrer_host text,
  -- Когда человек впервые попал на лендинг, по часам его браузера. Может заметно
  -- отличаться от `recorded_at`: между первым заходом и заявкой бывают недели.
  first_seen_at timestamptz,
  recorded_at timestamptz not null default now(),
  constraint contact_attributions_source_check check (
    utm_source is null or length(btrim(utm_source)) between 1 and 100
  ),
  constraint contact_attributions_medium_check check (
    utm_medium is null or length(btrim(utm_medium)) between 1 and 100
  ),
  constraint contact_attributions_campaign_check check (
    utm_campaign is null or length(btrim(utm_campaign)) between 1 and 200
  ),
  constraint contact_attributions_content_check check (
    utm_content is null or length(btrim(utm_content)) between 1 and 200
  ),
  constraint contact_attributions_term_check check (
    utm_term is null or length(btrim(utm_term)) between 1 and 200
  ),
  constraint contact_attributions_landing_check check (
    landing_page is null or length(btrim(landing_page)) between 1 and 200
  ),
  constraint contact_attributions_referrer_check check (
    referrer_host is null or length(btrim(referrer_host)) between 1 and 200
  )
);

-- «Сколько людей привёл этот источник» — вопрос к таблице целиком, а не к одному человеку.
create index contact_attributions_source_idx
  on public.contact_attributions (utm_source, utm_campaign);

comment on table public.contact_attributions is
  'Первое касание: с какой меткой человек к нам пришёл. Записывается один раз и не переписывается.';

-- Метки в самой заявке — сырьём, как их прислал браузер.
--
-- Копия рядом с карточкой нужна по той же причине, по какой заявка вообще хранится
-- отдельно от участника: заявку могли не привязать ни к кому, и тогда единственное место,
-- где метка сохранится, — это она сама.
alter table public.site_registrations
  add column if not exists utm_source text,
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text,
  add column if not exists utm_content text,
  add column if not exists utm_term text;

comment on column public.site_registrations.utm_source is
  'Метка с лендинга, как её принёс браузер. Пусто — человек пришёл без рекламы.';
