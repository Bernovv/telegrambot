# ADR 0013: Read-Only Administrator Event Catalog

## Status

Accepted on 2026-07-26.

The read-model decision remains active. The no-mutation UI consequence is superseded for draft
general settings by ADR 0014.

## Context

Operators need one event view containing schedule, capacity, products, prices, content, sales
counts, tickets, and the active immutable offer version. These records belong to several modules.
Loading them independently would produce an inconsistent page, while putting joins or publication
rules in the HTTP controller or React application would blur module boundaries.

## Decision

- Add event list and detail projections behind an application repository port.
- Require `events.read` for both operations and validate strict filters before persistence.
- Load each projection in a `REPEATABLE READ READ ONLY` transaction.
- Permit cross-module joins only in this explicit projection adapter; all event, product, price,
  offer, and publication mutations remain behind their owning application services.
- Use opaque cursor pagination ordered by `(created_at, id)`.
- Return money as decimal kopeck strings and timestamps as UTC ISO strings. The UI renders event
  schedule and pricing validity in the event's configured IANA timezone.
- Count only active, unexpired reservations as reserved capacity. Consumed reservations remain a
  separate count.
- Expose only the active immutable offer version's public metadata, never stored offer content or
  acceptance evidence.

## Consequences

- Operators get an internally consistent event snapshot without write locks.
- The screen cannot publish or mutate an event, even if the administrator also has write
  permissions.
- Aggregate queries may need reviewed indexes as production volume grows; plans must be inspected
  in staging before adding versioned indexes.
- Publication validation, audit logging, and optimistic locking remain prerequisites for a future
  write slice.

## Compatibility And Rollback

No migration or data write is introduced. Rollback unregisters the event read API and removes its
BFF allowlist entry and UI routes. Existing sales and publication workflows are unaffected.
