# ADR 0006: CI and Ephemeral Migration Testing

## Status

Accepted for the Phase 1 foundation.

## Context

Pull requests must run lint, typecheck, tests, build, migration checks, and dependency review.
Migrations must be verified both on a clean database and on the immediately previous schema.
The repository does not allow destructive operations against developer, staging, or production
databases.

## Decision

- Run CI with read-only repository permissions and commit-SHA-pinned external actions.
- Use a dedicated PostgreSQL service container for migration integration tests.
- Require `APP_ENV=test`, an explicit ephemeral-database confirmation flag, a loopback host, and
  the `postgres` administrative database before migration tests can connect.
- Create databases only under the `ticket_platform_migration_(clean|upgrade)_<pid>` namespace.
- Test all migrations on a clean database.
- Test all but the latest migration, verify that schema, then apply and verify the latest migration.
- Terminate connections and remove only the two namespaced databases in guaranteed cleanup.
- Never run this harness against staging or production.

## Consequences

Migration tests exercise actual PostgreSQL SQL, including pg-boss functions and transaction
boundaries. The harness intentionally uses `DROP DATABASE`, but only after all local safety gates
pass and only for its own loopback test namespace. A developer machine still needs Docker,
Supabase CLI, or PostgreSQL to execute the integration job.
