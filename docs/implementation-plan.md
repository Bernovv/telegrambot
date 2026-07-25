# Implementation Plan

## Scope

Phase 1 foundation is code-complete. Current work is Phase 2 event sales:

- event catalog, products, and pricing rules;
- immutable offers and order snapshots;
- inventory reservations and wallet holds;
- order state transitions, tickets, and purchase APIs;
- Telegram purchase flow, fake/manual payment, and notifications.

## File Plan

- `apps/api` for HTTP API and webhooks.
- `apps/telegram-bot` for Telegram transport only.
- `apps/worker` for pg-boss consumers and scheduled jobs.
- `apps/admin-web` for the admin UI.
- `packages/domain` for framework-free domain primitives.
- `packages/application` for use cases and ports.
- `packages/database` for migrations and database access.
- `packages/contracts` for API/job/event contracts.
- `packages/messenger-core` for channel-neutral messaging.
- `packages/messenger-telegram` for the reusable grammY transport adapter.
- `packages/payment-tbank` for the T-Bank provider adapter.
- `packages/scenario-engine` for versioned scenarios.
- `packages/observability` for logging and health models.

## Migration Plan

The first migration creates only additive foundation tables:

- `users`;
- `messenger_identities`;
- `messenger_username_history`;
- `user_touchpoints`;
- `audit_log`;
- `outbox_events`;
- `worker_heartbeats`.

No destructive operation is included.

## Compatibility Risks

- There is no previous schema yet, so backward compatibility risk is low.
- Future migrations must use expand/deploy/contract.
- External library APIs must be checked through Context7 or official docs before concrete integration code is added.
- Graphify is available locally through `Project/.tools/graphify`; query `graphify-out/graph.json` before broad cross-module changes.

## Completed Foundation Slice

- Added Telegram `/start` contracts.
- Added domain helpers for Telegram username normalization and deep-link payload parsing.
- Added `HandleTelegramStartService` in the application layer.
- Added repository and idempotency ports instead of placing business logic in Telegram transport.
- Added unit tests for attribution parsing and idempotent `/start` side effects.
- Replaced the check-then-mark idempotency contract with an atomic `tryBegin` operation.
- Added a transaction-scoped PostgreSQL session and unit of work.
- Added PostgreSQL adapters for Telegram identity, attribution history, idempotency, and outbox writes.
- Added advisory locks for concurrent Telegram identity creation and touchpoint ordering.
- Added persistence tests for commit, rollback, first processing, and duplicate updates.
- Added ADR 0003 for the append-only wallet ledger and cached-balance strategy.
- Added an expand-only migration for contacts, wallet campaigns, accounts, transactions, entries, and holds.
- Added database constraints and triggers protecting posted financial records from mutation.
- Added bigint-only wallet balance operations with hold, capture, and release invariant tests.
- Added the owned Telegram contact verification application service and third-party rejection.
- Added idempotent phone bonus crediting from an active database campaign.
- Added PostgreSQL persistence for verified contacts, wallet account locking, ledger credit, and outbox events.
- Added strict E.164 normalization through `libphonenumber-js` with full validation metadata.
- Added the real `pg.Pool` adapter with fail-fast ping, bounded connections, and graceful close.
- Added grammY `/start` and owned-contact transport handlers with presentation-only response mapping.
- Added UUIDv7 generation and a long-polling composition root for local and staging bot runs.
- Moved grammY handlers into a reusable infrastructure adapter shared by both delivery modes.
- Added a NestJS/Fastify Telegram webhook endpoint in `apps/api`.
- Added independent URL-path and Telegram-header secret checks using constant-time comparison.
- Added Zod envelope validation, a 256 KiB default body limit, and retry-preserving `5xx` behavior.
- Kept Telegram `setWebhook` registration outside application startup and deployment side effects.
- Added a versioned domain-event job contract with event ID based idempotency and correlation keys.
- Added an application-level outbox dispatcher behind repository and publisher ports.
- Added PostgreSQL `SKIP LOCKED` claiming, stale-lock recovery, exponential retry eligibility, and
  ownership checks when marking events published or failed.
- Added worker heartbeat upserts without resetting the original start timestamp.
- Pinned pg-boss 12.26.2, generated schema v37 as a reviewed migration, and disabled runtime DDL.
- Provisioned the outbox dispatch and dead-letter queues through the same versioned migration.
- Added ADR 0004 for pg-boss schema lifecycle and the explicitly approved vendor deletion function.
- Added application-level health aggregation with sanitized component failures and last-success tracking.
- Added PostgreSQL probes for connectivity, migration version, pg-boss schema and queues, worker
  heartbeat freshness, and oldest unprocessed outbox age.
- Added public `/health/live` and `/health/ready` contracts with Railway-compatible HTTP status codes.
- Kept component-level diagnostics private until an authenticated operations endpoint is available.
- Added an expand-only admin RBAC migration with accounts, system roles, permissions, active grant
  history, local session revocation, and append-only audit protection.
- Added deny-by-default application authorization and PostgreSQL principal resolution.
- Added asymmetric Supabase/OIDC JWT verification with issuer, audience, lifetime, subject, and
  assurance-level validation.
- Added a Nest authorization guard and protected operations health endpoint requiring `system.read`.
- Added an explicit one-time, advisory-locked first-superadmin bootstrap operation with audit.
- Replaced scaffold lint commands with a root type-aware ESLint gate and module dependency rules.
- Added a guarded PostgreSQL migration harness for clean-schema and previous-schema upgrades.
- Added a read-only GitHub Actions CI workflow with full-SHA-pinned actions, dependency review,
  frozen install, lint, typecheck, tests, build, and migration jobs.
- Added Dependabot configuration, CI policy validation, and the required pull-request template.
- Phase 1 is code-complete; PostgreSQL migration smoke remains environment verification until the
  workflow or a local PostgreSQL runtime is available.

## Phase 2 Event Sales Slice

- Added deterministic bigint pricing with explicit priority, specificity, validity, and
  configuration-conflict detection.
- Covered the Business Picnic Standard and child acceptance prices without letting child quantity
  affect the adult tier.
- Added the centralized order transition graph and composition-freeze rule.
- Added an expand-only migration for events, content blocks, products, prices, immutable offer
  versions, orders, items, status history, acceptances, reservations, and tickets.
- Added database triggers protecting offer content, accepted order snapshots, order composition,
  status transitions, acceptance evidence, and status history.
- Added an idempotent `CreateOrderService` that validates the sales window, phone, offer, product
  limits, event/product capacity, wallet split, and 30-minute TTL.
- Added PostgreSQL event locking, atomic inventory reservations, expiry-aware FIFO wallet holds,
  initial status history, and transactional outbox publication.
- Added deterministic HMAC public order tokens while storing only their SHA-256 hashes.
- Added an authenticated `POST /api/v1/orders` boundary with Zod validation and the
  `orders.create` permission.
- Added owner-bound `offer_accept:<opaque_token>` Telegram callbacks in long polling and webhook
  modes.
- Added order row locking, pinned offer text, append-only Telegram evidence, idempotent status
  history, and transactional `OfferAccepted` outbox publication.
- Duplicate acceptance is a successful no-op; malformed and foreign tokens do not reveal whether
  an order exists.
- Added bounded worker expiry sweeps with `FOR UPDATE SKIP LOCKED` for multi-replica safety.
- Expiry now releases inventory and wallet holds, appends an idempotent `ORDER_RELEASE`, records
  order history, and publishes `OrderExpired` in one transaction.
- Worker heartbeat metadata exposes the last successful expiry sweep; recovery is documented in
  `docs/runbooks/order-expiry.md`.
- Added expand-only payment attempts and append-only manual payment evidence.
- Added the shared idempotent `PaymentConfirmed` use case with immutable amount/currency checks,
  offer/reservation validation, wallet capture, inventory consumption, and deterministic ticket
  references.
- Added the MFA-protected `POST /api/v1/orders/:id/manual-payment` operation with audit, status
  history, and transactional outbox events for payment, ticket delivery, and admin notification.
- Added strict versioned domain-event consumers for `TicketsIssued` and
  `AdminPurchaseNotificationRequested`.
- Added one leased, append-only delivery record per ticket/admin message, partial-retry recovery,
  grammY `sendMessage` transport, worker feature gating, and DLQ operations documentation.
- Added owner-bound `/tickets` and `my_tickets` views plus idempotent
  `TicketRedeliveryRequested` handling without creating or mutating tickets.
- Added deterministic in-memory 512x512 QR PNG rendering from opaque ticket tokens and Telegram
  `sendPhoto` delivery with bounded media validation.
- Added a feature-gated T-Bank adapter with official endpoint allowlisting, scalar token
  generation, strict `Init` response binding, and signed webhook verification.
- Added owner-bound Telegram payment initialization with persisted `creating`, `pending`,
  `unknown`, and failed attempt states; duplicate callbacks reuse the existing payment URL.
- Added the `payment_processing` reservation guard: in-flight payments pause TTL release, while
  definite initialization failures and provider cancellations return the order to
  `awaiting_payment` with status history.
- Added an append-only provider-event ledger and exact `OK` webhook contract.
- Added atomic `CONFIRMED` handling that updates the original attempt inside the existing order,
  wallet, inventory, ticket, and outbox transaction. `AUTHORIZED` never issues tickets.
- Added independently gated T-Bank `CheckOrder` reconciliation for stale uncertain attempts with
  leased `SKIP LOCKED` claims, bounded backoff, repeated-empty release protection, append-only
  observations, and the shared atomic confirmation transaction.
- Multiple payments, amount mismatches, unsafe confirmed outcomes, and refund states stop in
  review without mutating financial state.
- Added MFA-protected, full-only T-Bank refunds with immutable intent, UUIDv4 provider
  idempotency, signed notification handling, leased reconciliation, append-only evidence, exact
  amount binding, ticket revocation, wallet capture reversal, order history, and audit.
- Partial refunds remain gated on approved fiscal `Receipt.Items` mapping. Referral reversal will
  be added with the referral commission module; the current payment path creates no referral
  commission.
- Event catalog administration and the remaining purchase UX remain in Phase 2.

## Phase 4 Admin Operations Slice

- Added application-level read models for administrator user and order lists/details.
- Added strict opaque cursor pagination, permission validation, UTC timestamps, and decimal
  kopeck strings.
- Added a dedicated PostgreSQL projection adapter using repeatable read-only snapshots across
  identity, contacts, wallet, sales, payments, and tickets.
- Masked phone contacts in normal user reads; raw export remains gated by `contacts.export`.
- Added RBAC-protected `GET /api/v1/users`, `GET /api/v1/users/:id`,
  `GET /api/v1/orders`, and `GET /api/v1/orders/:id` contracts.
- The Next.js admin screens remain pending because the current execution environment could not
  install the required frontend dependencies. The backend contract is ready for that UI slice.
