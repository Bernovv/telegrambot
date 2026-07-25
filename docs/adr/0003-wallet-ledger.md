# ADR 0003: Wallet Ledger

- Status: Accepted
- Date: 2026-07-22
- Requirements: FR-USER-007, FR-WALLET, AC-PURCHASE-001, AC-PURCHASE-006

## Context

The platform needs phone bonuses, referral rewards, order reservations, captures, releases,
refunds, and audited admin adjustments. A mutable balance on the user record cannot explain
how a balance was produced and cannot safely support retries or concurrent orders.

## Decision

- Store money as PostgreSQL `bigint` kopecks and TypeScript `bigint`.
- Keep one wallet account per user and currency with cached available and held values.
- Record every business operation as an idempotent wallet transaction.
- Record balance effects as append-only credit or debit entries.
- Allocate debits and holds to source credit entries so expiry-aware FIFO can be implemented.
- Lock the wallet account before changing cached values.
- Treat a posted transaction and every ledger entry as immutable. Corrections use a new
  transaction referencing the original transaction.
- Enforce one posted phone bonus per wallet account in addition to the required
  `phone_bonus:<user_id>` idempotency key.

## Consequences

- Cached balances can be rebuilt and checked against the ledger.
- A wallet write requires a transaction, account lock, idempotency key, transaction row,
  entries, and cached-balance update in one commit.
- Holds require explicit allocation rows and lifecycle handling.
- Expired order holds keep their allocation rows, append an `ORDER_RELEASE` transaction, and
  atomically move cached held funds back to available funds.
- Successful payment capture keeps hold allocations, appends one `ORDER_CAPTURE` transaction,
  writes debit entries against each allocated source credit, marks the hold captured, and
  atomically reduces cached held funds.
- Reporting is more verbose than reading a mutable user balance, but it is auditable.

## Compatibility And Rollback

The first wallet migration is expand-only and does not alter existing records. Code rollback
can leave the new tables unused. Schema removal is intentionally excluded from automated
rollback because financial records must not be destroyed.
