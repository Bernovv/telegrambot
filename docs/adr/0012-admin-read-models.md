# ADR 0012: Read-Only Administrator Projections

## Status

Accepted on 2026-07-25.

## Context

Administrator user and order screens need data owned by identity, contacts, wallet, sales,
payments, and tickets. Calling each write-oriented application service would not provide a
consistent page and would add transport-specific orchestration. Direct ad hoc SQL in controllers
would bypass boundary validation and make future writes unsafe.

## Decision

- Define administrator user and order projections as application ports.
- Implement the projections in one database adapter using
  `REPEATABLE READ READ ONLY` transactions.
- Keep all mutation use cases behind their owning module's public application service. The read
  adapter must never update data or become a shortcut for write operations.
- Require `users.read` for user list/detail and `orders.read` for order list/detail.
- Use strict HTTP query validation and cursor pagination ordered by immutable `(timestamp, UUID)`
  tuples. Money leaves the API as decimal kopeck strings and timestamps as UTC ISO strings.
- Mask phone contacts in normal read operations. Raw contact exports require the separate
  `contacts.export` permission and are outside this slice.
- Parameterize search and escape SQL wildcard characters. Unknown filters fail before reaching
  persistence.

## Consequences

- One detail response is internally consistent without taking write locks.
- Read-heavy admin screens do not place business logic in Nest controllers or UI components.
- New fields can be added without changing financial write paths.
- Cross-module joins are permitted only inside this explicit read-model adapter.

## Compatibility And Rollback

This slice adds no migration and no database writes. Rollback removes the registered
`adminOperations` API module. Existing data and write workflows are unaffected.
