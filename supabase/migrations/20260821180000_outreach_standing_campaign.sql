-- Постоянная воронка направления.
--
-- Кампания заводится вместе с мероприятием — и это верно для Пикника, который бывает раз в
-- год. Но «Бизнес-среда» бывает каждую неделю: за год это полсотни кампаний, а человек,
-- который ходит на среды, оказывается в десяти воронках сразу, с историей, разрезанной по
-- ним. Работать в такой воронке нельзя: она заканчивается вместе со встречей.
--
-- Признак направления — начало слага мероприятия. Это ровно тот же признак, по которому
-- заявка с сайта уже ищет ближайшую встречу (см. site-registration), поэтому второй правды
-- о том, «что такое среда», не появляется. Воронка с префиксом собирает участников всех
-- мероприятий, чей слаг с него начинается, и живёт, пока живёт направление.

alter table public.outreach_campaigns
  add column if not exists event_slug_prefix text;

alter table public.outreach_campaigns
  add constraint outreach_campaigns_slug_prefix_check check (
    event_slug_prefix is null
    or event_slug_prefix ~ '^[a-z0-9][a-z0-9-]{0,40}$'
  ),
  -- Кампания либо про одно мероприятие, либо про направление. И то и другое сразу означало
  -- бы, что участники приезжают из двух источников и непонятно, чем считается сверка.
  add constraint outreach_campaigns_scope_check check (
    event_slug_prefix is null or event_id is null
  );

-- Направление одно на префикс: две воронки «Бизнес-среда» — это две правды о том, где
-- ведётся работа, и участники поехали бы в обе.
create unique index if not exists outreach_campaigns_slug_prefix_idx
  on public.outreach_campaigns (event_slug_prefix)
  where event_slug_prefix is not null;

comment on column public.outreach_campaigns.event_slug_prefix is
  'Постоянная воронка направления: собирает участников всех мероприятий, чей слаг начинается с этого префикса.';

-- Окно обзвона: в какие часы автоматика ставит звонки.
--
-- Числом в коде это быть не может: сегодня звонят с двенадцати до семи, завтра решат
-- иначе, и менять это должен кабинет, а не выкладка.
alter table public.outreach_campaigns
  add column if not exists call_window_start smallint not null default 12,
  add column if not exists call_window_end smallint not null default 19,
  add column if not exists call_window_timezone text not null default 'Europe/Moscow';

alter table public.outreach_campaigns
  add constraint outreach_campaigns_call_window_check check (
    call_window_start between 0 and 23
    and call_window_end between 1 and 24
    and call_window_start < call_window_end
  );

-- Запрет карточки без задачи. Включается на воронке, а не на всех сразу: общий запрет
-- заблокировал бы работу с Пикником, где половина карточек — это оплаченные билеты.
alter table public.outreach_campaigns
  add column if not exists require_open_task boolean not null default false;

comment on column public.outreach_campaigns.require_open_task is
  'Карточка обязана иметь открытую задачу везде, кроме колонок с исходом «проигран».';

-- Сама воронка «Бизнес-среда».
do $$
declare
  standing_id uuid := gen_random_uuid();
begin
  if exists (
    select 1 from public.outreach_campaigns where event_slug_prefix = 'sreda'
  ) then
    return;
  end if;

  insert into public.outreach_campaigns (
    id, name, description, status, created_by_admin_id,
    created_at, updated_at, event_slug_prefix,
    require_open_task
  ) values (
    standing_id,
    'Бизнес-среда',
    'Постоянная воронка направления: сюда попадают участники всех еженедельных встреч и заявки с сайта.',
    'active',
    '00000000-0000-4000-8000-000000000002'::uuid,
    now(), now(), 'sreda',
    true
  );

  -- Стадии у направления свои. Набор по умолчанию заточен под продажу билета, а здесь
  -- работа другая: дозвониться, позвать, дождаться и позвать снова. «Не дошёл» —
  -- открытая стадия, а не проигрыш: не дошедшего зовут на следующую встречу.
  --
  -- Засеянные триггером стадии переименовываются, а не заводятся заново: сносить их
  -- значит писать в миграции удаление, а нужный набор ровно того же размера. Уникальность
  -- позиции отложена до конца транзакции, поэтому перестановка одним запросом проходит.
  update public.outreach_pipeline_columns as pipeline_column
  set stage = renamed.stage,
      label = renamed.label,
      position = renamed.position,
      outcome = renamed.outcome,
      updated_at = now()
  from (values
    ('new', 'new', 'Новые заявки', 1, 'open'),
    ('first_contact', 'calling', 'Дозваниваемся', 2, 'open'),
    ('dialogue', 'invited', 'Приглашён', 3, 'open'),
    ('follow_up', 'confirmed', 'Подтвердил участие', 4, 'open'),
    ('won', 'attended', 'Пришёл', 5, 'won'),
    ('interested', 'no_show', 'Не дошёл', 6, 'open'),
    ('lost', 'lost', 'Отказался', 7, 'lost')
  ) as renamed(seeded, stage, label, position, outcome)
  where pipeline_column.campaign_id = standing_id
    and pipeline_column.stage = renamed.seeded;

  -- Люди из кампаний отдельных сред переезжают сюда. Строки участия остаются в старых
  -- кампаниях вместе с их историей: журнал звонков защищён от изменений, и переносить его
  -- нельзя — да и незачем, в карточке человека он виден целиком.
  insert into public.outreach_campaign_contacts (
    id, campaign_id, contact_id, assigned_admin_id, current_status,
    pipeline_stage, lost_reason, last_activity_at, created_at, updated_at
  )
  select
    gen_random_uuid(),
    standing_id,
    source.contact_id,
    source.assigned_admin_id,
    source.current_status,
    case source.pipeline_stage
      when 'new' then 'new'
      when 'first_contact' then 'calling'
      when 'dialogue' then 'calling'
      when 'follow_up' then 'calling'
      when 'interested' then 'invited'
      when 'won' then 'attended'
      when 'lost' then 'lost'
      else 'new'
    end,
    case when source.pipeline_stage = 'lost'
      then coalesce(source.lost_reason, 'other')
      else null
    end,
    source.last_activity_at,
    now(), now()
  from (
    select distinct on (member.contact_id)
      member.contact_id,
      member.assigned_admin_id,
      member.current_status,
      member.pipeline_stage,
      member.lost_reason,
      member.last_activity_at
    from public.outreach_campaign_contacts member
    join public.outreach_campaigns campaign on campaign.id = member.campaign_id
    join public.events event on event.id = campaign.event_id
    where campaign.is_event_campaign
      and event.slug like 'sreda%'
      and member.removed_at is null
    order by member.contact_id, member.last_activity_at desc nulls last
  ) as source
  on conflict (campaign_id, contact_id) do nothing;

  -- Кампании отдельных встреч уходят в архив: работа теперь ведётся в направлении, а две
  -- воронки на одних и тех же людей — это два места, где менеджер ищет, кому звонить.
  update public.outreach_campaigns campaign
  set archived_at = now(),
      archived_by_admin_id = '00000000-0000-4000-8000-000000000002'::uuid,
      updated_at = now()
  from public.events event
  where event.id = campaign.event_id
    and campaign.is_event_campaign
    and campaign.archived_at is null
    and event.slug like 'sreda%';
end;
$$;
