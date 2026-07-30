import { randomUUID } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import {
  AcceptTelegramOfferService,
  AdvanceTelegramScenarioService,
  AuthorizeAdminRequestService,
  CompleteInternalOrderService,
  ConfirmPaymentService,
  CreditScenarioWalletService,
  AssignAdminUserCategoryService,
  AssignAdminUserStatusService,
  CreateAdminUserCategoryService,
  CreateAdminUserStatusService,
  CreateAdminEventContentBlockService,
  CreateAdminEventPricingRuleService,
  CreateAdminEventProductService,
  CreateAdminEventDraftService,
  CreateOrderService,
  DeactivateAdminEventOfferService,
  GetAdminEventService,
  GetReadinessService,
  GetAdminOrderService,
  GetAdminUserService,
  HandleTelegramContactService,
  HandleTelegramStartService,
  HmacOrderReferenceGenerator,
  HmacTicketReferenceGenerator,
  HandleTBankRefundWebhookService,
  HandleTBankPaymentWebhookService,
  InitializeTelegramTBankPaymentService,
  ListTelegramTicketsService,
  ListAdminOrdersService,
  ListAdminEventsService,
  ListAdminUsersService,
  ListAdminUserClassificationService,
  ListAdminSavedSegmentsService,
  GetAdminSavedSegmentService,
  CreateAdminSavedSegmentService,
  UpdateAdminSavedSegmentDraftService,
  PublishAdminSavedSegmentService,
  ListAdminSegmentAudienceSnapshotsService,
  GetAdminSegmentAudienceSnapshotService,
  RequestAdminSegmentAudienceSnapshotService,
  ListAdminBroadcastsService,
  GetAdminBroadcastService,
  AnalyzeAdminUserImportService,
  DecideAdminUserImportRowService,
  ListAdminUserImportRowsService,
  PreviewAdminUserImportService,
  CreateAdminBroadcastService,
  UpdateAdminBroadcastDraftService,
  PublishAdminBroadcastDraftService,
    ScheduleAdminBroadcastService,
    PauseAdminBroadcastService,
    ResumeAdminBroadcastService,
    CancelAdminBroadcastService,
    RequestAdminBroadcastTestSendService,
  PreviewAdminSegmentService,
  PublishAdminEventOfferVersionService,
  PublishAdminEventService,
  PublishAdminEventScenarioVersionService,
  RequestTelegramTicketRedeliveryService,
  ResumeTelegramScenarioAfterOfferService,
  RequestFullTBankRefundService,
  RemoveAdminUserCategoryService,
  RemoveAdminUserStatusService,
  RemoveUserCategoryService,
  RemoveUserStatusService,
  SaveAdminEventScenarioDraftService,
  SelectTelegramEventService,
  SetUserStatusService,
  StartTelegramScenarioService,
  SubmitTelegramScenarioInputService,
  AddUserCategoryService,
  UpdateAdminEventGeneralService,
  UpdateAdminEventContentBlockService,
  UpdateAdminEventPricingRuleService,
  UpdateAdminEventProductService,
  UpdateAdminUserCategoryService,
  UpdateAdminUserStatusService,
  type IdGenerator
} from "@ticket-platform/application";
import { loadApiConfig } from "@ticket-platform/config";
import {
  createOfferAcceptancePersistence,
  createAdminEventContentManagementPersistence,
  createAdminEventManagementPersistence,
  createAdminEventOfferManagementPersistence,
  createAdminEventScenarioManagementPersistence,
  createAdminEventCatalogManagementPersistence,
  createAdminEventsPersistence,
  createAdminOperationsPersistence,
  createAdminUserClassificationPersistence,
  createAdminSegmentPreviewPersistence,
  createAdminSavedSegmentPersistence,
  createSegmentAudienceSnapshotPersistence,
  createAdminBroadcastPersistence,
  createBroadcastTestDeliveryPersistence,
  createAdminUserImportMatchingPersistence,
  createAdminUserImportDecisionPersistence,
  createAdminUserImportPreviewPersistence,
  createNodePostgresPool,
  createPostgresHealthProbes,
  createPhonePersistence,
  createScenarioRuntimePersistence,
  createPaymentConfirmationPersistence,
  createOrderSalesPersistence,
  createTelegramTicketAccessPersistence,
  createTelegramStartPersistence,
  createTBankPaymentPersistence,
  createTBankRefundPersistence,
  migrations,
  PostgresAdminPrincipalRepository,
  type ManagedSqlConnectionPool
} from "@ticket-platform/database";
import { LibPhoneNumberNormalizer } from "@ticket-platform/messenger-core";
import {
  createTelegramBot,
  TelegramUpdateController,
  type TelegramUpdateProcessor
} from "@ticket-platform/messenger-telegram";
import { createLogger } from "@ticket-platform/observability";
import { TBankPaymentProvider } from "@ticket-platform/payment-tbank";
import { createApiApplication } from "./app.js";
import { SupabaseAdminAccessTokenVerifier } from "./supabase-admin-token-verifier.js";
import {
  DisabledOfferSnapshotStorage,
  SupabaseOfferSnapshotStorage
} from "./supabase-offer-storage.js";

export async function bootstrapApi(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const config = loadApiConfig(env);
  const logger = createLogger({ service: "api", environment: config.appEnv });
  let pool: ManagedSqlConnectionPool | undefined;

  let app: Awaited<ReturnType<typeof createApiApplication>> | undefined;

  try {
    let processor: TelegramUpdateProcessor | undefined;

    pool = createNodePostgresPool({
      connectionString: config.databaseUrl,
      maxConnections: config.databasePoolMax,
      applicationName: "ticket-platform-api",
      onIdleClientError(error) {
        logger.error("postgres idle client failed", { errorType: error.name });
      }
    });
    const expectedMigrationVersion = getExpectedMigrationVersion();
    const idGenerator: IdGenerator = { newId: uuidv7 };
    const readiness = new GetReadinessService(
      "api",
      config.appVersion,
      createPostgresHealthProbes(pool, {
        expectedMigrationVersion,
        pgBossSchema: config.pgBossSchema,
        expectedPgBossVersion: 37,
        workerHeartbeatDegradedSeconds: config.workerHeartbeatDegradedSeconds,
        workerHeartbeatFailedSeconds: config.workerHeartbeatFailedSeconds,
        outboxLagDegradedSeconds: config.outboxLagDegradedSeconds,
        outboxLagFailedSeconds: config.outboxLagFailedSeconds
      })
    );
    const adminAuth = config.adminAuth.enabled
      ? {
          tokenVerifier: new SupabaseAdminAccessTokenVerifier({
            issuer: config.adminAuth.issuer,
            audience: config.adminAuth.audience
          }),
          authorizer: new AuthorizeAdminRequestService(
            new PostgresAdminPrincipalRepository(pool)
          )
        }
      : undefined;
    const adminOperations = adminAuth
      ? (() => {
          const repository = createAdminOperationsPersistence(pool);
          return {
            listUsers: new ListAdminUsersService(repository),
            getUser: new GetAdminUserService(repository),
            listOrders: new ListAdminOrdersService(repository),
            getOrder: new GetAdminOrderService(repository)
          };
        })()
      : undefined;
    const adminUserClassification = adminAuth
      ? (() => {
          const repository = createAdminUserClassificationPersistence(pool);
          const assignments = createScenarioRuntimePersistence(
            pool,
            idGenerator
          );
          const setStatus = new SetUserStatusService(
            assignments.userClassificationRepository,
            assignments.outboxWriter,
            assignments.unitOfWork,
            idGenerator,
            assignments.userClassificationAuditWriter
          );
          const addCategory = new AddUserCategoryService(
            assignments.userClassificationRepository,
            assignments.outboxWriter,
            assignments.unitOfWork,
            idGenerator,
            assignments.userClassificationAuditWriter
          );
          const removeStatus = new RemoveUserStatusService(
            assignments.userClassificationRepository,
            assignments.outboxWriter,
            assignments.unitOfWork,
            idGenerator,
            assignments.userClassificationAuditWriter
          );
          const removeCategory = new RemoveUserCategoryService(
            assignments.userClassificationRepository,
            assignments.outboxWriter,
            assignments.unitOfWork,
            idGenerator,
            assignments.userClassificationAuditWriter
          );
          return {
            list: new ListAdminUserClassificationService(repository),
            createStatus: new CreateAdminUserStatusService(
              repository,
              idGenerator
            ),
            updateStatus: new UpdateAdminUserStatusService(
              repository,
              idGenerator
            ),
            createCategory: new CreateAdminUserCategoryService(
              repository,
              idGenerator
            ),
            updateCategory: new UpdateAdminUserCategoryService(
              repository,
              idGenerator
            ),
            assignStatus: new AssignAdminUserStatusService(
              setStatus,
              idGenerator
            ),
            assignCategory: new AssignAdminUserCategoryService(
              addCategory,
              idGenerator
            ),
            removeStatus: new RemoveAdminUserStatusService(
              removeStatus,
              idGenerator
            ),
            removeCategory: new RemoveAdminUserCategoryService(
              removeCategory,
              idGenerator
            )
          };
        })()
      : undefined;
    const adminSegments = adminAuth
      ? (() => {
          const saved = createAdminSavedSegmentPersistence(pool);
          const snapshots = createSegmentAudienceSnapshotPersistence(pool);
          return {
            preview: new PreviewAdminSegmentService(
              createAdminSegmentPreviewPersistence(pool)
            ),
            list: new ListAdminSavedSegmentsService(saved),
            get: new GetAdminSavedSegmentService(saved),
            create: new CreateAdminSavedSegmentService(saved, idGenerator),
            updateDraft: new UpdateAdminSavedSegmentDraftService(
              saved,
              idGenerator
            ),
            publish: new PublishAdminSavedSegmentService(saved, idGenerator),
            listSnapshots: new ListAdminSegmentAudienceSnapshotsService(
              snapshots.repository
            ),
            getSnapshot: new GetAdminSegmentAudienceSnapshotService(
              snapshots.repository
            ),
            requestSnapshot: new RequestAdminSegmentAudienceSnapshotService(
              snapshots.repository,
              idGenerator
            )
          };
        })()
      : undefined;
    const adminBroadcasts = adminAuth
      ? (() => {
          const repository = createAdminBroadcastPersistence(pool);
          const testDeliveries =
            createBroadcastTestDeliveryPersistence(pool);
          return {
            list: new ListAdminBroadcastsService(repository),
            get: new GetAdminBroadcastService(repository),
            create: new CreateAdminBroadcastService(repository, idGenerator),
            updateDraft: new UpdateAdminBroadcastDraftService(
              repository,
              idGenerator
            ),
            publish: new PublishAdminBroadcastDraftService(
              repository,
              idGenerator
            ),
             schedule: new ScheduleAdminBroadcastService(
               repository,
               idGenerator
              ),
             pause: new PauseAdminBroadcastService(repository, idGenerator),
             resume: new ResumeAdminBroadcastService(repository, idGenerator),
             cancel: new CancelAdminBroadcastService(repository, idGenerator),
             requestTestSend: new RequestAdminBroadcastTestSendService(
               testDeliveries,
               idGenerator
             )
          };
        })()
      : undefined;
    const adminImports = adminAuth
      ? (() => {
          const matching = createAdminUserImportMatchingPersistence(pool);
          return {
            previewUsers: new PreviewAdminUserImportService(
              createAdminUserImportPreviewPersistence(pool),
              new LibPhoneNumberNormalizer(
                "defaultCountry" in config.telegramWebhook
                  ? config.telegramWebhook.defaultCountry
                  : env.TELEGRAM_DEFAULT_COUNTRY ?? "RU"
              ),
              idGenerator
            ),
            analyzeUsers: new AnalyzeAdminUserImportService(
              matching,
              idGenerator
            ),
            decideUserRow: new DecideAdminUserImportRowService(
              createAdminUserImportDecisionPersistence(pool),
              idGenerator
            ),
            listUserRows: new ListAdminUserImportRowsService(
              matching
            )
          };
        })()
      : undefined;
    const adminEvents = adminAuth
      ? (() => {
          const repository = createAdminEventsPersistence(pool);
          const management = createAdminEventManagementPersistence(pool);
          const catalog = createAdminEventCatalogManagementPersistence(pool);
          const content = createAdminEventContentManagementPersistence(pool);
          const offers = createAdminEventOfferManagementPersistence(pool);
          const scenarios = createAdminEventScenarioManagementPersistence(pool);
          const offerStorage = config.offerStorage.enabled
            ? new SupabaseOfferSnapshotStorage(config.offerStorage)
            : new DisabledOfferSnapshotStorage();
          return {
            listEvents: new ListAdminEventsService(repository),
            getEvent: new GetAdminEventService(repository),
            createEvent: new CreateAdminEventDraftService(
              management,
              idGenerator
            ),
            updateEventGeneral: new UpdateAdminEventGeneralService(
              management,
              idGenerator
            ),
            publishEvent: new PublishAdminEventService(
              management,
              idGenerator
            ),
            createContentBlock: new CreateAdminEventContentBlockService(
              content,
              idGenerator
            ),
            updateContentBlock: new UpdateAdminEventContentBlockService(
              content,
              idGenerator
            ),
            publishOfferVersion: new PublishAdminEventOfferVersionService(
              offers,
              offerStorage,
              idGenerator
            ),
            deactivateOffer: new DeactivateAdminEventOfferService(
              offers,
              idGenerator
            ),
            saveScenarioDraft: new SaveAdminEventScenarioDraftService(
              scenarios,
              idGenerator
            ),
            publishScenarioVersion:
              new PublishAdminEventScenarioVersionService(
                scenarios,
                idGenerator
              ),
            createProduct: new CreateAdminEventProductService(
              catalog,
              idGenerator
            ),
            updateProduct: new UpdateAdminEventProductService(
              catalog,
              idGenerator
            ),
            createPricingRule: new CreateAdminEventPricingRuleService(
              catalog,
              idGenerator
            ),
            updatePricingRule: new UpdateAdminEventPricingRuleService(
              catalog,
              idGenerator
            )
          };
        })()
      : undefined;
    const orders = adminAuth
      ? (() => {
          const persistence = createOrderSalesPersistence(pool, idGenerator);
          return new CreateOrderService(
            persistence.orderSalesRepository,
            persistence.outboxWriter,
            persistence.unitOfWork,
            idGenerator,
            new HmacOrderReferenceGenerator(
              config.orderTokenSecret,
              config.orderNumberPrefix
            )
          );
        })()
      : undefined;
    const manualPayments = adminAuth
      ? (() => {
          const persistence = createPaymentConfirmationPersistence(pool, idGenerator);
          return new ConfirmPaymentService(
            persistence.paymentConfirmationRepository,
            persistence.outboxWriter,
            persistence.unitOfWork,
            idGenerator,
            new HmacTicketReferenceGenerator(config.orderTokenSecret)
          );
        })()
      : undefined;
    const tbank = config.tbankPayments.enabled
      ? (() => {
          const provider = new TBankPaymentProvider({
            baseUrl: config.tbankPayments.apiBaseUrl,
            terminalKey: config.tbankPayments.terminalKey,
            password: config.tbankPayments.password,
            timeoutMs: config.tbankPayments.timeoutMs
          });
          const paymentPersistence = createTBankPaymentPersistence(pool, idGenerator);
          const refundPersistence = createTBankRefundPersistence(pool);
          const confirmationPersistence = createPaymentConfirmationPersistence(
            pool,
            idGenerator
          );
          const confirmation = new ConfirmPaymentService(
            confirmationPersistence.paymentConfirmationRepository,
            confirmationPersistence.outboxWriter,
            confirmationPersistence.unitOfWork,
            idGenerator,
            new HmacTicketReferenceGenerator(config.orderTokenSecret)
          );
          const refundWebhook = new HandleTBankRefundWebhookService(
            refundPersistence,
            idGenerator
          );
          return {
            provider,
            initialization: new InitializeTelegramTBankPaymentService(
              paymentPersistence.initializationRepository,
              provider,
              {
                notificationUrl: config.tbankPayments.notificationUrl,
                successUrl: config.tbankPayments.successUrl,
                failUrl: config.tbankPayments.failUrl
              }
            ),
            webhook: new HandleTBankPaymentWebhookService(
              paymentPersistence.webhookRepository,
              confirmation,
              idGenerator,
              refundWebhook
            ),
            refunds: adminAuth
              ? new RequestFullTBankRefundService(
                  refundPersistence,
                  provider,
                  idGenerator,
                  { newId: randomUUID }
                )
              : undefined
          };
        })()
      : undefined;

    if (config.telegramWebhook.enabled) {
      const startPersistence = createTelegramStartPersistence(pool, idGenerator);
      const phonePersistence = createPhonePersistence(pool, idGenerator);
      const offerPersistence = createOfferAcceptancePersistence(pool);
      const scenarioPersistence = createScenarioRuntimePersistence(
        pool,
        idGenerator
      );
      const scenarioOrderCreator = new CreateOrderService(
        scenarioPersistence.orderSalesRepository,
        scenarioPersistence.outboxWriter,
        scenarioPersistence.unitOfWork,
        idGenerator,
        new HmacOrderReferenceGenerator(
          config.orderTokenSecret,
          config.orderNumberPrefix
        )
      );
      const internalOrderCompleter = new CompleteInternalOrderService(
        new ConfirmPaymentService(
          scenarioPersistence.paymentConfirmationRepository,
          scenarioPersistence.outboxWriter,
          scenarioPersistence.unitOfWork,
          idGenerator,
          new HmacTicketReferenceGenerator(config.orderTokenSecret)
        )
      );
      const scenarioWalletCreditor = new CreditScenarioWalletService(
        scenarioPersistence.scenarioWalletCreditRepository,
        scenarioPersistence.outboxWriter,
        scenarioPersistence.unitOfWork,
        idGenerator
      );
      const setUserStatus = new SetUserStatusService(
        scenarioPersistence.userClassificationRepository,
        scenarioPersistence.outboxWriter,
        scenarioPersistence.unitOfWork,
        idGenerator
      );
      const addUserCategory = new AddUserCategoryService(
        scenarioPersistence.userClassificationRepository,
        scenarioPersistence.outboxWriter,
        scenarioPersistence.unitOfWork,
        idGenerator
      );
      const scenarioUserClassifier = {
        setStatus: setUserStatus.execute.bind(setUserStatus),
        addCategory: addUserCategory.execute.bind(addUserCategory)
      };
      const ticketPersistence = createTelegramTicketAccessPersistence(pool);
      const startService = new HandleTelegramStartService(
        startPersistence.identityRepository,
        startPersistence.idempotencyRepository,
        startPersistence.outboxWriter,
        startPersistence.unitOfWork,
        idGenerator
      );
      const contactService = new HandleTelegramContactService(
        new LibPhoneNumberNormalizer(config.telegramWebhook.defaultCountry),
        phonePersistence.telegramUserResolver,
        phonePersistence.phoneRepository,
        phonePersistence.phoneBonusRepository,
        phonePersistence.idempotencyRepository,
        phonePersistence.outboxWriter,
        phonePersistence.unitOfWork,
        idGenerator
      );
      const offerService = new AcceptTelegramOfferService(
        offerPersistence.offerAcceptanceRepository,
        offerPersistence.outboxWriter,
        offerPersistence.unitOfWork,
        idGenerator
      );
      const ticketListService = new ListTelegramTicketsService(
        ticketPersistence.ticketAccessRepository
      );
      const ticketRedeliveryService = new RequestTelegramTicketRedeliveryService(
        ticketPersistence.ticketAccessRepository,
        ticketPersistence.idempotencyRepository,
        ticketPersistence.outboxWriter,
        ticketPersistence.unitOfWork,
        idGenerator
      );
      const scenario = {
        start: new StartTelegramScenarioService(
          scenarioPersistence.repository,
          scenarioPersistence.unitOfWork,
          idGenerator,
          undefined,
          scenarioOrderCreator,
          internalOrderCompleter,
          scenarioWalletCreditor,
          scenarioUserClassifier
        ),
        selectEvent: new SelectTelegramEventService(
          scenarioPersistence.repository,
          scenarioPersistence.unitOfWork,
          idGenerator,
          undefined,
          scenarioOrderCreator,
          internalOrderCompleter,
          scenarioWalletCreditor,
          scenarioUserClassifier
        ),
        advance: new AdvanceTelegramScenarioService(
          scenarioPersistence.repository,
          scenarioPersistence.unitOfWork,
          scenarioOrderCreator,
          internalOrderCompleter,
          scenarioWalletCreditor,
          scenarioUserClassifier
        ),
        input: new SubmitTelegramScenarioInputService(
          scenarioPersistence.repository,
          scenarioPersistence.unitOfWork,
          scenarioOrderCreator,
          internalOrderCompleter,
          scenarioWalletCreditor,
          scenarioUserClassifier
        ),
        offerAccepted: new ResumeTelegramScenarioAfterOfferService(
          scenarioPersistence.repository,
          scenarioPersistence.unitOfWork,
          scenarioOrderCreator,
          internalOrderCompleter,
          scenarioWalletCreditor,
          scenarioUserClassifier
        )
      };
      const bot = createTelegramBot(
        config.telegramWebhook.botToken,
        new TelegramUpdateController(
          startService,
          contactService,
          offerService,
          ticketListService,
          ticketRedeliveryService,
          tbank?.initialization,
          scenario,
          internalOrderCompleter
        ),
        logger,
        { rethrowUpdateErrors: true }
      );

      await pool.ping();
      await bot.init();
      processor = { handleUpdate: (update) => bot.handleUpdate(update) };
      logger.info("telegram webhook dependencies ready", { botId: String(bot.botInfo.id) });
    }

    app = await createApiApplication({
      appVersion: config.appVersion,
      bodyLimitBytes: Math.max(
        config.telegramWebhook.bodyLimitBytes,
        config.tbankPayments.bodyLimitBytes,
        750_000
      ),
      readiness,
      ...(adminAuth ? { adminAuth } : {}),
      ...(orders ? { orders } : {}),
      ...(manualPayments ? { manualPayments } : {}),
      ...(adminOperations ? { adminOperations } : {}),
      ...(adminEvents ? { adminEvents } : {}),
      ...(adminUserClassification ? { adminUserClassification } : {}),
      ...(adminSegments ? { adminSegments } : {}),
      ...(adminBroadcasts ? { adminBroadcasts } : {}),
      ...(adminImports ? { adminImports } : {}),
      ...(tbank?.refunds ? { fullRefunds: tbank.refunds } : {}),
      ...(tbank
        ? {
            tbankWebhook: {
              config: {
                bodyLimitBytes: config.tbankPayments.bodyLimitBytes
              },
              verifier: tbank.provider,
              handler: tbank.webhook
            }
          }
        : {}),
      ...(config.telegramWebhook.enabled && processor
        ? {
            webhook: {
              config: {
                pathSecret: config.telegramWebhook.pathSecret,
                headerSecret: config.telegramWebhook.headerSecret
              },
              processor
            }
          }
        : {})
    });
    await app.listen(config.apiPort, config.apiHost);
    logger.info("api started", {
      version: config.appVersion,
      port: config.apiPort,
      telegramWebhookEnabled: config.telegramWebhook.enabled,
      tbankPaymentsEnabled: config.tbankPayments.enabled
    });
  } catch (error) {
    await app?.close();
    await pool?.close();
    throw error;
  }

  let shuttingDown = false;
  const close = async () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    await app.close();
    await pool?.close();
    logger.info("api stopped", { version: config.appVersion });
  };

  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
}

await bootstrapApi();

function getExpectedMigrationVersion(): string {
  const latestMigration = migrations.at(-1);

  if (!latestMigration) {
    throw new Error("At least one database migration is required");
  }

  return latestMigration.id.slice(0, 14);
}
