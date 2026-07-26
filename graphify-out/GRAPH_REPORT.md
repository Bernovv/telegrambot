# Graph Report - Project  (2026-07-26)

## Corpus Check
- 302 files · ~149,967 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3517 nodes · 7193 edges · 202 communities (193 shown, 9 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 63 edges (avg confidence: 0.62)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `e25a47c4`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

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
- seed.sql
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
- outbox-persistence.ts
- grammy.ts
- telegram-start-persistence.test.ts
- LibPhoneNumberNormalizer
- .deliverTickets
- ADR 0005: Administrator Authentication and RBAC
- StubConnection
- RecordingConnection
- NodePostgresConnection
- check-ci-config.mjs
- PostgresOutboxWriter
- eslint.config.mjs
- order-sales-persistence.test.ts
- app.ts
- HmacOrderReferenceGenerator
- telegram-start-persistence.test.ts
- order.ts
- .register
- ADR 0007: Event Sales And Immutable Order Snapshots
- orders.test.ts
- controller.test.ts
- TransactionSession
- payment-confirmation.ts
- payment-confirmation.test.ts
- outbox.ts
- MoneyKopecks
- admin-authorization-persistence.ts
- admin-event-content-management-persistence.ts
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
- ticket-rendering/tsconfig.json
- Telegram Ticket Platform
- check-ci-config.mjs
- 20260722230000_pgboss_v37_outbox_queues.sql
- 20260724220000_tbank_payment_attempts_webhooks.sql
- 20260725120000_tbank_payment_reconciliation.sql
- 20260724190000_notification_delivery_ledger.sql
- scenario-engine/src/index.ts
- next-env.d.ts
- noop.mjs
- 20260721162000_foundation_idempotency_keys.sql
- .execute
- event-general-form.tsx
- admin-event-catalog-management-persistence.test.ts
- admin-operations.test.ts
- notification-delivery-persistence.test.ts
- telegram-start-persistence.test.ts
- ticket-access-persistence.test.ts
- ADR 0014: Audited Administrator Event Draft Management
- DomainEvent
- .deliverTickets
- Administrator Event Draft Management Runbook
- admin-event-content-management-persistence.test.ts
- .execute
- worker/src/main.ts
- health-persistence.ts
- order-expiry-persistence.test.ts
- event-content-editor.tsx
- admin-events-api.test.ts
- outbox-persistence.test.ts
- TBankWebhookStatus
- AdminEventAuditContext
- grammy.ts
- PostgresIdempotencyRepository
- ADR 0016: Draft Event Content Management
- admin-event-scenario-management-persistence.test.ts
- .execute
- telegram.ts
- Пользовательский runtime сценария
- MemoryLedger
- StubConnection
- PostgresNotificationDeliveryLedger
- tbank-refunds.test.ts
- offer-acceptance-persistence.test.ts
- TBankWebhookStatus
- NodePostgresConnection
- LibPhoneNumberNormalizer
- scenario-runtime.test.ts
- StubConnection
- scenario-runtime.test.ts
- ADR 0022: Продолжение сценария после подтвержденной оплаты
- scenario-engine/src/index.test.ts
- TBankWebhookStatus
- ADR 0024: Обязательный TOTP MFA для веб-админки
- .next/**
- tbank-refunds.test.ts
- admin-web/proxy.ts
- MFA администраторов
- StubConnection

## God Nodes (most connected - your core abstractions)
1. `SqlConnection` - 135 edges
2. `SqlConnectionPool` - 88 edges
3. `SqlQueryResult` - 76 edges
4. `IdGenerator` - 75 edges
5. `AuthenticatedAdminRequest` - 36 edges
6. `AdminRequestActor` - 36 edges
7. `TransactionSession` - 33 edges
8. `RequireAdminPermission()` - 30 edges
9. `requireAdminEventUuid()` - 26 edges
10. `UnitOfWork` - 25 edges

## Surprising Connections (you probably didn't know these)
- `EventGeneralFormProps` --references--> `AdminEventDetail`  [EXTRACTED]
  apps/admin-web/src/components/event-general-form.tsx → packages/contracts/src/admin-events.ts
- `AdminAuthorizationModuleOptions` --references--> `AdminAccessTokenVerifier`  [EXTRACTED]
  apps/api/src/admin-auth.ts → packages/application/src/admin-authorization.ts
- `AdminAuthorizationModuleOptions` --references--> `AuthorizeAdminRequest`  [EXTRACTED]
  apps/api/src/admin-auth.ts → packages/application/src/admin-authorization.ts
- `AuthenticatedAdminRequest` --references--> `AdminRequestActor`  [EXTRACTED]
  apps/api/src/admin-auth.ts → packages/contracts/src/admin-auth.ts
- `AdminEventsHandlers` --references--> `AdminEventDetail`  [EXTRACTED]
  apps/api/src/admin-events-api.ts → packages/contracts/src/admin-events.ts

## Import Cycles
- None detected.

## Communities (202 total, 9 thin omitted)

### Community 0 - "telegram-webhook.ts"
Cohesion: 0.29
Nodes (7): EventGeneralForm(), EventGeneralFormProps, nullableValue(), numberValue(), readGeneralInput(), requiredValue(), stringValue()

### Community 1 - "api/src/main.ts"
Cohesion: 0.09
Nodes (17): assertPgBossQueuesProvisioned(), PgBossOutboxPublisher, PgBossPublisherClient, getQueue(), queue(), append(), ClaimedOutboxEvent, DispatchOutboxBatchResult (+9 more)

### Community 2 - "grammy.test.ts"
Cohesion: 0.10
Nodes (20): ^build, coverage/**, dist/**, ^lint, ^typecheck, dependsOn, outputs, cache (+12 more)

### Community 3 - "dependencies"
Cohesion: 0.04
Nodes (47): dependencies, fastify, jose, @nestjs/common, @nestjs/core, @nestjs/platform-fastify, reflect-metadata, rxjs (+39 more)

### Community 4 - "compilerOptions"
Cohesion: 0.04
Nodes (16): RecordingConnection, FakeConnection, FakeConnection, FakeConnection, FakeConnection, FakeConnection, FakeConnection, StubConnection (+8 more)

### Community 5 - "telegram-start-persistence.ts"
Cohesion: 0.05
Nodes (39): eslint, @eslint/js, js-yaml, devDependencies, eslint, @eslint/js, js-yaml, tsx (+31 more)

### Community 6 - "scripts"
Cohesion: 0.05
Nodes (39): packages/application/src/index.ts, packages/config/src/index.ts, packages/contracts/src/index.ts, packages/database/src/index.ts, packages/domain/src/index.ts, packages/messenger-core/src/index.ts, packages/messenger-telegram/src/index.ts, packages/observability/src/index.ts (+31 more)

### Community 7 - "dependencies"
Cohesion: 0.05
Nodes (30): ADMIN_EVENTS, catalogMutationSchema, CatalogPricingHandler, contentBlockMutationSchema, contentBlockSchema, createEventSchema, cursorSchema, DeactivateOfferHandler (+22 more)

### Community 8 - "database/package.json"
Cohesion: 0.14
Nodes (10): aggregateStatus(), GetReadinessService, HealthClock, HealthProbe, HealthProbeResult, isReadyStatus(), statusPriority, systemClock (+2 more)

### Community 9 - "messenger-telegram/package.json"
Cohesion: 0.13
Nodes (26): ADMIN_EVENT_CONTENT_BLOCK_TYPES, AdminEventProduct, AdminEventScenarioVersion, AdminScenarioNodeType, ContentBlockRow, escapeLike(), EventDetailRow, EventSummaryRow (+18 more)

### Community 10 - "tasks"
Cohesion: 0.19
Nodes (19): AdminEventCatalogManagementRepository, appendCatalogAudit(), bumpEventVersion(), EventGate, EventGateRow, lockDraftEvent(), PostgresAdminEventCatalogManagementRepository, pricingRuleCurrencyConflictExists() (+11 more)

### Community 11 - "identity.ts"
Cohesion: 0.13
Nodes (37): AdminAuthConfig, ApiConfig, AppConfig, AppEnvironment, loadApiConfig(), loadAppConfig(), loadOfferStorageConfig(), loadTBankPaymentsConfig() (+29 more)

### Community 12 - "phone.ts"
Cohesion: 0.06
Nodes (34): compilerOptions, allowJs, baseUrl, esModuleInterop, exactOptionalPropertyTypes, incremental, isolatedModules, jsx (+26 more)

### Community 13 - "worker/package.json"
Cohesion: 0.13
Nodes (14): LockTelegramScenarioResult, OpenTelegramScenarioResult, ScenarioRuntimeSession, asObject(), EdgeRow, EventRow, expectAffectedRow(), mapEdge() (+6 more)

### Community 14 - "messenger-core/package.json"
Cohesion: 0.06
Nodes (31): dependencies, lucide-react, next, react, react-dom, @supabase/ssr, @supabase/supabase-js, @ticket-platform/contracts (+23 more)

### Community 15 - "application/package.json"
Cohesion: 0.08
Nodes (20): ADMIN_AUTHORIZER, ADMIN_TOKEN_VERIFIER, AdminAuthorizationGuard, AdminAuthorizationModule, parseBearerToken(), REQUIRED_ADMIN_PERMISSION, Inject, Injectable (+12 more)

### Community 16 - "admin-web/package.json"
Cohesion: 0.14
Nodes (11): TBankWebhookController, TBankWebhookModule, TBankWebhookService, Body, Controller, HttpCode, Inject, Injectable (+3 more)

### Community 17 - ".query"
Cohesion: 0.06
Nodes (31): dependencies, pg-boss, @ticket-platform/application, @ticket-platform/config, @ticket-platform/contracts, @ticket-platform/database, @ticket-platform/messenger-telegram, @ticket-platform/observability (+23 more)

### Community 18 - "config/package.json"
Cohesion: 0.08
Nodes (18): ExpirableOrder, ExpirableOrderStatus, ExpireOrderInput, ExpireOrderResult, ExpireOrdersBatchInput, ExpireOrdersBatchResult, ExpireOrdersBatchService, orderExpiredEvent() (+10 more)

### Community 19 - "contracts/package.json"
Cohesion: 0.15
Nodes (31): contentPreview(), EventDetailPage(), shortId(), EventsPage(), OrderDetailPage(), OrdersPage(), UserDetailPage(), UsersPage() (+23 more)

### Community 20 - "domain/package.json"
Cohesion: 0.09
Nodes (38): payment(), asRecord(), booleanField(), boundedSecret(), canonicalScalarPairs(), createTBankToken(), digitsField(), hashScalarPayload() (+30 more)

### Community 21 - "observability/package.json"
Cohesion: 0.10
Nodes (17): CONFIRM_MANUAL_PAYMENT, manualPaymentBodySchema, ManualPaymentsApiModule, ManualPaymentsController, noopHandler, result, validBody, Body (+9 more)

### Community 22 - "payment-tbank/package.json"
Cohesion: 0.10
Nodes (8): readiness, createApiApplication(), applicationWithStatus(), testApplication(), verifiedEvent, webhookBody, testApplication(), TelegramUpdate

### Community 23 - "scenario-engine/package.json"
Cohesion: 0.17
Nodes (17): CatalogEditor, EventCatalogEditor(), integerValue(), nullableIntegerValue(), nullableValue(), parseBundleComposition(), PricingRuleForm(), ProductForm() (+9 more)

### Community 24 - "20260722100000_contacts_wallet_ledger.sql"
Cohesion: 0.09
Nodes (19): fullRefundBodySchema, FullRefundsApiModule, FullRefundsController, REQUEST_FULL_REFUND, actor, healthyReadiness, result, unavailableHandler (+11 more)

### Community 25 - "node-postgres.ts"
Cohesion: 0.16
Nodes (15): assertMatchingRequest(), CreateOrderService, eventSnapshot(), hashCreationRequest(), orderCreatedEvent(), OrderPricingSnapshot, OrderSalesEvent, OrderSalesRepository (+7 more)

### Community 26 - "wallet.ts"
Cohesion: 0.07
Nodes (27): dependencies, @ticket-platform/application, @ticket-platform/config, @ticket-platform/database, @ticket-platform/messenger-core, @ticket-platform/messenger-telegram, @ticket-platform/observability, @ticket-platform/payment-tbank (+19 more)

### Community 27 - "SqlQueryResult"
Cohesion: 0.13
Nodes (16): AdminEventPageCursor, AdminEventsRepository, decodeCursor(), encodeCursor(), GetAdminEventService, ListAdminEventsService, parseLimit(), parseSearch() (+8 more)

### Community 28 - "SqlConnection"
Cohesion: 0.17
Nodes (13): PreparedFullTBankRefund, PrepareFullTBankRefundResult, TBankRefundReconciliationClaim, TBankRefundReconciliationRepository, assertRefundBinding(), LockedRefundRow, mapRefund(), PostgresTBankRefundRepository (+5 more)

### Community 29 - "api/tsconfig.json"
Cohesion: 0.10
Nodes (15): IdGenerator, OutboxWriter, UnitOfWork, acceptedResult(), hashPublicToken(), OfferAcceptanceOrder, OfferAcceptanceRepository, offerAcceptedEvent() (+7 more)

### Community 30 - "phone-persistence.test.ts"
Cohesion: 0.09
Nodes (19): secretsEqual(), telegramChatSchema, telegramMessageSchema, telegramUpdateSchema, telegramUserSchema, TelegramWebhookController, TelegramWebhookModule, TelegramWebhookService (+11 more)

### Community 31 - "messenger.ts"
Cohesion: 0.13
Nodes (8): FakePool, idGenerator, orderRow, pendingAttemptRow, RecordedQuery, requestedAt, webhookAttempt, webhookEvent

### Community 32 - "20260721160000_foundation_identity_audit_outbox.sql"
Cohesion: 0.07
Nodes (27): dependencies, pg, @ticket-platform/application, @ticket-platform/domain, @ticket-platform/scenario-engine, devDependencies, @types/pg, @ticket-platform/application (+19 more)

### Community 33 - "Implementation Plan"
Cohesion: 0.21
Nodes (15): asRecord(), date(), formatAdminPurchaseMessage(), formatKopecks(), formatTicketMessage(), HandleNotificationJobInput, HandleNotificationJobResult, NotificationDeliveryKind (+7 more)

### Community 34 - ".creditPhoneBonus"
Cohesion: 0.13
Nodes (9): initializedResult(), HandleTelegramContactCommand, HandleTelegramContactResult, InitializeTelegramPaymentCommand, InitializeTelegramPaymentResult, formatKopecks(), TelegramContactUseCase, TelegramPaymentInitializationUseCase (+1 more)

### Community 35 - "telegram-start-persistence.test.ts"
Cohesion: 0.14
Nodes (15): TBankOrderLookupProvider, finalizeRefund(), FullTBankRefundProvider, HandleTBankRefundWebhookService, hashRequest(), providerResultMatches(), ReconcileTBankRefundsBatchService, reconciliationRetryAt() (+7 more)

### Community 36 - "MessengerAdapter"
Cohesion: 0.14
Nodes (10): AdminBootstrapAlreadyCompletedError, BootstrapFirstAdminCommand, BootstrapFirstAdminService, InvalidAdminBootstrapInputError, normalizeEmail(), normalizeOptional(), normalizeRequired(), main() (+2 more)

### Community 37 - "ADR 0003: Wallet Ledger"
Cohesion: 0.11
Nodes (12): at, attemptRow, contactRow, FakePool, historyRow, identityRow, itemRow, orderRow (+4 more)

### Community 38 - "check-migrations.mjs"
Cohesion: 0.13
Nodes (39): AuthenticatedAdminRequest, RequireAdminPermission(), AdminEventsController, invalidEventMutation(), invalidEventQuery(), mapEventMutationError(), mapEventReadError(), mutationMetadata() (+31 more)

### Community 39 - "admin-web/tsconfig.json"
Cohesion: 0.07
Nodes (38): AdminOperationsHandlers, AdminOperationsRepository, AdminPageCursor, decodeCursor(), encodeCursor(), GetAdminOrderService, GetAdminUserService, ListAdminOrdersService (+30 more)

### Community 40 - "telegram-bot/tsconfig.json"
Cohesion: 0.09
Nodes (21): grammy, dependencies, grammy, @ticket-platform/contracts, @ticket-platform/messenger-core, @ticket-platform/observability, @ticket-platform/contracts, @ticket-platform/messenger-core (+13 more)

### Community 41 - "worker/tsconfig.json"
Cohesion: 0.10
Nodes (24): AdminEventsHandlers, AdminEventNotDraftError, AdminEventPublicationRequirementsError, AdminEventSlugConflictError, AdminEventVersionConflictError, buildAdminEventAuditContext(), CreateAdminEventDraftService, normalizeOptional() (+16 more)

### Community 42 - "MCP Setup"
Cohesion: 0.10
Nodes (20): dependencies, qrcode, @ticket-platform/application, devDependencies, @types/qrcode, @ticket-platform/application, main, name (+12 more)

### Community 43 - "application/tsconfig.json"
Cohesion: 0.21
Nodes (18): offer_acceptances_prevent_delete, offer_acceptances_prevent_update, offer_versions_protect_content, order_status_history_prevent_delete, order_status_history_prevent_update, public.event_content_blocks, public.events, public.inventory_reservations (+10 more)

### Community 44 - "config/tsconfig.json"
Cohesion: 0.13
Nodes (31): bootstrapApi(), getExpectedMigrationVersion(), bootstrapTelegramBot(), bootstrapWorker(), HandleTelegramStartService, AcceptTelegramOfferService, InitializeTelegramTBankPaymentService, createAdminEventCatalogManagementPersistence() (+23 more)

### Community 45 - "contracts/tsconfig.json"
Cohesion: 0.10
Nodes (17): CREATE_ORDER, createOrderBodySchema, OrdersApiModule, OrdersController, noopHandler, orderResult, Body, Controller (+9 more)

### Community 46 - "node-postgres.test.ts"
Cohesion: 0.09
Nodes (21): hashConfirmationRequest(), IssuedTicket, issueTicketReferences(), ManualPaymentEvidence, PaymentConfirmationActor, PaymentConfirmationRepository, PaymentConfirmationSource, paymentEvents() (+13 more)

### Community 47 - "database/tsconfig.json"
Cohesion: 0.14
Nodes (19): OrderSalesContext, OrderSalesProduct, PersistedOrder, PersistOrderInput, PersistOrderResult, aggregateProducts(), EventContextRow, MutableProduct (+11 more)

### Community 48 - "domain/tsconfig.json"
Cohesion: 0.11
Nodes (17): libphonenumber-js, dependencies, libphonenumber-js, @ticket-platform/application, @ticket-platform/application, main, name, private (+9 more)

### Community 49 - "messenger-core/tsconfig.json"
Cohesion: 0.10
Nodes (19): dependencies, @ticket-platform/contracts, @ticket-platform/domain, @ticket-platform/scenario-engine, @ticket-platform/contracts, @ticket-platform/domain, @ticket-platform/scenario-engine, main (+11 more)

### Community 50 - "messenger-telegram/tsconfig.json"
Cohesion: 0.16
Nodes (15): expireOrder(), calculatePrice(), comparePricingRules(), compareRuleRank(), dateRank(), matchesPricingInput(), PricingInput, PricingResult (+7 more)

### Community 51 - "observability/tsconfig.json"
Cohesion: 0.09
Nodes (26): OfferVersionHandler, ProductCommand, ContentBlockCommand, AdminEventMutationMetadata, AdminEventOfferNotActiveError, AdminOfferSnapshotStorageUnavailableError, bounded(), DeactivateAdminEventOfferService (+18 more)

### Community 52 - "payment-tbank/src/index.ts"
Cohesion: 0.12
Nodes (7): PhoneNormalizer, IncomingMessage, MessengerAdapter, SendMessageCommand, SendResult, InvalidPhoneNumberError, LibPhoneNumberNormalizer

### Community 53 - "payment-tbank/tsconfig.json"
Cohesion: 0.26
Nodes (5): edge(), invalidGraph(), loadDraft(), node(), validGraph()

### Community 54 - "scenario-engine/tsconfig.json"
Cohesion: 0.17
Nodes (8): execution(), advanceResult(), duplicateAdvanceResult(), duplicateInputResult(), duplicateStartResult(), scenarioCommandKey(), ScenarioRuntimeRepository, startResult()

### Community 55 - "Telegram Ticket Platform"
Cohesion: 0.09
Nodes (17): ContentBlockHandler, AdminEventContentBlockNotFoundError, AdminEventContentSortOrderConflictError, assertJsonValue(), ContentFailure, CreateAdminEventContentBlockService, mutationResult(), normalizeJsonObject() (+9 more)

### Community 56 - "NodePostgresConnection"
Cohesion: 0.11
Nodes (21): AdminEventGeneralRecord, AdminEventManagementRepository, AdminEventPublicationIssue, appendAudit(), EventGeneralRow, EventPublicationCatalogRow, eventSnapshot(), eventValues() (+13 more)

### Community 57 - ".transact"
Cohesion: 0.21
Nodes (11): LoginForm(), metadata, MfaPage(), Enrollment, MfaForm(), AdminAuthDestination, adminDestinationForAssurance(), isValidTotpCode() (+3 more)

### Community 58 - "scenario-engine/src/index.ts"
Cohesion: 0.15
Nodes (7): readiness(), testApplication(), InvalidAdminAccessTokenError, SupabaseAdminAccessTokenVerifier, SupabaseAdminTokenVerifierOptions, AdminAccessTokenVerifier, VerifiedAdminToken

### Community 59 - "noop.mjs"
Cohesion: 0.10
Nodes (20): AdminEventOfferVersionRecord, ActiveOfferRow, activeOfferSnapshot(), appendOfferAudit(), EventGate, EventGateRow, listOfferDocuments(), lockDraftEvent() (+12 more)

### Community 60 - "20260721162000_foundation_idempotency_keys.sql"
Cohesion: 0.06
Nodes (30): ConfirmPaymentService, ExternalPaymentInitializer, HandleTBankPaymentWebhookService, isRefundStatus(), mapStatus(), PreparedTBankPaymentAttempt, PrepareTBankPaymentResult, RecordTBankStatusEvent (+22 more)

### Community 61 - "seed.sql"
Cohesion: 0.07
Nodes (26): CatalogProductHandler, AdminEventPricingRuleNotFoundError, AdminEventProductCodeConflictError, CatalogFailure, CreateAdminEventPricingRuleService, CreateAdminEventProductService, integerBetween(), mutationResult() (+18 more)

### Community 62 - "outbox-persistence.test.ts"
Cohesion: 0.14
Nodes (12): isTerminal(), ReconcileTBankPaymentsBatchInput, ReconcileTBankPaymentsBatchResult, ReconcileTBankPaymentsBatchService, requiresReview(), retryAt(), TBankOrderLookupResult, TBankReconciliationRepository (+4 more)

### Community 63 - "generate-pgboss-migration.mjs"
Cohesion: 0.16
Nodes (17): AdminAuthorizationModuleOptions, ApiApplicationOptions, APP_VERSION, READINESS_CHECK, RequestFullRefundHandler, ConfirmManualPaymentHandler, CreateOrderCommandHandler, TBANK_WEBHOOK_CONFIG (+9 more)

### Community 64 - "ADR 0004: pg-boss Schema Management"
Cohesion: 0.18
Nodes (7): DisabledOfferSnapshotStorage, from(), OfferStorageClient, StorageBucketClient, SupabaseOfferSnapshotStorage, ImmutableOfferSnapshot, OfferSnapshotStorage

### Community 65 - "20260722230000_pgboss_v37_outbox_queues.sql"
Cohesion: 0.11
Nodes (15): ConfirmablePaymentOrder, ConfirmedPaymentRecord, PersistPaymentConfirmationInput, command, confirmedAt, order, RecordingRepository, ConfirmedPaymentRow (+7 more)

### Community 66 - "messenger.ts"
Cohesion: 0.15
Nodes (12): main, name, private, scripts, build, dev, lint, test (+4 more)

### Community 67 - "health-persistence.test.ts"
Cohesion: 0.15
Nodes (12): main, name, private, scripts, build, dev, lint, test (+4 more)

### Community 68 - "application/src/index.ts"
Cohesion: 0.28
Nodes (12): applyMigrations(), assertEphemeralDatabaseName(), dropDatabase(), main(), migrationDirectory, MigrationFile, projectRoot, quoteIdentifier() (+4 more)

### Community 69 - "app.ts"
Cohesion: 0.12
Nodes (8): AdvanceTelegramScenarioService, ResumeTelegramScenarioAfterOfferService, StartTelegramScenarioService, SubmitTelegramScenarioInputService, edgeRows, nodeRows, occurredAt, RecordedQuery

### Community 70 - "outbox.ts"
Cohesion: 0.15
Nodes (12): main, name, private, scripts, build, dev, lint, test (+4 more)

### Community 71 - "api/src/main.ts"
Cohesion: 0.09
Nodes (17): CreditPhoneBonusInput, CreditPhoneBonusResult, HandleTelegramContactService, phoneBonusCreditedEvent(), PhoneBonusRepository, PhoneVerificationRepository, phoneVerifiedEvent(), TelegramUserResolver (+9 more)

### Community 72 - "HealthController"
Cohesion: 0.15
Nodes (12): main, name, private, scripts, build, dev, lint, test (+4 more)

### Community 73 - "messenger-core/src/index.ts"
Cohesion: 0.15
Nodes (12): main, name, private, scripts, build, dev, lint, test (+4 more)

### Community 74 - "createApiApplication"
Cohesion: 0.15
Nodes (12): main, name, private, scripts, build, dev, lint, test (+4 more)

### Community 75 - ".newId"
Cohesion: 0.31
Nodes (12): public.prevent_posted_wallet_transaction_mutation(), public.prevent_wallet_entry_mutation(), public.user_contacts, public.wallet_accounts, public.wallet_credit_campaigns, public.wallet_entries, public.wallet_hold_entries, public.wallet_holds (+4 more)

### Community 76 - "20260723223000_admin_rbac.sql"
Cohesion: 0.10
Nodes (36): buildAdminApiPath(), createEvent(), createEventContentBlock(), createEventPricingRule(), createEventProduct(), deactivateEventOffer(), getOrder(), getUser() (+28 more)

### Community 77 - "outbox-persistence.ts"
Cohesion: 0.06
Nodes (24): AdminPrincipalRepository, BootstrapAdminRecord, FirstAdminBootstrapRepository, ClaimOutboxBatchOptions, AdminPrincipalRow, isAdminPermission(), knownPermissions, mapPrincipal() (+16 more)

### Community 78 - "grammy.ts"
Cohesion: 0.16
Nodes (20): continueFromAction(), duplicateOfferResult(), duplicatePaymentResult(), formatKopecks(), isKopeckString(), LockTelegramScenarioActionResult, LockTelegramScenarioInputResult, orderSummaryText() (+12 more)

### Community 79 - "telegram-start-persistence.test.ts"
Cohesion: 0.13
Nodes (7): confirmedAt, FakePool, orderItemRow, orderRow, RecordedQuery, walletAllocationRow, walletHoldRow

### Community 80 - "LibPhoneNumberNormalizer"
Cohesion: 0.15
Nodes (17): ScenarioDraftHandler, requireAdminEventUuid(), AdminEventScenarioManagementRepository, AdminScenarioValidationFailedError, bounded(), normalizeJsonObject(), parseGraph(), PublishAdminEventScenarioVersionService (+9 more)

### Community 81 - ".deliverTickets"
Cohesion: 0.15
Nodes (5): assertTicketSet(), HandleNotificationJobService, NotificationContextRepository, TicketPublicTokenGenerator, validateExecutionInput()

### Community 82 - "ADR 0005: Administrator Authentication and RBAC"
Cohesion: 0.11
Nodes (9): at, attemptRow, FakeConnection, FakePool, lockedRefundRow, orderRow, prepareInput, RecordedQuery (+1 more)

### Community 83 - "StubConnection"
Cohesion: 0.18
Nodes (10): API and Scenarios, Changed Modules, Goal, Manual Verification, Migrations, Requirements, Risks, Rollback (+2 more)

### Community 84 - "RecordingConnection"
Cohesion: 0.08
Nodes (35): isTelegramUserId(), AcceptTelegramOfferCommand, AcceptTelegramOfferResult, AdvanceTelegramScenarioCommand, AdvanceTelegramScenarioResult, HandleTelegramStartCommand, HandleTelegramStartResult, ListTelegramTicketsCommand (+27 more)

### Community 85 - "NodePostgresConnection"
Cohesion: 0.14
Nodes (16): createEdge(), defaultPayload(), editableGraph(), EditableNode, EventScenarioEditor(), NODE_TYPE_LABELS, NodeSelect(), nodeTypeLabel() (+8 more)

### Community 86 - "check-ci-config.mjs"
Cohesion: 0.20
Nodes (9): Database Connectivity, Database Migrations, Deferred Checks, Health and Readiness Runbook, Job Queue, Outbox Lag, Probe Failure, Public Endpoints (+1 more)

### Community 87 - "PostgresOutboxWriter"
Cohesion: 0.12
Nodes (11): at, contentRow, eventRow, FakePool, offerRow, pricingRow, productRow, RecordedQuery (+3 more)

### Community 88 - "eslint.config.mjs"
Cohesion: 0.28
Nodes (9): TBankOrderLookupPayment, TBankReconciliationClaim, isTerminal(), leaseLost(), PostgresTBankReconciliationRepository, ReconciliationClaimRow, safeResultCode(), terminalAttemptStatus() (+1 more)

### Community 89 - "order-sales-persistence.test.ts"
Cohesion: 0.29
Nodes (3): errorCode(), NotificationDeliveryLedger, MemoryLedger

### Community 90 - "app.ts"
Cohesion: 0.32
Nodes (10): EventCatalogPage(), EventContentPage(), EditEventPage(), EventOfferPage(), EventScenarioPage(), PageError(), PageLoading(), AdminApiError (+2 more)

### Community 91 - "HmacOrderReferenceGenerator"
Cohesion: 0.40
Nodes (9): assertPositiveKopecks(), assertWalletBalance(), captureWalletHold(), createWalletHold(), creditWallet(), releaseWalletHold(), WalletBalance, WalletBucket (+1 more)

### Community 92 - "telegram-start-persistence.test.ts"
Cohesion: 0.33
Nodes (9): audit_log_prevent_delete, audit_log_prevent_update, public.admin_accounts, public.admin_permissions, public.admin_role_grants, public.admin_role_permissions, public.admin_roles, public.audit_log (+1 more)

### Community 93 - "order.ts"
Cohesion: 0.22
Nodes (8): Compatibility Risks, Completed Foundation Slice, File Plan, Implementation Plan, Migration Plan, Phase 2 Event Sales Slice, Phase 4 Admin Operations Slice, Scope

### Community 94 - ".register"
Cohesion: 0.22
Nodes (8): Enablement, Expected Flow, Failure And Recovery, Full Refund Flow, Purpose, Read-Only Verification, Rollback, T-Bank Payments Runbook

### Community 95 - "ADR 0007: Event Sales And Immutable Order Snapshots"
Cohesion: 0.33
Nodes (3): NotificationSender, RecordingSender, TextNotificationSender

### Community 96 - "orders.test.ts"
Cohesion: 0.31
Nodes (4): RecordingRenderer, TicketPng, TicketPngRenderer, QrTicketPngRenderer

### Community 97 - "controller.test.ts"
Cohesion: 0.23
Nodes (10): createPostgresHealthProbes(), degraded(), failed(), healthy(), PostgresHealthProbeOptions, probe(), query(), quotePostgresIdentifier() (+2 more)

### Community 98 - "TransactionSession"
Cohesion: 0.12
Nodes (6): at, claim, claimRow, FakeConnection, FakePool, RecordedQuery

### Community 99 - "payment-confirmation.ts"
Cohesion: 0.22
Nodes (8): deadLetterQueueSql, dispatchQueueSql, migration, migrationPath, pgBossEntryPath, projectRoot, requireFromWorker, schemaSql

### Community 100 - "payment-confirmation.test.ts"
Cohesion: 0.25
Nodes (7): compilerOptions, emitDecoratorMetadata, experimentalDecorators, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 101 - "outbox.ts"
Cohesion: 0.25
Nodes (7): ADR 0004: pg-boss Schema Management, Compatibility, Context, Decision, Rollback, Status, Verification

### Community 102 - "MoneyKopecks"
Cohesion: 0.25
Nodes (7): Failure And Recovery, Manual Payment Confirmation Runbook, Preconditions, Purpose, Read-Only Verification, Request, Rollback

### Community 103 - "admin-authorization-persistence.ts"
Cohesion: 0.24
Nodes (11): contactKeyboard(), createTelegramBot(), inlineKeyboard(), sendReplies(), TelegramBotOptions, callbackPattern, decodeScenarioCallback(), decodeUuid() (+3 more)

### Community 104 - "admin-event-content-management-persistence.ts"
Cohesion: 0.24
Nodes (13): AdminEventContentManagementRepository, appendContentAudit(), bumpEventVersion(), ContentBlockRow, contentBlockRowSnapshot(), contentBlockSnapshot(), contentBlockValues(), EventGate (+5 more)

### Community 105 - "grammy.ts"
Cohesion: 0.25
Nodes (7): packages/database/scripts/**/*.ts, scripts/**/*.ts, compilerOptions, noEmit, extends, include, ./tsconfig.base.json

### Community 106 - "ticket-access-persistence.test.ts"
Cohesion: 0.25
Nodes (5): approvedVendorDestructiveStatements, destructivePatterns, files, migrationDir, violations

### Community 107 - "DomainEvent"
Cohesion: 0.36
Nodes (7): public.audit_log, public.messenger_identities, public.messenger_username_history, public.outbox_events, public.user_touchpoints, public.users, public.worker_heartbeats

### Community 108 - ".query"
Cohesion: 0.29
Nodes (6): ADR 0008: Idempotent Telegram Notification Delivery, Compatibility And Rollback, Consequences, Context, Decision, Status

### Community 109 - "supabase-admin-token-verifier.ts"
Cohesion: 0.29
Nodes (6): ADR 0009: T-Bank Payment Initialization And Webhooks, Compatibility And Rollback, Consequences, Context, Decision, Status

### Community 110 - "notification-sender.ts"
Cohesion: 0.29
Nodes (6): ADR 0010: T-Bank Payment Reconciliation, Compatibility And Rollback, Consequences, Context, Decision, Status

### Community 111 - "Manual Payment Confirmation Runbook"
Cohesion: 0.29
Nodes (6): ADR 0011: Safe Full T-Bank Refunds, Compatibility And Rollback, Consequences, Context, Decision, Status

### Community 112 - "MessengerAdapter"
Cohesion: 0.29
Nodes (6): ADR 0012: Read-Only Administrator Projections, Compatibility And Rollback, Consequences, Context, Decision, Status

### Community 113 - "NodePostgresConnection"
Cohesion: 0.29
Nodes (6): Enablement, Recovery, Rollback, Signals, Telegram Notification Delivery Runbook, Validation

### Community 114 - "20260724170000_payment_confirmation_tickets.sql"
Cohesion: 0.23
Nodes (6): ScenarioPresentationModel, GrammyTextNotificationSender, TelegramNotificationApi, validateButtonText(), validateMessageId(), validateRecipient()

### Community 115 - "notification-delivery.test.ts"
Cohesion: 0.29
Nodes (6): compilerOptions, noEmit, extends, include, ./*.ts, ../../../tsconfig.base.json

### Community 116 - "notification-delivery-persistence.ts"
Cohesion: 0.43
Nodes (6): manual_payments_append_only, payment_attempts_protect_evidence, public.manual_payments, public.payment_attempts, public.prevent_manual_payment_mutation(), public.protect_payment_attempt_record()

### Community 117 - "controller.ts"
Cohesion: 0.43
Nodes (6): payment_refund_events_append_only, payment_refund_requests_protect_evidence, public.payment_refund_events, public.payment_refund_requests, public.prevent_payment_refund_event_mutation(), public.protect_payment_refund_request()

### Community 118 - "contracts/src/index.ts"
Cohesion: 0.15
Nodes (10): AdminEventsApiModule, Module, ApiModule, HealthController, OperationsController, Controller, Get, Inject (+2 more)

### Community 119 - "NotificationSender"
Cohesion: 0.33
Nodes (5): ADR 0003: Wallet Ledger, Compatibility And Rollback, Consequences, Context, Decision

### Community 120 - "TicketPngRenderer"
Cohesion: 0.33
Nodes (5): ADR 0005: Administrator Authentication and RBAC, Consequences, Context, Decision, Status

### Community 121 - "health-persistence.ts"
Cohesion: 0.33
Nodes (5): ADR 0006: CI and Ephemeral Migration Testing, Consequences, Context, Decision, Status

### Community 122 - ".connect"
Cohesion: 0.33
Nodes (5): ADR 0007: Event Sales And Immutable Order Snapshots, Compatibility And Rollback, Consequences, Context, Decision

### Community 123 - "PhoneVerificationRepository"
Cohesion: 0.33
Nodes (5): Administrator Read Operations Runbook, Endpoints, Failure And Recovery, Pagination, Web Administrator UI

### Community 124 - ".deliverOnce"
Cohesion: 0.33
Nodes (5): Order Expiry Runbook, Read-Only Checks, Recovery, Signals, Validation

### Community 125 - "orders.test.ts"
Cohesion: 0.15
Nodes (5): eventContextRow, FakePool, productPricingRow, RecordedQuery, referenceGenerator

### Community 126 - "HandleTelegramStartCommand"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 127 - "ticket-rendering/tsconfig.json"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 128 - "StubConnection"
Cohesion: 0.40
Nodes (4): Context7, Current Session, Graphify, MCP Setup

### Community 129 - ".receive"
Cohesion: 0.29
Nodes (6): ADR 0013: Read-Only Administrator Event Catalog, Compatibility And Rollback, Consequences, Context, Decision, Status

### Community 130 - "orders.test.ts"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 131 - "RequestTelegramTicketRedeliveryCommand"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 132 - "application/src/index.ts"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 133 - "health-persistence.ts"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 134 - "health-persistence.test.ts"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 135 - "admin-authorization-persistence.ts"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 136 - "messenger.ts"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 137 - "ADR 0010: T-Bank Payment Reconciliation"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 138 - "20260725120000_tbank_payment_reconciliation.sql"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 139 - "StubConnection"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 140 - "ticket-rendering/tsconfig.json"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 141 - "Telegram Ticket Platform"
Cohesion: 0.33
Nodes (5): Безопасность, Локальные команды, Платформа продажи билетов в Telegram, Текущий этап, Что еще не реализовано

### Community 142 - "check-ci-config.mjs"
Cohesion: 0.40
Nodes (4): dependabotPath, violations, workflowDirectory, workflowFiles

### Community 144 - "20260724220000_tbank_payment_attempts_webhooks.sql"
Cohesion: 0.60
Nodes (4): payment_provider_events_append_only, public.payment_attempts, public.payment_provider_events, public.prevent_payment_provider_event_mutation()

### Community 145 - "20260725120000_tbank_payment_reconciliation.sql"
Cohesion: 0.60
Nodes (4): payment_reconciliation_events_append_only, public.payment_attempts, public.payment_reconciliation_events, public.prevent_payment_reconciliation_event_mutation()

### Community 146 - "20260724190000_notification_delivery_ledger.sql"
Cohesion: 0.67
Nodes (3): notification_deliveries_protect_record, public.notification_deliveries, public.protect_notification_delivery_record()

### Community 147 - "scenario-engine/src/index.ts"
Cohesion: 0.10
Nodes (35): automaticTransition(), blocked(), compareIssues(), executeScenarioGraph(), findActionsBeforeOrder(), findPaymentsBeforeOffer(), findUnboundedCycleNodes(), findUnreachable() (+27 more)

### Community 154 - ".execute"
Cohesion: 0.14
Nodes (3): FakeConnection, FakePool, RecordedQuery

### Community 155 - "event-general-form.tsx"
Cohesion: 0.13
Nodes (3): FakeConnection, FakePool, RecordedQuery

### Community 156 - "admin-event-catalog-management-persistence.test.ts"
Cohesion: 0.14
Nodes (9): AdminPurchaseContext, ScenarioPaymentContinuation, adminContext, adminJob, paymentConfirmedJob, redeliveryJob, scenarioPresentationJob, ticketContext (+1 more)

### Community 157 - "admin-operations.test.ts"
Cohesion: 0.29
Nodes (6): ADR 0015: Draft Product And Simple Pricing Management, Compatibility And Rollback, Consequences, Context, Decision, Status

### Community 158 - "notification-delivery-persistence.test.ts"
Cohesion: 0.14
Nodes (7): ScenarioDeliveryContext, TicketDeliveryContext, PostgresNotificationContextRepository, adminContextRow, RecordedQuery, ticketOrderContextRow, ticketRows

### Community 159 - "telegram-start-persistence.test.ts"
Cohesion: 0.19
Nodes (7): EventOfferEditor(), nullableValue(), OfferVersionRow(), requiredValue(), sourceTypeLabel(), stringValue(), AdminEventOfferVersion

### Community 160 - "ticket-access-persistence.test.ts"
Cohesion: 0.08
Nodes (21): isUuid(), ListTelegramTicketsService, RedeliverableTicket, RequestTelegramTicketRedeliveryService, TelegramTicketAccessRepository, directUnitOfWork, MemoryTicketRepository, ticketRedeliveryRequestedEvent() (+13 more)

### Community 161 - "ADR 0014: Audited Administrator Event Draft Management"
Cohesion: 0.29
Nodes (6): ADR 0014: Audited Administrator Event Draft Management, Compatibility And Rollback, Consequences, Context, Decision, Status

### Community 162 - "DomainEvent"
Cohesion: 0.08
Nodes (23): BeginIdempotentOperationInput, IdempotencyRepository, IdentityRepository, MessengerIdentityRecord, RecordTouchpointInput, UpsertTelegramIdentityInput, UpsertTelegramIdentityResult, UserRecord (+15 more)

### Community 163 - ".deliverTickets"
Cohesion: 0.29
Nodes (6): ADR 0017: Administrator Immutable Offer Management, Compatibility And Rollback, Consequences, Context, Decision, Status

### Community 164 - "Administrator Event Draft Management Runbook"
Cohesion: 0.33
Nodes (5): Administrator Event Draft Management Runbook, Browser Boundary, Failure And Recovery, Required Controls, Scope

### Community 165 - "admin-event-content-management-persistence.test.ts"
Cohesion: 0.33
Nodes (5): Administrator Event Offer Management Runbook, Failure And Recovery, Publication Controls, Scope, Storage Provisioning

### Community 166 - ".execute"
Cohesion: 0.06
Nodes (30): AdminEventOfferManagementRepository, FakePool, PostgresAdminEventOfferManagementRepository, FakePool, appendScenarioAudit(), bumpEventVersion(), EdgeRow, EventGate (+22 more)

### Community 167 - "worker/src/main.ts"
Cohesion: 0.31
Nodes (12): events_validate_scenario_assignment, public.events, public.protect_published_scenario_graph(), public.protect_scenario_version_identity_and_publication(), public.scenario_edges, public.scenario_nodes, public.scenario_versions, public.scenarios (+4 more)

### Community 170 - "event-content-editor.tsx"
Cohesion: 0.23
Nodes (10): CONTENT_BLOCK_LABELS, EventContentEditor(), integerValue(), parseContent(), readContentBlock(), requiredValue(), stringValue(), AdminEventContentBlockRecord (+2 more)

### Community 171 - "admin-events-api.test.ts"
Cohesion: 0.17
Nodes (7): contentBlockPayload, eventPayload, offerPayload, pricingPayload, productPayload, readiness, scenarioPayload

### Community 173 - "TBankWebhookStatus"
Cohesion: 0.29
Nodes (6): ADR 0018: Версионируемые сценарии мероприятия, Контекст, Последствия, Решение, Совместимость и откат, Статус

### Community 174 - "AdminEventAuditContext"
Cohesion: 0.33
Nodes (5): Миграция, Область, Ошибки, Порядок публикации, Управление сценариями мероприятия

### Community 175 - "grammy.ts"
Cohesion: 0.10
Nodes (7): RequestTelegramTicketRedeliveryCommand, RequestTelegramTicketRedeliveryResult, TelegramTicketRedeliveryUseCase, callbackFixture(), myTicketsFixture(), ticketRedeliveryFixture(), Logger

### Community 176 - "PostgresIdempotencyRepository"
Cohesion: 0.39
Nodes (7): public.prevent_scenario_event_mutation(), public.protect_scenario_session_identity(), public.scenario_events, public.scenario_sessions, scenario_events_prevent_delete, scenario_events_prevent_update, scenario_sessions_protect_identity

### Community 177 - "ADR 0016: Draft Event Content Management"
Cohesion: 0.29
Nodes (6): ADR 0016: Draft Event Content Management, Compatibility And Rollback, Consequences, Context, Decision, Status

### Community 178 - "admin-event-scenario-management-persistence.test.ts"
Cohesion: 0.30
Nodes (12): forwardAdminRequest(), GET(), PATCH(), POST(), problem(), readMutationBody(), RouteContext, AdminBffMethod (+4 more)

### Community 179 - ".execute"
Cohesion: 0.29
Nodes (6): ADR 0019: Закрепленные пользовательские сессии сценария, Контекст, Последствия, Решение, Совместимость и откат, Статус

### Community 180 - "telegram.ts"
Cohesion: 0.13
Nodes (5): expiredOrderRow, FakeConnection, FakePool, RecordedQuery, walletHoldRow

### Community 181 - "Пользовательский runtime сценария"
Cohesion: 0.29
Nodes (6): Диагностика, Нормальное поведение, Область, Откат приложения, Перед включением, Пользовательский runtime сценария

### Community 182 - "MemoryLedger"
Cohesion: 0.29
Nodes (6): ADR 0021: Создание заказа из закрепленного сценария, Контекст, Откат, Последствия, Решение, Статус

### Community 183 - "StubConnection"
Cohesion: 0.29
Nodes (6): ADR 0020: Валидированный ввод в сценарии, Контекст, Последствия, Решение, Совместимость и откат, Статус

### Community 184 - "PostgresNotificationDeliveryLedger"
Cohesion: 0.18
Nodes (9): ClaimNotificationDeliveryInput, ClaimNotificationDeliveryResult, AdminPurchaseContextRow, DeliveryStateRow, PostgresNotificationDeliveryLedger, query(), ScenarioDeliveryContextRow, TicketOrderContextRow (+1 more)

### Community 185 - "tbank-refunds.test.ts"
Cohesion: 0.15
Nodes (7): audit, contentBlock, contentBlockRow, eventGateRow, FakePool, occurredAt, RecordedQuery

### Community 186 - "offer-acceptance-persistence.test.ts"
Cohesion: 0.11
Nodes (10): AdminEventPricingRuleRecord, audit, eventGateRow, FakeConnection, FakePool, occurredAt, pricingRule, product (+2 more)

### Community 187 - "TBankWebhookStatus"
Cohesion: 0.14
Nodes (4): acceptanceRow, FakeConnection, FakePool, RecordedQuery

### Community 188 - "NodePostgresConnection"
Cohesion: 0.28
Nodes (8): ProtectedLayout(), LoginPage(), metadata, AdminShell(), NAVIGATION, getPublicSupabaseConfiguration(), PublicSupabaseConfiguration, createServerSupabaseClient()

### Community 189 - "LibPhoneNumberNormalizer"
Cohesion: 0.29
Nodes (6): ADR 0023: Атомарная публикация подготовленного мероприятия, Контекст, Откат, Последствия, Решение, Статус

### Community 190 - "scenario-runtime.test.ts"
Cohesion: 0.47
Nodes (4): EventPublicationPanel(), eventPublicationRequirements(), isPositiveKopeckAmount(), PublicationRequirement

### Community 192 - "scenario-runtime.test.ts"
Cohesion: 0.17
Nodes (9): ResolvedScenarioExecution, SaveScenarioExecutionInput, ScenarioOrderCreator, graph, inputGraph, now, orderGraph, storedOrder (+1 more)

### Community 193 - "ADR 0022: Продолжение сценария после подтвержденной оплаты"
Cohesion: 0.29
Nodes (6): ADR 0022: Продолжение сценария после подтвержденной оплаты, Контекст, Откат, Последствия, Решение, Статус

### Community 194 - "scenario-engine/src/index.test.ts"
Cohesion: 0.22
Nodes (5): NodeRow, ScenarioEdge, ScenarioNode, ScenarioNodeType, ids

### Community 195 - "TBankWebhookStatus"
Cohesion: 0.25
Nodes (4): TBankWebhookStatus, FullTBankRefundProviderResult, TBankRefundEvidence, TBankRefundRepository

### Community 196 - "ADR 0024: Обязательный TOTP MFA для веб-админки"
Cohesion: 0.29
Nodes (6): ADR 0024: Обязательный TOTP MFA для веб-админки, Контекст, Откат, Последствия, Решение, Статус

### Community 197 - ".next/**"
Cohesion: 0.33
Nodes (3): nextConfig, metadata, .next/**

### Community 198 - "tbank-refunds.test.ts"
Cohesion: 0.33
Nodes (4): at, claim, command, refund

### Community 199 - "admin-web/proxy.ts"
Cohesion: 0.60
Nodes (3): config, proxy(), refreshSupabaseSession()

### Community 200 - "MFA администраторов"
Cohesion: 0.40
Nodes (4): MFA администраторов, Обычный вход, Сбои, Требования

## Knowledge Gaps
- **975 isolated node(s):** `nextConfig`, `name`, `version`, `private`, `type` (+970 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `SqlConnection` connect `.execute` to `compilerOptions`, `messenger-telegram/package.json`, `tasks`, `.execute`, `event-general-form.tsx`, `notification-delivery-persistence.test.ts`, `messenger.ts`, `ticket-access-persistence.test.ts`, `ADR 0003: Wallet Ledger`, `admin-web/tsconfig.json`, `order-expiry-persistence.test.ts`, `telegram.ts`, `NodePostgresConnection`, `tbank-refunds.test.ts`, `offer-acceptance-persistence.test.ts`, `TBankWebhookStatus`, `noop.mjs`, `StubConnection`, `app.ts`, `StubConnection`, `outbox-persistence.ts`, `telegram-start-persistence.test.ts`, `ADR 0005: Administrator Authentication and RBAC`, `PostgresOutboxWriter`, `controller.test.ts`, `TransactionSession`, `admin-event-content-management-persistence.ts`, `orders.test.ts`?**
  _High betweenness centrality (0.056) - this node is a cross-community bridge._
- **Why does `IdGenerator` connect `api/tsconfig.json` to `worker/package.json`, `config/package.json`, `node-postgres.ts`, `.execute`, `event-general-form.tsx`, `messenger.ts`, `ticket-access-persistence.test.ts`, `Implementation Plan`, `DomainEvent`, `telegram-start-persistence.test.ts`, `MessengerAdapter`, `worker/tsconfig.json`, `config/tsconfig.json`, `node-postgres.test.ts`, `database/tsconfig.json`, `observability/tsconfig.json`, `telegram.ts`, `Telegram Ticket Platform`, `TBankWebhookStatus`, `20260721162000_foundation_idempotency_keys.sql`, `seed.sql`, `outbox-persistence.test.ts`, `20260722230000_pgboss_v37_outbox_queues.sql`, `app.ts`, `api/src/main.ts`, `grammy.ts`, `telegram-start-persistence.test.ts`, `LibPhoneNumberNormalizer`, `.deliverTickets`, `orders.test.ts`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **Why does `SqlQueryResult` connect `compilerOptions` to `worker/package.json`, `.execute`, `event-general-form.tsx`, `notification-delivery-persistence.test.ts`, `messenger.ts`, `ticket-access-persistence.test.ts`, `DomainEvent`, `ADR 0003: Wallet Ledger`, `.execute`, `telegram.ts`, `NodePostgresConnection`, `tbank-refunds.test.ts`, `offer-acceptance-persistence.test.ts`, `TBankWebhookStatus`, `noop.mjs`, `PostgresNotificationDeliveryLedger`, `StubConnection`, `app.ts`, `StubConnection`, `outbox-persistence.ts`, `telegram-start-persistence.test.ts`, `ADR 0005: Administrator Authentication and RBAC`, `PostgresOutboxWriter`, `controller.test.ts`, `TransactionSession`, `orders.test.ts`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **What connects `nextConfig`, `name`, `version` to the rest of the system?**
  _975 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `api/src/main.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08708708708708708 - nodes in this community are weakly interconnected._
- **Should `grammy.test.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.041666666666666664 - nodes in this community are weakly interconnected._