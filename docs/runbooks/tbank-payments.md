# T-Bank Payments Runbook

## Purpose

Operate one-stage T-Bank payment initialization and signed webhook confirmation without trusting
browser redirects or manually changing financial state.

## Enablement

Keep `TBANK_PAYMENTS_ENABLED=false` until all of the following are verified in staging:

- migration `20260724220000_tbank_payment_attempts_webhooks` is applied;
- migration `20260725120000_tbank_payment_reconciliation` is applied before enabling worker
  reconciliation;
- migration `20260725160000_tbank_full_refunds` is applied before enabling full refunds;
- the terminal credentials belong to the intended environment;
- `TBANK_API_BASE_URL` is the official test or production v2 endpoint;
- notification, success, and failure URLs are public HTTPS URLs;
- the terminal and fiscal receipt configuration are approved for one-stage payments;
- `ORDER_TOKEN_SECRET` is configured and stable;
- the provider can reach `POST /webhooks/payments/tbank`;
- a real low-value staging payment reaches `CONFIRMED` and issues one ticket exactly once.
- a reviewed low-value staging full refund reaches `REFUNDED`, revokes every issued ticket, and
  restores only the wallet amount captured by that order.

Never place terminal credentials in the repository or logs. Production variables and deployment
require separate approval.

Reconciliation is a separate worker feature. Keep `TBANK_RECONCILIATION_ENABLED=false` during
migration and initial deployment. To enable it in staging, configure:

- `TBANK_RECONCILIATION_BATCH_SIZE=10`;
- `TBANK_RECONCILIATION_LEASE_SECONDS=120`;
- `TBANK_RECONCILIATION_POLL_INTERVAL_MS=15000`;
- `TBANK_RECONCILIATION_INITIAL_DELAY_SECONDS=60`;
- `TBANK_RECONCILIATION_RETRY_BASE_SECONDS=30`;
- `TBANK_RECONCILIATION_RETRY_MAX_SECONDS=3600`;
- `TBANK_RECONCILIATION_EMPTY_THRESHOLD=3`.

The worker also requires the same stable `ORDER_TOKEN_SECRET` used for ticket references. The
lease must cover the configured sequential batch timeout; invalid combinations fail at startup.

## Expected Flow

1. Telegram `payment_init:<opaque-order-token>` locks the owner-bound payable order.
2. The platform creates a `creating` attempt and commits it.
   The order becomes `payment_processing`, which pauses normal TTL expiry.
3. T-Bank `Init` returns a bound `PaymentId`, `PaymentURL`, and `Status=NEW`.
4. The attempt becomes `pending`; duplicate callbacks reuse its URL.
5. `AUTHORIZED` is recorded but does not pay the order.
6. Signed `CONFIRMED` atomically pays the order, captures wallet funds, consumes inventory,
   issues tickets, records evidence, and publishes notification work.
7. If `Init` or a webhook outcome is uncertain, the worker checks the merchant order through
   T-Bank `CheckOrder`; it never issues a second `Init`.

## Full Refund Flow

1. A finance administrator with an `aal2` session calls
   `POST /api/v1/orders/:id/refunds/full` with `Idempotency-Key` and a reason.
2. The platform locks the paid order and succeeded T-Bank attempt, rejects checked-in tickets,
   and commits an immutable refund intent with a UUIDv4 `ExternalRequestId`.
3. The API calls T-Bank `Cancel` outside the transaction without `Amount` or `Receipt`.
4. Exact `REFUNDED` evidence from `Cancel`, the signed webhook, or reconciliation finalizes the
   refund once. `REFUNDING` remains pending and uncertain calls retry with the same
   `ExternalRequestId`.
5. Finalization atomically refunds the attempt and order, revokes all issued tickets, appends
   order history and audit, and creates `REFUND_CREDIT` linked to the original wallet capture.

Partial refunds are unsupported. Never add an `Amount` or fiscal receipt ad hoc; first approve
the refund policy, item allocation, taxation, VAT, and `Receipt.Items` mapping.

## Read-Only Verification

```sql
select id, order_id, attempt_number, status, merchant_order_id,
       provider_payment_id, provider_status, initialization_error_code,
       amount_kopecks, currency, initialized_at, confirmed_at,
       reconciliation_attempt_count, reconciliation_empty_count,
       reconciliation_last_attempt_at, reconciliation_next_attempt_at,
       reconciliation_locked_by, reconciliation_locked_until,
       reconciliation_last_result, updated_at
from public.payment_attempts
where provider = 'tbank' and order_id = '<order-id>'
order by attempt_number;
```

```sql
select payment_attempt_id, event_type, result_code, payment_count,
       provider_payment_id, provider_status, observed_at
from public.payment_reconciliation_events
where payment_attempt_id = '<payment-attempt-id>'
order by observed_at;
```

```sql
select id, order_id, payment_attempt_id, status, external_request_id,
       external_amount_kopecks, wallet_amount_kopecks, currency,
       provider_status, last_result_code, requested_at, completed_at,
       reconciliation_attempt_count, reconciliation_next_attempt_at,
       reconciliation_locked_by, reconciliation_locked_until
from public.payment_refund_requests
where order_id = '<order-id>'
order by requested_at;
```

```sql
select refund_request_id, origin, event_type, result_code,
       provider_status, observed_at
from public.payment_refund_events
where refund_request_id = '<refund-request-id>'
order by observed_at;
```

```sql
select payment_attempt_id, provider_payment_id, merchant_order_id,
       provider_status, success, error_code, amount_kopecks,
       outcome, received_at
from public.payment_provider_events
where merchant_order_id = '<merchant-order-id>'
order by received_at;
```

```sql
select id, number, status, external_due_kopecks, currency, paid_at
from public.orders
where id = '<order-id>';
```

Do not expose `payload_hash` in routine support output. It is evidence for controlled
investigation, not a user-facing identifier.

## Failure And Recovery

- `creating`: an `Init` operation is in flight. Wait for its bounded HTTP timeout.
- `unknown`: the provider outcome is ambiguous. When reconciliation is enabled, the worker checks
  the merchant order ID with bounded backoff. It never retries `Init`.
- `payment_processing`: inventory and wallet reservations intentionally remain active past the
  original order TTL while the provider outcome is pending or unknown.
- `failed`: a non-retryable `Init` failure was recorded. A later user callback may create the next
  numbered attempt. The order returns to `awaiting_payment`, so an elapsed TTL can expire it.
- `authorized`: funds may be authorized, but no ticket may be issued until `CONFIRMED`.
- `review` provider event: inspect the terminal, payment ID, merchant order ID, amount, and order
  read-only. A refund notification is handled only when it matches an active immutable full
  refund; unbound, partial, and mismatched notifications remain review evidence.
- `reconciliation_last_result=EMPTY`: the provider returned no payments. Capacity is released
  only after the configured number of repeated observations.
- `reconciliation_last_result=REVIEW:*`: automatic polling has stopped. Compare the immutable
  amount, merchant order ID, provider payment IDs, provider status, and append-only evidence
  read-only. Do not clear the review marker with ad hoc SQL.
- stale `unknown` or `payment_processing` without advancing reconciliation heartbeat metadata:
  verify worker health and credentials, then restart or scale through a reviewed operation.
- webhook HTTP 401: verify terminal credentials and token generation; do not log the body or
  password.
- webhook HTTP 500: restore database/application availability. T-Bank will retry; do not manually
  mark the order paid.
- refund `unknown`: the worker repeats `Cancel` with the stored `ExternalRequestId`; never create a
  new refund request or change that identifier.
- refund `submitted`: the worker uses `CheckOrder` until it observes exact `REFUNDED`.
- refund `review`: compare the immutable amount and provider binding read-only. Do not mark the
  request succeeded or restore wallet funds with SQL.
- `Order requires refund reconciliation` or `Ticket refund set changed`: stop automatic retries
  for that request and investigate order/ticket concurrency. Checked-in tickets are intentionally
  not auto-refunded.

Never update payment attempts, provider events, orders, wallet rows, reservations, or tickets with
ad hoc SQL. Corrections require a reviewed idempotent application operation and append-only
evidence.

## Rollback

Set `TBANK_RECONCILIATION_ENABLED=false` to stop provider polling while preserving payment
buttons, webhooks, attempts, leases, and evidence. Set `TBANK_PAYMENTS_ENABLED=false` as well only
when initialization and webhook handling must be disabled. Do not drop columns or evidence tables
during incident rollback.
