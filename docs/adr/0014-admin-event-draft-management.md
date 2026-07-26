# ADR 0014: Audited Administrator Event Draft Management

## Status

Accepted on 2026-07-26.

## Context

Content managers need to create event drafts and maintain general schedule, venue, capacity, and
purchase-policy fields. Direct table updates would bypass application validation and audit. A
stale browser tab could also overwrite another administrator's changes.

## Decision

- Add `POST /api/v1/events` and `PATCH /api/v1/events/:id/general`, both protected by
  `events.write`.
- These commands only create or update `draft` events. Published, paused, completed, sold-out, and
  archived events are outside this operation.
- Require a human-entered reason and write append-only before/after audit in the same transaction
  as the event mutation.
- Require `expectedLockVersion` for updates. Lock the event row, compare the exact version, and
  increment it once on success. A stale version returns HTTP 409 without a write.
- Serialize slug claims with a transaction-scoped advisory lock and retain the database unique
  constraint as the final invariant.
- Validate lengths, integer bounds, RFC 3339 timestamps, date ordering, and the configured IANA
  timezone at the application boundary.
- Keep product, price, content, offer, scenario, and publication writes outside this contract.
  Product and simple pricing management is introduced separately by ADR 0015.
- Permit browser mutations only through a same-origin BFF request with an explicit method/path
  allowlist, JSON content type, 64 KiB limit, and server-side Supabase session.

## Consequences

- Draft changes are attributable and cannot silently overwrite a newer version.
- An audit failure rolls back the event write.
- Creation is not financially sensitive and is not added to the financial idempotency ledger;
  slug uniqueness and disabled repeat submission prevent ordinary duplicates.
- Publication requires a separate validation checklist, audit action, and `events.publish`
  permission.

## Compatibility And Rollback

No migration is introduced. Rollback removes the two command handlers and BFF mutation allowlist.
Existing drafts, audit rows, sales, orders, and published events remain valid.
