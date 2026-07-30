# Graph Report - Project  (2026-07-30)

## Corpus Check
- 419 files · ~231,525 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 5213 nodes · 11256 edges · 275 communities (258 shown, 17 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 129 edges (avg confidence: 0.64)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `3dab13cd`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- controller.ts
- SqlQueryResult
- api/src/admin-auth.ts
- HealthController
- migration-runner.ts
- scenario-runtime.ts
- admin-saved-segments.ts
- tbank-payments.ts
- broadcast-test-delivery.ts
- admin-broadcast-persistence.ts
- .query
- scenario-engine/src/index.ts
- dependencies
- admin-events-api.ts
- payment-tbank/src/index.ts
- admin-operations-persistence.ts
- admin-api.ts
- event-content-editor.tsx
- scripts
- compilerOptions
- format.ts
- config/src/index.ts
- compilerOptions
- admin-event-catalog-management.ts
- scenario-runtime-persistence.ts
- admin-event-catalog-management-persistence.ts
- AdminUserClassificationMutationResult
- broadcast-delivery-persistence.ts
- admin-event-offer-management.ts
- admin-event-scenario-management.ts
- admin-event-management-persistence.ts
- broadcast-test-delivery-persistence.ts
- dependencies
- dependencies
- payment-confirmation.ts
- api/src/main.ts
- phone-persistence.ts
- broadcast-delivery.ts
- admin-event-management.ts
- SqlConnection
- domain/src/index.ts
- admin-saved-segments-persistence.ts
- scripts
- createApiApplication
- manual-payments-api.ts
- dependencies
- admin-event-content-management.ts
- full-refunds-api.test.ts
- application/src/index.ts
- order-expiry.ts
- orders-api.ts
- telegram-webhook.ts
- AdminRequestActor
- admin-user-imports.ts
- offer-acceptance.ts
- TransactionSession
- payment-confirmation-persistence.test.ts
- tbank-refunds.ts
- notification-sender.ts
- scenario-runtime-persistence.test.ts
- admin-events-persistence.ts
- seed.ts
- AdminEventAuditContext
- admin-broadcasts-api.ts
- admin-user-classification-api.ts
- application/src/orders.ts
- tbank-reconciliation.ts
- AuthenticatedAdminRequest
- messenger-telegram/package.json
- identity.ts
- tbank-refund-persistence.ts
- DomainEvent
- app.ts
- tasks
- order-expiry-persistence.test.ts
- admin-operations-persistence.test.ts
- application/package.json
- 20260724120000_event_sales_catalog_orders.sql
- event-catalog-editor.tsx
- tbank-reconciliation-persistence.ts
- AdminEventDetail
- ticket-rendering/package.json
- messenger-core/package.json
- admin-bootstrap.ts
- admin-event-content-management-persistence.ts
- contracts/src/admin-events.ts
- pricing.ts
- messenger-core/src/index.ts
- mfa-form.tsx
- .deliverTickets
- admin-imports-api.ts
- admin-saved-segments.test.ts
- application/src/admin-broadcasts.ts
- postgres.ts
- admin-event-catalog-management-persistence.test.ts
- notification-delivery.ts
- admin-event-offer-management-persistence.test.ts
- route.ts
- worker/src/main.ts
- application/src/admin-segments.ts
- application/src/admin-user-classification.ts
- admin-broadcasts.test.ts
- supabase-offer-storage.ts
- notification-delivery.test.ts
- admin-saved-segments-persistence.test.ts
- login/page.tsx
- event-offer-editor.tsx
- phone-persistence.test.ts
- admin-user-import-persistence.ts
- config/package.json
- contracts/package.json
- domain/package.json
- observability/package.json
- payment-tbank/package.json
- scenario-engine/package.json
- 20260722100000_contacts_wallet_ledger.sql
- 20260726120000_scenario_versions.sql
- user-classification-editor.tsx
- pull_request_template.md
- TicketPngRenderer
- wallet.ts
- Implementation Plan
- Health and Readiness Runbook
- outbox-persistence.ts
- admin-event-scenario-management-persistence.ts
- user-classification-persistence.ts
- 20260723223000_admin_rbac.sql
- 20260728200000_user_statuses_categories.sql
- T-Bank Payments Runbook
- NotificationSender
- admin-events-api.test.ts
- tbank-refund-persistence.test.ts
- generate-pgboss-migration.mjs
- api/tsconfig.json
- ADR 0004: pg-boss Schema Management
- Локальные демонстрационные данные
- Manual Payment Confirmation Runbook
- HmacOrderReferenceGenerator
- admin-event-content-management-persistence.test.ts
- tsconfig.json
- check-migrations.mjs
- 20260721160000_foundation_identity_audit_outbox.sql
- 20260726160000_scenario_runtime.sql
- ADR 0008: Idempotent Telegram Notification Delivery
- ADR 0009: T-Bank Payment Initialization And Webhooks
- ADR 0010: T-Bank Payment Reconciliation
- ADR 0011: Safe Full T-Bank Refunds
- ADR 0012: Read-Only Administrator Projections
- ADR 0013: Read-Only Administrator Event Catalog
- ADR 0014: Audited Administrator Event Draft Management
- ADR 0015: Draft Product And Simple Pricing Management
- ADR 0016: Draft Event Content Management
- ADR 0017: Administrator Immutable Offer Management
- ADR 0018: Версионируемые сценарии мероприятия
- ADR 0019: Закрепленные пользовательские сессии сценария
- ADR 0020: Валидированный ввод в сценарии
- ADR 0021: Создание заказа из закрепленного сценария
- ADR 0022: Продолжение сценария после подтвержденной оплаты
- ADR 0023: Атомарная публикация подготовленного мероприятия
- ADR 0024: Обязательный TOTP MFA для веб-админки
- ADR 0025: Защищенный запуск прикладных миграций
- ADR 0026: Защищенное демонстрационное наполнение local/test
- ADR 0027: Внутреннее подтверждение заказа с нулевой внешней суммой
- ADR 0028: Идемпотентное начисление баланса из сценария
- Прикладные миграции PostgreSQL
- Telegram Notification Delivery Runbook
- Пользовательский runtime сценария
- Статусы и категории пользователей
- scripts/tsconfig.json
- 20260724170000_payment_confirmation_tickets.sql
- 20260725160000_tbank_full_refunds.sql
- .next/**
- ADR 0003: Wallet Ledger
- ADR 0005: Administrator Authentication and RBAC
- ADR 0006: CI and Ephemeral Migration Testing
- ADR 0007: Event Sales And Immutable Order Snapshots
- ADR 0029: Статусы и категории пользователей
- Administrator Event Draft Management Runbook
- Administrator Event Offer Management Runbook
- Управление сценариями мероприятия
- Administrator Read Operations Runbook
- Order Expiry Runbook
- order-sales-persistence.ts
- scenario-runtime.test.ts
- ADR 0037. Асинхронная тестовая отправка рассылки
- Платформа продажи билетов в Telegram
- admin-web/proxy.ts
- telegram-bot/tsconfig.json
- worker/tsconfig.json
- MCP Setup
- MFA администраторов
- database/src/index.ts
- application/tsconfig.json
- config/tsconfig.json
- contracts/tsconfig.json
- ADR 0031: Сохранённые и версионируемые сегменты
- database/tsconfig.json
- domain/tsconfig.json
- messenger-core/tsconfig.json
- messenger-telegram/tsconfig.json
- observability/tsconfig.json
- payment-tbank/tsconfig.json
- scenario-engine/tsconfig.json
- ticket-rendering/tsconfig.json
- check-ci-config.mjs
- 20260722230000_pgboss_v37_outbox_queues.sql
- 20260724220000_tbank_payment_attempts_webhooks.sql
- 20260725120000_tbank_payment_reconciliation.sql
- Предварительный просмотр сегмента
- createTelegramBot
- 20260724190000_notification_delivery_ledger.sql
- 20260726200000_application_migration_checksums.sql
- seed.sql
- next-env.d.ts
- noop.mjs
- 20260721162000_foundation_idempotency_keys.sql
- 20260728120000_internal_zero_due_payments.sql
- 20260728160000_scenario_wallet_credit.sql
- segment-audience-snapshot-persistence.ts
- admin-broadcast-persistence.test.ts
- admin-segments-persistence.ts
- notification-delivery-persistence.ts
- offer-acceptance-persistence.test.ts
- ADR 0030: Предварительный просмотр сегмента классификации
- 20260729160000_segment_audience_snapshots.sql
- 20260729120000_segment_versions.sql
- notification-delivery-persistence.test.ts
- .register
- ADR 0032: Неизменяемые снимки аудитории сегмента
- tbank-payment-persistence.test.ts
- 20260730220000_broadcast_test_deliveries.sql
- Снимки аудитории сегмента
- 20260729200000_broadcast_versions.sql
- MemoryLedger
- Черновики и версии рассылок
- admin-user-import-persistence.test.ts
- admin-user-classification.test.ts
- ADR 0033: Версии рассылки с зафиксированной аудиторией
- ADR 0035. Арендованная доставка рассылок в Telegram
- Отправка рассылок в Telegram
- orders.test.ts
- admin-events-persistence.test.ts
- IdGenerator
- admin-user-classification-persistence.ts
- admin-user-imports.test.ts
- 20260731000000_broadcast_personalization_v2.sql
- 20260730120000_broadcast_scheduling_delivery_ledger.sql
- AdminApiError
- 20260730160000_broadcast_delivery_execution.sql
- CreateOrderCommand
- ADR 0034: Планирование и подготовка журнала рассылки
- Планирование и подготовка рассылки
- ADR 0038. Версионированная персонализация рассылок
- event-general-form.tsx
- SqlConnectionPool
- event-publication-panel.tsx
- ADR 0039. Фото в версиях рассылок
- user-import-preview.tsx
- ADR 0036. Аудируемое ручное управление рассылкой
- order-sales-persistence.test.ts
- admin-segments-api.ts
- 20260730200000_broadcast_manual_lifecycle_control.sql
- health-persistence.test.ts
- 20260731040000_broadcast_photo_media_v3.sql
- ADR 0040. Staging CSV-импорта пользователей
- Предпросмотр CSV-импорта пользователей
- tbank-refunds.test.ts
- admin-broadcasts-api.test.ts
- admin-imports.ts
- 20260731100000_user_import_staging.sql
- segment-audience-snapshots.ts
- .deliverOnce
- 20260731160000_user_import_identity_matching.sql

## God Nodes (most connected - your core abstractions)
1. `SqlConnection` - 239 edges
2. `SqlConnectionPool` - 129 edges
3. `IdGenerator` - 121 edges
4. `SqlQueryResult` - 112 edges
5. `AuthenticatedAdminRequest` - 77 edges
6. `AdminRequestActor` - 75 edges
7. `RequireAdminPermission()` - 64 edges
8. `AdminEventAuditContext` - 53 edges
9. `TransactionSession` - 46 edges
10. `AdminEventMutationMetadata` - 39 edges

## Surprising Connections (you probably didn't know these)
- `EventsPage()` --indirect_call--> `status()`  [INFERRED]
  apps/admin-web/src/app/(admin)/events/page.tsx → packages/application/src/user-classification.test.ts
- `OrdersPage()` --indirect_call--> `result()`  [INFERRED]
  apps/admin-web/src/app/(admin)/orders/page.tsx → packages/application/src/scenario-wallet-credit.ts
- `OrdersPage()` --indirect_call--> `status()`  [INFERRED]
  apps/admin-web/src/app/(admin)/orders/page.tsx → packages/application/src/user-classification.test.ts
- `UsersPage()` --indirect_call--> `result()`  [INFERRED]
  apps/admin-web/src/app/(admin)/users/page.tsx → packages/application/src/scenario-wallet-credit.ts
- `EventGeneralFormProps` --references--> `AdminEventDetail`  [EXTRACTED]
  apps/admin-web/src/components/event-general-form.tsx → packages/contracts/src/admin-events.ts

## Import Cycles
- None detected.

## Communities (275 total, 17 thin omitted)

### Community 0 - "controller.ts"
Cohesion: 0.06
Nodes (39): isTelegramUserId(), AcceptTelegramOfferCommand, HandleTelegramContactCommand, HandleTelegramContactResult, HandleTelegramStartCommand, HandleTelegramStartResult, InitializeTelegramPaymentCommand, ListTelegramTicketsCommand (+31 more)

### Community 1 - "SqlQueryResult"
Cohesion: 0.02
Nodes (34): StubConnection, RecordingConnection, FakeConnection, FakeConnection, FakeConnection, FakeConnection, FakeConnection, FakeConnection (+26 more)

### Community 2 - "api/src/admin-auth.ts"
Cohesion: 0.07
Nodes (25): ADMIN_AUTHORIZER, ADMIN_TOKEN_VERIFIER, AdminAuthorizationGuard, AdminAuthorizationModuleOptions, parseBearerToken(), REQUIRED_ADMIN_PERMISSION, Inject, Injectable (+17 more)

### Community 3 - "HealthController"
Cohesion: 0.13
Nodes (29): AdminUserImportIdentityCandidate, AdminUserImportMatchResultRow, AdminUserImportMatchKind, AdminUserImportMatchRow, AdminUserImportMatchStatus, AnalysisRow, appendAudit(), CandidateRow (+21 more)

### Community 4 - "migration-runner.ts"
Cohesion: 0.06
Nodes (55): main(), migrationDirectory, parseMode(), projectRoot, AppliedMigration, applyMigrationsToDatabase(), applyOneMigration(), assertUniqueVersions() (+47 more)

### Community 5 - "scenario-runtime.ts"
Cohesion: 0.06
Nodes (46): ClassificationCommandService, execution(), advanceResult(), classificationContext(), continueFromAction(), duplicateAdvanceResult(), duplicateInputResult(), duplicateOfferResult() (+38 more)

### Community 6 - "admin-saved-segments.ts"
Cohesion: 0.15
Nodes (16): bounded(), buildAudit(), GetAdminSavedSegmentService, ListAdminSavedSegmentsService, optional(), parseDefinition(), requireLockVersion(), requirePermission() (+8 more)

### Community 7 - "tbank-payments.ts"
Cohesion: 0.09
Nodes (17): ConfirmPaymentService, ExternalPaymentInitializer, HandleTBankPaymentWebhookService, initializedResult(), isRefundStatus(), mapStatus(), PreparedTBankPaymentAttempt, TBankPaymentInitializationRepository (+9 more)

### Community 8 - "broadcast-test-delivery.ts"
Cohesion: 0.07
Nodes (19): BroadcastMessageSender, AdminBroadcastTestRecipientUnavailableError, AdminBroadcastTestSendNotFoundError, AdminBroadcastTestSendVersionConflictError, buildAudit(), InvalidAdminBroadcastTestSendError, RequestAdminBroadcastTestSendService, requirePermission() (+11 more)

### Community 9 - "admin-broadcast-persistence.ts"
Cohesion: 0.12
Nodes (20): AdminBroadcastControlAction, bounded(), BroadcastFailure, buildAudit(), controlBroadcast(), CreateAdminBroadcastService, GetAdminBroadcastService, ListAdminBroadcastsService (+12 more)

### Community 10 - ".query"
Cohesion: 0.12
Nodes (11): ConfirmablePaymentOrder, ConfirmedPaymentRecord, PersistPaymentConfirmationInput, command, confirmedAt, order, RecordingRepository, VerifyPhoneInput (+3 more)

### Community 11 - "scenario-engine/src/index.ts"
Cohesion: 0.07
Nodes (42): automaticTransition(), blocked(), compareIssues(), executeScenarioGraph(), findActionsBeforeOrder(), findInvalidOrderComposition(), findPaymentsBeforeOffer(), findUnboundedCycleNodes() (+34 more)

### Community 12 - "dependencies"
Cohesion: 0.04
Nodes (47): dependencies, fastify, jose, @nestjs/common, @nestjs/core, @nestjs/platform-fastify, reflect-metadata, rxjs (+39 more)

### Community 13 - "admin-events-api.ts"
Cohesion: 0.05
Nodes (31): ADMIN_EVENTS, catalogMutationSchema, CatalogPricingHandler, CatalogProductHandler, ContentBlockHandler, contentBlockMutationSchema, contentBlockSchema, createEventSchema (+23 more)

### Community 14 - "payment-tbank/src/index.ts"
Cohesion: 0.09
Nodes (37): asRecord(), booleanField(), boundedSecret(), canonicalScalarPairs(), createTBankToken(), digitsField(), hashScalarPayload(), httpsUrlField() (+29 more)

### Community 15 - "admin-operations-persistence.ts"
Cohesion: 0.09
Nodes (28): OrderListFilters, AdminOperationsHandlers, AdminOperationsRepository, AdminPageCursor, decodeCursor(), encodeCursor(), GetAdminOrderService, GetAdminUserService (+20 more)

### Community 16 - "admin-api.ts"
Cohesion: 0.06
Nodes (59): BroadcastEditor(), browserTimezone(), defaultScheduleLocal(), DraftButton, lifecycleLabel(), message(), PERSONALIZATION_TOKENS, PersonalizationToken (+51 more)

### Community 17 - "event-content-editor.tsx"
Cohesion: 0.29
Nodes (8): CONTENT_BLOCK_LABELS, EventContentEditor(), integerValue(), parseContent(), readContentBlock(), requiredValue(), stringValue(), AdminEventContentBlock

### Community 18 - "scripts"
Cohesion: 0.05
Nodes (40): eslint, @eslint/js, js-yaml, devDependencies, eslint, @eslint/js, js-yaml, tsx (+32 more)

### Community 19 - "compilerOptions"
Cohesion: 0.05
Nodes (39): packages/application/src/index.ts, packages/config/src/index.ts, packages/contracts/src/index.ts, packages/database/src/index.ts, packages/domain/src/index.ts, packages/messenger-core/src/index.ts, packages/messenger-telegram/src/index.ts, packages/observability/src/index.ts (+31 more)

### Community 20 - "format.ts"
Cohesion: 0.17
Nodes (24): OrderDetailPage(), OrdersPage(), UserDetailPage(), UsersPage(), assignUserCategory(), assignUserStatus(), getOrder(), getUser() (+16 more)

### Community 21 - "config/src/index.ts"
Cohesion: 0.13
Nodes (37): AdminAuthConfig, ApiConfig, AppConfig, AppEnvironment, loadApiConfig(), loadAppConfig(), loadOfferStorageConfig(), loadTBankPaymentsConfig() (+29 more)

### Community 22 - "compilerOptions"
Cohesion: 0.05
Nodes (42): compilerOptions, allowJs, baseUrl, esModuleInterop, exactOptionalPropertyTypes, incremental, isolatedModules, jsx (+34 more)

### Community 23 - "admin-event-catalog-management.ts"
Cohesion: 0.08
Nodes (24): AdminEventPricingRuleNotFoundError, AdminEventProductCodeConflictError, AdminEventProductNotFoundError, CatalogFailure, CreateAdminEventPricingRuleService, CreateAdminEventProductService, integerBetween(), nullableDate() (+16 more)

### Community 24 - "scenario-runtime-persistence.ts"
Cohesion: 0.10
Nodes (19): LockTelegramScenarioResult, OpenTelegramScenarioResult, ScenarioRuntimeSession, asObject(), EdgeRow, EventChoiceRow, EventRow, expectAffectedRow() (+11 more)

### Community 25 - "admin-event-catalog-management-persistence.ts"
Cohesion: 0.10
Nodes (28): AdminEventCatalogManagementRepository, AdminEventPricingRuleRecord, AdminEventProductRecord, appendCatalogAudit(), bumpEventVersion(), EventGate, EventGateRow, lockDraftEvent() (+20 more)

### Community 26 - "AdminUserClassificationMutationResult"
Cohesion: 0.19
Nodes (18): AuthenticatedAdminRequest, AdminUserClassificationApiModule, AdminUserClassificationAssignmentsController, AdminUserClassificationController, invalidMutation(), mapMutationError(), mutationMetadata(), requireActor() (+10 more)

### Community 27 - "broadcast-delivery-persistence.ts"
Cohesion: 0.05
Nodes (40): BroadcastDeliveryCompletion, BroadcastDeliveryExecutionPolicy, BroadcastDeliveryFailureCategory, BroadcastDeliveryRepository, BroadcastDeliverySendError, ClaimedBroadcastDelivery, integerBetween(), InvalidBroadcastDeliveryExecutionError (+32 more)

### Community 28 - "admin-event-offer-management.ts"
Cohesion: 0.08
Nodes (21): AdminEventOfferDocumentAmbiguousError, AdminEventOfferManagementRepository, AdminEventOfferNotActiveError, AdminOfferSnapshotStorageUnavailableError, bounded(), DeactivateAdminEventOfferService, escapeHtml(), normalizeDisplayText() (+13 more)

### Community 29 - "admin-event-scenario-management.ts"
Cohesion: 0.09
Nodes (21): AdminEventScenarioManagementRepository, AdminScenarioValidationFailedError, AdminScenarioVersionNotDraftError, AdminScenarioVersionNotFoundError, bounded(), classificationReferenceIssues(), normalizeJsonObject(), parseGraph() (+13 more)

### Community 30 - "admin-event-management-persistence.ts"
Cohesion: 0.10
Nodes (21): AdminEventGeneralRecord, AdminEventManagementRepository, appendAudit(), EventGeneralRow, EventPublicationCatalogRow, eventSnapshot(), eventValues(), lockEventSales() (+13 more)

### Community 31 - "broadcast-test-delivery-persistence.ts"
Cohesion: 0.10
Nodes (24): BroadcastTestDeliveryRepository, AdminBroadcastTestDeliveryStatus, appendEvent(), appendRequestAudit(), asDate(), asIso(), BroadcastLockRow, BroadcastTestDeliveryRow (+16 more)

### Community 32 - "dependencies"
Cohesion: 0.06
Nodes (31): dependencies, lucide-react, next, react, react-dom, @supabase/ssr, @supabase/supabase-js, @ticket-platform/contracts (+23 more)

### Community 33 - "dependencies"
Cohesion: 0.06
Nodes (31): dependencies, pg-boss, @ticket-platform/application, @ticket-platform/config, @ticket-platform/contracts, @ticket-platform/database, @ticket-platform/messenger-telegram, @ticket-platform/observability (+23 more)

### Community 34 - "payment-confirmation.ts"
Cohesion: 0.08
Nodes (24): hashConfirmationRequest(), InternalPaymentEvidence, IssuedTicket, issueTicketReferences(), ManualPaymentEvidence, PaymentConfirmationActor, PaymentConfirmationRepository, PaymentConfirmationSource (+16 more)

### Community 35 - "api/src/main.ts"
Cohesion: 0.07
Nodes (38): bootstrapApi(), getExpectedMigrationVersion(), bootstrapTelegramBot(), CompleteInternalOrderService, AdvanceTelegramScenarioService, ResumeTelegramScenarioAfterOfferService, SelectTelegramEventService, StartTelegramScenarioService (+30 more)

### Community 36 - "phone-persistence.ts"
Cohesion: 0.36
Nodes (3): CreditPhoneBonusInput, CreditPhoneBonusResult, PostgresPhoneBonusRepository

### Community 37 - "broadcast-delivery.ts"
Cohesion: 0.07
Nodes (20): ADMIN_USER_CLASSIFICATION, AdminAssignmentHandler, AdminRemovalHandler, assignSchema, codeSchema, colorSchema, createCategorySchema, createStatusSchema (+12 more)

### Community 38 - "admin-event-management.ts"
Cohesion: 0.10
Nodes (23): mutationResult(), validateCommand(), mutationResult(), validateCommand(), AdminEventPublicationIssue, AdminEventPublicationRequirementsError, AdminEventSlugConflictError, buildAdminEventAuditContext() (+15 more)

### Community 39 - "SqlConnection"
Cohesion: 0.06
Nodes (37): AdminBroadcastRepository, appendAudit(), appendControlEvent(), appendPublicationEvent(), appendScheduleEvent(), asIso(), BroadcastListRow, BroadcastRow (+29 more)

### Community 40 - "domain/src/index.ts"
Cohesion: 0.15
Nodes (11): CreditScenarioWalletService, ExistingScenarioWalletCredit, hashRequest(), PersistScenarioWalletCreditInput, result(), ScenarioWalletCreditRepository, validateCommand(), validateExisting() (+3 more)

### Community 41 - "admin-saved-segments-persistence.ts"
Cohesion: 0.17
Nodes (17): AdminSavedSegmentRepository, AdminSavedSegmentSummary, appendAudit(), findUnavailableClassificationCodes(), lockSegment(), mapSummary(), mapVersion(), nextVersionNumber() (+9 more)

### Community 42 - "scripts"
Cohesion: 0.07
Nodes (28): dependencies, pg, @ticket-platform/application, @ticket-platform/domain, @ticket-platform/scenario-engine, devDependencies, @types/pg, @ticket-platform/application (+20 more)

### Community 43 - "createApiApplication"
Cohesion: 0.08
Nodes (13): broadcast, readiness, testDelivery, analysisResponse, readiness, response, readiness, HealthComponentSnapshot (+5 more)

### Community 44 - "manual-payments-api.ts"
Cohesion: 0.10
Nodes (17): CONFIRM_MANUAL_PAYMENT, manualPaymentBodySchema, ManualPaymentsApiModule, ManualPaymentsController, noopHandler, result, validBody, Body (+9 more)

### Community 45 - "dependencies"
Cohesion: 0.07
Nodes (27): dependencies, @ticket-platform/application, @ticket-platform/config, @ticket-platform/database, @ticket-platform/messenger-core, @ticket-platform/messenger-telegram, @ticket-platform/observability, @ticket-platform/payment-tbank (+19 more)

### Community 46 - "admin-event-content-management.ts"
Cohesion: 0.09
Nodes (17): AdminEventContentBlockNotFoundError, AdminEventContentBlockRecord, AdminEventContentSortOrderConflictError, assertJsonValue(), ContentFailure, CreateAdminEventContentBlockService, normalizeJsonObject(), optional() (+9 more)

### Community 47 - "full-refunds-api.test.ts"
Cohesion: 0.10
Nodes (20): fullRefundBodySchema, FullRefundsApiModule, FullRefundsController, REQUEST_FULL_REFUND, RequestFullRefundHandler, actor, healthyReadiness, result (+12 more)

### Community 48 - "application/src/index.ts"
Cohesion: 0.09
Nodes (17): HealthController, OperationsController, Controller, Get, Inject, aggregateStatus(), GetReadinessService, HealthClock (+9 more)

### Community 49 - "order-expiry.ts"
Cohesion: 0.11
Nodes (13): ExpirableOrder, ExpirableOrderStatus, ExpireOrderInput, ExpireOrderResult, ExpireOrdersBatchInput, ExpireOrdersBatchResult, ExpireOrdersBatchService, orderExpiredEvent() (+5 more)

### Community 50 - "orders-api.ts"
Cohesion: 0.10
Nodes (17): CREATE_ORDER, createOrderBodySchema, OrdersApiModule, OrdersController, noopHandler, orderResult, Body, Controller (+9 more)

### Community 51 - "telegram-webhook.ts"
Cohesion: 0.07
Nodes (21): secretsEqual(), telegramChatSchema, telegramMessageSchema, telegramUpdateSchema, telegramUserSchema, TelegramWebhookController, TelegramWebhookModule, TelegramWebhookService (+13 more)

### Community 52 - "AdminRequestActor"
Cohesion: 0.18
Nodes (10): AdminSegmentsHandlers, bounded(), GetAdminSegmentAudienceSnapshotService, ListAdminSegmentAudienceSnapshotsService, requirePermission(), requireUuid(), AdminSegmentAudienceSnapshot, AdminSegmentAudienceSnapshotSummary (+2 more)

### Community 53 - "admin-user-imports.ts"
Cohesion: 0.13
Nodes (24): AdminUserImportPreviewRepository, AdminUserImportStagedRow, bounded(), decodeBase64(), decodeUtf8(), Delimiter, DELIMITERS, HEADER_NAMES (+16 more)

### Community 54 - "offer-acceptance.ts"
Cohesion: 0.12
Nodes (16): acceptedResult(), AcceptTelegramOfferService, hashPublicToken(), isAcceptedOrderStatus(), OfferAcceptanceOrder, OfferAcceptanceRepository, offerAcceptedEvent(), RecordTelegramOfferAcceptanceInput (+8 more)

### Community 55 - "TransactionSession"
Cohesion: 0.18
Nodes (8): UpsertTelegramIdentityInput, UpsertTelegramIdentityResult, expectAffectedRow(), IdentityRow, mapIdentity(), PostgresIdempotencyRepository, PostgresIdentityRepository, ReturningKeyRow

### Community 56 - "payment-confirmation-persistence.test.ts"
Cohesion: 0.13
Nodes (7): confirmedAt, FakePool, orderItemRow, orderRow, RecordedQuery, walletAllocationRow, walletHoldRow

### Community 57 - "tbank-refunds.ts"
Cohesion: 0.10
Nodes (19): TBankWebhookStatus, TBankOrderLookupProvider, finalizeRefund(), FullTBankRefundProvider, FullTBankRefundProviderResult, HandleTBankRefundWebhookService, hashRequest(), providerResultMatches() (+11 more)

### Community 58 - "notification-sender.ts"
Cohesion: 0.20
Nodes (8): classifyTelegramBroadcastError(), GrammyTextNotificationSender, TelegramBroadcastSendError, TelegramNotificationApi, validateBroadcastPhotoUrl(), validateButtonText(), validateMessageId(), validateRecipient()

### Community 59 - "scenario-runtime-persistence.test.ts"
Cohesion: 0.14
Nodes (11): appendAudit(), CategoryRow, lockCatalogKey(), mapCategory(), mapStatus(), PostgresAdminUserClassificationRepository, StatusRow, audit (+3 more)

### Community 60 - "admin-events-persistence.ts"
Cohesion: 0.14
Nodes (26): AdminEventsRepository, AdminEventProduct, AdminEventScenarioVersion, AdminScenarioNodeType, ContentBlockRow, escapeLike(), EventDetailRow, EventSummaryRow (+18 more)

### Community 61 - "seed.ts"
Cohesion: 0.14
Nodes (20): ADMIN_OPERATIONS, AdminOperationsApiModule, AdminOrdersReadController, AdminUsersController, cursorSchema, execute(), idSchema, invalidAdminQuery() (+12 more)

### Community 62 - "AdminEventAuditContext"
Cohesion: 0.28
Nodes (14): AdminBroadcastsController, invalidBroadcast(), mapError(), mutationMetadata(), requireActor(), Body, Controller, Get (+6 more)

### Community 63 - "admin-broadcasts-api.ts"
Cohesion: 0.06
Nodes (29): Actor, ADMIN_BROADCASTS, AdminBroadcastControlHandler, AdminBroadcastHandlers, contentSchema, controlSchema, definitionSchema, publishSchema (+21 more)

### Community 64 - "admin-user-classification-api.ts"
Cohesion: 0.14
Nodes (14): PrepareTBankPaymentResult, RecordTBankStatusEvent, TBankWebhookPaymentAttempt, AttemptOrderRow, createMerchantOrderId(), hasActiveReservations(), InsertedEventRow, isPayableOrder() (+6 more)

### Community 65 - "application/src/orders.ts"
Cohesion: 0.16
Nodes (15): assertMatchingRequest(), CreateOrderService, eventSnapshot(), hashCreationRequest(), orderCreatedEvent(), OrderPricingSnapshot, OrderSalesEvent, OrderSalesRepository (+7 more)

### Community 66 - "tbank-reconciliation.ts"
Cohesion: 0.13
Nodes (13): isTerminal(), ReconcileTBankPaymentsBatchInput, ReconcileTBankPaymentsBatchResult, ReconcileTBankPaymentsBatchService, requiresReview(), retryAt(), TBankOrderLookupResult, TBankReconciliationRepository (+5 more)

### Community 67 - "AuthenticatedAdminRequest"
Cohesion: 0.25
Nodes (21): AdminEventsController, invalidEventMutation(), invalidEventQuery(), mapEventMutationError(), mapEventReadError(), mutationMetadata(), requireActor(), Body (+13 more)

### Community 68 - "messenger-telegram/package.json"
Cohesion: 0.09
Nodes (21): grammy, dependencies, grammy, @ticket-platform/contracts, @ticket-platform/messenger-core, @ticket-platform/observability, @ticket-platform/contracts, @ticket-platform/messenger-core (+13 more)

### Community 69 - "identity.ts"
Cohesion: 0.24
Nodes (8): IdentityRepository, userRegisteredEvent(), emptyPayload(), mergePayloadPart(), MessengerChannel, normalizePayload(), normalizeTelegramUsername(), parseStartPayload()

### Community 70 - "tbank-refund-persistence.ts"
Cohesion: 0.15
Nodes (12): PreparedFullTBankRefund, PrepareFullTBankRefundResult, TBankRefundReconciliationClaim, TBankRefundReconciliationRepository, at, claim, command, refund (+4 more)

### Community 71 - "DomainEvent"
Cohesion: 0.12
Nodes (12): BroadcastPreparationCounts, BroadcastPreparationRepository, count(), InvalidBroadcastPreparationError, PrepareBroadcastDeliveriesBatchResult, PrepareBroadcastDeliveriesBatchService, preparedEvent(), preparedAt (+4 more)

### Community 72 - "app.ts"
Cohesion: 0.09
Nodes (25): ApiApplicationOptions, APP_VERSION, READINESS_CHECK, ConfirmManualPaymentHandler, CreateOrderCommandHandler, TBANK_WEBHOOK_CONFIG, TBANK_WEBHOOK_HANDLER, TBANK_WEBHOOK_VERIFIER (+17 more)

### Community 73 - "tasks"
Cohesion: 0.10
Nodes (20): ^build, coverage/**, dist/**, ^lint, ^typecheck, dependsOn, outputs, cache (+12 more)

### Community 74 - "order-expiry-persistence.test.ts"
Cohesion: 0.08
Nodes (17): ADMIN_SEGMENTS, codeSchema, conditionSchema, definitionSchema, expressionSchema, invalidPreview(), previewSchema, publishSchema (+9 more)

### Community 75 - "admin-operations-persistence.test.ts"
Cohesion: 0.09
Nodes (27): escapeLike(), mapOrderSummary(), mapUserSummary(), maskContact(), OrderDetailRow, OrderSummaryRow, PostgresAdminOperationsRepository, at (+19 more)

### Community 76 - "application/package.json"
Cohesion: 0.09
Nodes (21): csv-parse, dependencies, csv-parse, @ticket-platform/contracts, @ticket-platform/domain, @ticket-platform/scenario-engine, @ticket-platform/contracts, @ticket-platform/domain (+13 more)

### Community 77 - "20260724120000_event_sales_catalog_orders.sql"
Cohesion: 0.21
Nodes (18): offer_acceptances_prevent_delete, offer_acceptances_prevent_update, offer_versions_protect_content, order_status_history_prevent_delete, order_status_history_prevent_update, public.event_content_blocks, public.events, public.inventory_reservations (+10 more)

### Community 78 - "event-catalog-editor.tsx"
Cohesion: 0.23
Nodes (13): CatalogEditor, integerValue(), nullableIntegerValue(), nullableValue(), parseBundleComposition(), PricingRuleForm(), ProductForm(), readPricingRule() (+5 more)

### Community 79 - "tbank-reconciliation-persistence.ts"
Cohesion: 0.32
Nodes (7): TBankOrderLookupPayment, TBankReconciliationClaim, isTerminal(), leaseLost(), PostgresTBankReconciliationRepository, safeResultCode(), terminalAttemptStatus()

### Community 80 - "AdminEventDetail"
Cohesion: 0.12
Nodes (19): EventGeneralFormProps, EventListFilters, AdminEventPageCursor, decodeCursor(), encodeCursor(), GetAdminEventService, ListAdminEventsService, parseLimit() (+11 more)

### Community 81 - "ticket-rendering/package.json"
Cohesion: 0.12
Nodes (15): devDependencies, @types/qrcode, main, name, private, scripts, build, dev (+7 more)

### Community 82 - "messenger-core/package.json"
Cohesion: 0.11
Nodes (17): libphonenumber-js, dependencies, libphonenumber-js, @ticket-platform/application, @ticket-platform/application, main, name, private (+9 more)

### Community 83 - "admin-bootstrap.ts"
Cohesion: 0.12
Nodes (13): AdminBootstrapAlreadyCompletedError, BootstrapAdminRecord, BootstrapFirstAdminCommand, BootstrapFirstAdminService, FirstAdminBootstrapRepository, InvalidAdminBootstrapInputError, normalizeEmail(), normalizeOptional() (+5 more)

### Community 84 - "admin-event-content-management-persistence.ts"
Cohesion: 0.11
Nodes (20): AdminEventContentManagementRepository, appendContentAudit(), bumpEventVersion(), ContentBlockRow, contentBlockRowSnapshot(), contentBlockSnapshot(), contentBlockValues(), EventGate (+12 more)

### Community 85 - "contracts/src/admin-events.ts"
Cohesion: 0.07
Nodes (36): createEdge(), defaultPayload(), editableGraph(), EditableNode, EventScenarioEditor(), NODE_TYPE_LABELS, NodeSelect(), nodeTypeLabel() (+28 more)

### Community 86 - "pricing.ts"
Cohesion: 0.17
Nodes (13): calculatePrice(), comparePricingRules(), compareRuleRank(), dateRank(), matchesPricingInput(), PricingInput, PricingResult, PricingRuleConflictError (+5 more)

### Community 87 - "messenger-core/src/index.ts"
Cohesion: 0.12
Nodes (6): IncomingMessage, MessengerAdapter, SendMessageCommand, SendResult, InvalidPhoneNumberError, LibPhoneNumberNormalizer

### Community 88 - "mfa-form.tsx"
Cohesion: 0.21
Nodes (11): LoginForm(), metadata, MfaPage(), Enrollment, MfaForm(), AdminAuthDestination, adminDestinationForAssurance(), isValidTotpCode() (+3 more)

### Community 89 - ".deliverTickets"
Cohesion: 0.15
Nodes (5): assertTicketSet(), HandleNotificationJobService, NotificationContextRepository, TicketPublicTokenGenerator, validateExecutionInput()

### Community 90 - "admin-imports-api.ts"
Cohesion: 0.12
Nodes (24): ADMIN_IMPORTS, AdminImportHandlers, AdminImportsApiModule, AdminImportsController, analysisSchema, batchIdSchema, execute(), invalidAnalysis() (+16 more)

### Community 91 - "admin-saved-segments.test.ts"
Cohesion: 0.11
Nodes (9): AdminSavedSegmentVersionConflictError, CreateAdminSavedSegmentService, PublishAdminSavedSegmentService, draft, expression, metadata, publishedSegment, segment (+1 more)

### Community 92 - "application/src/admin-broadcasts.ts"
Cohesion: 0.07
Nodes (13): AdminBroadcastInvalidTransitionError, AdminBroadcastVersionConflictError, CancelAdminBroadcastService, InvalidAdminBroadcastError, PauseAdminBroadcastService, ResumeAdminBroadcastService, actor, broadcast (+5 more)

### Community 93 - "postgres.ts"
Cohesion: 0.03
Nodes (57): PendingBroadcastPreparation, TelegramTicketSummary, AdminPrincipalRow, isAdminPermission(), knownPermissions, mapPrincipal(), PostgresAdminPrincipalRepository, asDate() (+49 more)

### Community 94 - "admin-event-catalog-management-persistence.test.ts"
Cohesion: 0.12
Nodes (6): at, claim, claimRow, FakeConnection, FakePool, RecordedQuery

### Community 95 - "notification-delivery.ts"
Cohesion: 0.21
Nodes (15): asRecord(), date(), formatAdminPurchaseMessage(), formatKopecks(), formatTicketMessage(), HandleNotificationJobInput, HandleNotificationJobResult, NotificationDeliveryKind (+7 more)

### Community 96 - "admin-event-offer-management-persistence.test.ts"
Cohesion: 0.08
Nodes (22): AdminEventOfferVersionRecord, ActiveOfferRow, activeOfferSnapshot(), appendOfferAudit(), EventGate, EventGateRow, listOfferDocuments(), lockDraftEvent() (+14 more)

### Community 97 - "route.ts"
Cohesion: 0.30
Nodes (12): forwardAdminRequest(), GET(), PATCH(), POST(), problem(), readMutationBody(), RouteContext, AdminBffMethod (+4 more)

### Community 98 - "worker/src/main.ts"
Cohesion: 0.13
Nodes (18): bootstrapWorker(), assertPgBossQueuesProvisioned(), PgBossOutboxPublisher, PgBossPublisherClient, getQueue(), queue(), OutboxJobPublisher, DomainEventJobV1 (+10 more)

### Community 99 - "application/src/admin-segments.ts"
Cohesion: 0.11
Nodes (22): DraftCondition, collectAdminSegmentClassificationCodes(), parseCondition(), parseGroup(), parseSampleLimit(), PreviewAdminSegmentService, requirePermission(), uniqueCodes() (+14 more)

### Community 100 - "application/src/admin-user-classification.ts"
Cohesion: 0.11
Nodes (15): AdvanceTelegramScenarioCommand, AdvanceTelegramScenarioResult, ScenarioPresentationButton, SelectTelegramEventCommand, SelectTelegramEventResult, StartTelegramScenarioCommand, StartTelegramScenarioResult, SubmitTelegramScenarioInputCommand (+7 more)

### Community 101 - "admin-broadcasts.test.ts"
Cohesion: 0.13
Nodes (8): asIso(), buildCondition(), buildGroups(), CountRow, mapSample(), SampleRow, FakeConnection, FakePool

### Community 102 - "supabase-offer-storage.ts"
Cohesion: 0.18
Nodes (7): DisabledOfferSnapshotStorage, from(), OfferStorageClient, StorageBucketClient, SupabaseOfferSnapshotStorage, ImmutableOfferSnapshot, OfferSnapshotStorage

### Community 103 - "notification-delivery.test.ts"
Cohesion: 0.14
Nodes (9): ScenarioPaymentContinuation, adminContext, adminJob, paymentConfirmedJob, redeliveryJob, scenarioPresentationJob, ticketContext, ticketJob (+1 more)

### Community 105 - "login/page.tsx"
Cohesion: 0.28
Nodes (8): ProtectedLayout(), LoginPage(), metadata, AdminShell(), NAVIGATION, getPublicSupabaseConfiguration(), PublicSupabaseConfiguration, createServerSupabaseClient()

### Community 106 - "event-offer-editor.tsx"
Cohesion: 0.16
Nodes (5): AdminSegmentClassificationUnavailableError, AdminSegmentPreviewRepository, InvalidAdminSegmentPreviewError, actor, PostgresAdminSegmentPreviewRepository

### Community 107 - "phone-persistence.test.ts"
Cohesion: 0.13
Nodes (4): FakeConnection, FakePool, normalized, occurredAt

### Community 108 - "admin-user-import-persistence.ts"
Cohesion: 0.18
Nodes (17): ADMIN_USER_IMPORT_LIMITS, AdminUserImportRowStatus, appendAudit(), BatchRow, countRows(), ImportRow, mapImportRow(), optionalString() (+9 more)

### Community 109 - "config/package.json"
Cohesion: 0.15
Nodes (12): main, name, private, scripts, build, dev, lint, test (+4 more)

### Community 110 - "contracts/package.json"
Cohesion: 0.15
Nodes (12): main, name, private, scripts, build, dev, lint, test (+4 more)

### Community 111 - "domain/package.json"
Cohesion: 0.15
Nodes (12): main, name, private, scripts, build, dev, lint, test (+4 more)

### Community 112 - "observability/package.json"
Cohesion: 0.15
Nodes (12): main, name, private, scripts, build, dev, lint, test (+4 more)

### Community 113 - "payment-tbank/package.json"
Cohesion: 0.15
Nodes (12): main, name, private, scripts, build, dev, lint, test (+4 more)

### Community 114 - "scenario-engine/package.json"
Cohesion: 0.15
Nodes (12): main, name, private, scripts, build, dev, lint, test (+4 more)

### Community 115 - "20260722100000_contacts_wallet_ledger.sql"
Cohesion: 0.31
Nodes (12): public.prevent_posted_wallet_transaction_mutation(), public.prevent_wallet_entry_mutation(), public.user_contacts, public.wallet_accounts, public.wallet_credit_campaigns, public.wallet_entries, public.wallet_hold_entries, public.wallet_holds (+4 more)

### Community 116 - "20260726120000_scenario_versions.sql"
Cohesion: 0.31
Nodes (12): events_validate_scenario_assignment, public.events, public.protect_published_scenario_graph(), public.protect_scenario_version_identity_and_publication(), public.scenario_edges, public.scenario_nodes, public.scenario_versions, public.scenarios (+4 more)

### Community 117 - "user-classification-editor.tsx"
Cohesion: 0.18
Nodes (3): message(), UserClassificationEditor(), status()

### Community 118 - "pull_request_template.md"
Cohesion: 0.18
Nodes (10): API and Scenarios, Changed Modules, Goal, Manual Verification, Migrations, Requirements, Risks, Rollback (+2 more)

### Community 119 - "TicketPngRenderer"
Cohesion: 0.18
Nodes (9): RecordingRenderer, TicketPng, TicketPngRenderer, dependencies, qrcode, @ticket-platform/application, @ticket-platform/application, QrTicketPngRenderer (+1 more)

### Community 120 - "wallet.ts"
Cohesion: 0.40
Nodes (9): assertPositiveKopecks(), assertWalletBalance(), captureWalletHold(), createWalletHold(), creditWallet(), releaseWalletHold(), WalletBalance, WalletBucket (+1 more)

### Community 121 - "Implementation Plan"
Cohesion: 0.10
Nodes (20): Compatibility Risks, Completed Foundation Slice, File Plan, Implementation Plan, Migration Plan, Phase 2 Event Sales Slice, Phase 4 Admin Operations Slice, Scope (+12 more)

### Community 122 - "Health and Readiness Runbook"
Cohesion: 0.20
Nodes (9): Database Connectivity, Database Migrations, Deferred Checks, Health and Readiness Runbook, Job Queue, Outbox Lag, Probe Failure, Public Endpoints (+1 more)

### Community 123 - "outbox-persistence.ts"
Cohesion: 0.15
Nodes (10): append(), ClaimedOutboxEvent, ClaimOutboxBatchOptions, DispatchOutboxBatchResult, DispatchOutboxBatchService, errorType(), OutboxDispatchRepository, event() (+2 more)

### Community 124 - "admin-event-scenario-management-persistence.ts"
Cohesion: 0.09
Nodes (22): appendScenarioAudit(), bumpEventVersion(), EdgeRow, EventGate, EventGateRow, findEventVersion(), insertGraph(), lockDraftEvent() (+14 more)

### Community 125 - "user-classification-persistence.ts"
Cohesion: 0.06
Nodes (32): execute(), ActiveUserCategoryAssignment, ActiveUserStatusAssignment, AddUserCategoryService, appendClassificationAudit(), classificationEvent(), RemoveUserCategoryService, RemoveUserStatusService (+24 more)

### Community 126 - "20260723223000_admin_rbac.sql"
Cohesion: 0.33
Nodes (9): audit_log_prevent_delete, audit_log_prevent_update, public.admin_accounts, public.admin_permissions, public.admin_role_grants, public.admin_role_permissions, public.admin_roles, public.audit_log (+1 more)

### Community 127 - "20260728200000_user_statuses_categories.sql"
Cohesion: 0.31
Nodes (9): protect_user_category_assignment, protect_user_category_catalog, protect_user_status_assignment, protect_user_status_catalog, public.protect_user_classification_assignment(), public.protect_user_classification_catalog(), public.user_categories, public.user_status_assignments (+1 more)

### Community 128 - "T-Bank Payments Runbook"
Cohesion: 0.22
Nodes (8): Enablement, Expected Flow, Failure And Recovery, Full Refund Flow, Purpose, Read-Only Verification, Rollback, T-Bank Payments Runbook

### Community 129 - "NotificationSender"
Cohesion: 0.33
Nodes (3): NotificationSender, RecordingSender, TextNotificationSender

### Community 130 - "admin-events-api.test.ts"
Cohesion: 0.17
Nodes (7): contentBlockPayload, eventPayload, offerPayload, pricingPayload, productPayload, readiness, scenarioPayload

### Community 131 - "tbank-refund-persistence.test.ts"
Cohesion: 0.13
Nodes (5): expiredOrderRow, FakeConnection, FakePool, RecordedQuery, walletHoldRow

### Community 132 - "generate-pgboss-migration.mjs"
Cohesion: 0.22
Nodes (8): deadLetterQueueSql, dispatchQueueSql, migration, migrationPath, pgBossEntryPath, projectRoot, requireFromWorker, schemaSql

### Community 133 - "api/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, emitDecoratorMetadata, experimentalDecorators, extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 134 - "ADR 0004: pg-boss Schema Management"
Cohesion: 0.25
Nodes (7): ADR 0004: pg-boss Schema Management, Compatibility, Context, Decision, Rollback, Status, Verification

### Community 135 - "Локальные демонстрационные данные"
Cohesion: 0.25
Nodes (7): Запуск, Локальные демонстрационные данные, Назначение, Оплата, Повторный запуск, Подготовка администратора, Публикация демо-мероприятия

### Community 136 - "Manual Payment Confirmation Runbook"
Cohesion: 0.25
Nodes (7): Failure And Recovery, Manual Payment Confirmation Runbook, Preconditions, Purpose, Read-Only Verification, Request, Rollback

### Community 138 - "admin-event-content-management-persistence.test.ts"
Cohesion: 0.13
Nodes (3): FakeConnection, FakePool, RecordedQuery

### Community 139 - "tsconfig.json"
Cohesion: 0.25
Nodes (7): packages/database/scripts/**/*.ts, scripts/**/*.ts, compilerOptions, noEmit, extends, include, ./tsconfig.base.json

### Community 140 - "check-migrations.mjs"
Cohesion: 0.25
Nodes (5): approvedVendorDestructiveStatements, destructivePatterns, files, migrationDir, violations

### Community 141 - "20260721160000_foundation_identity_audit_outbox.sql"
Cohesion: 0.36
Nodes (7): public.audit_log, public.messenger_identities, public.messenger_username_history, public.outbox_events, public.user_touchpoints, public.users, public.worker_heartbeats

### Community 142 - "20260726160000_scenario_runtime.sql"
Cohesion: 0.39
Nodes (7): public.prevent_scenario_event_mutation(), public.protect_scenario_session_identity(), public.scenario_events, public.scenario_sessions, scenario_events_prevent_delete, scenario_events_prevent_update, scenario_sessions_protect_identity

### Community 143 - "ADR 0008: Idempotent Telegram Notification Delivery"
Cohesion: 0.29
Nodes (6): ADR 0008: Idempotent Telegram Notification Delivery, Compatibility And Rollback, Consequences, Context, Decision, Status

### Community 144 - "ADR 0009: T-Bank Payment Initialization And Webhooks"
Cohesion: 0.29
Nodes (6): ADR 0009: T-Bank Payment Initialization And Webhooks, Compatibility And Rollback, Consequences, Context, Decision, Status

### Community 145 - "ADR 0010: T-Bank Payment Reconciliation"
Cohesion: 0.29
Nodes (6): ADR 0010: T-Bank Payment Reconciliation, Compatibility And Rollback, Consequences, Context, Decision, Status

### Community 146 - "ADR 0011: Safe Full T-Bank Refunds"
Cohesion: 0.29
Nodes (6): ADR 0011: Safe Full T-Bank Refunds, Compatibility And Rollback, Consequences, Context, Decision, Status

### Community 147 - "ADR 0012: Read-Only Administrator Projections"
Cohesion: 0.29
Nodes (6): ADR 0012: Read-Only Administrator Projections, Compatibility And Rollback, Consequences, Context, Decision, Status

### Community 148 - "ADR 0013: Read-Only Administrator Event Catalog"
Cohesion: 0.29
Nodes (6): ADR 0013: Read-Only Administrator Event Catalog, Compatibility And Rollback, Consequences, Context, Decision, Status

### Community 149 - "ADR 0014: Audited Administrator Event Draft Management"
Cohesion: 0.29
Nodes (6): ADR 0014: Audited Administrator Event Draft Management, Compatibility And Rollback, Consequences, Context, Decision, Status

### Community 150 - "ADR 0015: Draft Product And Simple Pricing Management"
Cohesion: 0.29
Nodes (6): ADR 0015: Draft Product And Simple Pricing Management, Compatibility And Rollback, Consequences, Context, Decision, Status

### Community 151 - "ADR 0016: Draft Event Content Management"
Cohesion: 0.29
Nodes (6): ADR 0016: Draft Event Content Management, Compatibility And Rollback, Consequences, Context, Decision, Status

### Community 152 - "ADR 0017: Administrator Immutable Offer Management"
Cohesion: 0.29
Nodes (6): ADR 0017: Administrator Immutable Offer Management, Compatibility And Rollback, Consequences, Context, Decision, Status

### Community 153 - "ADR 0018: Версионируемые сценарии мероприятия"
Cohesion: 0.29
Nodes (6): ADR 0018: Версионируемые сценарии мероприятия, Контекст, Последствия, Решение, Совместимость и откат, Статус

### Community 154 - "ADR 0019: Закрепленные пользовательские сессии сценария"
Cohesion: 0.29
Nodes (6): ADR 0019: Закрепленные пользовательские сессии сценария, Контекст, Последствия, Решение, Совместимость и откат, Статус

### Community 155 - "ADR 0020: Валидированный ввод в сценарии"
Cohesion: 0.29
Nodes (6): ADR 0020: Валидированный ввод в сценарии, Контекст, Последствия, Решение, Совместимость и откат, Статус

### Community 156 - "ADR 0021: Создание заказа из закрепленного сценария"
Cohesion: 0.29
Nodes (6): ADR 0021: Создание заказа из закрепленного сценария, Контекст, Откат, Последствия, Решение, Статус

### Community 157 - "ADR 0022: Продолжение сценария после подтвержденной оплаты"
Cohesion: 0.29
Nodes (6): ADR 0022: Продолжение сценария после подтвержденной оплаты, Контекст, Откат, Последствия, Решение, Статус

### Community 158 - "ADR 0023: Атомарная публикация подготовленного мероприятия"
Cohesion: 0.29
Nodes (6): ADR 0023: Атомарная публикация подготовленного мероприятия, Контекст, Откат, Последствия, Решение, Статус

### Community 159 - "ADR 0024: Обязательный TOTP MFA для веб-админки"
Cohesion: 0.29
Nodes (6): ADR 0024: Обязательный TOTP MFA для веб-админки, Контекст, Откат, Последствия, Решение, Статус

### Community 160 - "ADR 0025: Защищенный запуск прикладных миграций"
Cohesion: 0.29
Nodes (6): ADR 0025: Защищенный запуск прикладных миграций, Контекст, Откат, Последствия, Решение, Статус

### Community 161 - "ADR 0026: Защищенное демонстрационное наполнение local/test"
Cohesion: 0.29
Nodes (6): ADR 0026: Защищенное демонстрационное наполнение local/test, Контекст, Откат, Последствия, Решение, Статус

### Community 162 - "ADR 0027: Внутреннее подтверждение заказа с нулевой внешней суммой"
Cohesion: 0.29
Nodes (6): ADR 0027: Внутреннее подтверждение заказа с нулевой внешней суммой, Контекст, Откат, Последствия, Решение, Статус

### Community 163 - "ADR 0028: Идемпотентное начисление баланса из сценария"
Cohesion: 0.29
Nodes (6): ADR 0028: Идемпотентное начисление баланса из сценария, Контекст, Откат, Последствия, Решение, Статус

### Community 164 - "Прикладные миграции PostgreSQL"
Cohesion: 0.29
Nodes (6): Production, Локальная база, Остановки и восстановление, Перед запуском, Прикладные миграции PostgreSQL, Тестовый стенд

### Community 165 - "Telegram Notification Delivery Runbook"
Cohesion: 0.29
Nodes (6): Enablement, Recovery, Rollback, Signals, Telegram Notification Delivery Runbook, Validation

### Community 166 - "Пользовательский runtime сценария"
Cohesion: 0.29
Nodes (6): Диагностика, Нормальное поведение, Область, Откат приложения, Перед включением, Пользовательский runtime сценария

### Community 167 - "Статусы и категории пользователей"
Cohesion: 0.29
Nodes (6): Payload узлов, Диагностика, Нормальное поведение, Ограничения текущего этапа, Перед включением, Статусы и категории пользователей

### Community 168 - "scripts/tsconfig.json"
Cohesion: 0.29
Nodes (6): compilerOptions, noEmit, extends, include, ./*.ts, ../../../tsconfig.base.json

### Community 169 - "20260724170000_payment_confirmation_tickets.sql"
Cohesion: 0.43
Nodes (6): manual_payments_append_only, payment_attempts_protect_evidence, public.manual_payments, public.payment_attempts, public.prevent_manual_payment_mutation(), public.protect_payment_attempt_record()

### Community 170 - "20260725160000_tbank_full_refunds.sql"
Cohesion: 0.43
Nodes (6): payment_refund_events_append_only, payment_refund_requests_protect_evidence, public.payment_refund_events, public.payment_refund_requests, public.prevent_payment_refund_event_mutation(), public.protect_payment_refund_request()

### Community 171 - ".next/**"
Cohesion: 0.33
Nodes (3): nextConfig, metadata, .next/**

### Community 172 - "ADR 0003: Wallet Ledger"
Cohesion: 0.33
Nodes (5): ADR 0003: Wallet Ledger, Compatibility And Rollback, Consequences, Context, Decision

### Community 173 - "ADR 0005: Administrator Authentication and RBAC"
Cohesion: 0.33
Nodes (5): ADR 0005: Administrator Authentication and RBAC, Consequences, Context, Decision, Status

### Community 174 - "ADR 0006: CI and Ephemeral Migration Testing"
Cohesion: 0.33
Nodes (5): ADR 0006: CI and Ephemeral Migration Testing, Consequences, Context, Decision, Status

### Community 175 - "ADR 0007: Event Sales And Immutable Order Snapshots"
Cohesion: 0.33
Nodes (5): ADR 0007: Event Sales And Immutable Order Snapshots, Compatibility And Rollback, Consequences, Context, Decision

### Community 176 - "ADR 0029: Статусы и категории пользователей"
Cohesion: 0.33
Nodes (5): ADR 0029: Статусы и категории пользователей, Контекст, Миграция, Последствия, Решение

### Community 177 - "Administrator Event Draft Management Runbook"
Cohesion: 0.33
Nodes (5): Administrator Event Draft Management Runbook, Browser Boundary, Failure And Recovery, Required Controls, Scope

### Community 178 - "Administrator Event Offer Management Runbook"
Cohesion: 0.33
Nodes (5): Administrator Event Offer Management Runbook, Failure And Recovery, Publication Controls, Scope, Storage Provisioning

### Community 179 - "Управление сценариями мероприятия"
Cohesion: 0.33
Nodes (5): Миграция, Область, Ошибки, Порядок публикации, Управление сценариями мероприятия

### Community 180 - "Administrator Read Operations Runbook"
Cohesion: 0.33
Nodes (5): Administrator Read Operations Runbook, Endpoints, Failure And Recovery, Pagination, Web Administrator UI

### Community 181 - "Order Expiry Runbook"
Cohesion: 0.33
Nodes (5): Order Expiry Runbook, Read-Only Checks, Recovery, Signals, Validation

### Community 182 - "order-sales-persistence.ts"
Cohesion: 0.14
Nodes (19): OrderSalesContext, OrderSalesProduct, PersistedOrder, PersistOrderInput, PersistOrderResult, aggregateProducts(), EventContextRow, MutableProduct (+11 more)

### Community 183 - "scenario-runtime.test.ts"
Cohesion: 0.08
Nodes (18): CompleteInternalOrderCommand, ResolvedScenarioExecution, SaveScenarioExecutionInput, ScenarioInternalOrderCompleter, ScenarioOrderCreator, classificationGraph, composedOrderGraph, graph (+10 more)

### Community 184 - "ADR 0037. Асинхронная тестовая отправка рассылки"
Cohesion: 0.29
Nodes (6): ADR 0037. Асинхронная тестовая отправка рассылки, Контекст, Последствия, Решение, Совместимость, Статус

### Community 185 - "Платформа продажи билетов в Telegram"
Cohesion: 0.33
Nodes (5): Безопасность, Локальные команды, Платформа продажи билетов в Telegram, Текущий этап, Что еще не реализовано

### Community 186 - "admin-web/proxy.ts"
Cohesion: 0.60
Nodes (3): config, proxy(), refreshSupabaseSession()

### Community 187 - "telegram-bot/tsconfig.json"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 188 - "worker/tsconfig.json"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 189 - "MCP Setup"
Cohesion: 0.40
Nodes (4): Context7, Current Session, Graphify, MCP Setup

### Community 190 - "MFA администраторов"
Cohesion: 0.40
Nodes (4): MFA администраторов, Обычный вход, Сбои, Требования

### Community 192 - "application/tsconfig.json"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 193 - "config/tsconfig.json"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 194 - "contracts/tsconfig.json"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 195 - "ADR 0031: Сохранённые и версионируемые сегменты"
Cohesion: 0.33
Nodes (5): ADR 0031: Сохранённые и версионируемые сегменты, Контекст, Последствия, Решение, Совместимость

### Community 196 - "database/tsconfig.json"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 197 - "domain/tsconfig.json"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 198 - "messenger-core/tsconfig.json"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 199 - "messenger-telegram/tsconfig.json"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 200 - "observability/tsconfig.json"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 201 - "payment-tbank/tsconfig.json"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 202 - "scenario-engine/tsconfig.json"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 203 - "ticket-rendering/tsconfig.json"
Cohesion: 0.40
Nodes (4): extends, include, src/**/*.ts, ../../tsconfig.base.json

### Community 204 - "check-ci-config.mjs"
Cohesion: 0.40
Nodes (4): dependabotPath, violations, workflowDirectory, workflowFiles

### Community 206 - "20260724220000_tbank_payment_attempts_webhooks.sql"
Cohesion: 0.60
Nodes (4): payment_provider_events_append_only, public.payment_attempts, public.payment_provider_events, public.prevent_payment_provider_event_mutation()

### Community 207 - "20260725120000_tbank_payment_reconciliation.sql"
Cohesion: 0.60
Nodes (4): payment_reconciliation_events_append_only, public.payment_attempts, public.payment_reconciliation_events, public.prevent_payment_reconciliation_event_mutation()

### Community 208 - "Предварительный просмотр сегмента"
Cohesion: 0.25
Nodes (7): Диагностика, Доступ, Нормальное поведение, Ограничения, Правила выражения, Предварительный просмотр сегмента, Сохранённые версии

### Community 209 - "createTelegramBot"
Cohesion: 0.09
Nodes (10): callbackFixture(), myTicketsFixture(), ticketRedeliveryFixture(), callbackPattern, decodeScenarioCallback(), decodeUuid(), encodeScenarioCallback(), encodeUuid() (+2 more)

### Community 210 - "20260724190000_notification_delivery_ledger.sql"
Cohesion: 0.67
Nodes (3): notification_deliveries_protect_record, public.notification_deliveries, public.protect_notification_delivery_record()

### Community 211 - "20260726200000_application_migration_checksums.sql"
Cohesion: 0.67
Nodes (3): application_migration_checksums_append_only, public.application_migration_checksums, public.reject_application_migration_checksum_mutation()

### Community 220 - "segment-audience-snapshot-persistence.ts"
Cohesion: 0.12
Nodes (16): SegmentAudienceSnapshotRepository, snapshotReadyEvent(), AdminSegmentAudienceSnapshotStatus, AdminSegmentSampleUser, buildAdminSegmentSqlExpression(), SqlExecutor, appendAudit(), asIso() (+8 more)

### Community 221 - "admin-broadcast-persistence.test.ts"
Cohesion: 0.14
Nodes (6): audit, broadcastRow(), FakeConnection, FakePool, scheduledAt, scheduledBroadcastRow()

### Community 222 - "admin-segments-persistence.ts"
Cohesion: 0.27
Nodes (9): assertKnownTokens(), BROADCAST_PERSONALIZATION_TOKENS, InvalidBroadcastPersonalizationError, normalizeBroadcastPersonalization(), profileValue(), renderBroadcastContent(), telegramUsername(), AdminBroadcastPersonalization (+1 more)

### Community 224 - "offer-acceptance-persistence.test.ts"
Cohesion: 0.14
Nodes (3): FakeConnection, FakePool, RecordedQuery

### Community 225 - "ADR 0030: Предварительный просмотр сегмента классификации"
Cohesion: 0.33
Nodes (5): ADR 0030: Предварительный просмотр сегмента классификации, Контекст, Последствия, Решение, Совместимость

### Community 226 - "20260729160000_segment_audience_snapshots.sql"
Cohesion: 0.39
Nodes (7): public.protect_ready_segment_audience_snapshot(), public.protect_segment_audience_snapshot_member(), public.segment_audience_snapshots, public.validate_segment_audience_snapshot_version(), segment_audience_snapshot_members_protect_mutation, segment_audience_snapshots_protect_mutation, segment_audience_snapshots_validate_version

### Community 227 - "20260729120000_segment_versions.sql"
Cohesion: 0.47
Nodes (4): public.segment_versions, public.segments, public.validate_segment_published_version(), segments_validate_published_version

### Community 228 - "notification-delivery-persistence.test.ts"
Cohesion: 0.09
Nodes (16): AdminPurchaseContext, ClaimNotificationDeliveryInput, ClaimNotificationDeliveryResult, ScenarioDeliveryContext, AdminPurchaseContextRow, DeliveryStateRow, PostgresNotificationContextRepository, PostgresNotificationDeliveryLedger (+8 more)

### Community 229 - ".register"
Cohesion: 0.13
Nodes (10): AdminAuthorizationModule, Module, AdminBroadcastsApiModule, Module, AdminEventsApiModule, Module, AdminSegmentsApiModule, Module (+2 more)

### Community 230 - "ADR 0032: Неизменяемые снимки аудитории сегмента"
Cohesion: 0.33
Nodes (5): ADR 0032: Неизменяемые снимки аудитории сегмента, Контекст, Последствия, Решение, Совместимость

### Community 231 - "tbank-payment-persistence.test.ts"
Cohesion: 0.11
Nodes (9): FakeConnection, FakePool, idGenerator, orderRow, pendingAttemptRow, RecordedQuery, requestedAt, webhookAttempt (+1 more)

### Community 233 - "Снимки аудитории сегмента"
Cohesion: 0.33
Nodes (5): Диагностика, Доступ, Ограничения, Снимки аудитории сегмента, Состояния

### Community 234 - "20260729200000_broadcast_versions.sql"
Cohesion: 0.36
Nodes (8): broadcast_versions_protect_mutation, broadcast_versions_validate_audience, broadcasts_validate_published_version, public.broadcast_versions, public.broadcasts, public.protect_broadcast_version_identity_and_publication(), public.validate_broadcast_audience_snapshot(), public.validate_broadcast_published_version()

### Community 235 - "MemoryLedger"
Cohesion: 0.15
Nodes (3): audit, FakeConnection, FakePool

### Community 236 - "Черновики и версии рассылок"
Cohesion: 0.25
Nodes (7): Диагностика, Доступ, Ограничения содержимого, Подготовка, Текущие границы, Тестовая отправка, Черновики и версии рассылок

### Community 237 - "admin-user-import-persistence.test.ts"
Cohesion: 0.29
Nodes (6): ADR 0041. Неизменяемый анализ совпадений импорта пользователей, Контекст, Последствия, Решение, Совместимость, Статус

### Community 238 - "admin-user-classification.test.ts"
Cohesion: 0.07
Nodes (49): AdminUserClassificationHandlers, AdminBroadcastControlServiceInput, ContentBlockCommand, AdminEventMutationMetadata, AdminUserClassificationCodeConflictError, AdminUserClassificationVersionConflictError, AssignAdminUserCategoryService, AssignAdminUserStatusService (+41 more)

### Community 239 - "ADR 0033: Версии рассылки с зафиксированной аудиторией"
Cohesion: 0.33
Nodes (5): ADR 0033: Версии рассылки с зафиксированной аудиторией, Контекст, Последствия, Решение, Совместимость

### Community 240 - "ADR 0035. Арендованная доставка рассылок в Telegram"
Cohesion: 0.33
Nodes (5): ADR 0035. Арендованная доставка рассылок в Telegram, Контекст, Последствия, Решение, Статус

### Community 241 - "Отправка рассылок в Telegram"
Cohesion: 0.22
Nodes (8): Включение, Диагностика, Отправка рассылок в Telegram, Персонализация, Ручное управление, Состояния доставки, Тестовые доставки, Фото

### Community 243 - "admin-events-persistence.test.ts"
Cohesion: 0.12
Nodes (11): at, contentRow, eventRow, FakePool, offerRow, pricingRow, productRow, RecordedQuery (+3 more)

### Community 244 - "IdGenerator"
Cohesion: 0.06
Nodes (28): BeginIdempotentOperationInput, HandleTelegramStartService, IdempotencyRepository, IdGenerator, MessengerIdentityRecord, OutboxWriter, RecordTouchpointInput, UnitOfWork (+20 more)

### Community 245 - "admin-user-classification-persistence.ts"
Cohesion: 0.15
Nodes (4): assignedAt, FakeConnection, FakePool, RecordedQuery

### Community 246 - "admin-user-imports.test.ts"
Cohesion: 0.18
Nodes (9): InvalidAdminUserImportError, actor, base64(), batchFrom(), command(), create(), ids(), metadata (+1 more)

### Community 247 - "20260731000000_broadcast_personalization_v2.sql"
Cohesion: 0.22
Nodes (5): broadcast_deliveries_capture_personalization, public.broadcast_deliveries, public.broadcast_test_deliveries, public.broadcast_versions, public.capture_broadcast_delivery_personalization()

### Community 248 - "20260730120000_broadcast_scheduling_delivery_ledger.sql"
Cohesion: 0.33
Nodes (8): broadcast_deliveries_protect_record, broadcasts_protect_schedule, broadcasts_validate_schedule, public.broadcast_deliveries, public.broadcasts, public.protect_broadcast_delivery(), public.protect_broadcast_schedule(), public.validate_broadcast_schedule()

### Community 249 - "AdminApiError"
Cohesion: 0.11
Nodes (28): EventCatalogPage(), EventContentPage(), EditEventPage(), EventOfferPage(), contentPreview(), EventDetailPage(), shortId(), EventScenarioPage() (+20 more)

### Community 251 - "CreateOrderCommand"
Cohesion: 0.17
Nodes (4): capturedAt, expression, FakeConnection, FakePool

### Community 252 - "ADR 0034: Планирование и подготовка журнала рассылки"
Cohesion: 0.33
Nodes (5): ADR 0034: Планирование и подготовка журнала рассылки, Контекст, Последствия, Решение, Совместимость

### Community 253 - "Планирование и подготовка рассылки"
Cohesion: 0.33
Nodes (5): Диагностика, Доступ, Планирование и подготовка рассылки, Подготовка worker, Условия планирования

### Community 254 - "ADR 0038. Версионированная персонализация рассылок"
Cohesion: 0.29
Nodes (6): ADR 0038. Версионированная персонализация рассылок, Контекст, Последствия, Решение, Совместимость, Статус

### Community 255 - "event-general-form.tsx"
Cohesion: 0.33
Nodes (6): EventGeneralForm(), nullableValue(), numberValue(), readGeneralInput(), requiredValue(), stringValue()

### Community 256 - "SqlConnectionPool"
Cohesion: 0.25
Nodes (4): AdminUserImportMatchContext, AdminUserImportMatchingRepository, AdminUserImportMatchAnalysis, PostgresAdminUserImportMatchingRepository

### Community 257 - "event-publication-panel.tsx"
Cohesion: 0.47
Nodes (4): EventPublicationPanel(), eventPublicationRequirements(), isKopeckAmount(), PublicationRequirement

### Community 258 - "ADR 0039. Фото в версиях рассылок"
Cohesion: 0.29
Nodes (6): ADR 0039. Фото в версиях рассылок, Контекст, Последствия, Решение, Совместимость, Статус

### Community 259 - "user-import-preview.tsx"
Cohesion: 0.24
Nodes (6): ImportRow(), issueLabel(), matchKindLabel(), shortId(), statusLabel(), UserImportPreview()

### Community 260 - "ADR 0036. Аудируемое ручное управление рассылкой"
Cohesion: 0.33
Nodes (5): ADR 0036. Аудируемое ручное управление рассылкой, Контекст, Последствия, Решение, Статус

### Community 261 - "order-sales-persistence.test.ts"
Cohesion: 0.15
Nodes (5): eventContextRow, FakePool, productPricingRow, RecordedQuery, referenceGenerator

### Community 262 - "admin-segments-api.ts"
Cohesion: 0.26
Nodes (16): RequireAdminPermission(), AdminSegmentsController, execute(), invalidSavedSegment(), invalidSnapshot(), mapSavedSegmentError(), mutationMetadata(), requireActor() (+8 more)

### Community 265 - "health-persistence.test.ts"
Cohesion: 0.23
Nodes (10): createPostgresHealthProbes(), degraded(), failed(), healthy(), PostgresHealthProbeOptions, probe(), query(), quotePostgresIdentifier() (+2 more)

### Community 267 - "ADR 0040. Staging CSV-импорта пользователей"
Cohesion: 0.29
Nodes (6): ADR 0040. Staging CSV-импорта пользователей, Контекст, Последствия, Решение, Совместимость, Статус

### Community 268 - "Предпросмотр CSV-импорта пользователей"
Cohesion: 0.25
Nodes (7): Доступ, Идемпотентность, Предпросмотр и сопоставление CSV-импорта пользователей, Статусы staging, Статусы сопоставления, Формат, Хранение и диагностика

### Community 269 - "tbank-refunds.test.ts"
Cohesion: 0.10
Nodes (8): readiness(), testApplication(), readiness, createApiApplication(), applicationWithStatus(), testApplication(), verifiedEvent, webhookBody

### Community 270 - "admin-broadcasts-api.test.ts"
Cohesion: 0.33
Nodes (3): readiness, savedSegment, snapshotSummary

### Community 271 - "admin-imports.ts"
Cohesion: 0.09
Nodes (25): AdminUserImportBatchNotFoundError, AdminUserImportMatchSourceRow, AnalyzeAdminUserImportService, bounded(), classifyAdminUserImportRows(), classifyRow(), combineCandidateProfiles(), conflict() (+17 more)

### Community 272 - "20260731100000_user_import_staging.sql"
Cohesion: 0.53
Nodes (5): public.user_import_batches, public.user_import_rows, public.user_import_staging_append_only(), user_import_batches_append_only, user_import_rows_append_only

### Community 276 - "segment-audience-snapshots.ts"
Cohesion: 0.13
Nodes (6): RequestAdminSegmentAudienceSnapshotService, actor, expression, metadata, pending, summary

### Community 277 - ".deliverOnce"
Cohesion: 0.29
Nodes (3): errorCode(), NotificationDeliveryLedger, MemoryLedger

## Knowledge Gaps
- **1332 isolated node(s):** `nextConfig`, `name`, `version`, `private`, `type` (+1327 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **17 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `SqlConnection` connect `SqlConnection` to `SqlConnectionPool`, `SqlQueryResult`, `HealthController`, `tbank-refund-persistence.test.ts`, `order-sales-persistence.test.ts`, `health-persistence.test.ts`, `admin-event-content-management-persistence.test.ts`, `admin-event-catalog-management-persistence.ts`, `broadcast-delivery-persistence.ts`, `admin-event-management-persistence.ts`, `broadcast-test-delivery-persistence.ts`, `api/src/main.ts`, `admin-saved-segments-persistence.ts`, `payment-confirmation-persistence.test.ts`, `scenario-runtime-persistence.test.ts`, `admin-events-persistence.ts`, `database/src/index.ts`, `admin-operations-persistence.test.ts`, `admin-event-content-management-persistence.ts`, `segment-audience-snapshot-persistence.ts`, `postgres.ts`, `admin-broadcast-persistence.test.ts`, `notification-delivery-persistence.ts`, `admin-event-offer-management-persistence.test.ts`, `admin-event-catalog-management-persistence.test.ts`, `offer-acceptance-persistence.test.ts`, `notification-delivery-persistence.test.ts`, `admin-broadcasts.test.ts`, `tbank-payment-persistence.test.ts`, `event-offer-editor.tsx`, `MemoryLedger`, `admin-user-import-persistence.ts`, `phone-persistence.test.ts`, `admin-events-persistence.test.ts`, `admin-user-classification-persistence.ts`, `CreateOrderCommand`, `admin-event-scenario-management-persistence.ts`?**
  _High betweenness centrality (0.063) - this node is a cross-community bridge._
- **Why does `IdGenerator` connect `IdGenerator` to `tbank-refund-persistence.test.ts`, `scenario-runtime.ts`, `admin-saved-segments.ts`, `tbank-payments.ts`, `broadcast-test-delivery.ts`, `admin-broadcast-persistence.ts`, `order-sales-persistence.test.ts`, `.query`, `admin-event-content-management-persistence.test.ts`, `admin-imports.ts`, `segment-audience-snapshots.ts`, `admin-event-catalog-management.ts`, `scenario-runtime-persistence.ts`, `broadcast-delivery-persistence.ts`, `admin-event-offer-management.ts`, `admin-event-scenario-management.ts`, `payment-confirmation.ts`, `api/src/main.ts`, `phone-persistence.ts`, `admin-event-management.ts`, `domain/src/index.ts`, `admin-event-content-management.ts`, `order-expiry.ts`, `admin-user-imports.ts`, `offer-acceptance.ts`, `order-sales-persistence.ts`, `payment-confirmation-persistence.test.ts`, `tbank-refunds.ts`, `TransactionSession`, `admin-user-classification-api.ts`, `application/src/orders.ts`, `tbank-reconciliation.ts`, `DomainEvent`, `admin-bootstrap.ts`, `.deliverTickets`, `admin-saved-segments.test.ts`, `application/src/admin-broadcasts.ts`, `postgres.ts`, `notification-delivery.ts`, `offer-acceptance-persistence.test.ts`, `worker/src/main.ts`, `tbank-payment-persistence.test.ts`, `admin-user-classification.test.ts`, `user-classification-persistence.ts`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **Why does `SqlConnectionPool` connect `postgres.ts` to `SqlConnectionPool`, `SqlQueryResult`, `HealthController`, `tbank-refund-persistence.test.ts`, `order-sales-persistence.test.ts`, `health-persistence.test.ts`, `admin-event-content-management-persistence.test.ts`, `scenario-runtime-persistence.ts`, `admin-event-catalog-management-persistence.ts`, `broadcast-delivery-persistence.ts`, `admin-event-management-persistence.ts`, `broadcast-test-delivery-persistence.ts`, `api/src/main.ts`, `SqlConnection`, `admin-saved-segments-persistence.ts`, `order-sales-persistence.ts`, `TransactionSession`, `payment-confirmation-persistence.test.ts`, `scenario-runtime-persistence.test.ts`, `admin-events-persistence.ts`, `database/src/index.ts`, `admin-user-classification-api.ts`, `admin-operations-persistence.test.ts`, `admin-bootstrap.ts`, `admin-event-content-management-persistence.ts`, `segment-audience-snapshot-persistence.ts`, `admin-broadcast-persistence.test.ts`, `admin-event-catalog-management-persistence.test.ts`, `notification-delivery-persistence.ts`, `admin-event-offer-management-persistence.test.ts`, `offer-acceptance-persistence.test.ts`, `notification-delivery-persistence.test.ts`, `admin-broadcasts.test.ts`, `tbank-payment-persistence.test.ts`, `event-offer-editor.tsx`, `MemoryLedger`, `admin-user-import-persistence.ts`, `phone-persistence.test.ts`, `admin-events-persistence.test.ts`, `admin-user-classification-persistence.ts`, `CreateOrderCommand`, `admin-event-scenario-management-persistence.ts`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **What connects `nextConfig`, `name`, `version` to the rest of the system?**
  _1332 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `controller.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0648018648018648 - nodes in this community are weakly interconnected._
- **Should `SqlQueryResult` be split into smaller, more focused modules?**
  _Cohesion score 0.02111473373699736 - nodes in this community are weakly interconnected._
- **Should `api/src/admin-auth.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07180851063829788 - nodes in this community are weakly interconnected._