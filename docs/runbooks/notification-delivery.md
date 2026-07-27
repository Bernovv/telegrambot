# Telegram Notification Delivery Runbook

## Enablement

Apply all migrations, then configure the worker:

```text
TELEGRAM_NOTIFICATIONS_ENABLED=true
TELEGRAM_BOT_TOKEN=<secret>
ADMIN_NOTIFICATION_TELEGRAM_CHAT_ID=<numeric-chat-id>[,<numeric-chat-id>...]
ORDER_TOKEN_SECRET=<same-secret-as-api>
NOTIFICATION_DELIVERY_LEASE_SECONDS=60
NOTIFICATION_WORKER_CONCURRENCY=2
```

Restart the worker and verify that its startup log does not contain
`telegram notification consumer disabled`. Do not log or place bot/token secrets in tickets,
issues, Graphify, or runbook output.

## Signals

```sql
select status, kind, count(*)
from public.notification_deliveries
group by status, kind
order by status, kind;
```

```sql
select id, kind, aggregate_id, recipient_id, status, attempt_count,
       last_error_code, updated_at, sent_at
from public.notification_deliveries
where status <> 'sent'
order by updated_at
limit 100;
```

```sql
select state, count(*)
from pgboss.job
where name in ('outbox-dispatch', 'outbox-dispatch-dead-letter')
group by state
order by state;
```

Never select or expose `TELEGRAM_BOT_TOKEN`, `ORDER_TOKEN_SECRET`, or generated ticket tokens.
Ticket PNGs are rendered in worker memory and must not be written to logs, issue attachments,
Graphify input, object storage, or the database during routine delivery.

## Recovery

- `failed` delivery: inspect only `last_error_code`, recipient availability, worker logs, and
  Telegram bot membership. The pg-boss retry remains authoritative.
- Stale `sending`: confirm the owning worker is stopped. The next job attempt may reclaim it after
  `lease_expires_at`.
- Dead-letter job: fix configuration or recipient state, then use a reviewed pg-boss redrive
  operation. Do not insert another outbox event or delivery row manually.
- Missing Telegram identity: ask the user to reopen the private bot chat, then redrive the job.
- Bot blocked: retain the failed delivery for support follow-up; do not mark it sent.
- User redelivery: ask the user to open `/tickets` or «Мои билеты». Do not create a ticket or
  outbox row manually; the owner-bound callback emits `TicketRedeliveryRequested`.
- Unknown outcome around a worker crash: inspect the chat and delivery row before redrive. Telegram
  may have accepted the message before `markSent`, so one duplicate is possible.

## Validation

For a paid test order:

1. Every issued ticket has one `ticket_user` delivery with `status = 'sent'`.
2. The payment notification event has one `admin_purchase` delivery with `status = 'sent'`.
3. `provider_message_id` is present for sent rows.
4. Reprocessing the same jobs does not increase Telegram send count.
5. No message body or ticket token is stored in `notification_deliveries`.
6. Repeating one redelivery callback update creates one outbox intent; a later callback may create
   another `ticket_user` delivery for the same still-issued ticket.
7. Checked-in, revoked, refunded, foreign, and unknown tickets cannot request redelivery.
8. The user receives a 512x512 PNG through Telegram `sendPhoto`; scanning it yields the same
   43-character opaque token shown in the caption.
9. The QR contains no phone, Telegram ID, user ID, order number, event title, or payment data.

## Rollback

Set `TELEGRAM_NOTIFICATIONS_ENABLED=false` and restart the worker. Jobs remain in pg-boss for later
processing and sent evidence remains immutable. Do not delete queue jobs or delivery rows.
