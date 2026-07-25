# ADR 0007: Event Sales And Immutable Order Snapshots

- Status: Accepted
- Date: 2026-07-24
- Requirements: FR-EVENT, FR-PRICE, FR-ORDER, FR-OFFER, FR-WALLET, AC-PURCHASE-003,
  AC-PURCHASE-004, AC-PURCHASE-005, AC-PURCHASE-006

## Context

An order must retain the event, product, rule, price, offer, wallet split, and expiry that the
buyer saw. Later catalog edits must not change an existing order. Concurrent purchases must not
oversell event or product capacity, and retries must not create another reservation or wallet
hold.

## Decision

- Store event, product, pricing, and offer data in normalized catalog tables.
- Store every monetary value as PostgreSQL `bigint` kopecks and TypeScript `bigint`.
- Rank pricing rules by explicit priority, specificity, `valid_from`, and deterministic ID.
  Reject equally ranked matching rules as a configuration error.
- Store versioned event, product, and pricing JSONB snapshots on the order and order items.
- Freeze order composition after offer acceptance and protect snapshots with database triggers.
- Keep published offer content immutable; only its active routing flag can change.
- Centralize order state transitions in the domain and enforce the same transition graph in
  PostgreSQL.
- Acquire a transaction-scoped advisory lock for the event before reading capacity and creating
  reservations.
- Use a 30-minute default reservation TTL and count only active, unexpired reservations.
- Allocate wallet holds against unspent credit entries in expiry-aware FIFO order while holding
  a row lock on the wallet account.
- Make order creation idempotent with a unique key and SHA-256 request fingerprint.
- Derive the public callback token deterministically with HMAC, persist only its SHA-256 hash,
  and require an explicit production secret.
- Resolve Telegram offer callbacks by the stored token hash and the order owner's messenger
  identity, returning the same not-found result for unknown and foreign tokens.
- Lock the order row before acceptance, persist the pinned offer text and Telegram callback
  evidence append-only, then transition to `awaiting_payment`.
- Treat a repeated acceptance as a successful no-op without another history or outbox record.
- Claim overdue unpaid orders in bounded worker batches with `FOR UPDATE SKIP LOCKED`.
- Expire the order, inventory reservations, and active wallet hold in one transaction.
- Return held funds to cached available balance, retain hold allocations, and append an
  idempotent `ORDER_RELEASE` transaction instead of deleting financial records.
- Route manual, fake, and provider success through one idempotent `PaymentConfirmed` use case.
- Lock the payment idempotency key and order, then atomically persist payment evidence, transition
  the order to `paid`, consume inventory, capture wallet allocations, issue unique tickets, append
  history/audit, and publish post-commit work through the outbox.
- Derive opaque ticket tokens with domain-separated HMAC and persist only SHA-256 token hashes.
- Deliver issued tickets and administrator purchase notifications only after commit through
  versioned outbox jobs and an idempotent leased delivery ledger.
- Write initial status history and `OrderCreated` outbox event in the order transaction.

## Consequences

- Catalog changes are safe for existing orders and accepted offers.
- A create-order retry returns the existing order; reuse of the same key for another payload is
  rejected.
- A duplicate Telegram acceptance closes the callback without trying to edit the message again.
- Multiple worker replicas can sweep overdue orders without duplicate expiry effects.
- Duplicate payment confirmation returns the original payment and tickets without another ledger
  capture, reservation transition, audit record, or outbox event.
- Administrative catalog writes must use the same event lock before changing sale-critical data.

## Compatibility And Rollback

Migration `20260724120000_event_sales_catalog_orders` is expand-only and applies after the Phase 1
schema. A code rollback leaves its empty tables and permissions unused. Automated schema removal
is excluded because accepted offers, order history, wallet allocations, and tickets are durable
business records.
