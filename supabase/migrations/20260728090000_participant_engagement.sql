-- Phase 4 schema: participant questionnaire (docs/bots/BOT_FLOWS.md "После оплаты" — 7 questions,
-- ported from the MAX bot's design docs; MAX itself never implemented this), the event reminder
-- cadence (10/7/3/1 days before + day-of), and admin broadcasts filtered by order status. All three
-- reuse the existing outbox -> pg-boss -> notification_deliveries delivery path, so
-- notification_deliveries_kind_check needs three new kinds.

create table public.participant_questionnaire_responses (
  id uuid primary key,
  order_id uuid not null references public.orders(id),
  user_id uuid not null references public.users(id),
  event_id uuid not null references public.events(id),
  name text not null,
  city text not null,
  niche text not null,
  stage text not null,
  wish text not null,
  focus_area text not null,
  join_chat boolean not null,
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint participant_questionnaire_responses_order_unique unique (order_id),
  constraint participant_questionnaire_responses_stage_check check (
    stage in (
      'only_building_product',
      'have_product_or_service',
      'have_clients_want_structure',
      'want_more_sales',
      'want_environment_reset'
    )
  ),
  constraint participant_questionnaire_responses_focus_check check (
    focus_area in ('packaging', 'content', 'sales', 'positioning', 'energy_resource', 'environment')
  ),
  constraint participant_questionnaire_responses_text_check check (
    length(btrim(name)) between 1 and 200
    and length(btrim(city)) between 1 and 200
    and length(btrim(niche)) between 1 and 500
    and length(btrim(wish)) between 1 and 1000
  )
);

create index participant_questionnaire_responses_event_idx
  on public.participant_questionnaire_responses (event_id, completed_at);

-- Reminder-cadence dedup: the worker sweep claims a (order, cadence_step) pair here, in the same
-- transaction it appends the outbox event in, so a retried sweep cannot double-claim.
create table public.event_reminder_dispatches (
  id uuid primary key,
  order_id uuid not null references public.orders(id),
  event_id uuid not null references public.events(id),
  cadence_step text not null,
  dispatched_at timestamptz not null default now(),
  constraint event_reminder_dispatches_step_check check (
    cadence_step in ('10d', '7d', '3d', '1d', 'day_of')
  ),
  constraint event_reminder_dispatches_order_step_unique unique (order_id, cadence_step)
);

create index event_reminder_dispatches_event_idx
  on public.event_reminder_dispatches (event_id, cadence_step);

-- Admin broadcast campaigns (packages/contracts admin-auth.ts permission 'broadcasts.send', already
-- seeded and granted in 20260723223000_admin_rbac.sql but never wired to a feature until now).
create table public.admin_broadcasts (
  id uuid primary key,
  created_by_admin_id uuid not null references public.admin_accounts(id),
  message_text text not null,
  target_event_id uuid references public.events(id),
  target_order_status text,
  status text not null default 'pending',
  recipient_count integer,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  constraint admin_broadcasts_message_check check (length(btrim(message_text)) between 1 and 3500),
  constraint admin_broadcasts_status_check check (
    status in ('pending', 'sending', 'completed', 'cancelled')
  ),
  constraint admin_broadcasts_target_status_check check (
    target_order_status is null
    or target_order_status in (
      'draft', 'awaiting_offer', 'awaiting_payment', 'payment_processing',
      'paid', 'partially_refunded', 'refunded', 'cancelled', 'expired'
    )
  ),
  constraint admin_broadcasts_counts_check check (sent_count >= 0 and failed_count >= 0),
  constraint admin_broadcasts_recipient_count_check check (
    recipient_count is null or recipient_count >= 0
  ),
  constraint admin_broadcasts_lifecycle_check check (
    (status = 'pending' and started_at is null and completed_at is null)
    or (status = 'sending' and started_at is not null and completed_at is null)
    or (status in ('completed', 'cancelled') and started_at is not null and completed_at is not null)
  )
);

create index admin_broadcasts_status_idx on public.admin_broadcasts (status, created_at);

alter table public.notification_deliveries
  drop constraint notification_deliveries_kind_check;

alter table public.notification_deliveries
  add constraint notification_deliveries_kind_check check (
    kind in (
      'ticket_user', 'admin_purchase',
      'questionnaire_prompt', 'event_reminder', 'admin_broadcast'
    )
  );

insert into public.admin_permissions (code, description) values
  ('participants.export', 'Export paid participant lists as CSV')
on conflict (code) do nothing;

insert into public.admin_role_permissions (role_code, permission_code) values
  ('sales_manager', 'participants.export'),
  ('financial_admin', 'participants.export'),
  ('super_admin', 'participants.export')
on conflict (role_code, permission_code) do nothing;
