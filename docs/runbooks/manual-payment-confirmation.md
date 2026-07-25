# Manual Payment Confirmation Runbook

## Purpose

Confirm a verified external payment through the same idempotent `PaymentConfirmed` use case used
by payment providers. The operation atomically records evidence, marks the order paid, captures
the wallet hold, consumes inventory, issues tickets, writes audit/history, and publishes outbox
events.

## Preconditions

- Migration `20260724170000_payment_confirmation_tickets` is applied.
- The administrator has `orders.manual_paid`.
- The access token has `aal2`.
- The order is `awaiting_payment` or `payment_processing`.
- The immutable offer is accepted when the order references an offer version.
- The amount and currency exactly match the order's `external_due_kopecks` and `currency`.
- Inventory reservations and any wallet hold are still active.

## Request

```text
POST /api/v1/orders/<order-id>/manual-payment
Authorization: Bearer <access-token>
Idempotency-Key: manual:<stable-operation-id>
X-Request-Id: <request-id>
Content-Type: application/json
```

```json
{
  "amountKopecks": "239000",
  "currency": "RUB",
  "method": "bank_transfer",
  "externalReference": "bank-reference",
  "reason": "Payment verified against the bank statement"
}
```

Retry the exact request with the same idempotency key after a network timeout. A successful retry
returns `created: false` with the original payment and ticket references. Never reuse the key with
different evidence.

## Read-Only Verification

```sql
select id, number, status, total_kopecks, wallet_applied_kopecks,
       external_due_kopecks, currency, paid_at
from public.orders
where id = '<order-id>';
```

```sql
select id, provider, status, amount_kopecks, currency, confirmed_at
from public.payment_attempts
where order_id = '<order-id>'
order by attempt_number;
```

```sql
select transaction_type, status, idempotency_key, posted_at
from public.wallet_transactions
where reference_type = 'order' and reference_id = '<order-id>'
order by created_at;
```

```sql
select status, count(*)
from public.inventory_reservations
where order_id = '<order-id>'
group by status;
```

```sql
select ticket_number, status, issued_at
from public.tickets
where order_id = '<order-id>'
order by ticket_number;
```

## Failure And Recovery

- `Payment amount or currency does not match`: verify the immutable order split; do not edit it.
- `Order reservation has expired`: create a new order instead of reviving the old reservation.
- `Wallet hold requires reconciliation`: stop retries, inspect hold allocations and cached
  balances read-only, then open a financial incident.
- `Inventory consumption requires reconciliation`: stop retries and inspect reservations; do not
  insert or update reservations manually.
- Unknown HTTP outcome: retry the identical request and idempotency key.

Do not update `orders.status`, `wallet_holds`, `wallet_accounts`, reservations, tickets, payment
attempts, or manual payment evidence with ad hoc SQL. Corrections require a reviewed application
use case and append-only financial records.

## Rollback

The migration is expand-only. A code rollback removes the endpoint and leaves payment, ticket,
ledger, audit, and outbox records intact. Dropping these tables is not an automated rollback.
