# Graph Report - Project  (2026-07-29)

## Corpus Check
- 387 files · ~209,770 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 4746 nodes · 10227 edges · 263 communities (248 shown, 15 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 110 edges (avg confidence: 0.65)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `c36e9da5`
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
- contracts/src/admin-operations.ts
- admin-authorization-persistence.ts
- grammy.ts
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
- admin-events-api.test.ts
- phone-persistence.test.ts
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
- app/page.tsx
- noop.mjs
- 20260721162000_foundation_idempotency_keys.sql
- eslint.config.mjs
- seed.sql
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
- ticket-access-persistence.test.ts
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
- controller.test.ts
- ADR 0024: Обязательный TOTP MFA для веб-админки
- .next/**
- tbank-refunds.test.ts
- admin-web/proxy.ts
- MFA администраторов
- payment-tbank/tsconfig.json
- admin-event-scenario-management-persistence.test.ts
- LibPhoneNumberNormalizer
- Локальные демонстрационные данные
- ADR 0025: Защищенный запуск прикладных миграций
- ADR 0026: Защищенное демонстрационное наполнение local/test
- Прикладные миграции PostgreSQL
- Предварительный просмотр сегмента
- .deliverOnce
- 20260724190000_notification_delivery_ledger.sql
- 20260726200000_application_migration_checksums.sql
- PostgresOrderSalesRepository
- next-env.d.ts
- noop.mjs
- 20260721162000_foundation_idempotency_keys.sql
- 20260728120000_internal_zero_due_payments.sql
- 20260728160000_scenario_wallet_credit.sql
- admin-segments-persistence.ts
- health-persistence.ts
- order-expiry-persistence.test.ts
- event-general-form.tsx
- offer-acceptance-persistence.test.ts
- ADR 0030: Предварительный просмотр сегмента классификации
- HmacTicketReferenceGenerator
- .list
- PostgresNotificationContextRepository
- .list
- ADR 0032: Неизменяемые снимки аудитории сегмента
- event-publication-panel.tsx
- .constructor
- Снимки аудитории сегмента
- .constructor
- PostgresPhoneBonusRepository
- Черновики и версии рассылок
- admin-segments-api.test.ts
- .receive
- ADR 0033: Версии рассылки с зафиксированной аудиторией
- admin-broadcasts-api.test.ts
- AdminBroadcastSummary
- PricingRule
- ticket-access-persistence.test.ts
- admin-saved-segments-persistence.test.ts
- createTelegramBot
- .execute
- controller.test.ts
- 20260730120000_broadcast_scheduling_delivery_ledger.sql
- event-publication-panel.tsx
- ListTelegramTicketsCommand
- .list
- ADR 0034: Планирование и подготовка журнала рассылки
- Планирование и подготовка рассылки
- user-classification-editor.tsx
- AdminBroadcast
- admin-event-scenario-management-persistence.test.ts
- order-sales-persistence.test.ts
- .constructor
- telegram-webhook.test.ts
- admin-broadcasts-api.test.ts
- admin-user-classification-api.test.ts
- ListAdminBroadcastsService

## God Nodes (most connected - your core abstractions)
1. `SqlConnection` - 210 edges
2. `SqlConnectionPool` - 117 edges
3. `IdGenerator` - 111 edges
4. `SqlQueryResult` - 103 edges
5. `AuthenticatedAdminRequest` - 69 edges
6. `AdminRequestActor` - 65 edges
7. `RequireAdminPermission()` - 57 edges
8. `TransactionSession` - 46 edges
9. `AdminEventAuditContext` - 43 edges
10. `UnitOfWork` - 38 edges

## Surprising Connections (you probably didn't know these)
- `EventsPage()` --indirect_call--> `status()`  [INFERRED]
  apps/admin-web/src/app/(admin)/events/page.tsx → packages/application/src/user-classification.test.ts
- `OrdersPage()` --indirect_call--> `status()`  [INFERRED]
  apps/admin-web/src/app/(admin)/orders/page.tsx → packages/application/src/user-classification.test.ts
- `EventGeneralFormProps` --references--> `AdminEventDetail`  [EXTRACTED]
  apps/admin-web/src/components/event-general-form.tsx → packages/contracts/src/admin-events.ts
- `OrdersPage()` --indirect_call--> `result()`  [INFERRED]
  apps/admin-web/src/app/(admin)/orders/page.tsx → packages/application/src/scenario-wallet-credit.ts
- `UsersPage()` --indirect_call--> `result()`  [INFERRED]
  apps/admin-web/src/app/(admin)/users/page.tsx → packages/application/src/scenario-wallet-credit.ts

## Import Cycles
- None detected.

## Communities (263 total, 15 thin omitted)

### Community 0 - "telegram-webhook.ts"
Cohesion: 0.05
Nodes (46): isTelegramUserId(), AcceptTelegramOfferCommand, AdvanceTelegramScenarioCommand, AdvanceTelegramScenarioResult, HandleTelegramContactCommand, HandleTelegramStartCommand, InitializeTelegramPaymentCommand, ListTelegramTicketsCommand (+38 more)

### Community 1 - "api/src/main.ts"
Cohesion: 0.03
Nodes (24): RecordingConnection, FakeConnection, FakeConnection, FakeConnection, FakeConnection, FakeConnection, FakeConnection, StubConnection (+16 more)

### Community 2 - "grammy.test.ts"
Cohesion: 0.14
Nodes (11): AdminAuthenticationError, AdminMfaRequiredError, AdminPermissionDeniedError, AdminPrincipal, AdminPrincipalRepository, AuthorizeAdminRequestService, MFA_REQUIRED_PERMISSIONS, sessionWasRevoked() (+3 more)

### Community 3 - "dependencies"
Cohesion: 0.20
Nodes (16): AdminUserClassificationAssignmentsController, AdminUserClassificationController, invalidMutation(), mapMutationError(), mutationMetadata(), requireActor(), Body, Controller (+8 more)

### Community 4 - "compilerOptions"
Cohesion: 0.09
Nodes (36): main(), migrationDirectory, parseMode(), projectRoot, AppliedMigration, applyMigrationsToDatabase(), applyOneMigration(), assertUniqueVersions() (+28 more)

### Community 5 - "telegram-start-persistence.ts"
Cohesion: 0.05
Nodes (51): CompleteInternalOrderCommand, classificationContext(), continueFromAction(), duplicatePaymentResult(), formatKopecks(), isKopeckString(), LockTelegramScenarioActionResult, LockTelegramScenarioInputResult (+43 more)

### Community 6 - "scripts"
Cohesion: 0.15
Nodes (17): bounded(), buildAudit(), GetAdminSavedSegmentService, optional(), parseDefinition(), PublishAdminSavedSegmentService, requireLockVersion(), requirePermission() (+9 more)

### Community 7 - "dependencies"
Cohesion: 0.08
Nodes (19): ExternalPaymentInitializer, HandleTBankPaymentWebhookService, initializedResult(), InitializeTelegramTBankPaymentService, isRefundStatus(), mapStatus(), PreparedTBankPaymentAttempt, RecordTBankStatusEvent (+11 more)

### Community 8 - "database/package.json"
Cohesion: 0.07
Nodes (21): ActiveUserCategoryAssignment, ActiveUserStatusAssignment, appendClassificationAudit(), classificationEvent(), RemoveUserCategoryService, RemoveUserStatusService, requireCode(), SetUserStatusService (+13 more)

### Community 9 - "messenger-telegram/package.json"
Cohesion: 0.04
Nodes (27): FakePool, FakePool, QueuePool, FakePool, FakePool, FakePool, FakePool, FakePool (+19 more)

### Community 10 - "tasks"
Cohesion: 0.13
Nodes (9): UpsertTelegramIdentityInput, UpsertTelegramIdentityResult, expectAffectedRow(), IdentityRow, mapIdentity(), PostgresIdempotencyRepository, PostgresIdentityRepository, ReturningKeyRow (+1 more)

### Community 11 - "identity.ts"
Cohesion: 0.07
Nodes (44): NodeRow, automaticTransition(), blocked(), compareIssues(), executeScenarioGraph(), findActionsBeforeOrder(), findInvalidOrderComposition(), findPaymentsBeforeOffer() (+36 more)

### Community 12 - "phone.ts"
Cohesion: 0.04
Nodes (47): dependencies, fastify, jose, @nestjs/common, @nestjs/core, @nestjs/platform-fastify, reflect-metadata, rxjs (+39 more)

### Community 13 - "worker/package.json"
Cohesion: 0.05
Nodes (34): ADMIN_EVENTS, AdminEventsHandlers, catalogMutationSchema, CatalogPricingHandler, CatalogProductHandler, contentBlockMutationSchema, contentBlockSchema, createEventSchema (+26 more)

### Community 14 - "messenger-core/package.json"
Cohesion: 0.09
Nodes (38): payment(), asRecord(), booleanField(), boundedSecret(), canonicalScalarPairs(), createTBankToken(), digitsField(), hashScalarPayload() (+30 more)

### Community 15 - "application/package.json"
Cohesion: 0.09
Nodes (23): AdminPageCursor, decodeCursor(), encodeCursor(), GetAdminOrderService, GetAdminUserService, ListAdminOrdersService, ListAdminUsersService, page() (+15 more)

### Community 16 - "admin-web/package.json"
Cohesion: 0.09
Nodes (42): DraftGroup, message(), SegmentPreviewBuilder(), buildAdminApiPath(), createAdminBroadcast(), createAdminSavedSegment(), createEvent(), createEventContentBlock() (+34 more)

### Community 17 - ".query"
Cohesion: 0.15
Nodes (15): createEdge(), defaultPayload(), editableGraph(), EditableNode, EventScenarioEditor(), NODE_TYPE_LABELS, NodeSelect(), nodeTypeLabel() (+7 more)

### Community 18 - "config/package.json"
Cohesion: 0.05
Nodes (40): eslint, @eslint/js, js-yaml, devDependencies, eslint, @eslint/js, js-yaml, tsx (+32 more)

### Community 19 - "contracts/package.json"
Cohesion: 0.05
Nodes (39): packages/application/src/index.ts, packages/config/src/index.ts, packages/contracts/src/index.ts, packages/database/src/index.ts, packages/domain/src/index.ts, packages/messenger-core/src/index.ts, packages/messenger-telegram/src/index.ts, packages/observability/src/index.ts (+31 more)

### Community 20 - "domain/package.json"
Cohesion: 0.13
Nodes (35): contentPreview(), EventDetailPage(), shortId(), EventsPage(), OrderDetailPage(), OrdersPage(), UserDetailPage(), UsersPage() (+27 more)

### Community 21 - "observability/package.json"
Cohesion: 0.13
Nodes (37): AdminAuthConfig, ApiConfig, AppConfig, AppEnvironment, loadApiConfig(), loadAppConfig(), loadOfferStorageConfig(), loadTBankPaymentsConfig() (+29 more)

### Community 22 - "payment-tbank/package.json"
Cohesion: 0.05
Nodes (40): compilerOptions, allowJs, baseUrl, esModuleInterop, exactOptionalPropertyTypes, incremental, isolatedModules, jsx (+32 more)

### Community 23 - "scenario-engine/package.json"
Cohesion: 0.08
Nodes (23): AdminEventPricingRuleNotFoundError, AdminEventProductCodeConflictError, CatalogFailure, CreateAdminEventPricingRuleService, CreateAdminEventProductService, integerBetween(), mutationResult(), nullableDate() (+15 more)

### Community 24 - "20260722100000_contacts_wallet_ledger.sql"
Cohesion: 0.11
Nodes (17): LockTelegramScenarioResult, OpenTelegramScenarioResult, ScenarioRuntimeSession, asObject(), EdgeRow, EventChoiceRow, EventRow, expectAffectedRow() (+9 more)

### Community 25 - "node-postgres.ts"
Cohesion: 0.19
Nodes (19): AdminEventCatalogManagementRepository, appendCatalogAudit(), bumpEventVersion(), EventGate, EventGateRow, lockDraftEvent(), PostgresAdminEventCatalogManagementRepository, pricingRuleCurrencyConflictExists() (+11 more)

### Community 26 - "wallet.ts"
Cohesion: 0.15
Nodes (14): bootstrapWorker(), assertPgBossQueuesProvisioned(), PgBossOutboxPublisher, PgBossPublisherClient, getQueue(), queue(), OutboxJobPublisher, DomainEventJobV1 (+6 more)

### Community 27 - "SqlQueryResult"
Cohesion: 0.10
Nodes (18): BroadcastDeliveryCompletion, ClaimedBroadcastDelivery, appendLifecycleEvent(), asDate(), BroadcastClaimRow, CampaignProgressRow, completeIfFinished(), DeliveryClaimRow (+10 more)

### Community 28 - "SqlConnection"
Cohesion: 0.08
Nodes (23): DeactivateOfferHandler, OfferVersionHandler, AdminEventOfferManagementRepository, AdminEventOfferNotActiveError, AdminOfferSnapshotStorageUnavailableError, bounded(), DeactivateAdminEventOfferService, escapeHtml() (+15 more)

### Community 29 - "api/tsconfig.json"
Cohesion: 0.14
Nodes (22): validateCommand(), validateCommand(), AdminEventMutationMetadata, requireAdminEventsWrite(), requireAdminEventUuid(), validateMutation(), AdminEventScenarioManagementRepository, AdminScenarioValidationFailedError (+14 more)

### Community 30 - "phone-persistence.test.ts"
Cohesion: 0.11
Nodes (21): AdminEventGeneralRecord, AdminEventManagementRepository, AdminEventPublicationIssue, appendAudit(), EventGeneralRow, EventPublicationCatalogRow, eventSnapshot(), eventValues() (+13 more)

### Community 31 - "messenger.ts"
Cohesion: 0.18
Nodes (8): PendingBroadcastPreparation, asDate(), DueBroadcastRow, PostgresBroadcastPreparationRepository, PreparationCountsRow, preparedAt, scheduledAt, validCount()

### Community 32 - "20260721160000_foundation_identity_audit_outbox.sql"
Cohesion: 0.06
Nodes (31): dependencies, lucide-react, next, react, react-dom, @supabase/ssr, @supabase/supabase-js, @ticket-platform/contracts (+23 more)

### Community 33 - "Implementation Plan"
Cohesion: 0.06
Nodes (31): dependencies, pg-boss, @ticket-platform/application, @ticket-platform/config, @ticket-platform/contracts, @ticket-platform/database, @ticket-platform/messenger-telegram, @ticket-platform/observability (+23 more)

### Community 34 - ".creditPhoneBonus"
Cohesion: 0.06
Nodes (30): ConfirmablePaymentOrder, ConfirmedPaymentRecord, hashConfirmationRequest(), InternalPaymentEvidence, IssuedTicket, issueTicketReferences(), ManualPaymentEvidence, PaymentConfirmationActor (+22 more)

### Community 35 - "telegram-start-persistence.test.ts"
Cohesion: 0.07
Nodes (42): bootstrapApi(), getExpectedMigrationVersion(), bootstrapTelegramBot(), HandleTelegramStartService, AdvanceTelegramScenarioService, SelectTelegramEventService, StartTelegramScenarioService, SubmitTelegramScenarioInputService (+34 more)

### Community 36 - "MessengerAdapter"
Cohesion: 0.14
Nodes (11): CreditPhoneBonusInput, CreditPhoneBonusResult, HandleTelegramContactService, phoneBonusCreditedEvent(), PhoneBonusRepository, PhoneNormalizer, PhoneVerificationRepository, phoneVerifiedEvent() (+3 more)

### Community 37 - "ADR 0003: Wallet Ledger"
Cohesion: 0.10
Nodes (17): BroadcastDeliveryExecutionPolicy, BroadcastDeliveryFailureCategory, BroadcastDeliveryRepository, BroadcastDeliverySendError, BroadcastMessageSender, integerBetween(), InvalidBroadcastDeliveryExecutionError, normalizeFailure() (+9 more)

### Community 38 - "check-migrations.mjs"
Cohesion: 0.12
Nodes (20): AdminEventNotDraftError, AdminEventPublicationRequirementsError, AdminEventSlugConflictError, AdminEventVersionConflictError, buildAdminEventAuditContext(), CreateAdminEventDraftService, normalizeOptional(), normalizeRequired() (+12 more)

### Community 39 - "admin-web/tsconfig.json"
Cohesion: 0.18
Nodes (13): AdminEventOfferVersionRecord, ActiveOfferRow, activeOfferSnapshot(), appendOfferAudit(), EventGate, EventGateRow, listOfferDocuments(), lockDraftEvent() (+5 more)

### Community 40 - "telegram-bot/tsconfig.json"
Cohesion: 0.15
Nodes (5): PersistScenarioWalletCreditInput, ExistingCreditRow, PostgresScenarioWalletCreditRepository, RecordedQuery, WalletAccountRow

### Community 41 - "worker/tsconfig.json"
Cohesion: 0.16
Nodes (17): AdminSavedSegmentRepository, AdminSegmentVersion, appendAudit(), findUnavailableClassificationCodes(), lockSegment(), mapSummary(), mapVersion(), nextVersionNumber() (+9 more)

### Community 42 - "MCP Setup"
Cohesion: 0.07
Nodes (28): dependencies, pg, @ticket-platform/application, @ticket-platform/domain, @ticket-platform/scenario-engine, devDependencies, @types/pg, @ticket-platform/application (+20 more)

### Community 43 - "application/tsconfig.json"
Cohesion: 0.10
Nodes (10): readiness(), testApplication(), readiness, savedSegment, snapshotSummary, createApiApplication(), applicationWithStatus(), testApplication() (+2 more)

### Community 44 - "config/tsconfig.json"
Cohesion: 0.10
Nodes (18): CONFIRM_MANUAL_PAYMENT, ConfirmManualPaymentHandler, manualPaymentBodySchema, ManualPaymentsApiModule, ManualPaymentsController, noopHandler, result, validBody (+10 more)

### Community 45 - "contracts/tsconfig.json"
Cohesion: 0.07
Nodes (27): dependencies, @ticket-platform/application, @ticket-platform/config, @ticket-platform/database, @ticket-platform/messenger-core, @ticket-platform/messenger-telegram, @ticket-platform/observability, @ticket-platform/payment-tbank (+19 more)

### Community 46 - "node-postgres.test.ts"
Cohesion: 0.08
Nodes (24): ContentBlockHandler, AdminEventContentBlockNotFoundError, AdminEventContentBlockRecord, AdminEventContentManagementRepository, AdminEventContentSortOrderConflictError, assertJsonValue(), ContentBlockCommand, ContentFailure (+16 more)

### Community 47 - "database/tsconfig.json"
Cohesion: 0.10
Nodes (20): fullRefundBodySchema, FullRefundsApiModule, FullRefundsController, REQUEST_FULL_REFUND, RequestFullRefundHandler, actor, healthyReadiness, result (+12 more)

### Community 48 - "domain/tsconfig.json"
Cohesion: 0.16
Nodes (8): aggregateStatus(), GetReadinessService, HealthClock, HealthProbe, HealthProbeResult, statusPriority, systemClock, HealthStatus

### Community 49 - "messenger-core/tsconfig.json"
Cohesion: 0.08
Nodes (22): ExpirableOrder, ExpirableOrderStatus, ExpireOrderInput, ExpireOrderResult, ExpireOrdersBatchInput, ExpireOrdersBatchResult, ExpireOrdersBatchService, orderExpiredEvent() (+14 more)

### Community 50 - "messenger-telegram/tsconfig.json"
Cohesion: 0.10
Nodes (17): CREATE_ORDER, createOrderBodySchema, OrdersApiModule, OrdersController, noopHandler, orderResult, Body, Controller (+9 more)

### Community 51 - "observability/tsconfig.json"
Cohesion: 0.09
Nodes (19): secretsEqual(), telegramChatSchema, telegramMessageSchema, telegramUpdateSchema, telegramUserSchema, TelegramWebhookController, TelegramWebhookModule, TelegramWebhookService (+11 more)

### Community 52 - "payment-tbank/src/index.ts"
Cohesion: 0.10
Nodes (11): bounded(), BuildSegmentAudienceSnapshotsBatchResult, BuildSegmentAudienceSnapshotsBatchService, RequestAdminSegmentAudienceSnapshotService, SegmentAudienceSnapshotRepository, snapshotReadyEvent(), actor, expression (+3 more)

### Community 53 - "payment-tbank/tsconfig.json"
Cohesion: 0.08
Nodes (17): ADMIN_SEGMENTS, codeSchema, conditionSchema, definitionSchema, expressionSchema, invalidPreview(), previewSchema, publishSchema (+9 more)

### Community 54 - "scenario-engine/tsconfig.json"
Cohesion: 0.16
Nodes (13): acceptedResult(), AcceptTelegramOfferService, hashPublicToken(), isAcceptedOrderStatus(), OfferAcceptanceOrder, OfferAcceptanceRepository, offerAcceptedEvent(), acceptedAt (+5 more)

### Community 55 - "Telegram Ticket Platform"
Cohesion: 0.12
Nodes (9): BeginIdempotentOperationInput, isUuid(), RedeliverableTicket, RequestTelegramTicketRedeliveryService, TelegramTicketAccessRepository, directUnitOfWork, MemoryIdempotencyRepository, MemoryTicketRepository (+1 more)

### Community 56 - "NodePostgresConnection"
Cohesion: 0.11
Nodes (8): CompleteInternalOrderService, HmacTicketReferenceGenerator, confirmedAt, orderItemRow, orderRow, RecordedQuery, walletAllocationRow, walletHoldRow

### Community 57 - ".transact"
Cohesion: 0.09
Nodes (23): TBankWebhookStatus, TBankOrderLookupProvider, finalizeRefund(), FullTBankRefundProvider, FullTBankRefundProviderResult, HandleTBankRefundWebhookService, hashRequest(), providerResultMatches() (+15 more)

### Community 58 - "scenario-engine/src/index.ts"
Cohesion: 0.14
Nodes (13): classifyTelegramBroadcastError(), GrammyTextNotificationSender, TelegramBroadcastSendError, TelegramNotificationApi, validateButtonText(), validateMessageId(), validateRecipient(), callbackPattern (+5 more)

### Community 59 - "noop.mjs"
Cohesion: 0.06
Nodes (23): ADMIN_USER_CLASSIFICATION, AdminAssignmentHandler, AdminRemovalHandler, AdminUserClassificationApiModule, assignSchema, codeSchema, colorSchema, createCategorySchema (+15 more)

### Community 60 - "20260721162000_foundation_idempotency_keys.sql"
Cohesion: 0.14
Nodes (24): AdminEventPricingRule, AdminEventProduct, AdminEventScenarioVersion, AdminScenarioNodeType, AdminScenarioValidationIssue, ContentBlockRow, escapeLike(), mapEventSummary() (+16 more)

### Community 61 - "seed.sql"
Cohesion: 0.16
Nodes (10): appendAudit(), CategoryRow, lockCatalogKey(), mapCategory(), mapStatus(), PostgresAdminUserClassificationRepository, StatusRow, audit (+2 more)

### Community 62 - "outbox-persistence.test.ts"
Cohesion: 0.14
Nodes (23): AdminBroadcastLifecycleStatus, AdminBroadcastSchedule, AdminBroadcastVersion, AdminBroadcastVersionStatus, appendAudit(), appendPublicationEvent(), appendScheduleEvent(), asIso() (+15 more)

### Community 63 - "generate-pgboss-migration.mjs"
Cohesion: 0.09
Nodes (21): Actor, ADMIN_BROADCASTS, AdminBroadcastHandlers, contentSchema, definitionSchema, publishSchema, readRequestId(), scheduleSchema (+13 more)

### Community 64 - "ADR 0004: pg-boss Schema Management"
Cohesion: 0.13
Nodes (15): AdminSegmentClassificationUnavailableError, AdminSegmentPreviewRepository, collectAdminSegmentClassificationCodes(), InvalidAdminSegmentPreviewError, parseCondition(), parseGroup(), parseSampleLimit(), PreviewAdminSegmentService (+7 more)

### Community 65 - "20260722230000_pgboss_v37_outbox_queues.sql"
Cohesion: 0.16
Nodes (15): assertMatchingRequest(), CreateOrderService, eventSnapshot(), hashCreationRequest(), orderCreatedEvent(), OrderPricingSnapshot, OrderSalesEvent, OrderSalesRepository (+7 more)

### Community 66 - "messenger.ts"
Cohesion: 0.13
Nodes (13): ConfirmPaymentService, isTerminal(), ReconcileTBankPaymentsBatchInput, ReconcileTBankPaymentsBatchResult, ReconcileTBankPaymentsBatchService, requiresReview(), retryAt(), TBankOrderLookupResult (+5 more)

### Community 67 - "health-persistence.test.ts"
Cohesion: 0.11
Nodes (49): AuthenticatedAdminRequest, RequireAdminPermission(), AdminBroadcastsController, execute(), invalidBroadcast(), mapError(), mutationMetadata(), requireActor() (+41 more)

### Community 68 - "application/src/index.ts"
Cohesion: 0.09
Nodes (21): grammy, dependencies, grammy, @ticket-platform/contracts, @ticket-platform/messenger-core, @ticket-platform/observability, @ticket-platform/contracts, @ticket-platform/messenger-core (+13 more)

### Community 69 - "app.ts"
Cohesion: 0.16
Nodes (13): IdentityRepository, MessengerIdentityRecord, RecordTouchpointInput, UserRecord, userRegisteredEvent(), HandleTelegramStartResult, emptyPayload(), mergePayloadPart() (+5 more)

### Community 70 - "outbox.ts"
Cohesion: 0.17
Nodes (13): PreparedFullTBankRefund, PrepareFullTBankRefundResult, TBankRefundReconciliationClaim, TBankRefundReconciliationRepository, assertRefundBinding(), LockedRefundRow, mapRefund(), PostgresTBankRefundRepository (+5 more)

### Community 71 - "api/src/main.ts"
Cohesion: 0.12
Nodes (12): execution(), advanceResult(), duplicateAdvanceResult(), duplicateInputResult(), duplicateOfferResult(), duplicateStartResult(), executeTelegramScenarioOpening(), scenarioCommandKey() (+4 more)

### Community 72 - "HealthController"
Cohesion: 0.14
Nodes (11): TBankWebhookController, TBankWebhookModule, TBankWebhookService, Body, Controller, HttpCode, Inject, Injectable (+3 more)

### Community 73 - "messenger-core/src/index.ts"
Cohesion: 0.10
Nodes (20): ^build, coverage/**, dist/**, ^lint, ^typecheck, dependsOn, outputs, cache (+12 more)

### Community 74 - "createApiApplication"
Cohesion: 0.12
Nodes (8): AdminSavedSegmentVersionConflictError, CreateAdminSavedSegmentService, draft, expression, metadata, publishedSegment, segment, writeActor

### Community 75 - ".newId"
Cohesion: 0.18
Nodes (17): AdminOperationsRepository, escapeLike(), mapOrderSummary(), mapUserSummary(), maskContact(), OrderDetailRow, OrderSummaryRow, PostgresAdminOperationsRepository (+9 more)

### Community 76 - "20260723223000_admin_rbac.sql"
Cohesion: 0.10
Nodes (19): dependencies, @ticket-platform/contracts, @ticket-platform/domain, @ticket-platform/scenario-engine, @ticket-platform/contracts, @ticket-platform/domain, @ticket-platform/scenario-engine, main (+11 more)

### Community 77 - "outbox-persistence.ts"
Cohesion: 0.21
Nodes (18): offer_acceptances_prevent_delete, offer_acceptances_prevent_update, offer_versions_protect_content, order_status_history_prevent_delete, order_status_history_prevent_update, public.event_content_blocks, public.events, public.inventory_reservations (+10 more)

### Community 78 - "grammy.ts"
Cohesion: 0.20
Nodes (15): CatalogEditor, EventCatalogEditor(), integerValue(), nullableIntegerValue(), nullableValue(), parseBundleComposition(), PricingRuleForm(), ProductForm() (+7 more)

### Community 79 - "telegram-start-persistence.test.ts"
Cohesion: 0.28
Nodes (9): TBankOrderLookupPayment, TBankReconciliationClaim, isTerminal(), leaseLost(), PostgresTBankReconciliationRepository, ReconciliationClaimRow, safeResultCode(), terminalAttemptStatus() (+1 more)

### Community 80 - "LibPhoneNumberNormalizer"
Cohesion: 0.11
Nodes (20): EventListFilters, AdminEventPageCursor, AdminEventsRepository, decodeCursor(), encodeCursor(), GetAdminEventService, ListAdminEventsService, parseLimit() (+12 more)

### Community 81 - ".deliverTickets"
Cohesion: 0.11
Nodes (18): dependencies, @ticket-platform/application, devDependencies, @types/qrcode, @ticket-platform/application, main, name, private (+10 more)

### Community 82 - "ADR 0005: Administrator Authentication and RBAC"
Cohesion: 0.11
Nodes (17): libphonenumber-js, dependencies, libphonenumber-js, @ticket-platform/application, @ticket-platform/application, main, name, private (+9 more)

### Community 83 - "StubConnection"
Cohesion: 0.12
Nodes (13): AdminBootstrapAlreadyCompletedError, BootstrapAdminRecord, BootstrapFirstAdminCommand, BootstrapFirstAdminService, FirstAdminBootstrapRepository, InvalidAdminBootstrapInputError, normalizeEmail(), normalizeOptional() (+5 more)

### Community 84 - "RecordingConnection"
Cohesion: 0.12
Nodes (18): appendContentAudit(), bumpEventVersion(), ContentBlockRow, contentBlockRowSnapshot(), contentBlockSnapshot(), contentBlockValues(), EventGate, EventGateRow (+10 more)

### Community 85 - "NodePostgresConnection"
Cohesion: 0.14
Nodes (20): ADMIN_OPERATIONS, AdminOperationsApiModule, AdminOrdersReadController, AdminUsersController, cursorSchema, execute(), idSchema, invalidAdminQuery() (+12 more)

### Community 86 - "check-ci-config.mjs"
Cohesion: 0.17
Nodes (13): calculatePrice(), comparePricingRules(), compareRuleRank(), dateRank(), matchesPricingInput(), PricingInput, PricingResult, PricingRuleConflictError (+5 more)

### Community 87 - "PostgresOutboxWriter"
Cohesion: 0.12
Nodes (6): IncomingMessage, MessengerAdapter, SendMessageCommand, SendResult, InvalidPhoneNumberError, LibPhoneNumberNormalizer

### Community 88 - "eslint.config.mjs"
Cohesion: 0.21
Nodes (11): LoginForm(), metadata, MfaPage(), Enrollment, MfaForm(), AdminAuthDestination, adminDestinationForAssurance(), isValidTotpCode() (+3 more)

### Community 89 - "order-sales-persistence.test.ts"
Cohesion: 0.15
Nodes (5): assertTicketSet(), HandleNotificationJobService, NotificationContextRepository, TicketPublicTokenGenerator, validateExecutionInput()

### Community 90 - "app.ts"
Cohesion: 0.17
Nodes (7): idGenerator, orderRow, pendingAttemptRow, RecordedQuery, requestedAt, webhookAttempt, webhookEvent

### Community 91 - "HmacOrderReferenceGenerator"
Cohesion: 0.10
Nodes (12): at, contentRow, eventRow, FakeConnection, FakePool, offerRow, pricingRow, productRow (+4 more)

### Community 92 - "telegram-start-persistence.test.ts"
Cohesion: 0.20
Nodes (14): bounded(), BroadcastFailure, buildAudit(), CreateAdminBroadcastService, parseContent(), parseDefinition(), parseScheduledAt(), parseTimezone() (+6 more)

### Community 93 - "order.ts"
Cohesion: 0.11
Nodes (16): PersistPaymentConfirmationInput, PrepareTBankPaymentResult, TBankWebhookPaymentAttempt, PostgresPaymentConfirmationRepository, PostgresUnitOfWork, AttemptOrderRow, createMerchantOrderId(), hasActiveReservations() (+8 more)

### Community 94 - ".register"
Cohesion: 0.26
Nodes (5): edge(), invalidGraph(), loadDraft(), node(), validGraph()

### Community 95 - "ADR 0007: Event Sales And Immutable Order Snapshots"
Cohesion: 0.21
Nodes (15): asRecord(), date(), formatAdminPurchaseMessage(), formatKopecks(), formatTicketMessage(), HandleNotificationJobInput, HandleNotificationJobResult, NotificationDeliveryKind (+7 more)

### Community 96 - "orders.test.ts"
Cohesion: 0.12
Nodes (6): at, claim, claimRow, FakeConnection, FakePool, RecordedQuery

### Community 97 - "controller.test.ts"
Cohesion: 0.30
Nodes (12): forwardAdminRequest(), GET(), PATCH(), POST(), problem(), readMutationBody(), RouteContext, AdminBffMethod (+4 more)

### Community 98 - "TransactionSession"
Cohesion: 0.09
Nodes (17): append(), ClaimedOutboxEvent, ClaimOutboxBatchOptions, DispatchOutboxBatchResult, DispatchOutboxBatchService, errorType(), OutboxDispatchRepository, event() (+9 more)

### Community 99 - "payment-confirmation.ts"
Cohesion: 0.11
Nodes (9): at, attemptRow, FakeConnection, FakePool, lockedRefundRow, orderRow, prepareInput, RecordedQuery (+1 more)

### Community 100 - "payment-confirmation.test.ts"
Cohesion: 0.16
Nodes (16): AdminUserClassificationHandlers, AdminUserClassificationRepository, buildAudit(), executeManualClassification(), requireLockVersion(), requirePermission(), requireUuid(), unwrapMutation() (+8 more)

### Community 101 - "outbox.ts"
Cohesion: 0.11
Nodes (9): AdminBroadcastVersionConflictError, PublishAdminBroadcastDraftService, actor, broadcast, draft, metadata, publishedBroadcast, scheduledBroadcast (+1 more)

### Community 102 - "contracts/src/admin-operations.ts"
Cohesion: 0.18
Nodes (7): DisabledOfferSnapshotStorage, from(), OfferStorageClient, StorageBucketClient, SupabaseOfferSnapshotStorage, ImmutableOfferSnapshot, OfferSnapshotStorage

### Community 103 - "admin-authorization-persistence.ts"
Cohesion: 0.14
Nodes (9): ScenarioPaymentContinuation, adminContext, adminJob, paymentConfirmedJob, redeliveryJob, scenarioPresentationJob, ticketContext, ticketJob (+1 more)

### Community 104 - "grammy.ts"
Cohesion: 0.08
Nodes (30): AdminBroadcastsApiModule, Module, AdminEventsApiModule, Module, AdminOperationsHandlers, AdminSegmentsApiModule, Module, ApiApplicationOptions (+22 more)

### Community 105 - "grammy.ts"
Cohesion: 0.28
Nodes (8): ProtectedLayout(), LoginPage(), metadata, AdminShell(), NAVIGATION, getPublicSupabaseConfiguration(), PublicSupabaseConfiguration, createServerSupabaseClient()

### Community 106 - "ticket-access-persistence.test.ts"
Cohesion: 0.19
Nodes (7): EventOfferEditor(), nullableValue(), OfferVersionRow(), requiredValue(), sourceTypeLabel(), stringValue(), AdminEventOfferVersion

### Community 107 - "DomainEvent"
Cohesion: 0.10
Nodes (8): VerifyPhoneInput, CampaignRow, ContactRow, ExistingBonusRow, PostgresPhoneVerificationRepository, PostgresTelegramUserResolver, RecordedQuery, WalletAccountRow

### Community 108 - ".query"
Cohesion: 0.16
Nodes (12): ADMIN_AUTHORIZER, ADMIN_TOKEN_VERIFIER, AdminAuthorizationGuard, AdminAuthorizationModule, AdminAuthorizationModuleOptions, parseBearerToken(), REQUIRED_ADMIN_PERMISSION, Inject (+4 more)

### Community 109 - "supabase-admin-token-verifier.ts"
Cohesion: 0.15
Nodes (12): main, name, private, scripts, build, dev, lint, test (+4 more)

### Community 110 - "notification-sender.ts"
Cohesion: 0.15
Nodes (12): main, name, private, scripts, build, dev, lint, test (+4 more)

### Community 111 - "Manual Payment Confirmation Runbook"
Cohesion: 0.15
Nodes (12): main, name, private, scripts, build, dev, lint, test (+4 more)

### Community 112 - "MessengerAdapter"
Cohesion: 0.15
Nodes (12): main, name, private, scripts, build, dev, lint, test (+4 more)

### Community 113 - "NodePostgresConnection"
Cohesion: 0.15
Nodes (12): main, name, private, scripts, build, dev, lint, test (+4 more)

### Community 114 - "20260724170000_payment_confirmation_tickets.sql"
Cohesion: 0.15
Nodes (12): main, name, private, scripts, build, dev, lint, test (+4 more)

### Community 115 - "notification-delivery.test.ts"
Cohesion: 0.31
Nodes (12): public.prevent_posted_wallet_transaction_mutation(), public.prevent_wallet_entry_mutation(), public.user_contacts, public.wallet_accounts, public.wallet_credit_campaigns, public.wallet_entries, public.wallet_hold_entries, public.wallet_holds (+4 more)

### Community 116 - "notification-delivery-persistence.ts"
Cohesion: 0.31
Nodes (12): events_validate_scenario_assignment, public.events, public.protect_published_scenario_graph(), public.protect_scenario_version_identity_and_publication(), public.scenario_edges, public.scenario_nodes, public.scenario_versions, public.scenarios (+4 more)

### Community 117 - "controller.ts"
Cohesion: 0.29
Nodes (8): CONTENT_BLOCK_LABELS, EventContentEditor(), integerValue(), parseContent(), readContentBlock(), requiredValue(), stringValue(), AdminEventContentBlock

### Community 118 - "contracts/src/index.ts"
Cohesion: 0.18
Nodes (10): API and Scenarios, Changed Modules, Goal, Manual Verification, Migrations, Requirements, Risks, Rollback (+2 more)

### Community 119 - "NotificationSender"
Cohesion: 0.24
Nodes (6): RecordingRenderer, TicketPng, TicketPngRenderer, qrcode, QrTicketPngRenderer, qrcode

### Community 120 - "TicketPngRenderer"
Cohesion: 0.40
Nodes (9): assertPositiveKopecks(), assertWalletBalance(), captureWalletHold(), createWalletHold(), creditWallet(), releaseWalletHold(), WalletBalance, WalletBucket (+1 more)

### Community 121 - "health-persistence.ts"
Cohesion: 0.13
Nodes (14): Compatibility Risks, Completed Foundation Slice, File Plan, Implementation Plan, Migration Plan, Phase 2 Event Sales Slice, Phase 4 Admin Operations Slice, Scope (+6 more)

### Community 122 - ".connect"
Cohesion: 0.20
Nodes (9): Database Connectivity, Database Migrations, Deferred Checks, Health and Readiness Runbook, Job Queue, Outbox Lag, Probe Failure, Public Endpoints (+1 more)

### Community 123 - "PhoneVerificationRepository"
Cohesion: 0.14
Nodes (22): AssignAdminUserCategoryService, AssignAdminUserStatusService, ClassificationCommandService, optional(), optionalCode(), parseCategory(), parseCategoryPatch(), parseStatus() (+14 more)

### Community 124 - ".deliverOnce"
Cohesion: 0.14
Nodes (17): appendScenarioAudit(), bumpEventVersion(), EdgeRow, EventGate, EventGateRow, findEventVersion(), insertGraph(), lockDraftEvent() (+9 more)

### Community 125 - "orders.test.ts"
Cohesion: 0.10
Nodes (5): IdempotencyRepository, IdGenerator, OutboxWriter, UnitOfWork, TelegramScenarioOpeningInput

### Community 126 - "HandleTelegramStartCommand"
Cohesion: 0.33
Nodes (9): audit_log_prevent_delete, audit_log_prevent_update, public.admin_accounts, public.admin_permissions, public.admin_role_grants, public.admin_role_permissions, public.admin_roles, public.audit_log (+1 more)

### Community 127 - "ticket-rendering/tsconfig.json"
Cohesion: 0.31
Nodes (9): protect_user_category_assignment, protect_user_category_catalog, protect_user_status_assignment, protect_user_status_catalog, public.protect_user_classification_assignment(), public.protect_user_classification_catalog(), public.user_categories, public.user_status_assignments (+1 more)

### Community 128 - "StubConnection"
Cohesion: 0.22
Nodes (8): Enablement, Expected Flow, Failure And Recovery, Full Refund Flow, Purpose, Read-Only Verification, Rollback, T-Bank Payments Runbook

### Community 129 - ".receive"
Cohesion: 0.33
Nodes (3): NotificationSender, RecordingSender, TextNotificationSender

### Community 130 - "admin-events-api.test.ts"
Cohesion: 0.17
Nodes (7): contentBlockPayload, eventPayload, offerPayload, pricingPayload, productPayload, readiness, scenarioPayload

### Community 131 - "phone-persistence.test.ts"
Cohesion: 0.27
Nodes (4): InvalidAdminAccessTokenError, SupabaseAdminAccessTokenVerifier, SupabaseAdminTokenVerifierOptions, VerifiedAdminToken

### Community 132 - "application/src/index.ts"
Cohesion: 0.22
Nodes (8): deadLetterQueueSql, dispatchQueueSql, migration, migrationPath, pgBossEntryPath, projectRoot, requireFromWorker, schemaSql

### Community 133 - "health-persistence.ts"
Cohesion: 0.25
Nodes (7): compilerOptions, emitDecoratorMetadata, experimentalDecorators, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 134 - "health-persistence.test.ts"
Cohesion: 0.25
Nodes (7): ADR 0004: pg-boss Schema Management, Compatibility, Context, Decision, Rollback, Status, Verification

### Community 135 - "admin-authorization-persistence.ts"
Cohesion: 0.25
Nodes (7): Запуск, Локальные демонстрационные данные, Назначение, Оплата, Повторный запуск, Подготовка администратора, Публикация демо-мероприятия

### Community 136 - "messenger.ts"
Cohesion: 0.25
Nodes (7): Failure And Recovery, Manual Payment Confirmation Runbook, Preconditions, Purpose, Read-Only Verification, Request, Rollback

### Community 138 - "20260725120000_tbank_payment_reconciliation.sql"
Cohesion: 0.11
Nodes (9): UserClassificationAuditWriter, TransactionSession, ActiveCategoryRow, ActiveStatusRow, CategoryRow, PostgresUserClassificationAuditWriter, StatusRow, assignedAt (+1 more)

### Community 139 - "StubConnection"
Cohesion: 0.25
Nodes (7): packages/database/scripts/**/*.ts, scripts/**/*.ts, compilerOptions, noEmit, extends, include, ./tsconfig.base.json

### Community 140 - "ticket-rendering/tsconfig.json"
Cohesion: 0.25
Nodes (5): approvedVendorDestructiveStatements, destructivePatterns, files, migrationDir, violations

### Community 141 - "Telegram Ticket Platform"
Cohesion: 0.36
Nodes (7): public.audit_log, public.messenger_identities, public.messenger_username_history, public.outbox_events, public.user_touchpoints, public.users, public.worker_heartbeats

### Community 142 - "check-ci-config.mjs"
Cohesion: 0.39
Nodes (7): public.prevent_scenario_event_mutation(), public.protect_scenario_session_identity(), public.scenario_events, public.scenario_sessions, scenario_events_prevent_delete, scenario_events_prevent_update, scenario_sessions_protect_identity

### Community 143 - "20260722230000_pgboss_v37_outbox_queues.sql"
Cohesion: 0.29
Nodes (6): ADR 0008: Idempotent Telegram Notification Delivery, Compatibility And Rollback, Consequences, Context, Decision, Status

### Community 144 - "20260724220000_tbank_payment_attempts_webhooks.sql"
Cohesion: 0.29
Nodes (6): ADR 0009: T-Bank Payment Initialization And Webhooks, Compatibility And Rollback, Consequences, Context, Decision, Status

### Community 145 - "20260725120000_tbank_payment_reconciliation.sql"
Cohesion: 0.29
Nodes (6): ADR 0010: T-Bank Payment Reconciliation, Compatibility And Rollback, Consequences, Context, Decision, Status

### Community 146 - "20260724190000_notification_delivery_ledger.sql"
Cohesion: 0.29
Nodes (6): ADR 0011: Safe Full T-Bank Refunds, Compatibility And Rollback, Consequences, Context, Decision, Status

### Community 147 - "scenario-engine/src/index.ts"
Cohesion: 0.29
Nodes (6): ADR 0012: Read-Only Administrator Projections, Compatibility And Rollback, Consequences, Context, Decision, Status

### Community 148 - "next-env.d.ts"
Cohesion: 0.29
Nodes (6): ADR 0013: Read-Only Administrator Event Catalog, Compatibility And Rollback, Consequences, Context, Decision, Status

### Community 149 - "app/page.tsx"
Cohesion: 0.29
Nodes (6): ADR 0014: Audited Administrator Event Draft Management, Compatibility And Rollback, Consequences, Context, Decision, Status

### Community 150 - "noop.mjs"
Cohesion: 0.29
Nodes (6): ADR 0015: Draft Product And Simple Pricing Management, Compatibility And Rollback, Consequences, Context, Decision, Status

### Community 151 - "20260721162000_foundation_idempotency_keys.sql"
Cohesion: 0.29
Nodes (6): ADR 0016: Draft Event Content Management, Compatibility And Rollback, Consequences, Context, Decision, Status

### Community 152 - "eslint.config.mjs"
Cohesion: 0.29
Nodes (6): ADR 0017: Administrator Immutable Offer Management, Compatibility And Rollback, Consequences, Context, Decision, Status

### Community 153 - "seed.sql"
Cohesion: 0.29
Nodes (6): ADR 0018: Версионируемые сценарии мероприятия, Контекст, Последствия, Решение, Совместимость и откат, Статус

### Community 154 - ".execute"
Cohesion: 0.29
Nodes (6): ADR 0019: Закрепленные пользовательские сессии сценария, Контекст, Последствия, Решение, Совместимость и откат, Статус

### Community 155 - "event-general-form.tsx"
Cohesion: 0.29
Nodes (6): ADR 0020: Валидированный ввод в сценарии, Контекст, Последствия, Решение, Совместимость и откат, Статус

### Community 156 - "admin-event-catalog-management-persistence.test.ts"
Cohesion: 0.29
Nodes (6): ADR 0021: Создание заказа из закрепленного сценария, Контекст, Откат, Последствия, Решение, Статус

### Community 157 - "admin-operations.test.ts"
Cohesion: 0.29
Nodes (6): ADR 0022: Продолжение сценария после подтвержденной оплаты, Контекст, Откат, Последствия, Решение, Статус

### Community 158 - "notification-delivery-persistence.test.ts"
Cohesion: 0.29
Nodes (6): ADR 0023: Атомарная публикация подготовленного мероприятия, Контекст, Откат, Последствия, Решение, Статус

### Community 159 - "telegram-start-persistence.test.ts"
Cohesion: 0.29
Nodes (6): ADR 0024: Обязательный TOTP MFA для веб-админки, Контекст, Откат, Последствия, Решение, Статус

### Community 160 - "ticket-access-persistence.test.ts"
Cohesion: 0.29
Nodes (6): ADR 0025: Защищенный запуск прикладных миграций, Контекст, Откат, Последствия, Решение, Статус

### Community 161 - "ADR 0014: Audited Administrator Event Draft Management"
Cohesion: 0.29
Nodes (6): ADR 0026: Защищенное демонстрационное наполнение local/test, Контекст, Откат, Последствия, Решение, Статус

### Community 162 - "DomainEvent"
Cohesion: 0.29
Nodes (6): ADR 0027: Внутреннее подтверждение заказа с нулевой внешней суммой, Контекст, Откат, Последствия, Решение, Статус

### Community 163 - ".deliverTickets"
Cohesion: 0.29
Nodes (6): ADR 0028: Идемпотентное начисление баланса из сценария, Контекст, Откат, Последствия, Решение, Статус

### Community 164 - "Administrator Event Draft Management Runbook"
Cohesion: 0.29
Nodes (6): Production, Локальная база, Остановки и восстановление, Перед запуском, Прикладные миграции PostgreSQL, Тестовый стенд

### Community 165 - "admin-event-content-management-persistence.test.ts"
Cohesion: 0.29
Nodes (6): Enablement, Recovery, Rollback, Signals, Telegram Notification Delivery Runbook, Validation

### Community 166 - ".execute"
Cohesion: 0.29
Nodes (6): Диагностика, Нормальное поведение, Область, Откат приложения, Перед включением, Пользовательский runtime сценария

### Community 167 - "worker/src/main.ts"
Cohesion: 0.29
Nodes (6): Payload узлов, Диагностика, Нормальное поведение, Ограничения текущего этапа, Перед включением, Статусы и категории пользователей

### Community 168 - "health-persistence.ts"
Cohesion: 0.29
Nodes (6): compilerOptions, noEmit, extends, include, ./*.ts, ../../../tsconfig.base.json

### Community 169 - "order-expiry-persistence.test.ts"
Cohesion: 0.43
Nodes (6): manual_payments_append_only, payment_attempts_protect_evidence, public.manual_payments, public.payment_attempts, public.prevent_manual_payment_mutation(), public.protect_payment_attempt_record()

### Community 170 - "event-content-editor.tsx"
Cohesion: 0.43
Nodes (6): payment_refund_events_append_only, payment_refund_requests_protect_evidence, public.payment_refund_events, public.payment_refund_requests, public.prevent_payment_refund_event_mutation(), public.protect_payment_refund_request()

### Community 171 - "admin-events-api.test.ts"
Cohesion: 0.33
Nodes (3): nextConfig, metadata, .next/**

### Community 172 - "outbox-persistence.test.ts"
Cohesion: 0.33
Nodes (5): ADR 0003: Wallet Ledger, Compatibility And Rollback, Consequences, Context, Decision

### Community 173 - "TBankWebhookStatus"
Cohesion: 0.33
Nodes (5): ADR 0005: Administrator Authentication and RBAC, Consequences, Context, Decision, Status

### Community 174 - "AdminEventAuditContext"
Cohesion: 0.33
Nodes (5): ADR 0006: CI and Ephemeral Migration Testing, Consequences, Context, Decision, Status

### Community 175 - "grammy.ts"
Cohesion: 0.33
Nodes (5): ADR 0007: Event Sales And Immutable Order Snapshots, Compatibility And Rollback, Consequences, Context, Decision

### Community 176 - "PostgresIdempotencyRepository"
Cohesion: 0.33
Nodes (5): ADR 0029: Статусы и категории пользователей, Контекст, Миграция, Последствия, Решение

### Community 177 - "ADR 0016: Draft Event Content Management"
Cohesion: 0.33
Nodes (5): Administrator Event Draft Management Runbook, Browser Boundary, Failure And Recovery, Required Controls, Scope

### Community 178 - "admin-event-scenario-management-persistence.test.ts"
Cohesion: 0.33
Nodes (5): Administrator Event Offer Management Runbook, Failure And Recovery, Publication Controls, Scope, Storage Provisioning

### Community 179 - ".execute"
Cohesion: 0.33
Nodes (5): Миграция, Область, Ошибки, Порядок публикации, Управление сценариями мероприятия

### Community 180 - "telegram.ts"
Cohesion: 0.33
Nodes (5): Administrator Read Operations Runbook, Endpoints, Failure And Recovery, Pagination, Web Administrator UI

### Community 181 - "Пользовательский runtime сценария"
Cohesion: 0.33
Nodes (5): Order Expiry Runbook, Read-Only Checks, Recovery, Signals, Validation

### Community 182 - "MemoryLedger"
Cohesion: 0.17
Nodes (15): OrderSalesContext, PersistedOrder, PersistOrderInput, PersistOrderResult, aggregateProducts(), EventContextRow, OrderRow, parseBundleComposition() (+7 more)

### Community 183 - "ticket-access-persistence.test.ts"
Cohesion: 0.11
Nodes (10): AdminEventPricingRuleRecord, audit, eventGateRow, FakeConnection, FakePool, occurredAt, pricingRule, product (+2 more)

### Community 184 - "PostgresNotificationDeliveryLedger"
Cohesion: 0.09
Nodes (21): DraftCondition, AdminSegmentsHandlers, ListAdminSavedSegmentsService, GetAdminSegmentAudienceSnapshotService, ListAdminSegmentAudienceSnapshotsService, requirePermission(), requireUuid(), ADMIN_SEGMENT_BOOLEAN_OPERATORS (+13 more)

### Community 185 - "tbank-refunds.test.ts"
Cohesion: 0.33
Nodes (5): Безопасность, Локальные команды, Платформа продажи билетов в Telegram, Текущий этап, Что еще не реализовано

### Community 186 - "offer-acceptance-persistence.test.ts"
Cohesion: 0.60
Nodes (3): config, proxy(), refreshSupabaseSession()

### Community 187 - "TBankWebhookStatus"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 188 - "NodePostgresConnection"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 189 - "LibPhoneNumberNormalizer"
Cohesion: 0.40
Nodes (4): Context7, Current Session, Graphify, MCP Setup

### Community 190 - "scenario-runtime.test.ts"
Cohesion: 0.40
Nodes (4): MFA администраторов, Обычный вход, Сбои, Требования

### Community 192 - "scenario-runtime.test.ts"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 193 - "ADR 0022: Продолжение сценария после подтвержденной оплаты"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 194 - "scenario-engine/src/index.test.ts"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 195 - "controller.test.ts"
Cohesion: 0.33
Nodes (5): ADR 0031: Сохранённые и версионируемые сегменты, Контекст, Последствия, Решение, Совместимость

### Community 196 - "ADR 0024: Обязательный TOTP MFA для веб-админки"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 197 - ".next/**"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 198 - "tbank-refunds.test.ts"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 199 - "admin-web/proxy.ts"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 200 - "MFA администраторов"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 201 - "payment-tbank/tsconfig.json"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 202 - "admin-event-scenario-management-persistence.test.ts"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 203 - "LibPhoneNumberNormalizer"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 204 - "Локальные демонстрационные данные"
Cohesion: 0.40
Nodes (4): dependabotPath, violations, workflowDirectory, workflowFiles

### Community 206 - "ADR 0026: Защищенное демонстрационное наполнение local/test"
Cohesion: 0.60
Nodes (4): payment_provider_events_append_only, public.payment_attempts, public.payment_provider_events, public.prevent_payment_provider_event_mutation()

### Community 207 - "Прикладные миграции PostgreSQL"
Cohesion: 0.60
Nodes (4): payment_reconciliation_events_append_only, public.payment_attempts, public.payment_reconciliation_events, public.prevent_payment_reconciliation_event_mutation()

### Community 208 - "Предварительный просмотр сегмента"
Cohesion: 0.25
Nodes (7): Диагностика, Доступ, Нормальное поведение, Ограничения, Правила выражения, Предварительный просмотр сегмента, Сохранённые версии

### Community 209 - ".deliverOnce"
Cohesion: 0.09
Nodes (8): TelegramInlineButton, TelegramReplyModel, inlineKeyboard(), TelegramBotOptions, callbackFixture(), myTicketsFixture(), ticketRedeliveryFixture(), Logger

### Community 210 - "20260724190000_notification_delivery_ledger.sql"
Cohesion: 0.67
Nodes (3): notification_deliveries_protect_record, public.notification_deliveries, public.protect_notification_delivery_record()

### Community 211 - "20260726200000_application_migration_checksums.sql"
Cohesion: 0.67
Nodes (3): application_migration_checksums_append_only, public.application_migration_checksums, public.reject_application_migration_checksum_mutation()

### Community 220 - "admin-segments-persistence.ts"
Cohesion: 0.06
Nodes (23): AdminSegmentSampleUser, asIso(), buildAdminSegmentSqlExpression(), buildCondition(), buildGroups(), CountRow, mapSample(), PostgresAdminSegmentPreviewRepository (+15 more)

### Community 221 - "health-persistence.ts"
Cohesion: 0.14
Nodes (6): audit, broadcastRow(), FakeConnection, FakePool, scheduledAt, scheduledBroadcastRow()

### Community 222 - "order-expiry-persistence.test.ts"
Cohesion: 0.23
Nodes (10): createPostgresHealthProbes(), degraded(), failed(), healthy(), PostgresHealthProbeOptions, probe(), query(), quotePostgresIdentifier() (+2 more)

### Community 223 - "event-general-form.tsx"
Cohesion: 0.29
Nodes (7): EventGeneralForm(), EventGeneralFormProps, nullableValue(), numberValue(), readGeneralInput(), requiredValue(), stringValue()

### Community 224 - "offer-acceptance-persistence.test.ts"
Cohesion: 0.16
Nodes (5): RecordTelegramOfferAcceptanceInput, PostgresOfferAcceptanceRepository, acceptanceRow, RecordedQuery, toOfferAcceptanceOrder()

### Community 225 - "ADR 0030: Предварительный просмотр сегмента классификации"
Cohesion: 0.33
Nodes (5): ADR 0030: Предварительный просмотр сегмента классификации, Контекст, Последствия, Решение, Совместимость

### Community 226 - "HmacTicketReferenceGenerator"
Cohesion: 0.39
Nodes (7): public.protect_ready_segment_audience_snapshot(), public.protect_segment_audience_snapshot_member(), public.segment_audience_snapshots, public.validate_segment_audience_snapshot_version(), segment_audience_snapshot_members_protect_mutation, segment_audience_snapshots_protect_mutation, segment_audience_snapshots_validate_version

### Community 227 - ".list"
Cohesion: 0.47
Nodes (4): public.segment_versions, public.segments, public.validate_segment_published_version(), segments_validate_published_version

### Community 228 - "PostgresNotificationContextRepository"
Cohesion: 0.09
Nodes (16): AdminPurchaseContext, ClaimNotificationDeliveryInput, ClaimNotificationDeliveryResult, ScenarioDeliveryContext, AdminPurchaseContextRow, DeliveryStateRow, PostgresNotificationContextRepository, PostgresNotificationDeliveryLedger (+8 more)

### Community 229 - ".list"
Cohesion: 0.09
Nodes (13): at, attemptRow, contactRow, FakeConnection, FakePool, historyRow, identityRow, itemRow (+5 more)

### Community 230 - "ADR 0032: Неизменяемые снимки аудитории сегмента"
Cohesion: 0.33
Nodes (5): ADR 0032: Неизменяемые снимки аудитории сегмента, Контекст, Последствия, Решение, Совместимость

### Community 231 - "event-publication-panel.tsx"
Cohesion: 0.32
Nodes (10): EventCatalogPage(), EventContentPage(), EditEventPage(), EventOfferPage(), EventScenarioPage(), PageError(), PageLoading(), AdminApiError (+2 more)

### Community 232 - ".constructor"
Cohesion: 0.18
Nodes (6): AdminPrincipalRow, isAdminPermission(), knownPermissions, mapPrincipal(), PostgresAdminPrincipalRepository, StubConnection

### Community 233 - "Снимки аудитории сегмента"
Cohesion: 0.33
Nodes (5): Диагностика, Доступ, Ограничения, Снимки аудитории сегмента, Состояния

### Community 234 - ".constructor"
Cohesion: 0.36
Nodes (8): broadcast_versions_protect_mutation, broadcast_versions_validate_audience, broadcasts_validate_published_version, public.broadcast_versions, public.broadcasts, public.protect_broadcast_version_identity_and_publication(), public.validate_broadcast_audience_snapshot(), public.validate_broadcast_published_version()

### Community 235 - "PostgresPhoneBonusRepository"
Cohesion: 0.29
Nodes (3): errorCode(), NotificationDeliveryLedger, MemoryLedger

### Community 236 - "Черновики и версии рассылок"
Cohesion: 0.29
Nodes (6): Диагностика, Доступ, Ограничения содержимого, Подготовка, Текущие границы, Черновики и версии рассылок

### Community 237 - "admin-segments-api.test.ts"
Cohesion: 0.15
Nodes (19): applyDemoSeed(), assertSafeDemoSeedSource(), DemoSeedConfig, DemoSeedResult, main(), mapScenarioEdge(), mapScenarioNode(), projectRoot (+11 more)

### Community 238 - ".receive"
Cohesion: 0.10
Nodes (11): AdminUserClassificationCodeConflictError, AdminUserClassificationVersionConflictError, CreateAdminUserCategoryService, CreateAdminUserStatusService, ListAdminUserClassificationService, execute(), metadata, systemStatus (+3 more)

### Community 239 - "ADR 0033: Версии рассылки с зафиксированной аудиторией"
Cohesion: 0.33
Nodes (5): ADR 0033: Версии рассылки с зафиксированной аудиторией, Контекст, Последствия, Решение, Совместимость

### Community 240 - "admin-broadcasts-api.test.ts"
Cohesion: 0.33
Nodes (5): ADR 0035. Арендованная доставка рассылок в Telegram, Контекст, Последствия, Решение, Статус

### Community 241 - "AdminBroadcastSummary"
Cohesion: 0.40
Nodes (4): Включение, Диагностика, Отправка рассылок в Telegram, Состояния доставки

### Community 242 - "PricingRule"
Cohesion: 0.22
Nodes (6): OrderSalesProduct, createdAt, salesContext, MutableProduct, ProductPricingRow, PricingRule

### Community 243 - "ticket-access-persistence.test.ts"
Cohesion: 0.15
Nodes (9): TelegramTicketSummary, IdentityRow, mapTicketSummary(), PostgresTelegramTicketAccessRepository, RedeliverableTicketRow, RecordedQuery, redeliverableRow, ticketSummaryRow (+1 more)

### Community 245 - "createTelegramBot"
Cohesion: 0.14
Nodes (10): BroadcastPreparationCounts, BroadcastPreparationRepository, count(), InvalidBroadcastPreparationError, PrepareBroadcastDeliveriesBatchResult, PrepareBroadcastDeliveriesBatchService, preparedEvent(), preparedAt (+2 more)

### Community 246 - ".execute"
Cohesion: 0.11
Nodes (10): activeOfferRow, at, audit, documentRow, eventRow, FakeConnection, FakePool, publishInput (+2 more)

### Community 247 - "controller.test.ts"
Cohesion: 0.15
Nodes (7): readiness, HealthComponentSnapshot, HealthReadinessReport, HealthSnapshot, ProblemDetails, JobActorReference, JobEntityReference

### Community 248 - "20260730120000_broadcast_scheduling_delivery_ledger.sql"
Cohesion: 0.33
Nodes (8): broadcast_deliveries_protect_record, broadcasts_protect_schedule, broadcasts_validate_schedule, public.broadcast_deliveries, public.broadcasts, public.protect_broadcast_delivery(), public.protect_broadcast_schedule(), public.validate_broadcast_schedule()

### Community 249 - "event-publication-panel.tsx"
Cohesion: 0.11
Nodes (19): EventPublicationPanel(), eventPublicationRequirements(), isKopeckAmount(), PublicationRequirement, AdminEventProductRecord, ADMIN_OFFER_SOURCE_TYPES, AdminEventCatalogMutationRequest, AdminOfferSourceType (+11 more)

### Community 251 - ".list"
Cohesion: 0.26
Nodes (9): BroadcastEditor(), browserTimezone(), defaultScheduleLocal(), DraftButton, lifecycleLabel(), message(), toLocalInput(), listAdminBroadcasts() (+1 more)

### Community 252 - "ADR 0034: Планирование и подготовка журнала рассылки"
Cohesion: 0.33
Nodes (5): ADR 0034: Планирование и подготовка журнала рассылки, Контекст, Последствия, Решение, Совместимость

### Community 253 - "Планирование и подготовка рассылки"
Cohesion: 0.33
Nodes (5): Диагностика, Доступ, Планирование и подготовка рассылки, Подготовка worker, Условия планирования

### Community 254 - "user-classification-editor.tsx"
Cohesion: 0.18
Nodes (3): message(), UserClassificationEditor(), status()

### Community 255 - "AdminBroadcast"
Cohesion: 0.26
Nodes (4): AdminBroadcastRepository, GetAdminBroadcastService, AdminBroadcast, AdminBroadcastContent

### Community 256 - "admin-event-scenario-management-persistence.test.ts"
Cohesion: 0.24
Nodes (5): affected(), FakeConnection, RecordedQuery, respond(), rows()

### Community 257 - "order-sales-persistence.test.ts"
Cohesion: 0.20
Nodes (4): eventContextRow, productPricingRow, RecordedQuery, referenceGenerator

### Community 258 - ".constructor"
Cohesion: 0.22
Nodes (6): ConfirmedPaymentRow, PaymentOrderItemRow, TicketResultRow, WalletHoldAllocationRow, WalletHoldRow, PostgresOutboxWriter

## Knowledge Gaps
- **1226 isolated node(s):** `nextConfig`, `name`, `version`, `private`, `type` (+1221 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **15 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `SqlConnection` connect `messenger-telegram/package.json` to `admin-event-scenario-management-persistence.test.ts`, `api/src/main.ts`, `order-sales-persistence.test.ts`, `tasks`, `20260725120000_tbank_payment_reconciliation.sql`, `node-postgres.ts`, `SqlQueryResult`, `phone-persistence.test.ts`, `messenger.ts`, `telegram-start-persistence.test.ts`, `admin-web/tsconfig.json`, `telegram-bot/tsconfig.json`, `worker/tsconfig.json`, `ticket-access-persistence.test.ts`, `NodePostgresConnection`, `20260721162000_foundation_idempotency_keys.sql`, `seed.sql`, `outbox-persistence.test.ts`, `StubConnection`, `.newId`, `RecordingConnection`, `app.ts`, `HmacOrderReferenceGenerator`, `admin-segments-persistence.ts`, `health-persistence.ts`, `order-expiry-persistence.test.ts`, `offer-acceptance-persistence.test.ts`, `orders.test.ts`, `payment-confirmation.ts`, `PostgresNotificationContextRepository`, `.list`, `.constructor`, `DomainEvent`, `ticket-access-persistence.test.ts`, `admin-saved-segments-persistence.test.ts`, `.execute`, `.deliverOnce`?**
  _High betweenness centrality (0.058) - this node is a cross-community bridge._
- **Why does `IdGenerator` connect `orders.test.ts` to `order-sales-persistence.test.ts`, `.constructor`, `telegram-start-persistence.ts`, `scripts`, `dependencies`, `database/package.json`, `20260725120000_tbank_payment_reconciliation.sql`, `tasks`, `scenario-engine/package.json`, `20260722100000_contacts_wallet_ledger.sql`, `wallet.ts`, `SqlConnection`, `api/tsconfig.json`, `.creditPhoneBonus`, `telegram-start-persistence.test.ts`, `MessengerAdapter`, `ADR 0003: Wallet Ledger`, `check-migrations.mjs`, `telegram-bot/tsconfig.json`, `node-postgres.test.ts`, `messenger-core/tsconfig.json`, `payment-tbank/src/index.ts`, `scenario-engine/tsconfig.json`, `Telegram Ticket Platform`, `MemoryLedger`, `.transact`, `NodePostgresConnection`, `20260722230000_pgboss_v37_outbox_queues.sql`, `messenger.ts`, `app.ts`, `createApiApplication`, `StubConnection`, `order-sales-persistence.test.ts`, `app.ts`, `telegram-start-persistence.test.ts`, `admin-segments-persistence.ts`, `order.ts`, `ADR 0007: Event Sales And Immutable Order Snapshots`, `offer-acceptance-persistence.test.ts`, `payment-confirmation.test.ts`, `outbox.ts`, `DomainEvent`, `.receive`, `ticket-access-persistence.test.ts`, `createTelegramBot`, `PhoneVerificationRepository`?**
  _High betweenness centrality (0.042) - this node is a cross-community bridge._
- **Why does `SqlConnectionPool` connect `admin-segments-persistence.ts` to `admin-event-scenario-management-persistence.test.ts`, `order-sales-persistence.test.ts`, `.constructor`, `messenger-telegram/package.json`, `20260725120000_tbank_payment_reconciliation.sql`, `tasks`, `20260722100000_contacts_wallet_ledger.sql`, `node-postgres.ts`, `SqlQueryResult`, `phone-persistence.test.ts`, `messenger.ts`, `telegram-start-persistence.test.ts`, `admin-web/tsconfig.json`, `telegram-bot/tsconfig.json`, `worker/tsconfig.json`, `MemoryLedger`, `ticket-access-persistence.test.ts`, `NodePostgresConnection`, `20260721162000_foundation_idempotency_keys.sql`, `seed.sql`, `outbox-persistence.test.ts`, `outbox.ts`, `.newId`, `telegram-start-persistence.test.ts`, `StubConnection`, `RecordingConnection`, `app.ts`, `HmacOrderReferenceGenerator`, `health-persistence.ts`, `order-expiry-persistence.test.ts`, `order.ts`, `offer-acceptance-persistence.test.ts`, `orders.test.ts`, `TransactionSession`, `payment-confirmation.ts`, `PostgresNotificationContextRepository`, `.list`, `.constructor`, `DomainEvent`, `ticket-access-persistence.test.ts`, `admin-saved-segments-persistence.test.ts`, `.execute`, `.deliverOnce`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **What connects `nextConfig`, `name`, `version` to the rest of the system?**
  _1226 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `telegram-webhook.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05468215994531784 - nodes in this community are weakly interconnected._
- **Should `api/src/main.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.026414212248714354 - nodes in this community are weakly interconnected._
- **Should `grammy.test.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.1422924901185771 - nodes in this community are weakly interconnected._