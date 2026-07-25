# ADR 0008: Idempotent Telegram Notification Delivery

## Status

Accepted on 2026-07-24.

## Context

Payment confirmation commits tickets and notification intents through the transactional outbox.
Telegram is an external system and cannot participate in the database transaction. Its
`sendMessage` method does not accept a client idempotency key, so a worker retry must avoid
repeating completed ticket and administrator messages while retaining a bounded recovery path.

## Decision

- Consume versioned domain-event jobs from the existing pg-boss `outbox-dispatch` queue.
- Validate the job envelope and supported event payload before loading delivery context.
- Keep message formatting and retry decisions in an application service, not in the worker or
  grammY adapter.
- Record one delivery per ticket and one delivery per administrator purchase notification.
- Use stable idempotency keys derived from ticket IDs or source event IDs and recipient IDs.
- Treat `TicketRedeliveryRequested` as a separate owner-bound intent. A retry of the same intent is
  a no-op, while a later user request may create another delivery for the same issued ticket.
- Reject redelivery for checked-in, revoked, or refunded tickets without revealing foreign ticket
  ownership.
- Claim a delivery with a bounded lease before calling Telegram.
- Mark `sent` only with the owning worker lease and store the Telegram message ID.
- Keep sent delivery evidence immutable and never delete delivery rows.
- Store no message bodies, bot tokens, ticket tokens, or raw Telegram responses in the delivery
  ledger.
- Reconstruct opaque ticket tokens with the same domain-separated HMAC used at issuance.
- Render a deterministic 512x512 PNG QR in memory after claiming the delivery lease. The QR
  contains only the opaque ticket token and no user, order, event, or payment data.
- Upload ticket PNGs with `sendPhoto` and keep human-readable ticket details in the caption.
- Bound and validate the PNG dimensions, size, MIME type, signature, filename, and Telegram
  caption before upload. Do not persist rendered ticket files.
- Let pg-boss retry failed jobs and route exhausted jobs to the configured dead-letter queue.
- Enable Telegram consumption only through an explicit configuration flag with complete secrets
  and destination settings.

## Consequences

- A retry after a recorded success is a no-op.
- A retry after a partial multi-ticket delivery resumes from the first unsent ticket.
- `/tickets` and `my_tickets` list tickets through the Telegram identity owner; ticket tokens are
  still generated only inside the delivery worker and are not returned by the list query.
- Ticket rendering or upload failures follow the existing leased delivery retry and DLQ path.
- A code or worker restart can regenerate the same QR from the ticket ID and HMAC root secret
  without storing the public token or image.
- Multiple worker replicas cannot claim the same delivery concurrently while its lease is valid.
- There is an unavoidable crash gap if Telegram accepts a message but the worker dies before
  `markSent`. That narrow case can produce one duplicate because Telegram has no client-side
  idempotency primitive. Provider message IDs and the delivery ledger support investigation.
- Unsupported domain events are safely completed without notification side effects.

## Compatibility And Rollback

Migration `20260724190000_notification_delivery_ledger` is expand-only. Code can be deployed with
delivery disabled, then enabled after configuration is verified. A code rollback stops consumers
and leaves queued jobs and append-only delivery evidence intact. Automated table or queue removal
is excluded.
