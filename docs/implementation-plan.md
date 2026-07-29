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
- Replaced migration command scaffolds with the guarded application runner: exact manifest
  matching, a non-blocking advisory lock, transactional application, append-only SHA-256 evidence,
  and explicit production backup, rollback-plan, and confirmation gates.
- Added a local/test-only, confirmation-gated and advisory-locked demo seed with synthetic identity,
  Business Picnic catalog prices, an offer source, a validated purchase-scenario draft, and
  insert-only repeat behavior.
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
- Read-only event catalog administration, draft product, simple-pricing, content-block,
  immutable-offer management, and validated atomic event publication are implemented; the
  remaining purchase UX remains in Phase 2.
- Added bounded Telegram event discovery when `/start` has no event deep-link. Published event
  cards include event-timezone dates, location, current minimum price, and sales status; selecting
  a UUID callback re-resolves the Telegram owner and starts the pinned scenario idempotently.
- Added backward-compatible composed orders in scenarios: `order_start` can initialize a bounded
  draft, `order_add_item` upserts validated context quantities, and `order_summary` creates the
  immutable order once through the existing application service. Legacy published `order_start`
  payloads retain immediate creation semantics.
- Added internal zero-due confirmation for free and wallet-only orders. The shared payment
  transaction records an `internal` attempt, captures any wallet hold, consumes inventory, issues
  tickets, and advances the pinned scenario without calling T-Bank.
- Added bounded `wallet_credit` scenario execution through the append-only ledger. Published
  payloads carry integer kopecks, currency, reason, and a safe idempotency namespace; runtime,
  ledger posting, outbox, cached balance, and session transition share one transaction.

## Phase 4 Admin Operations Slice

- Added application-level read models for administrator user and order lists/details.
- Added strict opaque cursor pagination, permission validation, UTC timestamps, and decimal
  kopeck strings.
- Added a dedicated PostgreSQL projection adapter using repeatable read-only snapshots across
  identity, contacts, wallet, sales, payments, and tickets.
- Masked phone contacts in normal user reads; raw export remains gated by `contacts.export`.
- Added RBAC-protected `GET /api/v1/users`, `GET /api/v1/users/:id`,
  `GET /api/v1/orders`, and `GET /api/v1/orders/:id` contracts.
- Added the Next.js App Router administrator application with Supabase SSR authentication and
  session refresh.
- Added mandatory TOTP enrollment and challenge verification, `aal2` session elevation, and a
  server-side assurance gate for every administrator page.
- Added a same-origin BFF forwarding the short-lived administrator access token to the Nest API;
  reads and event-draft mutations use separate method/path allowlists.
- Added responsive user/order lists and detail screens with strict filters, opaque cursor
  pagination, masked contacts, bigint-safe money rendering, loading, empty, and failure states.
- Added an `events.read` catalog projection for event list/detail views, including aggregate
  capacity, order and ticket counts, content blocks, products, pricing rules, and active offer.
- Added strict event filters and cursor pagination to the API and same-origin BFF.
- Added responsive event list/detail screens with event-timezone rendering.
- Added audited event draft creation and general-settings updates guarded by `events.write`,
  row/advisory locking, exact optimistic versions, strict date/timezone validation, and
  transactional before/after audit.
- Added same-origin JSON and body-limit protection to the BFF plus responsive create/edit forms.
- Added draft-only product and simple pricing create/update operations with event-level sales
  locking, aggregate optimistic versions, append-only audit, deactivation instead of deletion,
  currency checks, and bigint-only money handling.
- Added a responsive product and tariff editor to the event detail workflow.
- Added draft-only content-block create/update operations with bounded schema-versioned JSON,
  unique ordering, hide-instead-of-delete behavior, aggregate locking, audit, and a responsive
  editor.
- Added server-rendered immutable HTML offer snapshots with SHA-256, feature-gated Supabase
  Storage, version history, acceptance counts, event-level locking, append-only audit, withdrawal,
  and a responsive administrator workflow.
- Conditional pricing, PDF/rich-text offer import, dashboard metrics, jobs, and integration
  screens remain future Phase 4 slices and require reviewed backend contracts.
- Added normalized event scenario/version/node/edge storage with one mutable draft, immutable
  published history, event assignment, aggregate locking, and append-only audit.
- Added a framework-free publication validator for graph references, reachability, terminal nodes,
  bounded cycles, wallet idempotency, and offer-before-payment paths.
- Added RBAC-separated draft and publication APIs plus a responsive structured scenario editor.
- Added PostgreSQL-pinned scenario sessions, append-only execution trace, owner-bound compact
  Telegram callbacks, and idempotent safe-node execution in long polling and webhook.
- Added bounded text/number input nodes, owner-bound Telegram text routing, typed session context,
  and atomic idempotent input persistence without raw answers in execution events.
- Scenario action ports, Expression DSL, preview/test execution, canvas, and rollback cloning
  remain future slices.

## Срез классификации пользователей

- Добавлены защищённые каталоги статусов и категорий с неизменяемыми кодами, группами
  взаимоисключения, допустимыми переходами, оптимистической блокировкой и аудитом.
- Добавлена неизменяемая история назначений со снимками отображения и первой операцией закрытия
  активного интервала.
- Добавлены application services и PostgreSQL-адаптеры для идемпотентных `set_status` и
  `add_category`.
- Действия подключены к long polling, Telegram webhook и продолжению после оплаты через общий
  транзакционный runtime.
- Публикация сценария проверяет, что используемые коды существуют и активны.
- В админке добавлен `/classification`, а карточка пользователя показывает активные значения и
  последние изменения.
- Добавлены ручное назначение и снятие классификаций из карточки пользователя с `users.write`,
  обязательной причиной, outbox и аудитом в общей транзакции.
- Следующий срез: правила оплаты, опросов и импорта, массовые операции, сегменты и рассылки.

## Срез предварительного просмотра сегмента

- Добавлен строгий двухуровневый contract групп AND/OR для активных статусов и категорий.
- Application service ограничивает размер выражения, нормализует коды и отклоняет недоступные
  определения.
- PostgreSQL строит только параметризованные `exists`/`not exists`/`count distinct` условия и
  возвращает count со sample users в repeatable read-only snapshot.
- Добавлены RBAC-маршрут `POST /api/v1/segments/preview`, BFF allowlist и рабочая страница
  `/segments`.
- Сохранённые сегменты используют один изменяемый черновик, неизменяемую опубликованную историю,
  optimistic locking и повторную проверку справочников в транзакции публикации.
- Добавлены audited API списка, чтения, создания, сохранения и публикации с раздельными правами
  `users.read` и `broadcasts.send`, а также управление версиями на странице `/segments`.
## Срез снимка аудитории сегмента

- Добавлены audited-заявки на фиксацию аудитории для точной опубликованной версии сегмента.
- Worker асинхронно материализует пользователей через параметризованный `INSERT ... SELECT` под
  `FOR UPDATE SKIP LOCKED`; HTTP-запрос не выполняет массовую выборку.
- Участники, состояние `ready` и `SegmentAudienceSnapshotReady` записываются в одной транзакции.
- Готовый снимок и его append-only участники защищены PostgreSQL-триггерами.
- Страница `/segments` показывает очередь и историю снимков с точным количеством получателей.
- Черновик рассылки, неизменяемая версия содержимого и привязка к готовому снимку реализованы
  следующим срезом.

## Срез черновика и версии рассылки

- Добавлен агрегат рассылки с optimistic locking, одним изменяемым черновиком и неизменяемой
  опубликованной историей.
- Версия схемы 1 фиксирует название, текст, настройку предпросмотра ссылок, до восьми
  HTTPS-кнопок и точный готовый снимок аудитории.
- Создание, сохранение и публикация требуют `broadcasts.send`, обязательную причину и записывают
  append-only audit.
- Публикация повторно проверяет готовность снимка и атомарно создаёт
  `BroadcastVersionPublished` в transactional outbox без копирования текста сообщения.
- Добавлены строгие API и BFF-маршруты, а также рабочий редактор `/broadcasts`.
- Расписание и подготовка неизменяемого журнала доставок реализованы следующим срезом.

## Срез расписания и подготовки рассылки

- Добавлены состояния кампании и неизменяемая привязка расписания к точной опубликованной версии.
- Планирование фиксирует UTC-момент, часовой пояс IANA и ограничение скорости с аудитом и
  `BroadcastScheduled` в одной транзакции.
- Worker выбирает наступившие кампании через `FOR UPDATE SKIP LOCKED` и одним
  `INSERT ... SELECT` создаёт идемпотентные записи доставки для снимка аудитории.
- Недоступные Telegram identity и известные блокировки фиксируются как `skipped`; доступные
  получатели остаются `pending`.
- Итоговые счётчики и `BroadcastPrepared` записываются атомарно, а экран `/broadcasts` показывает
  состояние подготовки.
- Следующий срез: арендованная отправка Telegram, повторные попытки с задержкой, пауза, отмена,
  автопауза при высокой доле ошибок и завершение кампании.

## Срез арендованной отправки рассылки

- Worker атомарно арендует одну доступную delivery-запись, а просроченная аренда восстанавливается
  после перезапуска без потери получателя.
- Скорость сериализуется по кампании и глобально по боту; несколько worker вместе не превышают
  25 вызовов Telegram в секунду.
- Адаптер grammY отправляет текст, HTTPS-кнопки и настройку предпросмотра ссылок, сохраняя
  `provider_message_id` после подтверждённого успеха.
- HTTP 429 использует `retry_after`, транспортные и серверные ошибки повторяются с
  экспоненциальной задержкой, блокировка пользователя становится окончательной и обновляет
  Telegram identity.
- Кампания завершается при отсутствии активных доставок и автоматически приостанавливается при
  высокой доле окончательных ошибок; оба перехода атомарно публикуются через transactional outbox.
- Следующий срез: административные пауза, возобновление и отмена с optimistic locking, аудитом,
  outbox-событиями и отображением текущего прогресса.
