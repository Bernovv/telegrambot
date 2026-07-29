create table public.outreach_contacts (
  id uuid primary key,
  linked_user_id uuid references public.users(id),
  display_name text,
  phone_e164 text,
  telegram_username text,
  telegram_username_normalized text,
  max_identifier text,
  max_identifier_normalized text,
  source text,
  note text,
  created_by_admin_id uuid not null references public.admin_accounts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outreach_contacts_identity_check check (
    phone_e164 is not null
    or telegram_username_normalized is not null
    or max_identifier_normalized is not null
  ),
  constraint outreach_contacts_phone_check check (
    phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'
  ),
  constraint outreach_contacts_display_name_check check (
    display_name is null or length(btrim(display_name)) between 1 and 200
  ),
  constraint outreach_contacts_note_check check (
    note is null or length(note) <= 2000
  )
);

create unique index outreach_contacts_phone_unique
  on public.outreach_contacts (phone_e164)
  where phone_e164 is not null;
create unique index outreach_contacts_telegram_unique
  on public.outreach_contacts (telegram_username_normalized)
  where telegram_username_normalized is not null;
create unique index outreach_contacts_max_unique
  on public.outreach_contacts (max_identifier_normalized)
  where max_identifier_normalized is not null;
create unique index outreach_contacts_linked_user_unique
  on public.outreach_contacts (linked_user_id)
  where linked_user_id is not null;

create table public.outreach_campaigns (
  id uuid primary key,
  name text not null,
  description text,
  status text not null default 'active',
  created_by_admin_id uuid not null references public.admin_accounts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint outreach_campaigns_name_check check (
    length(btrim(name)) between 1 and 200
  ),
  constraint outreach_campaigns_description_check check (
    description is null or length(description) <= 2000
  ),
  constraint outreach_campaigns_status_check check (
    status in ('draft', 'active', 'completed')
  ),
  constraint outreach_campaigns_completed_check check (
    (status = 'completed' and completed_at is not null)
    or (status <> 'completed' and completed_at is null)
  )
);

create index outreach_campaigns_created_idx
  on public.outreach_campaigns (created_at desc, id desc);

create table public.outreach_campaign_contacts (
  id uuid primary key,
  campaign_id uuid not null references public.outreach_campaigns(id),
  contact_id uuid not null references public.outreach_contacts(id),
  assigned_admin_id uuid references public.admin_accounts(id),
  current_status text not null default 'new',
  last_activity_at timestamptz,
  next_contact_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outreach_campaign_contacts_unique unique (campaign_id, contact_id),
  constraint outreach_campaign_contacts_status_check check (
    current_status in (
      'new', 'sent', 'no_answer', 'answered', 'callback',
      'interested', 'declined', 'converted', 'invalid'
    )
  )
);

create index outreach_campaign_contacts_campaign_status_idx
  on public.outreach_campaign_contacts (campaign_id, current_status, created_at desc);
create index outreach_campaign_contacts_assignee_idx
  on public.outreach_campaign_contacts (assigned_admin_id, current_status)
  where assigned_admin_id is not null;
create index outreach_campaign_contacts_next_contact_idx
  on public.outreach_campaign_contacts (next_contact_at)
  where next_contact_at is not null;

create table public.outreach_activities (
  id uuid primary key,
  campaign_contact_id uuid not null references public.outreach_campaign_contacts(id),
  contact_id uuid not null references public.outreach_contacts(id),
  actor_admin_id uuid not null references public.admin_accounts(id),
  action text not null,
  channel text not null,
  result text not null,
  note text,
  batch_id uuid,
  occurred_at timestamptz not null default now(),
  constraint outreach_activities_action_check check (
    action in ('message', 'call')
  ),
  constraint outreach_activities_channel_check check (
    channel in ('phone', 'telegram', 'max', 'whatsapp', 'sms', 'other')
  ),
  constraint outreach_activities_result_check check (
    result in (
      'sent', 'no_answer', 'answered', 'callback',
      'interested', 'declined', 'converted', 'invalid'
    )
  ),
  constraint outreach_activities_action_channel_check check (
    (action = 'call' and channel = 'phone')
    or (action = 'message' and channel <> 'phone')
  ),
  constraint outreach_activities_note_check check (
    note is null or length(note) <= 2000
  )
);

create index outreach_activities_campaign_contact_idx
  on public.outreach_activities (campaign_contact_id, occurred_at desc, id desc);
create index outreach_activities_actor_idx
  on public.outreach_activities (actor_admin_id, occurred_at desc);
create index outreach_activities_batch_idx
  on public.outreach_activities (batch_id)
  where batch_id is not null;

create function public.prevent_outreach_activity_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'outreach activities are append-only';
end;
$$;

create trigger outreach_activities_append_only
before update or delete on public.outreach_activities
for each row execute function public.prevent_outreach_activity_mutation();

insert into public.admin_permissions (code, description) values
  ('outreach.read', 'Read outreach campaigns, contacts, and activity history'),
  ('outreach.write', 'Create outreach campaigns and record manager activity')
on conflict (code) do nothing;

insert into public.admin_role_permissions (role_code, permission_code) values
  ('sales_manager', 'outreach.read'),
  ('sales_manager', 'outreach.write'),
  ('super_admin', 'outreach.read'),
  ('super_admin', 'outreach.write')
on conflict (role_code, permission_code) do nothing;

-- Link the imported base to users who have already shared a trusted phone.
update public.outreach_contacts outreach
set linked_user_id = matched.user_id,
    updated_at = now()
from (
  select distinct on (contact.value_normalized)
    contact.value_normalized,
    contact.user_id
  from public.user_contacts contact
  where contact.contact_type = 'phone'
    and contact.verification_status in ('imported', 'verified')
  order by contact.value_normalized, contact.is_primary desc, contact.created_at
) matched
where outreach.phone_e164 = matched.value_normalized
  and outreach.linked_user_id is null;

create function public.link_outreach_contact_from_user_phone()
returns trigger
language plpgsql
as $$
begin
  if new.contact_type = 'phone'
    and new.verification_status in ('imported', 'verified') then
    update public.outreach_contacts
    set linked_user_id = new.user_id,
        updated_at = now()
    where phone_e164 = new.value_normalized
      and (linked_user_id is null or linked_user_id = new.user_id);
  end if;
  return new;
end;
$$;

create trigger user_contacts_link_outreach
after insert or update of value_normalized, verification_status
on public.user_contacts
for each row execute function public.link_outreach_contact_from_user_phone();
