# Order Expiry Runbook

## Signals

- Orders remain in an active unpaid status after `expires_at`.
- Inventory stays unavailable after the reservation TTL.
- Wallet accounts retain held funds for expired orders.
- Worker heartbeat metadata has a stale or missing `lastOrderExpirySweepAt`.

## Read-Only Checks

Check overdue active orders:

```sql
select id, status, expires_at, wallet_applied_kopecks
from public.orders
where expires_at <= now()
  and status in ('draft', 'awaiting_offer', 'awaiting_payment', 'payment_processing')
order by expires_at
limit 100;
```

Check active holds for overdue orders:

```sql
select hold.id, hold.reference_id as order_id, hold.amount_kopecks, hold.expires_at
from public.wallet_holds hold
join public.orders orders on orders.id::text = hold.reference_id
where hold.reference_type = 'order'
  and hold.status = 'active'
  and orders.expires_at <= now()
order by orders.expires_at;
```

Inspect worker heartbeat freshness and `lastOrderExpirySweepAt` before taking action.

## Recovery

1. Verify PostgreSQL readiness and worker logs.
2. Restart or scale the worker through the reviewed staging/production operation.
3. Confirm the overdue count decreases and heartbeat metadata advances.
4. If a wallet reconciliation error appears, stop retries for that order and investigate the
   account, hold, hold allocations, and cached balances together.
5. Never repair an order or wallet with direct updates. Use a reviewed reconciliation use case
   and append-only correction records.

## Validation

- The order has status `expired`.
- Inventory reservations have status `expired` and `released_at`.
- The wallet hold has status `expired` and an `ORDER_RELEASE` transaction.
- Cached available/held balances match the release.
- `order_status_history` and `OrderExpired` outbox records exist once.
