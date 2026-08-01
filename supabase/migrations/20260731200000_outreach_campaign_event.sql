-- Кампания знает, на какое мероприятие продаёт.
--
-- Связь необязательная и живёт на кампании, а не на контакте: человек за год съездит на
-- несколько мероприятий, и привязывать к событию его самого — значит плодить дубли одного
-- и того же человека. На одно мероприятие при этом можно вести несколько кампаний:
-- холодную базу и повторных клиентов ведут по-разному.

alter table public.outreach_campaigns
  add column if not exists event_id uuid references public.events(id);

comment on column public.outreach_campaigns.event_id is
  'Мероприятие, на которое продаёт кампания. Пусто у кампаний без привязки к событию.';

create index if not exists outreach_campaigns_event_idx
  on public.outreach_campaigns (event_id)
  where event_id is not null;
