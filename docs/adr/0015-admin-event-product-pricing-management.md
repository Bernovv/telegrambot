# ADR 0015: Draft Product And Simple Pricing Management

## Status

Accepted on 2026-07-26.

## Context

Content managers need to configure saleable products and deterministic price rules before an event
can be published. Product capacity and prices participate in order creation, so stale administrator
updates must not race with order inventory locking or rewrite immutable order snapshots.

## Decision

- Add draft-only create and update operations for event products and their simple pricing rules.
- Protect every operation with `events.write`, a human-entered reason, and the event's exact
  `expectedLockVersion`.
- Serialize mutations with the existing `event-sales:<eventId>` transaction advisory lock and an
  event row lock. Increment the aggregate lock version exactly once on success.
- Keep product and pricing rows instead of physically deleting them. Operators disable them with
  `isActive`.
- Accept money as an integer-kopeck decimal string at the API boundary and convert a ruble form
  value using `BigInt` only.
- Restrict this slice to deterministic quantity, validity-window, priority, and unit-price rules.
  Persist empty conditions and specificity zero until conditional rule semantics have a separately
  reviewed application contract.
- Require a product's price currency to match its product currency.
- Append masked before/after audit data in the same transaction as every mutation.
- Keep published events immutable through these operations. Existing order and offer snapshots are
  never rewritten.

## Consequences

- Product codes are unique within an event and conflicting or stale writes return HTTP 409.
- Catalog writes use the same concurrency boundary as checkout, so future lifecycle expansion will
  not introduce a second event-level lock protocol.
- Deactivation preserves financial and operational history.
- Conditional pricing, bundle semantics beyond validated composition JSON, publication, and
  destructive catalog cleanup remain outside this slice.

## Compatibility And Rollback

No migration is introduced. Rollback removes the four handlers and their BFF allowlist entries.
Existing product, pricing, event, order, offer, audit, and financial rows remain valid.
