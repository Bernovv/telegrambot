# ADR 0009: T-Bank Payment Initialization And Webhooks

## Status

Accepted on 2026-07-24.

## Context

The Telegram checkout needs an external payment page while order totals, wallet allocation,
inventory, and tickets remain controlled by the platform. T-Bank `Init` is a network call and
cannot share the PostgreSQL transaction. A timeout can therefore leave an unknown provider
outcome. User redirects are not authoritative; only a signed provider notification with
`Status=CONFIRMED`, `Success=true`, and `ErrorCode=0` may confirm an order.

## Decision

- Keep the integration disabled by default through `TBANK_PAYMENTS_ENABLED=false`.
- Support only one-stage payments (`PayType=O`) in this slice.
- Create and commit a `creating` payment attempt before calling `POST /v2/Init`.
- Move the order from `awaiting_payment` to `payment_processing` in that transaction and append
  status history. The expiry worker does not release a payment-processing reservation.
- Use a stable, unique merchant order ID and integer kopecks from the immutable order split.
- Reuse a persisted `pending` payment URL on duplicate Telegram callbacks.
- Move retryable or ambiguous `Init` failures to `unknown`; do not create another attempt until
  the first result is reconciled.
- Return a definite initialization failure or provider cancellation to `awaiting_payment`, with
  append-only status history, so normal expiry can resume.
- Put the T-Bank client behind an application port and allow only the official test and production
  HTTPS v2 endpoints.
- Generate request and webhook tokens from root scalar fields plus the terminal password, sorted
  by field name and hashed with SHA-256.
- Validate webhook structure, terminal, amount, merchant order ID, provider payment ID, and token
  before invoking application logic.
- Return HTTP 200 with the exact plain-text body `OK` after every valid notification is durably
  processed or recorded for review.
- Treat only a valid `CONFIRMED` notification as payment confirmation. `AUTHORIZED` records an
  intermediate state and never issues tickets.
- Update the existing attempt to `succeeded` in the same transaction that pays the order,
  captures the wallet hold, consumes inventory, issues tickets, stores webhook evidence, and
  publishes outbox events.
- Deduplicate provider notifications by a stable `event_key`.
- Store only a canonical payload hash and bounded scalar evidence. Do not store raw provider
  payloads, passwords, tokens, card data, or receipt data.
- Record unknown attempts, binding mismatches, invalid confirmed outcomes, and refund statuses as
  append-only `review` events. Refund execution is outside this slice.

## Consequences

- A user can safely press the payment button again after a completed `Init`.
- A network timeout fails closed and requires reconciliation instead of risking two charges.
- An in-flight provider payment keeps active inventory and wallet reservations even after their
  original timestamp. Confirmation still requires those reservations to be active; it never
  revives released rows.
- Webhook retries after a committed confirmation are idempotent through the original attempt key.
- A failure anywhere in confirmation rolls back the attempt transition, provider event, order,
  wallet capture, inventory consumption, tickets, and outbox writes together.
- A valid but unmatched webhook is acknowledged to stop provider retries and remains visible in
  the review ledger.
- Redirect success or failure pages are presentation only and cannot change financial state.

## Compatibility And Rollback

Migration `20260724220000_tbank_payment_attempts_webhooks` is expand-only. It adds nullable columns
to `payment_attempts` and creates an append-only provider-event table. Old code continues to use
the existing payment schema. Deploy with the feature disabled, apply the migration, verify
configuration and fiscal requirements, then enable in staging. A code rollback disables new
initialization and webhook routes while retaining all payment evidence. Automated schema removal
is excluded.
