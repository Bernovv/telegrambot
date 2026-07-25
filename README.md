# Telegram Ticket Platform

Monorepo for the Telegram-first ticket sales platform described in the parent technical specification.

## Current Slice

Phase 1 foundation is code-complete. The current Phase 2 slice adds event sales, immutable order
snapshots, inventory reservations, and wallet-backed checkout.

- `apps/api` - HTTP API, webhooks, health endpoints.
- `apps/telegram-bot` - Telegram transport process.
- `apps/worker` - background jobs and scheduler process.
- `apps/admin-web` - admin panel shell.
- `packages/*` - shared modular-monolith packages.
- `supabase/migrations` - versioned PostgreSQL migrations.

Implemented critical-path foundations:

- idempotent Telegram `/start` identity upsert and attribution;
- owned-contact verification with strict E.164 normalization;
- one-time configurable phone bonus;
- transactional outbox and PostgreSQL unit of work;
- append-only wallet transactions and entries with hold allocations.
- shared grammY transport for long polling and webhook delivery;
- NestJS/Fastify Telegram webhook with schema, dual-secret, and body-limit checks.
- pg-boss outbox dispatcher with leased PostgreSQL claims, retry backoff, and worker heartbeat.
- liveness and aggregate readiness checks for PostgreSQL, migrations, pg-boss, workers, and outbox lag.
- database-backed administrator RBAC with asymmetric JWT verification and MFA enforcement.
- bigint-only deterministic pricing and centralized order state transitions;
- event, product, pricing, offer, order, reservation, and ticket schema;
- idempotent order creation with event locking, FIFO wallet holds, and transactional outbox;
- HMAC-derived opaque order tokens with only hashes stored in PostgreSQL;
- authenticated and boundary-validated `POST /api/v1/orders`.
- owner-bound, idempotent Telegram offer acceptance with immutable evidence and status history.
- multi-replica-safe order expiry with atomic inventory and wallet release.
- shared idempotent payment confirmation with atomic wallet capture and inventory consumption.
- append-only manual payment evidence, audit history, HMAC ticket references, and ticket issuance.
- MFA-protected manual payment API with post-commit payment, ticket, and admin outbox events.
- pg-boss notification consumer with per-ticket idempotency, leased delivery records, Telegram
  ticket messages, and administrator purchase notifications.
- owner-bound `/tickets` and «Мои билеты» views with explicit, idempotent ticket redelivery.
- deterministic in-memory QR PNG rendering and Telegram photo delivery without persisted tokens
  or ticket files.
- feature-gated T-Bank one-stage `Init`, owner-bound Telegram payment buttons, signed webhook
  verification, append-only provider evidence, and atomic `CONFIRMED` ticket issuance.
- separately gated T-Bank `CheckOrder` reconciliation with leased claims, bounded backoff,
  repeated-empty protection, append-only observations, and shared atomic confirmation.
- MFA-protected full T-Bank refunds with immutable intent, stable provider idempotency,
  signed-webhook/reconciliation completion, ticket revocation, wallet reversal, and audit.
- RBAC-protected administrator user/order lists and details with opaque cursor pagination,
  masked contacts, UTC timestamps, kopeck strings, and repeatable read-only snapshots.

## Local Commands

```bash
pnpm install
pnpm ci:check
pnpm lint
pnpm typecheck
pnpm test
pnpm db:migrate
pnpm db:pgboss:check
```

After the local PostgreSQL schema and seed are applied, the Telegram transport can run in
long-polling mode with values from `.env`:

```bash
pnpm --filter @ticket-platform/telegram-bot dev
```

Production defaults to webhook delivery. Webhook hosting and secret validation belong to the
API runtime. Configure `TELEGRAM_WEBHOOK_PATH_SECRET` and `TELEGRAM_WEBHOOK_SECRET` with
different URL-safe values of at least 32 characters, then start:

```bash
pnpm --filter @ticket-platform/api dev
```

The endpoint is `POST /webhooks/telegram/<TELEGRAM_WEBHOOK_PATH_SECRET>` and requires the
`X-Telegram-Bot-Api-Secret-Token` header. Telegram `setWebhook` is intentionally not called at
startup; register it through a reviewed deployment operation using the same endpoint and header
secret. A failed update returns a non-2xx response so Telegram can retry it.

Use `GET /health/live` for process liveness and `GET /health/ready` for Railway readiness.
Readiness returns HTTP 503 for failed dependencies and does not expose component details.
Operational thresholds and response semantics are documented in
`docs/runbooks/health-readiness.md`.

Administrator authentication is disabled by default outside production. Configure
`ADMIN_AUTH_ISSUER` with the trusted OIDC/Supabase Auth issuer and enable `ADMIN_AUTH_ENABLED`.
The protected `GET /api/v1/operations/health` endpoint requires `system.read` and returns
component diagnostics. The API accepts only asymmetric `ES256` or `RS256` JWT signing keys;
financial and other sensitive permissions require an `aal2` session.

Order creation additionally requires `ORDER_TOKEN_SECRET` in production and the
`orders.create` permission. The secret derives stable opaque callback tokens and is never stored
in the database; only each token's SHA-256 hash is persisted. The same root secret is
domain-separated for ticket tokens, and only ticket token hashes are stored.

Manual payment confirmation uses `POST /api/v1/orders/:id/manual-payment`, requires
`orders.manual_paid` with an `aal2` administrator session, and requires a stable
`Idempotency-Key`. Operational recovery is documented in
`docs/runbooks/manual-payment-confirmation.md`.

T-Bank payments are disabled by default. Enabling them registers
`POST /webhooks/payments/tbank` and adds payment callbacks to accepted Telegram offers. Only a
signed `CONFIRMED` notification can pay an order; browser redirects have no financial authority.
Configuration, staging verification, ambiguous `Init` recovery, and rollback are documented in
`docs/runbooks/tbank-payments.md`.

Automatic T-Bank reconciliation is independently disabled by default. Apply migration
`20260725120000_tbank_payment_reconciliation` before enabling
`TBANK_RECONCILIATION_ENABLED` on the worker. It never creates a second payment: it only checks
the stable merchant order ID and confirms an exact, unambiguous provider result.

Full T-Bank refunds use `POST /api/v1/orders/:id/refunds/full`, require `payments.refund` with an
`aal2` administrator session, and require a stable `Idempotency-Key`. Apply migration
`20260725160000_tbank_full_refunds` first. Only exact provider `REFUNDED` evidence changes local
financial state. Partial refunds and refunds of checked-in tickets are intentionally unsupported;
see `docs/adr/0011-tbank-full-refunds.md` and `docs/runbooks/tbank-payments.md`.

Administrator read operations use `GET /api/v1/users`, `GET /api/v1/users/:id`,
`GET /api/v1/orders`, and `GET /api/v1/orders/:id`. They require `users.read` or `orders.read`,
never expose raw phone contacts, and use opaque cursors. Operational details are in
`docs/runbooks/admin-read-operations.md`.

After the RBAC migration is applied, the first super administrator can be created once with
`pnpm admin:bootstrap`. The operation requires `DATABASE_DIRECT_URL`, the
`ADMIN_BOOTSTRAP_*` values from `.env.example`, and the exact confirmation phrase
`bootstrap-first-super-admin`. It uses one transaction and writes an audit row. Never run it
against production without a reviewed change and explicit approval.

After all versioned migrations have been applied, run the outbox worker with:

```bash
pnpm --filter @ticket-platform/worker dev
```

The worker never migrates pg-boss at runtime. It verifies schema v37, the `outbox-dispatch` queue,
and its dead-letter queue before claiming events. The outbox `event_id` is reused as the pg-boss
job UUID, so a crash between publish and `processed_at` produces a harmless duplicate insert.

Telegram notification consumption is disabled by default. Enable it only after configuring the
worker values documented in `docs/runbooks/notification-delivery.md`. Delivery rows do not contain
message bodies or ticket tokens; successful rows retain only the Telegram message ID.

The local database workflow should use Supabase CLI or Docker Compose PostgreSQL. Production schema changes must go through versioned migrations and human review.

CI runs frozen dependency installation, dependency review, real type-aware ESLint, typecheck,
tests, build, migration source checks, and PostgreSQL migration smoke tests. The smoke harness
tests both a fresh schema and an upgrade from the previous migration. It is restricted to an
explicitly confirmed loopback PostgreSQL instance; see `docs/adr/0006-ci-migration-testing.md`.

## Safety

- Do not commit real `.env` files or production secrets.
- Do not run destructive database actions without explicit approval.
- Money is represented as integer kopecks.
- Financial, audit, and outbox records are append-only.
- Queue schema changes are generated from the pinned pg-boss version and applied only as migrations.
- The first super administrator is provisioned through a reviewed one-time operation, never migration data.
