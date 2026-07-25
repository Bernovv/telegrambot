# ADR 0004: pg-boss Schema Management

## Status

Accepted on 2026-07-22 with explicit user approval for the vendor `delete_queue` function.

## Context

The worker must use pg-boss over PostgreSQL while all database changes remain versioned and
reviewable. pg-boss normally creates or migrates its own schema during `start()`. Runtime DDL is
not acceptable for staging or production, and the application database role must not silently
upgrade queue storage during deployment.

The pg-boss v37 construction plan is additive when installed on a new database. It defines a
vendor `delete_queue` function containing dynamic `DROP TABLE IF EXISTS` and two queue-metadata
`DELETE` statements for explicitly requested queue deletion. The migration does not call that
function. The application does not expose or call `deleteQueue`.

## Decision

- Pin `pg-boss` to `12.26.2` and schema version 37.
- Generate `20260722230000_pgboss_v37_outbox_queues.sql` deterministically from the pinned package.
- Provision `outbox-dispatch` and `outbox-dispatch-dead-letter` in the same versioned migration.
- Publish versioned domain events to `outbox-dispatch` and consume them with pg-boss workers;
  supported notification events use an additional public delivery ledger for side-effect
  idempotency.
- Start pg-boss with `migrate: false`; schema drift or a missing migration fails startup.
- Reject `PG_BOSS_MIGRATE=true` in configuration.
- Allow exactly three audited destructive statements inside `delete_queue` in migration guard,
  matching the vendor function byte-for-byte. Additional destructive statements remain blocked.
- Never call queue deletion from an application runtime. A future queue removal requires a new ADR,
  backup, rollback plan, and explicit production approval.

## Compatibility

The migration only creates the isolated `pgboss` schema and queue metadata. Existing public tables
and records are unchanged. Application deploys may precede the migration, but the worker will stay
unready until schema v37 and both queues exist.

## Verification

- `pnpm db:pgboss:check` verifies the committed SQL against the pinned package output.
- `pnpm db:migrations:check` rejects every destructive statement except the one approved vendor line.
- Worker startup uses pg-boss schema version checks and verifies both required queues and dead-letter
  linkage before claiming outbox events.

## Rollback

Stop the worker and roll back application code first. Do not drop the `pgboss` schema automatically.
Schema removal is destructive and requires a separate reviewed operation after confirming that no
jobs need replay or audit retention.
