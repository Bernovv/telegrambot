# Graph Report - Project  (2026-07-23)

## Corpus Check
- 97 files · ~21,428 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 955 nodes · 1431 edges · 68 communities (61 shown, 7 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 9 edges (avg confidence: 0.6)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- telegram-webhook.ts
- api/src/main.ts
- grammy.test.ts
- dependencies
- compilerOptions
- telegram-start-persistence.ts
- scripts
- dependencies
- database/package.json
- messenger-telegram/package.json
- tasks
- identity.ts
- phone.ts
- worker/package.json
- messenger-core/package.json
- application/package.json
- admin-web/package.json
- .query
- config/package.json
- contracts/package.json
- domain/package.json
- observability/package.json
- payment-tbank/package.json
- scenario-engine/package.json
- 20260722100000_contacts_wallet_ledger.sql
- node-postgres.ts
- wallet.ts
- SqlQueryResult
- SqlConnection
- api/tsconfig.json
- phone-persistence.test.ts
- messenger.ts
- 20260721160000_foundation_identity_audit_outbox.sql
- Implementation Plan
- .creditPhoneBonus
- telegram-start-persistence.test.ts
- MessengerAdapter
- ADR 0003: Wallet Ledger
- check-migrations.mjs
- admin-web/tsconfig.json
- telegram-bot/tsconfig.json
- worker/tsconfig.json
- MCP Setup
- application/tsconfig.json
- config/tsconfig.json
- contracts/tsconfig.json
- node-postgres.test.ts
- database/tsconfig.json
- domain/tsconfig.json
- messenger-core/tsconfig.json
- messenger-telegram/tsconfig.json
- observability/tsconfig.json
- payment-tbank/src/index.ts
- payment-tbank/tsconfig.json
- scenario-engine/tsconfig.json
- Telegram Ticket Platform
- NodePostgresConnection
- .transact
- scenario-engine/src/index.ts
- noop.mjs
- 20260721162000_foundation_idempotency_keys.sql
- outbox-persistence.test.ts
- generate-pgboss-migration.mjs
- ADR 0004: pg-boss Schema Management
- 20260722230000_pgboss_v37_outbox_queues.sql
- messenger.ts
- health-persistence.test.ts

## God Nodes (most connected - your core abstractions)
1. `SqlQueryResult` - 19 edges
2. `SqlConnection` - 19 edges
3. `SqlConnectionPool` - 17 edges
4. `compilerOptions` - 16 edges
5. `IdGenerator` - 15 edges
6. `TransactionSession` - 13 edges
7. `scripts` - 12 edges
8. `loadApiConfig()` - 11 edges
9. `createTelegramBot()` - 11 edges
10. `paths` - 11 edges

## Surprising Connections (you probably didn't know these)
- `bootstrapApi()` --calls--> `loadApiConfig()`  [EXTRACTED]
  apps/api/src/main.ts → packages/config/src/index.ts
- `bootstrapApi()` --calls--> `createPostgresHealthProbes()`  [EXTRACTED]
  apps/api/src/main.ts → packages/database/src/health-persistence.ts
- `bootstrapTelegramBot()` --calls--> `loadTelegramBotConfig()`  [EXTRACTED]
  apps/telegram-bot/src/main.ts → packages/config/src/index.ts
- `bootstrapWorker()` --calls--> `loadWorkerConfig()`  [EXTRACTED]
  apps/worker/src/main.ts → packages/config/src/index.ts
- `ApiApplicationOptions` --references--> `ReadinessCheck`  [EXTRACTED]
  apps/api/src/app.ts → packages/application/src/health.ts

## Import Cycles
- None detected.

## Communities (68 total, 7 thin omitted)

### Community 0 - "telegram-webhook.ts"
Cohesion: 0.05
Nodes (38): ApiApplicationOptions, ApiModule, APP_VERSION, createApiApplication(), HealthController, READINESS_CHECK, Controller, Inject (+30 more)

### Community 1 - "api/src/main.ts"
Cohesion: 0.05
Nodes (34): bootstrapApi(), getExpectedMigrationVersion(), bootstrapTelegramBot(), bootstrapWorker(), assertPgBossQueuesProvisioned(), HandleTelegramContactCommand, HandleTelegramContactResult, HandleTelegramStartCommand (+26 more)

### Community 2 - "grammy.test.ts"
Cohesion: 0.12
Nodes (16): aggregateStatus(), GetReadinessService, HealthClock, HealthProbe, HealthProbeResult, statusPriority, systemClock, HealthStatus (+8 more)

### Community 3 - "dependencies"
Cohesion: 0.05
Nodes (41): dependencies, fastify, @nestjs/common, @nestjs/core, @nestjs/platform-fastify, reflect-metadata, rxjs, @ticket-platform/application (+33 more)

### Community 4 - "compilerOptions"
Cohesion: 0.05
Nodes (37): ES2023, packages/application/src/index.ts, packages/config/src/index.ts, packages/contracts/src/index.ts, packages/database/src/index.ts, packages/domain/src/index.ts, packages/messenger-core/src/index.ts, packages/messenger-telegram/src/index.ts (+29 more)

### Community 5 - "telegram-start-persistence.ts"
Cohesion: 0.13
Nodes (10): BeginIdempotentOperationInput, IdGenerator, PostgresUnitOfWork, TransactionSession, expectAffectedRow(), IdentityRow, mapIdentity(), PostgresIdempotencyRepository (+2 more)

### Community 6 - "scripts"
Cohesion: 0.07
Nodes (28): devDependencies, tsx, turbo, @types/node, typescript, engines, node, pnpm (+20 more)

### Community 7 - "dependencies"
Cohesion: 0.08
Nodes (25): dependencies, @ticket-platform/application, @ticket-platform/config, @ticket-platform/database, @ticket-platform/messenger-core, @ticket-platform/messenger-telegram, @ticket-platform/observability, uuid (+17 more)

### Community 8 - "database/package.json"
Cohesion: 0.08
Nodes (24): dependencies, pg, @ticket-platform/application, @ticket-platform/domain, devDependencies, @types/pg, @ticket-platform/application, @ticket-platform/domain (+16 more)

### Community 9 - "messenger-telegram/package.json"
Cohesion: 0.09
Nodes (21): grammy, dependencies, grammy, @ticket-platform/contracts, @ticket-platform/messenger-core, @ticket-platform/observability, @ticket-platform/contracts, @ticket-platform/messenger-core (+13 more)

### Community 10 - "tasks"
Cohesion: 0.10
Nodes (21): ^build, coverage/**, dist/**, ^lint, .next/**, ^typecheck, dependsOn, outputs (+13 more)

### Community 11 - "identity.ts"
Cohesion: 0.20
Nodes (10): HandleTelegramStartService, IdempotencyRepository, MessengerIdentityRecord, OutboxWriter, RecordTouchpointInput, UnitOfWork, UserRecord, HandleTelegramContactService (+2 more)

### Community 12 - "phone.ts"
Cohesion: 0.19
Nodes (19): ApiConfig, AppConfig, AppEnvironment, loadApiConfig(), loadAppConfig(), loadTelegramBotConfig(), loadWorkerConfig(), parseAppEnvironment() (+11 more)

### Community 13 - "worker/package.json"
Cohesion: 0.08
Nodes (23): dependencies, pg-boss, @ticket-platform/application, @ticket-platform/config, @ticket-platform/contracts, @ticket-platform/database, @ticket-platform/observability, @ticket-platform/application (+15 more)

### Community 14 - "messenger-core/package.json"
Cohesion: 0.11
Nodes (17): libphonenumber-js, dependencies, libphonenumber-js, @ticket-platform/application, @ticket-platform/application, main, name, private (+9 more)

### Community 15 - "application/package.json"
Cohesion: 0.11
Nodes (17): dependencies, @ticket-platform/contracts, @ticket-platform/domain, @ticket-platform/contracts, @ticket-platform/domain, main, name, private (+9 more)

### Community 16 - "admin-web/package.json"
Cohesion: 0.14
Nodes (13): dependencies, @ticket-platform/contracts, @ticket-platform/contracts, name, private, scripts, build, dev (+5 more)

### Community 17 - ".query"
Cohesion: 0.28
Nodes (4): UpsertTelegramIdentityInput, UpsertTelegramIdentityResult, PostgresPhoneBonusRepository, PostgresIdentityRepository

### Community 18 - "config/package.json"
Cohesion: 0.15
Nodes (12): main, name, private, scripts, build, dev, lint, test (+4 more)

### Community 19 - "contracts/package.json"
Cohesion: 0.15
Nodes (12): main, name, private, scripts, build, dev, lint, test (+4 more)

### Community 20 - "domain/package.json"
Cohesion: 0.15
Nodes (12): main, name, private, scripts, build, dev, lint, test (+4 more)

### Community 21 - "observability/package.json"
Cohesion: 0.15
Nodes (12): main, name, private, scripts, build, dev, lint, test (+4 more)

### Community 22 - "payment-tbank/package.json"
Cohesion: 0.15
Nodes (12): main, name, private, scripts, build, dev, lint, test (+4 more)

### Community 23 - "scenario-engine/package.json"
Cohesion: 0.15
Nodes (12): main, name, private, scripts, build, dev, lint, test (+4 more)

### Community 24 - "20260722100000_contacts_wallet_ledger.sql"
Cohesion: 0.31
Nodes (12): public.prevent_posted_wallet_transaction_mutation(), public.prevent_wallet_entry_mutation(), public.user_contacts, public.wallet_accounts, public.wallet_credit_campaigns, public.wallet_entries, public.wallet_hold_entries, public.wallet_holds (+4 more)

### Community 25 - "node-postgres.ts"
Cohesion: 0.12
Nodes (4): ManagedSqlConnectionPool, NodePostgresConnection, NodePostgresPool, NodePostgresPoolOptions

### Community 26 - "wallet.ts"
Cohesion: 0.40
Nodes (9): assertPositiveKopecks(), assertWalletBalance(), captureWalletHold(), createWalletHold(), creditWallet(), releaseWalletHold(), WalletBalance, WalletBucket (+1 more)

### Community 27 - "SqlQueryResult"
Cohesion: 0.15
Nodes (5): StubConnection, FakeConnection, FakeConnection, SqlQueryResult, FakeConnection

### Community 28 - "SqlConnection"
Cohesion: 0.15
Nodes (5): FakePool, SqlConnection, SqlExecutor, FakePool, RecordedQuery

### Community 29 - "api/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, emitDecoratorMetadata, experimentalDecorators, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 31 - "messenger.ts"
Cohesion: 0.23
Nodes (3): IdentityRepository, userRegisteredEvent(), PhoneNormalizer

### Community 32 - "20260721160000_foundation_identity_audit_outbox.sql"
Cohesion: 0.36
Nodes (7): public.audit_log, public.messenger_identities, public.messenger_username_history, public.outbox_events, public.user_touchpoints, public.users, public.worker_heartbeats

### Community 33 - "Implementation Plan"
Cohesion: 0.29
Nodes (6): Compatibility Risks, Completed Foundation Slice, File Plan, Implementation Plan, Migration Plan, Scope

### Community 34 - ".creditPhoneBonus"
Cohesion: 0.12
Nodes (15): CreditPhoneBonusInput, CreditPhoneBonusResult, phoneBonusCreditedEvent(), PhoneBonusRepository, PhoneVerificationRepository, phoneVerifiedEvent(), TelegramUserResolver, VerifyPhoneInput (+7 more)

### Community 35 - "telegram-start-persistence.test.ts"
Cohesion: 0.09
Nodes (14): PgBossOutboxPublisher, PgBossPublisherClient, getQueue(), queue(), DispatchOutboxBatchResult, DispatchOutboxBatchService, errorType(), OutboxDispatchRepository (+6 more)

### Community 36 - "MessengerAdapter"
Cohesion: 0.20
Nodes (9): Database Connectivity, Database Migrations, Deferred Checks, Health and Readiness Runbook, Job Queue, Outbox Lag, Probe Failure, Public Endpoints (+1 more)

### Community 37 - "ADR 0003: Wallet Ledger"
Cohesion: 0.33
Nodes (5): ADR 0003: Wallet Ledger, Compatibility And Rollback, Consequences, Context, Decision

### Community 38 - "check-migrations.mjs"
Cohesion: 0.25
Nodes (5): approvedVendorDestructiveStatements, destructivePatterns, files, migrationDir, violations

### Community 39 - "admin-web/tsconfig.json"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 40 - "telegram-bot/tsconfig.json"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 41 - "worker/tsconfig.json"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 42 - "MCP Setup"
Cohesion: 0.40
Nodes (4): Context7, Current Session, Graphify, MCP Setup

### Community 43 - "application/tsconfig.json"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 44 - "config/tsconfig.json"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 45 - "contracts/tsconfig.json"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 46 - "node-postgres.test.ts"
Cohesion: 0.27
Nodes (7): ClaimedOutboxEvent, ClaimOutboxBatchOptions, assertOwned(), mapOutboxRow(), OutboxRow, PostgresOutboxDispatchRepository, WorkerHeartbeatInput

### Community 47 - "database/tsconfig.json"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 48 - "domain/tsconfig.json"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 49 - "messenger-core/tsconfig.json"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 50 - "messenger-telegram/tsconfig.json"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 51 - "observability/tsconfig.json"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 52 - "payment-tbank/src/index.ts"
Cohesion: 0.40
Nodes (3): InitializePayment, PaymentInitialization, PaymentProvider

### Community 53 - "payment-tbank/tsconfig.json"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 54 - "scenario-engine/tsconfig.json"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 55 - "Telegram Ticket Platform"
Cohesion: 0.40
Nodes (4): Current Slice, Local Commands, Safety, Telegram Ticket Platform

### Community 56 - "NodePostgresConnection"
Cohesion: 0.36
Nodes (4): HealthComponentSnapshot, HealthReadinessReport, HealthSnapshot, ProblemDetails

### Community 62 - "outbox-persistence.test.ts"
Cohesion: 0.22
Nodes (3): InvalidOutboxPayloadError, LostOutboxLockError, FakePool

### Community 63 - "generate-pgboss-migration.mjs"
Cohesion: 0.22
Nodes (8): deadLetterQueueSql, dispatchQueueSql, migration, migrationPath, pgBossEntryPath, projectRoot, requireFromWorker, schemaSql

### Community 64 - "ADR 0004: pg-boss Schema Management"
Cohesion: 0.25
Nodes (7): ADR 0004: pg-boss Schema Management, Compatibility, Context, Decision, Rollback, Status, Verification

### Community 66 - "messenger.ts"
Cohesion: 0.43
Nodes (6): emptyPayload(), mergePayloadPart(), MessengerChannel, normalizePayload(), normalizeTelegramUsername(), parseStartPayload()

## Knowledge Gaps
- **384 isolated node(s):** `name`, `version`, `private`, `type`, `build` (+379 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `bootstrapWorker()` connect `api/src/main.ts` to `.transact`, `telegram-start-persistence.test.ts`, `phone.ts`, `worker/package.json`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **Why does `pg-boss` connect `worker/package.json` to `api/src/main.ts`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _384 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `telegram-webhook.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05201636469900643 - nodes in this community are weakly interconnected._
- **Should `api/src/main.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.054773082942097026 - nodes in this community are weakly interconnected._
- **Should `grammy.test.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.11965811965811966 - nodes in this community are weakly interconnected._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.047619047619047616 - nodes in this community are weakly interconnected._