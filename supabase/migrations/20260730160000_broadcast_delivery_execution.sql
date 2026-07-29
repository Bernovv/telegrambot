alter table public.broadcasts
  add column send_started_at timestamptz,
  add column next_delivery_at timestamptz,
  add column completed_at timestamptz,
  add column paused_at timestamptz,
  add column auto_pause_reason text,
  add column attempted_recipient_count bigint not null default 0,
  add column sent_recipient_count bigint not null default 0,
  add column failed_recipient_count bigint not null default 0;

alter table public.broadcasts
  add constraint broadcasts_execution_counts_check check (
    attempted_recipient_count >= 0
    and sent_recipient_count >= 0
    and failed_recipient_count >= 0
    and sent_recipient_count + failed_recipient_count
      <= attempted_recipient_count
    and (
      reachable_recipient_count is null
      or attempted_recipient_count <= reachable_recipient_count
    )
  ),
  add constraint broadcasts_auto_pause_reason_check check (
    auto_pause_reason is null
    or length(auto_pause_reason) between 1 and 200
  ),
  add constraint broadcasts_execution_timestamps_check check (
    (send_started_at is null or prepared_at is not null)
    and (completed_at is null or lifecycle_status = 'completed')
    and (paused_at is null or lifecycle_status = 'paused')
    and (auto_pause_reason is null or lifecycle_status = 'paused')
  );

create index broadcasts_delivery_due_idx
  on public.broadcasts (next_delivery_at, id)
  where lifecycle_status in ('preparing', 'sending');

create index broadcast_deliveries_stale_lease_idx
  on public.broadcast_deliveries (lease_expires_at, id)
  where status = 'sending';

create table public.broadcast_delivery_rate_gate (
  singleton boolean primary key default true,
  next_delivery_at timestamptz,
  updated_at timestamptz not null,
  constraint broadcast_delivery_rate_gate_singleton_check check (singleton)
);

insert into public.broadcast_delivery_rate_gate (
  singleton, next_delivery_at, updated_at
) values (true, null, now());
