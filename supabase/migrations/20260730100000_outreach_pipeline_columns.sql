create table public.outreach_pipeline_columns (
  campaign_id uuid not null references public.outreach_campaigns(id),
  stage text not null,
  label text not null,
  position integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (campaign_id, stage),
  constraint outreach_pipeline_columns_stage_check check (
    stage in (
      'new', 'first_contact', 'dialogue', 'follow_up',
      'interested', 'won', 'lost'
    )
  ),
  constraint outreach_pipeline_columns_label_check check (
    length(btrim(label)) between 1 and 60
  ),
  constraint outreach_pipeline_columns_position_check check (
    position between 1 and 7
  ),
  constraint outreach_pipeline_columns_position_unique
    unique (campaign_id, position) deferrable initially deferred
);

create function public.seed_outreach_pipeline_columns(target_campaign_id uuid)
returns void
language sql
as $$
  insert into public.outreach_pipeline_columns (
    campaign_id, stage, label, position
  ) values
    (target_campaign_id, 'new', 'Новые', 1),
    (target_campaign_id, 'first_contact', 'Первичный контакт', 2),
    (target_campaign_id, 'dialogue', 'В диалоге', 3),
    (target_campaign_id, 'follow_up', 'Думает / перезвонить', 4),
    (target_campaign_id, 'interested', 'Заинтересован', 5),
    (target_campaign_id, 'won', 'Оплатил / зарегистрировался', 6),
    (target_campaign_id, 'lost', 'Закрыто без результата', 7)
  on conflict (campaign_id, stage) do nothing;
$$;

select public.seed_outreach_pipeline_columns(campaign.id)
from public.outreach_campaigns campaign;

create function public.seed_outreach_pipeline_columns_after_campaign()
returns trigger
language plpgsql
as $$
begin
  perform public.seed_outreach_pipeline_columns(new.id);
  return new;
end;
$$;

create trigger outreach_campaigns_seed_pipeline_columns
after insert on public.outreach_campaigns
for each row execute function public.seed_outreach_pipeline_columns_after_campaign();
