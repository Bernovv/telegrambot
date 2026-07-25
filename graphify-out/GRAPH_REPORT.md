# Graph Report - Project  (2026-07-25)

## Corpus Check
- 187 files · ~69,785 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2031 nodes · 3598 edges · 140 communities (128 shown, 12 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 30 edges (avg confidence: 0.61)
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
- application/src/index.ts
- app.ts
- outbox.ts
- api/src/main.ts
- HealthController
- messenger-core/src/index.ts
- createApiApplication
- .newId
- 20260723223000_admin_rbac.sql
- .receive
- grammy.ts
- telegram-start-persistence.test.ts
- LibPhoneNumberNormalizer
- tsconfig.scripts.json
- ADR 0005: Administrator Authentication and RBAC
- StubConnection
- RecordingConnection
- NodePostgresConnection
- check-ci-config.mjs
- PostgresOutboxWriter
- order-sales-persistence.test.ts
- app.ts
- HmacOrderReferenceGenerator
- telegram-start-persistence.test.ts
- order.ts
- .register
- ADR 0007: Event Sales And Immutable Order Snapshots
- orders.test.ts
- health-persistence.test.ts
- TransactionSession
- payment-confirmation.ts
- payment-confirmation.test.ts
- outbox.ts
- MoneyKopecks
- admin-authorization-persistence.ts
- payment-confirmation-persistence.test.ts
- grammy.ts
- ticket-access-persistence.test.ts
- DomainEvent
- .query
- supabase-admin-token-verifier.ts
- notification-sender.ts
- Manual Payment Confirmation Runbook
- MessengerAdapter
- NodePostgresConnection
- 20260724170000_payment_confirmation_tickets.sql
- notification-delivery.test.ts
- notification-delivery-persistence.ts
- controller.ts
- contracts/src/index.ts
- NotificationSender
- TicketPngRenderer
- health-persistence.ts
- .connect
- PhoneVerificationRepository
- .deliverOnce
- orders.test.ts
- HandleTelegramStartCommand
- ticket-rendering/tsconfig.json
- StubConnection
- .receive
- orders.test.ts
- RequestTelegramTicketRedeliveryCommand
- application/src/index.ts
- health-persistence.ts
- health-persistence.test.ts
- admin-authorization-persistence.ts
- messenger.ts
- ADR 0010: T-Bank Payment Reconciliation
- 20260725120000_tbank_payment_reconciliation.sql
- StubConnection

## God Nodes (most connected - your core abstractions)
1. `SqlConnection` - 55 edges
2. `SqlConnectionPool` - 53 edges
3. `SqlQueryResult` - 48 edges
4. `IdGenerator` - 47 edges
5. `TransactionSession` - 29 edges
6. `MoneyKopecks` - 24 edges
7. `OutboxWriter` - 20 edges
8. `DomainEvent` - 20 edges
9. `UnitOfWork` - 19 edges
10. `PostgresUnitOfWork` - 17 edges

## Surprising Connections (you probably didn't know these)
- `execute()` --indirect_call--> `event()`  [INFERRED]
  apps/api/src/tbank-webhook.test.ts → packages/application/src/outbox.test.ts
- `AdminAuthorizationModuleOptions` --references--> `AuthorizeAdminRequest`  [EXTRACTED]
  apps/api/src/admin-auth.ts → packages/application/src/admin-authorization.ts
- `AuthenticatedAdminRequest` --references--> `AdminRequestActor`  [EXTRACTED]
  apps/api/src/admin-auth.ts → packages/contracts/src/admin-auth.ts
- `bootstrapApi()` --calls--> `loadApiConfig()`  [EXTRACTED]
  apps/api/src/main.ts → packages/config/src/index.ts
- `bootstrapApi()` --calls--> `createPostgresHealthProbes()`  [EXTRACTED]
  apps/api/src/main.ts → packages/database/src/health-persistence.ts

## Import Cycles
- None detected.

## Communities (140 total, 12 thin omitted)

### Community 0 - "telegram-webhook.ts"
Cohesion: 0.09
Nodes (19): secretsEqual(), telegramChatSchema, telegramMessageSchema, telegramUpdateSchema, telegramUserSchema, TelegramWebhookController, TelegramWebhookModule, TelegramWebhookService (+11 more)

### Community 1 - "api/src/main.ts"
Cohesion: 0.14
Nodes (17): asRecord(), assertTicketSet(), formatAdminPurchaseMessage(), formatKopecks(), formatTicketMessage(), HandleNotificationJobInput, HandleNotificationJobResult, HandleNotificationJobService (+9 more)

### Community 2 - "grammy.test.ts"
Cohesion: 0.16
Nodes (8): aggregateStatus(), GetReadinessService, HealthClock, HealthProbe, HealthProbeResult, statusPriority, systemClock, HealthStatus

### Community 3 - "dependencies"
Cohesion: 0.04
Nodes (45): dependencies, fastify, jose, @nestjs/common, @nestjs/core, @nestjs/platform-fastify, reflect-metadata, rxjs (+37 more)

### Community 4 - "compilerOptions"
Cohesion: 0.05
Nodes (39): ES2023, packages/application/src/index.ts, packages/config/src/index.ts, packages/contracts/src/index.ts, packages/database/src/index.ts, packages/domain/src/index.ts, packages/messenger-core/src/index.ts, packages/messenger-telegram/src/index.ts (+31 more)

### Community 5 - "telegram-start-persistence.ts"
Cohesion: 0.11
Nodes (15): ConfirmPaymentService, ExternalPaymentInitializer, HandleTBankPaymentWebhookService, initializedResult(), InitializeTelegramTBankPaymentService, mapStatus(), TBankPaymentUrls, TBankWebhookRepository (+7 more)

### Community 6 - "scripts"
Cohesion: 0.05
Nodes (39): eslint, @eslint/js, js-yaml, devDependencies, eslint, @eslint/js, js-yaml, tsx (+31 more)

### Community 7 - "dependencies"
Cohesion: 0.07
Nodes (27): dependencies, @ticket-platform/application, @ticket-platform/config, @ticket-platform/database, @ticket-platform/messenger-core, @ticket-platform/messenger-telegram, @ticket-platform/observability, @ticket-platform/payment-tbank (+19 more)

### Community 8 - "database/package.json"
Cohesion: 0.08
Nodes (25): dependencies, pg, @ticket-platform/application, @ticket-platform/domain, devDependencies, @types/pg, @ticket-platform/application, @ticket-platform/domain (+17 more)

### Community 9 - "messenger-telegram/package.json"
Cohesion: 0.09
Nodes (21): grammy, dependencies, grammy, @ticket-platform/contracts, @ticket-platform/messenger-core, @ticket-platform/observability, @ticket-platform/contracts, @ticket-platform/messenger-core (+13 more)

### Community 10 - "tasks"
Cohesion: 0.10
Nodes (21): ^build, coverage/**, dist/**, ^lint, .next/**, ^typecheck, dependsOn, outputs (+13 more)

### Community 11 - "identity.ts"
Cohesion: 0.38
Nodes (4): HealthComponentSnapshot, HealthReadinessReport, HealthSnapshot, ProblemDetails

### Community 12 - "phone.ts"
Cohesion: 0.14
Nodes (33): AdminAuthConfig, ApiConfig, AppConfig, AppEnvironment, loadApiConfig(), loadAppConfig(), loadTBankPaymentsConfig(), loadTBankReconciliationConfig() (+25 more)

### Community 13 - "worker/package.json"
Cohesion: 0.06
Nodes (31): dependencies, pg-boss, @ticket-platform/application, @ticket-platform/config, @ticket-platform/contracts, @ticket-platform/database, @ticket-platform/messenger-telegram, @ticket-platform/observability (+23 more)

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
Cohesion: 0.11
Nodes (17): acceptedResult(), AcceptTelegramOfferService, hashPublicToken(), OfferAcceptanceOrder, OfferAcceptanceRepository, offerAcceptedEvent(), RecordTelegramOfferAcceptanceInput, acceptedAt (+9 more)

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

### Community 26 - "wallet.ts"
Cohesion: 0.47
Nodes (8): assertPositiveKopecks(), assertWalletBalance(), captureWalletHold(), createWalletHold(), creditWallet(), releaseWalletHold(), WalletBucket, WalletTransactionType

### Community 27 - "SqlQueryResult"
Cohesion: 0.10
Nodes (7): NodePostgresConnection, FakeConnection, FakeConnection, FakeConnection, FakeConnection, SqlQueryResult, FakeConnection

### Community 28 - "SqlConnection"
Cohesion: 0.11
Nodes (9): FakePool, FakePool, FakePool, FakePool, SqlConnection, SqlExecutor, FakePool, FakePool (+1 more)

### Community 29 - "api/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, emitDecoratorMetadata, experimentalDecorators, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 30 - "phone-persistence.test.ts"
Cohesion: 0.17
Nodes (11): AdminAuthenticationError, AdminPrincipal, AdminPrincipalRepository, AuthorizeAdminRequest, AuthorizeAdminRequestService, MFA_REQUIRED_PERMISSIONS, sessionWasRevoked(), VerifiedAdminToken (+3 more)

### Community 31 - "messenger.ts"
Cohesion: 0.19
Nodes (4): IdentityRepository, userRegisteredEvent(), PhoneBonusRepository, phoneVerifiedEvent()

### Community 32 - "20260721160000_foundation_identity_audit_outbox.sql"
Cohesion: 0.36
Nodes (7): public.audit_log, public.messenger_identities, public.messenger_username_history, public.outbox_events, public.user_touchpoints, public.users, public.worker_heartbeats

### Community 33 - "Implementation Plan"
Cohesion: 0.25
Nodes (7): Compatibility Risks, Completed Foundation Slice, File Plan, Implementation Plan, Migration Plan, Phase 2 Event Sales Slice, Scope

### Community 34 - ".creditPhoneBonus"
Cohesion: 0.12
Nodes (12): CreditPhoneBonusInput, CreditPhoneBonusResult, PhoneVerificationRepository, TelegramUserResolver, VerifyPhoneInput, CampaignRow, ContactRow, ExistingBonusRow (+4 more)

### Community 35 - "telegram-start-persistence.test.ts"
Cohesion: 0.08
Nodes (20): ExpirableOrder, ExpirableOrderStatus, ExpireOrderInput, ExpireOrderResult, ExpireOrdersBatchInput, ExpireOrdersBatchResult, ExpireOrdersBatchService, orderExpiredEvent() (+12 more)

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
Cohesion: 0.17
Nodes (4): expiredOrderRow, FakeConnection, RecordedQuery, walletHoldRow

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
Cohesion: 0.11
Nodes (32): payment(), asRecord(), booleanField(), boundedSecret(), canonicalScalarPairs(), createTBankToken(), digitsField(), hashScalarPayload() (+24 more)

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
Cohesion: 0.19
Nodes (10): HandleTelegramStartService, IdempotencyRepository, IdGenerator, MessengerIdentityRecord, OutboxWriter, UnitOfWork, UserRecord, HandleTelegramContactService (+2 more)

### Community 57 - ".transact"
Cohesion: 0.28
Nodes (12): applyMigrations(), assertEphemeralDatabaseName(), dropDatabase(), main(), migrationDirectory, MigrationFile, projectRoot, quoteIdentifier() (+4 more)

### Community 62 - "outbox-persistence.test.ts"
Cohesion: 0.14
Nodes (11): AdminBootstrapAlreadyCompletedError, BootstrapFirstAdminCommand, BootstrapFirstAdminService, FirstAdminBootstrapRepository, InvalidAdminBootstrapInputError, normalizeEmail(), normalizeOptional(), normalizeRequired() (+3 more)

### Community 63 - "generate-pgboss-migration.mjs"
Cohesion: 0.22
Nodes (8): deadLetterQueueSql, dispatchQueueSql, migration, migrationPath, pgBossEntryPath, projectRoot, requireFromWorker, schemaSql

### Community 64 - "ADR 0004: pg-boss Schema Management"
Cohesion: 0.25
Nodes (7): ADR 0004: pg-boss Schema Management, Compatibility, Context, Decision, Rollback, Status, Verification

### Community 66 - "messenger.ts"
Cohesion: 0.18
Nodes (10): API and Scenarios, Changed Modules, Goal, Manual Verification, Migrations, Requirements, Risks, Rollback (+2 more)

### Community 67 - "health-persistence.test.ts"
Cohesion: 0.11
Nodes (15): TBankWebhookStatus, isTerminal(), ReconcileTBankPaymentsBatchInput, ReconcileTBankPaymentsBatchResult, ReconcileTBankPaymentsBatchService, requiresReview(), retryAt(), TBankOrderLookupPayment (+7 more)

### Community 68 - "application/src/index.ts"
Cohesion: 0.18
Nodes (3): acceptanceRow, FakeConnection, RecordedQuery

### Community 69 - "app.ts"
Cohesion: 0.12
Nodes (16): CONFIRM_MANUAL_PAYMENT, ConfirmManualPaymentHandler, manualPaymentBodySchema, ManualPaymentsController, noopHandler, result, validBody, Body (+8 more)

### Community 71 - "api/src/main.ts"
Cohesion: 0.14
Nodes (19): OrderSalesContext, OrderSalesProduct, PersistedOrder, PersistOrderInput, PersistOrderResult, aggregateProducts(), EventContextRow, MutableProduct (+11 more)

### Community 72 - "HealthController"
Cohesion: 0.18
Nodes (9): RequireAdminPermission(), HealthController, OperationsController, Controller, Inject, Get, isReadyStatus(), getLivenessSnapshot() (+1 more)

### Community 73 - "messenger-core/src/index.ts"
Cohesion: 0.10
Nodes (16): CREATE_ORDER, createOrderBodySchema, OrdersApiModule, OrdersController, noopHandler, orderResult, Body, Controller (+8 more)

### Community 74 - "createApiApplication"
Cohesion: 0.15
Nodes (7): createApiApplication(), applicationWithStatus(), testApplication(), verifiedEvent, webhookBody, testApplication(), TelegramUpdate

### Community 75 - ".newId"
Cohesion: 0.16
Nodes (16): assertMatchingRequest(), CreateOrderService, eventSnapshot(), hashCreationRequest(), orderCreatedEvent(), OrderPricingSnapshot, OrderSalesEvent, OrderSalesRepository (+8 more)

### Community 76 - "20260723223000_admin_rbac.sql"
Cohesion: 0.33
Nodes (9): audit_log_prevent_delete, audit_log_prevent_update, public.admin_accounts, public.admin_permissions, public.admin_role_grants, public.admin_role_permissions, public.admin_roles, public.audit_log (+1 more)

### Community 77 - ".receive"
Cohesion: 0.10
Nodes (22): HandleTelegramContactCommand, HandleTelegramContactResult, InitializeTelegramPaymentResult, RequestTelegramTicketRedeliveryCommand, RequestTelegramTicketRedeliveryResult, formatKopecks(), formatTicketSummary(), singleLine() (+14 more)

### Community 78 - "grammy.ts"
Cohesion: 0.21
Nodes (18): offer_acceptances_prevent_delete, offer_acceptances_prevent_update, offer_versions_protect_content, order_status_history_prevent_delete, order_status_history_prevent_update, public.event_content_blocks, public.events, public.inventory_reservations (+10 more)

### Community 79 - "telegram-start-persistence.test.ts"
Cohesion: 0.29
Nodes (6): compilerOptions, noEmit, extends, include, ../../../tsconfig.base.json, ./*.ts

### Community 80 - "LibPhoneNumberNormalizer"
Cohesion: 0.17
Nodes (14): expireOrder(), calculatePrice(), comparePricingRules(), compareRuleRank(), dateRank(), matchesPricingInput(), PricingInput, PricingRuleConflictError (+6 more)

### Community 81 - "tsconfig.scripts.json"
Cohesion: 0.25
Nodes (7): packages/database/scripts/**/*.ts, scripts/**/*.ts, compilerOptions, noEmit, extends, include, ./tsconfig.base.json

### Community 82 - "ADR 0005: Administrator Authentication and RBAC"
Cohesion: 0.33
Nodes (5): ADR 0005: Administrator Authentication and RBAC, Consequences, Context, Decision, Status

### Community 83 - "StubConnection"
Cohesion: 0.14
Nodes (6): BootstrapAdminRecord, PostgresFirstAdminBootstrapRepository, MigrationDescriptor, NodePostgresPoolOptions, FakePool, SqlConnectionPool

### Community 84 - "RecordingConnection"
Cohesion: 0.06
Nodes (33): execute(), bootstrapWorker(), assertPgBossQueuesProvisioned(), PgBossOutboxPublisher, PgBossPublisherClient, getQueue(), queue(), append() (+25 more)

### Community 85 - "NodePostgresConnection"
Cohesion: 0.33
Nodes (5): ADR 0006: CI and Ephemeral Migration Testing, Consequences, Context, Decision, Status

### Community 86 - "check-ci-config.mjs"
Cohesion: 0.40
Nodes (4): dependabotPath, violations, workflowDirectory, workflowFiles

### Community 87 - "PostgresOutboxWriter"
Cohesion: 0.18
Nodes (5): adminContextRow, FakePool, RecordedQuery, ticketOrderContextRow, ticketRows

### Community 89 - "order-sales-persistence.test.ts"
Cohesion: 0.15
Nodes (5): eventContextRow, FakePool, productPricingRow, RecordedQuery, referenceGenerator

### Community 90 - "app.ts"
Cohesion: 0.29
Nodes (13): bootstrapApi(), getExpectedMigrationVersion(), bootstrapTelegramBot(), migrations, createNodePostgresPool(), createOfferAcceptancePersistence(), createOrderSalesPersistence(), createPhonePersistence() (+5 more)

### Community 93 - "order.ts"
Cohesion: 0.29
Nodes (6): ADR 0008: Idempotent Telegram Notification Delivery, Compatibility And Rollback, Consequences, Context, Decision, Status

### Community 94 - ".register"
Cohesion: 0.29
Nodes (6): Enablement, Recovery, Rollback, Signals, Telegram Notification Delivery Runbook, Validation

### Community 95 - "ADR 0007: Event Sales And Immutable Order Snapshots"
Cohesion: 0.33
Nodes (5): ADR 0007: Event Sales And Immutable Order Snapshots, Compatibility And Rollback, Consequences, Context, Decision

### Community 96 - "orders.test.ts"
Cohesion: 0.12
Nodes (4): callbackFixture(), myTicketsFixture(), ticketRedeliveryFixture(), Logger

### Community 97 - "health-persistence.test.ts"
Cohesion: 0.33
Nodes (5): Order Expiry Runbook, Read-Only Checks, Recovery, Signals, Validation

### Community 98 - "TransactionSession"
Cohesion: 0.13
Nodes (12): BeginIdempotentOperationInput, RecordTouchpointInput, UpsertTelegramIdentityInput, UpsertTelegramIdentityResult, MemoryIdempotencyRepository, expectAffectedRow(), IdentityRow, mapIdentity() (+4 more)

### Community 99 - "payment-confirmation.ts"
Cohesion: 0.05
Nodes (35): ConfirmablePaymentOrder, ConfirmedPaymentRecord, hashConfirmationRequest(), IssuedTicket, issueTicketReferences(), ManualPaymentEvidence, PaymentConfirmationActor, PaymentConfirmationRepository (+27 more)

### Community 100 - "payment-confirmation.test.ts"
Cohesion: 0.10
Nodes (20): dependencies, qrcode, @ticket-platform/application, devDependencies, @types/qrcode, @ticket-platform/application, main, name (+12 more)

### Community 101 - "outbox.ts"
Cohesion: 0.67
Nodes (3): notification_deliveries_protect_record, public.notification_deliveries, public.protect_notification_delivery_record()

### Community 102 - "MoneyKopecks"
Cohesion: 0.10
Nodes (17): PreparedTBankPaymentAttempt, PrepareTBankPaymentResult, RecordTBankStatusEvent, TBankPaymentInitializationRepository, TBankWebhookPaymentAttempt, PostgresUnitOfWork, AttemptOrderRow, createMerchantOrderId() (+9 more)

### Community 103 - "admin-authorization-persistence.ts"
Cohesion: 0.21
Nodes (13): ApiApplicationOptions, APP_VERSION, READINESS_CHECK, CreateOrderCommandHandler, TBANK_WEBHOOK_CONFIG, TBANK_WEBHOOK_HANDLER, TBANK_WEBHOOK_VERIFIER, TBankWebhookEndpointConfig (+5 more)

### Community 104 - "payment-confirmation-persistence.test.ts"
Cohesion: 0.17
Nodes (6): confirmedAt, orderItemRow, orderRow, RecordedQuery, walletAllocationRow, walletHoldRow

### Community 105 - "grammy.ts"
Cohesion: 0.29
Nodes (8): TBankReconciliationClaim, isTerminal(), leaseLost(), PostgresTBankReconciliationRepository, ReconciliationClaimRow, safeResultCode(), terminalAttemptStatus(), UpdatedAttemptRow

### Community 106 - "ticket-access-persistence.test.ts"
Cohesion: 0.13
Nodes (14): isTelegramUserId(), isUuid(), RedeliverableTicket, RequestTelegramTicketRedeliveryService, TelegramTicketAccessRepository, directUnitOfWork, MemoryTicketRepository, ticketRedeliveryRequestedEvent() (+6 more)

### Community 107 - "DomainEvent"
Cohesion: 0.14
Nodes (11): TBankWebhookController, TBankWebhookModule, TBankWebhookService, Body, Controller, HttpCode, Inject, Injectable (+3 more)

### Community 108 - ".query"
Cohesion: 0.36
Nodes (3): PhoneNormalizer, InvalidPhoneNumberError, LibPhoneNumberNormalizer

### Community 109 - "supabase-admin-token-verifier.ts"
Cohesion: 0.12
Nodes (8): FakeConnection, idGenerator, orderRow, pendingAttemptRow, RecordedQuery, requestedAt, webhookAttempt, webhookEvent

### Community 110 - "notification-sender.ts"
Cohesion: 0.26
Nodes (4): GrammyTextNotificationSender, TelegramNotificationApi, validateMessageId(), validateRecipient()

### Community 111 - "Manual Payment Confirmation Runbook"
Cohesion: 0.25
Nodes (7): Failure And Recovery, Manual Payment Confirmation Runbook, Preconditions, Purpose, Read-Only Verification, Request, Rollback

### Community 112 - "MessengerAdapter"
Cohesion: 0.18
Nodes (4): IncomingMessage, MessengerAdapter, SendMessageCommand, SendResult

### Community 113 - "NodePostgresConnection"
Cohesion: 0.22
Nodes (6): AdminAuthorizationModule, Module, ApiModule, Module, ManualPaymentsApiModule, Module

### Community 114 - "20260724170000_payment_confirmation_tickets.sql"
Cohesion: 0.43
Nodes (6): manual_payments_append_only, payment_attempts_protect_evidence, public.manual_payments, public.payment_attempts, public.prevent_manual_payment_mutation(), public.protect_payment_attempt_record()

### Community 115 - "notification-delivery.test.ts"
Cohesion: 0.18
Nodes (7): ClaimNotificationDeliveryInput, adminContext, adminJob, MemoryLedger, redeliveryJob, ticketContext, ticketJob

### Community 116 - "notification-delivery-persistence.ts"
Cohesion: 0.19
Nodes (8): AdminPurchaseContext, NotificationContextRepository, TicketDeliveryContext, AdminPurchaseContextRow, DeliveryStateRow, PostgresNotificationContextRepository, TicketOrderContextRow, TicketRow

### Community 117 - "controller.ts"
Cohesion: 0.19
Nodes (10): ADMIN_AUTHORIZER, ADMIN_TOKEN_VERIFIER, AdminAuthorizationGuard, AdminAuthorizationModuleOptions, AuthenticatedAdminRequest, parseBearerToken(), REQUIRED_ADMIN_PERMISSION, Inject (+2 more)

### Community 118 - "contracts/src/index.ts"
Cohesion: 0.17
Nodes (5): at, claim, claimRow, FakePool, RecordedQuery

### Community 119 - "NotificationSender"
Cohesion: 0.28
Nodes (3): NotificationSender, RecordingSender, TextNotificationSender

### Community 120 - "TicketPngRenderer"
Cohesion: 0.27
Nodes (4): RecordingRenderer, TicketPng, TicketPngRenderer, QrTicketPngRenderer

### Community 121 - "health-persistence.ts"
Cohesion: 0.25
Nodes (7): Enablement, Expected Flow, Failure And Recovery, Purpose, Read-Only Verification, Rollback, T-Bank Payments Runbook

### Community 122 - ".connect"
Cohesion: 0.36
Nodes (3): ClaimNotificationDeliveryResult, PostgresNotificationDeliveryLedger, query()

### Community 123 - "PhoneVerificationRepository"
Cohesion: 0.29
Nodes (6): ADR 0009: T-Bank Payment Initialization And Webhooks, Compatibility And Rollback, Consequences, Context, Decision, Status

### Community 125 - "orders.test.ts"
Cohesion: 0.60
Nodes (4): payment_provider_events_append_only, public.payment_attempts, public.payment_provider_events, public.prevent_payment_provider_event_mutation()

### Community 126 - "HandleTelegramStartCommand"
Cohesion: 0.17
Nodes (9): ListTelegramTicketsService, HandleTelegramStartCommand, HandleTelegramStartResult, ListTelegramTicketsCommand, ListTelegramTicketsResult, TelegramContactPayload, TelegramStartUser, TelegramStartUseCase (+1 more)

### Community 127 - "ticket-rendering/tsconfig.json"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 129 - ".receive"
Cohesion: 0.17
Nodes (4): FakeConnection, RecordedQuery, redeliverableRow, ticketSummaryRow

### Community 131 - "RequestTelegramTicketRedeliveryCommand"
Cohesion: 0.22
Nodes (4): readiness(), testApplication(), AdminMfaRequiredError, AdminPermissionDeniedError

### Community 132 - "application/src/index.ts"
Cohesion: 0.24
Nodes (3): InvalidAdminAccessTokenError, SupabaseAdminAccessTokenVerifier, SupabaseAdminTokenVerifierOptions

### Community 133 - "health-persistence.ts"
Cohesion: 0.39
Nodes (8): createPostgresHealthProbes(), degraded(), failed(), healthy(), PostgresHealthProbeOptions, probe(), query(), quotePostgresIdentifier()

### Community 134 - "health-persistence.test.ts"
Cohesion: 0.25
Nodes (3): poolForHealthyState(), poolWithRows(), StubConnection

### Community 135 - "admin-authorization-persistence.ts"
Cohesion: 0.32
Nodes (6): ADMIN_PERMISSIONS, AdminPrincipalRow, isAdminPermission(), knownPermissions, mapPrincipal(), PostgresAdminPrincipalRepository

### Community 136 - "messenger.ts"
Cohesion: 0.43
Nodes (6): emptyPayload(), mergePayloadPart(), MessengerChannel, normalizePayload(), normalizeTelegramUsername(), parseStartPayload()

### Community 137 - "ADR 0010: T-Bank Payment Reconciliation"
Cohesion: 0.29
Nodes (6): ADR 0010: T-Bank Payment Reconciliation, Compatibility And Rollback, Consequences, Context, Decision, Status

### Community 138 - "20260725120000_tbank_payment_reconciliation.sql"
Cohesion: 0.60
Nodes (4): payment_reconciliation_events_append_only, public.payment_attempts, public.payment_reconciliation_events, public.prevent_payment_reconciliation_event_mutation()

## Knowledge Gaps
- **629 isolated node(s):** `name`, `version`, `private`, `type`, `build` (+624 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **12 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `IdGenerator` connect `NodePostgresConnection` to `api/src/main.ts`, `.receive`, `telegram-start-persistence.ts`, `.query`, `.creditPhoneBonus`, `telegram-start-persistence.test.ts`, `node-postgres.test.ts`, `outbox-persistence.test.ts`, `health-persistence.test.ts`, `application/src/index.ts`, `outbox.ts`, `api/src/main.ts`, `.newId`, `RecordingConnection`, `order-sales-persistence.test.ts`, `app.ts`, `telegram-start-persistence.test.ts`, `TransactionSession`, `payment-confirmation.ts`, `MoneyKopecks`, `payment-confirmation-persistence.test.ts`, `ticket-access-persistence.test.ts`, `supabase-admin-token-verifier.ts`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **Why does `SqlConnectionPool` connect `StubConnection` to `.receive`, `health-persistence.ts`, `health-persistence.test.ts`, `admin-authorization-persistence.ts`, `node-postgres.ts`, `SqlConnection`, `.creditPhoneBonus`, `telegram-start-persistence.test.ts`, `node-postgres.test.ts`, `application/src/index.ts`, `outbox.ts`, `api/src/main.ts`, `RecordingConnection`, `PostgresOutboxWriter`, `order-sales-persistence.test.ts`, `telegram-start-persistence.test.ts`, `TransactionSession`, `payment-confirmation.ts`, `MoneyKopecks`, `payment-confirmation-persistence.test.ts`, `grammy.ts`, `ticket-access-persistence.test.ts`, `supabase-admin-token-verifier.ts`, `notification-delivery-persistence.ts`, `contracts/src/index.ts`, `.connect`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Why does `SqlQueryResult` connect `SqlQueryResult` to `StubConnection`, `.receive`, `TransactionSession`, `application/src/index.ts`, `health-persistence.ts`, `health-persistence.test.ts`, `outbox.ts`, `payment-confirmation-persistence.test.ts`, `StubConnection`, `supabase-admin-token-verifier.ts`, `node-postgres.test.ts`, `StubConnection`, `notification-delivery-persistence.ts`, `RecordingConnection`, `contracts/src/index.ts`, `PostgresOutboxWriter`, `order-sales-persistence.test.ts`, `telegram-start-persistence.test.ts`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _629 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `telegram-webhook.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09230769230769231 - nodes in this community are weakly interconnected._
- **Should `api/src/main.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.13768115942028986 - nodes in this community are weakly interconnected._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.043478260869565216 - nodes in this community are weakly interconnected._