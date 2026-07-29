alter table public.outreach_campaign_contacts
  add column pipeline_stage text,
  add column lost_reason text;

update public.outreach_campaign_contacts
set pipeline_stage = case current_status
  when 'new' then 'new'
  when 'sent' then 'first_contact'
  when 'no_answer' then 'first_contact'
  when 'answered' then 'dialogue'
  when 'callback' then 'follow_up'
  when 'interested' then 'interested'
  when 'converted' then 'won'
  when 'declined' then 'lost'
  when 'invalid' then 'lost'
end,
lost_reason = case current_status
  when 'declined' then 'declined'
  when 'invalid' then 'invalid_contact'
  else null
end;

alter table public.outreach_campaign_contacts
  alter column pipeline_stage set default 'new',
  alter column pipeline_stage set not null,
  add constraint outreach_campaign_contacts_pipeline_stage_check check (
    pipeline_stage in (
      'new', 'first_contact', 'dialogue', 'follow_up',
      'interested', 'won', 'lost'
    )
  ),
  add constraint outreach_campaign_contacts_lost_reason_check check (
    lost_reason is null
    or lost_reason in (
      'declined', 'not_relevant', 'invalid_contact', 'duplicate', 'other'
    )
  ),
  add constraint outreach_campaign_contacts_lost_state_check check (
    (pipeline_stage = 'lost' and lost_reason is not null)
    or (pipeline_stage <> 'lost' and lost_reason is null)
  );

create index outreach_campaign_contacts_pipeline_idx
  on public.outreach_campaign_contacts (
    campaign_id, pipeline_stage, updated_at desc, id desc
  );

create table public.outreach_stage_history (
  id uuid primary key,
  campaign_contact_id uuid not null
    references public.outreach_campaign_contacts(id),
  actor_admin_id uuid references public.admin_accounts(id),
  from_stage text,
  to_stage text not null,
  lost_reason text,
  occurred_at timestamptz not null default now(),
  constraint outreach_stage_history_from_check check (
    from_stage is null
    or from_stage in (
      'new', 'first_contact', 'dialogue', 'follow_up',
      'interested', 'won', 'lost'
    )
  ),
  constraint outreach_stage_history_to_check check (
    to_stage in (
      'new', 'first_contact', 'dialogue', 'follow_up',
      'interested', 'won', 'lost'
    )
  ),
  constraint outreach_stage_history_lost_reason_check check (
    lost_reason is null
    or lost_reason in (
      'declined', 'not_relevant', 'invalid_contact', 'duplicate', 'other'
    )
  ),
  constraint outreach_stage_history_lost_state_check check (
    (to_stage = 'lost' and lost_reason is not null)
    or (to_stage <> 'lost' and lost_reason is null)
  )
);

create index outreach_stage_history_contact_idx
  on public.outreach_stage_history (
    campaign_contact_id, occurred_at desc, id desc
  );

insert into public.outreach_stage_history (
  id, campaign_contact_id, actor_admin_id,
  from_stage, to_stage, lost_reason, occurred_at
)
select
  gen_random_uuid(),
  campaign_contact.id,
  null,
  null,
  campaign_contact.pipeline_stage,
  campaign_contact.lost_reason,
  campaign_contact.updated_at
from public.outreach_campaign_contacts campaign_contact;

create function public.prevent_outreach_stage_history_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'outreach stage history is append-only';
end;
$$;

create trigger outreach_stage_history_append_only
before update or delete on public.outreach_stage_history
for each row execute function public.prevent_outreach_stage_history_mutation();

create table public.outreach_tasks (
  id uuid primary key,
  campaign_contact_id uuid not null
    references public.outreach_campaign_contacts(id),
  assigned_admin_id uuid not null references public.admin_accounts(id),
  created_by_admin_id uuid not null references public.admin_accounts(id),
  completed_by_admin_id uuid references public.admin_accounts(id),
  task_type text not null,
  task_text text not null,
  due_at timestamptz not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint outreach_tasks_type_check check (
    task_type in ('call', 'message', 'other')
  ),
  constraint outreach_tasks_text_check check (
    length(btrim(task_text)) between 1 and 500
  ),
  constraint outreach_tasks_status_check check (
    status in ('open', 'completed', 'cancelled')
  ),
  constraint outreach_tasks_completion_check check (
    (status = 'completed'
      and completed_at is not null
      and completed_by_admin_id is not null)
    or (status <> 'completed'
      and completed_at is null
      and completed_by_admin_id is null)
  )
);

create unique index outreach_tasks_one_open_per_contact
  on public.outreach_tasks (campaign_contact_id)
  where status = 'open';
create index outreach_tasks_assignee_due_idx
  on public.outreach_tasks (assigned_admin_id, due_at, id)
  where status = 'open';
create index outreach_tasks_contact_history_idx
  on public.outreach_tasks (
    campaign_contact_id, created_at desc, id desc
  );

insert into public.outreach_tasks (
  id, campaign_contact_id, assigned_admin_id, created_by_admin_id,
  task_type, task_text, due_at, status, created_at
)
select
  gen_random_uuid(),
  campaign_contact.id,
  coalesce(campaign_contact.assigned_admin_id, campaign.created_by_admin_id),
  campaign.created_by_admin_id,
  'call',
  'Связаться с клиентом',
  campaign_contact.next_contact_at,
  'open',
  campaign_contact.updated_at
from public.outreach_campaign_contacts campaign_contact
join public.outreach_campaigns campaign
  on campaign.id = campaign_contact.campaign_id
where campaign_contact.next_contact_at is not null;
