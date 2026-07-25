# ADR 0010: T-Bank Payment Reconciliation

## Status

Accepted on 2026-07-25.

## Context

`Init` can time out after T-Bank creates a payment but before the platform receives and persists
`PaymentId`. The order then remains in `payment_processing`, preserving inventory and wallet
reservations, while a second `Init` could create a duplicate charge.

T-Bank exposes `CheckOrder` by the platform's merchant `OrderId` and `GetState` by `PaymentId`.
Because the uncertain path may not have a `PaymentId`, reconciliation must start with
[`CheckOrder`](https://developer.tbank.ru/eacq/api/check-order). Provider calls cannot be part of a
PostgreSQL transaction.

## Decision

- Keep reconciliation disabled by default through `TBANK_RECONCILIATION_ENABLED=false`.
- Claim only stale `creating`, `unknown`, `authorized`, or URL-less `pending` T-Bank attempts
  whose orders remain in `payment_processing`.
- Use a bounded batch and an expiring owner-checked lease acquired with
  `FOR UPDATE SKIP LOCKED`.
- Call `POST /v2/CheckOrder` outside the database transaction with the stable merchant order ID.
- Apply exponential bounded backoff to network, HTTP 429/5xx, and non-JSON provider responses.
- Confirm only one returned payment whose amount exactly matches the immutable attempt and whose
  state is `CONFIRMED`, `Success=true`, and `ErrorCode=0`.
- Reuse the shared idempotent payment-confirmation transaction for order payment, wallet capture,
  inventory consumption, ticket issuance, provider evidence, and outbox publication.
- Require repeated empty `CheckOrder` observations before marking the attempt failed and returning
  the order to `awaiting_payment`.
- Route structurally malformed responses, multiple payments, amount mismatches, invalid confirmed
  outcomes, response-binding failures, and refund states to review. A review result stops
  automatic polling and preserves `payment_processing`.
- Persist every observation in append-only `payment_reconciliation_events`; never store raw
  provider responses or credentials.
- Expose the last successful sweep through worker heartbeat metadata.

## Consequences

- An ambiguous `Init` can be resolved without creating another provider payment.
- A confirmed payment uses the same financial invariants and idempotency path as a signed webhook.
- Temporary provider failures retain reservations and retry with bounded load.
- Empty provider results must be independently repeated before capacity is released.
- Ambiguous, duplicate, mismatched, and refund situations require a reviewed follow-up operation.
- Lease duration must cover the configured sequential batch timeout, preventing overlapping work
  under valid configuration.

## Compatibility And Rollback

Migration `20260725120000_tbank_payment_reconciliation` is expand-only. It adds defaulted or
nullable attempt fields, indexes, and a new append-only event table. Apply it before deploying the
new worker code, with reconciliation disabled.

Rollback sets `TBANK_RECONCILIATION_ENABLED=false` and deploys compatible code. Existing payment
initialization and webhooks may remain enabled. Do not remove columns, events, or leases during an
incident rollback.
