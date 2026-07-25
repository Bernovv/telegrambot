# ADR 0011: Safe Full T-Bank Refunds

## Status

Accepted on 2026-07-25.

## Context

A T-Bank `Cancel` call can complete after the client times out, and the provider can report the
result through either the immediate response, a signed notification, or later reconciliation.
Changing an order on the strength of an administrator request or browser redirect would risk
returning wallet funds and revoking tickets without a confirmed external refund.

T-Bank supports full and partial refunds through
[`Cancel`](https://developer.tbank.ru/eacq/api/cancel). Partial refunds require an item-level
fiscal receipt when an online cashbox is enabled. The project does not yet have an approved
refund `Receipt.Items` mapping or referral commission module.

## Decision

- Support full refunds only. Omit `Amount` and `Receipt` from `Cancel`; do not emulate partial
  refunds.
- Require the MFA-sensitive `payments.refund` permission and a stable API idempotency key.
- Persist an immutable refund intent before calling T-Bank. Use a UUIDv4 `ExternalRequestId` and
  reuse it for uncertain retries.
- Call the provider outside PostgreSQL transactions.
- Complete local financial state only from exact `REFUNDED` evidence bound to the original
  `PaymentId`, merchant order ID, RUB amount, and a zero remaining provider amount.
- Accept evidence from the signed webhook, the `Cancel` response, or leased reconciliation.
- Keep provider observations append-only and move malformed, partial, mismatched, or otherwise
  unsafe outcomes to review.
- In one transaction, change the succeeded payment attempt and paid order to `refunded`, revoke
  every issued ticket, append order history, create a posted `REFUND_CREDIT` linked to the
  original `ORDER_CAPTURE`, restore the cached wallet balance, and write audit evidence.
- Reject requests and finalization when any ticket is already checked in. Recheck the complete
  ticket set during finalization and roll back if it changed.
- Do not add referral reversal placeholders. The current payment path creates no referral
  commission. A future referral slice must add commission creation and proportional reversal in
  the same refund finalization transaction before referral payments can be enabled.

## Consequences

- A timeout cannot cause a second logical refund: reconciliation repeats `Cancel` with the same
  provider idempotency identifier.
- Webhook and reconciliation use the same local finalization transaction.
- Wallet history remains append-only and explains both capture and refund.
- Checked-in orders and partial provider outcomes require reviewed operations.
- Full refunds must remain unavailable in production until fiscal configuration, refund policy,
  staging UAT, and rollback procedures are approved.

## Compatibility And Rollback

Migration `20260725160000_tbank_full_refunds` is expand-only. It adds immutable refund requests,
append-only provider events, indexes, and protection triggers. Apply it before deploying the API
and worker code.

Rollback removes access to `POST /api/v1/orders/:id/refunds/full` by disabling T-Bank payments or
administrator access and stops recovery with `TBANK_RECONCILIATION_ENABLED=false`. Existing
refund requests and evidence remain readable. Do not drop refund tables or reverse completed
financial entries during an incident rollback.
