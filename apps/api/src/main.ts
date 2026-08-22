import { randomUUID } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import {
  AcceptTelegramOfferService,
  AdminAccommodationService,
  AdminEventParticipantsService,
  ImportParticipantsService,
  AdminEventExpensesService,
  AdminEventInventoryService,
  AdminEventTeamService,
  AdminStaffService,
  AdminEventOverviewService,
  AdminEventReportService,
  AdminCancelOrderService,
  AdminOutreachService,
  AdvanceTelegramScenarioService,
  AuthorizeAdminRequestService,
  ConfirmPaymentService,
  CountAdminBroadcastAudienceService,
  CreateAdminBroadcastService,
  ListAdminBroadcastsService,
  StoreAdminBroadcastImageService,
  CreateAdminEventContentBlockService,
  CreateAdminEventPricingRuleService,
  CreateAdminEventProductService,
  CreateAdminEventDraftService,
  CreateOrderService,
  DeactivateAdminEventOfferService,
  ExportParticipantsCsvService,
  GetAdminEventService,
  GetReadinessService,
  GetAdminOrderService,
  GetAdminUserService,
  CheckTelegramPhoneAccessService,
  GetTelegramReferralBalanceService,
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
  PublishAdminEventOfferVersionService,
  PublishAdminEventService,
  PublishAdminEventScenarioVersionService,
  ReceiveZvonobotCallService,
  RegisterFromSiteService,
  RequestTelegramTicketRedeliveryService,
  ResumeTelegramScenarioAfterOfferService,
  RequestFullTBankRefundService,
  SaveAdminEventScenarioDraftService,
  StartTelegramScenarioService,
  SubmitTelegramScenarioInputService,
  TelegramPurchaseFlowService,
  UpdateAdminEventGeneralService,
  UpdateAdminEventContentBlockService,
  UpdateAdminEventPricingRuleService,
  UpdateAdminEventProductService,
  type IdGenerator
} from "@ticket-platform/application";
import { loadApiConfig } from "@ticket-platform/config";
import {
  createOfferAcceptancePersistence,
  createAdminBroadcastPersistence,
  createAdminEventContentManagementPersistence,
  createAdminEventManagementPersistence,
  createAdminEventOfferManagementPersistence,
  createAdminEventScenarioManagementPersistence,
  createAdminEventCatalogManagementPersistence,
  createAdminEventsPersistence,
  createAdminOperationsPersistence,
  createAdminAccommodationPersistence,
  createAdminEventParticipantsPersistence,
  createAdminEventExpensesPersistence,
  createAdminEventInventoryPersistence,
  createAdminEventTeamPersistence,
  createAdminEventOverviewPersistence,
  createAdminEventReportPersistence,
  PostgresAdminOrderCancellationRepository,
  createAdminOutreachPersistence,
  createAdminStaffPersistence,
  createNodePostgresPool,
  createParticipantsExportPersistence,
  createPostgresHealthProbes,
  createPhonePersistence,
  createReferralBalancePersistence,
  createTelegramAccessPersistence,
  createScenarioRuntimePersistence,
  createSiteRegistrationPersistence,
  createZvonobotIntakePersistence,
  createPaymentConfirmationPersistence,
  createOrderSalesPersistence,
  createTelegramPurchaseFlowPersistence,
  createTelegramTicketAccessPersistence,
  createTelegramStartPersistence,
  createTBankPaymentPersistence,
  createTBankRefundPersistence,
  migrations,
  PostgresAdminPrincipalRepository,
  type ManagedSqlConnectionPool
} from "@ticket-platform/database";
import {
  ConversationController,
  LibPhoneNumberNormalizer
} from "@ticket-platform/messenger-core";
import {
  MaxApi,
  createMaxUpdateProcessor,
  type MaxUpdateProcessor
} from "@ticket-platform/messenger-max";
import {
  createTelegramBot,
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
    let maxProcessor: MaxUpdateProcessor | undefined;

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
            new PostgresAdminPrincipalRepository(pool),
            { mfaRequired: config.adminAuth.mfaRequired }
          )
        }
      : undefined;
    const adminOperations = adminAuth
      ? (() => {
          const repository = createAdminOperationsPersistence(pool);
          // Отмена трогает бронь и кошелёк, поэтому идёт через ту же единицу работы, что
          // и продажа: всё либо применяется целиком, либо не применяется вовсе.
          const sales = createOrderSalesPersistence(pool, idGenerator);
          return {
            listUsers: new ListAdminUsersService(repository),
            getUser: new GetAdminUserService(repository),
            listOrders: new ListAdminOrdersService(repository),
            getOrder: new GetAdminOrderService(repository),
            cancelOrder: new AdminCancelOrderService(
              new PostgresAdminOrderCancellationRepository(sales.session),
              sales.outboxWriter,
              sales.unitOfWork,
              idGenerator
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
    const participantsExport = adminAuth
      ? new ExportParticipantsCsvService(
          createParticipantsExportPersistence(pool)
        )
      : undefined;
    const adminBroadcast = adminAuth
      ? (() => {
          const persistence = createAdminBroadcastPersistence(pool);
          return {
            create: new CreateAdminBroadcastService(
              persistence.adminBroadcastRepository,
              persistence.outboxWriter,
              persistence.unitOfWork,
              idGenerator
            ),
            audience: new CountAdminBroadcastAudienceService(
              persistence.adminBroadcastAudienceRepository
            ),
            image: new StoreAdminBroadcastImageService(
              persistence.adminBroadcastImageRepository,
              idGenerator
            ),
            list: new ListAdminBroadcastsService(
              persistence.adminBroadcastHistoryRepository
            )
          };
        })()
      : undefined;
    const adminOutreach = adminAuth
      ? new AdminOutreachService(
          createAdminOutreachPersistence(pool),
          new LibPhoneNumberNormalizer(
            config.telegramWebhook.enabled
              ? config.telegramWebhook.defaultCountry
              : "RU"
          ),
          idGenerator
        )
      : undefined;
    const adminAccommodation = adminAuth
      ? new AdminAccommodationService(
          createAdminAccommodationPersistence(pool),
          { now: () => new Date() },
          idGenerator,
          new LibPhoneNumberNormalizer(
            config.telegramWebhook.enabled
              ? config.telegramWebhook.defaultCountry
              : "RU"
          )
        )
      : undefined;
    const adminEventParticipants = adminAuth
      ? new AdminEventParticipantsService(
          createAdminEventParticipantsPersistence(pool).repository,
          { now: () => new Date() }
        )
      : undefined;
    const importParticipants = adminAuth
      ? new ImportParticipantsService(
          createAdminEventParticipantsPersistence(pool).repository,
          idGenerator
        )
      : undefined;
    const adminExpenses = adminAuth
      ? new AdminEventExpensesService(
          createAdminEventExpensesPersistence(pool).repository,
          { now: () => new Date() },
          idGenerator
        )
      : undefined;
    const adminInventory = adminAuth
      ? new AdminEventInventoryService(
          createAdminEventInventoryPersistence(pool).repository,
          { now: () => new Date() },
          idGenerator
        )
      : undefined;
    const adminTeam = adminAuth
      ? new AdminEventTeamService(
          createAdminEventTeamPersistence(pool).repository,
          { now: () => new Date() },
          idGenerator
        )
      : undefined;
    // Команда кабинета — не то же самое, что команда мероприятия выше: там доли от
    // прибыли пикника, здесь роли и календари наставников.
    const adminStaff = adminAuth
      ? new AdminStaffService(
          createAdminStaffPersistence(pool).repository,
          { now: () => new Date() },
          idGenerator
        )
      : undefined;
    const adminOverview = adminAuth
      ? new AdminEventOverviewService(
          createAdminEventOverviewPersistence(pool).repository,
          { now: () => new Date() }
        )
      : undefined;
    const adminEventReport = adminAuth
      ? new AdminEventReportService(
          createAdminEventReportPersistence(pool).repository,
          { now: () => new Date() }
        )
      : undefined;
    // Регистрация с сайта работает без входа в панель: за формой стоит посетитель, а не
    // администратор. Поэтому она собирается всегда, а не под `adminAuth`.
    const siteRegistration = (() => {
      // Одна сборка на все три зависимости: репозиторий, журнал исходящих и транзакция
      // должны делить одну сессию, иначе запись уйдёт мимо открытой транзакции.
      const persistence = createSiteRegistrationPersistence(pool);
      return new RegisterFromSiteService(
        persistence.repository,
        new LibPhoneNumberNormalizer(
          config.telegramWebhook.enabled
            ? config.telegramWebhook.defaultCountry
            : "RU"
        ),
        persistence.outboxWriter,
        persistence.unitOfWork,
        idGenerator,
        config.siteRegistration
      );
    })();
    // Обратная связь Звонобота. Поднимается только вместе с ключом: путь без ключа — это
    // способ насыпать в воронку кого угодно, и молча открытым он быть не должен.
    const zvonobot = config.zvonobot.enabled
      ? new ReceiveZvonobotCallService(
          createZvonobotIntakePersistence(pool).repository,
          new LibPhoneNumberNormalizer(
            config.telegramWebhook.enabled
              ? config.telegramWebhook.defaultCountry
              : "RU"
          ),
          idGenerator
        )
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
            new HmacTicketReferenceGenerator(config.orderTokenSecret),
            persistence.referralCommissionRepository
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
            new HmacTicketReferenceGenerator(config.orderTokenSecret),
            confirmationPersistence.referralCommissionRepository
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

    // Разговорный слой один на оба мессенджера, поэтому и собирается один раз — как только
    // включён хотя бы один канал. Своё у канала только то, что действительно своё:
    // транспорт и вебхук.
    if (config.telegramWebhook.enabled || config.max.enabled) {
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
      const purchaseFlowOrderSalesPersistence = createOrderSalesPersistence(pool, idGenerator);
      const purchaseFlowOrderCreator = new CreateOrderService(
        purchaseFlowOrderSalesPersistence.orderSalesRepository,
        purchaseFlowOrderSalesPersistence.outboxWriter,
        purchaseFlowOrderSalesPersistence.unitOfWork,
        idGenerator,
        new HmacOrderReferenceGenerator(
          config.orderTokenSecret,
          config.orderNumberPrefix
        )
      );
      const purchaseFlowPersistence = createTelegramPurchaseFlowPersistence(pool);
      const purchaseFlowService = new TelegramPurchaseFlowService(
        purchaseFlowPersistence.purchaseDraftRepository,
        purchaseFlowPersistence.eventCatalogRepository,
        purchaseFlowOrderCreator,
        phonePersistence.telegramUserResolver,
        idGenerator,
        config.purchaseEventSlug,
        phonePersistence.unitOfWork
      );
      const referralBalanceService = new GetTelegramReferralBalanceService(
        createReferralBalancePersistence(pool).referralBalanceRepository
      );
      const phoneAccessService = new CheckTelegramPhoneAccessService(
        createTelegramAccessPersistence(pool).phoneStatusRepository
      );
      const ticketPersistence = createTelegramTicketAccessPersistence(pool);
      const startService = new HandleTelegramStartService(
        startPersistence.identityRepository,
        startPersistence.idempotencyRepository,
        startPersistence.outboxWriter,
        startPersistence.unitOfWork,
        idGenerator
      );
      const contactService = new HandleTelegramContactService(
        new LibPhoneNumberNormalizer(
          config.telegramWebhook.enabled ? config.telegramWebhook.defaultCountry : "RU"
        ),
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
          scenarioOrderCreator
        ),
        advance: new AdvanceTelegramScenarioService(
          scenarioPersistence.repository,
          scenarioPersistence.unitOfWork,
          scenarioOrderCreator
        ),
        input: new SubmitTelegramScenarioInputService(
          scenarioPersistence.repository,
          scenarioPersistence.unitOfWork,
          scenarioOrderCreator
        ),
        offerAccepted: new ResumeTelegramScenarioAfterOfferService(
          scenarioPersistence.repository,
          scenarioPersistence.unitOfWork,
          scenarioOrderCreator
        )
      };
      const conversation = new ConversationController(
        startService,
        contactService,
        offerService,
        ticketListService,
        ticketRedeliveryService,
        tbank?.initialization,
        scenario,
        purchaseFlowService,
        referralBalanceService,
        phoneAccessService
      );

      await pool.ping();

      if (config.telegramWebhook.enabled) {
        const bot = createTelegramBot(
          config.telegramWebhook.botToken,
          conversation,
          logger,
          {
            rethrowUpdateErrors: true,
            ...(config.telegramWebhook.apiRoot ? { apiRoot: config.telegramWebhook.apiRoot } : {})
          }
        );
        await bot.init();
        processor = { handleUpdate: (update) => bot.handleUpdate(update) };
        logger.info("telegram webhook dependencies ready", { botId: String(bot.botInfo.id) });
      }

      if (config.max.enabled) {
        maxProcessor = createMaxUpdateProcessor(
          new MaxApi({
            token: config.max.botToken,
            baseUrl: config.max.apiBaseUrl,
            timeoutMs: config.max.httpTimeoutMs
          }),
          conversation,
          logger,
          { botUsername: config.max.botUsername }
        );
        logger.info("max webhook dependencies ready");
      }
    }

    app = await createApiApplication({
      appVersion: config.appVersion,
      // 1.6 МБ — под мегабайтную картинку рассылки, раздутую base64 примерно на треть.
      // Предел общий на весь API, поэтому больше не берём: у вебхуков Т-Банка и Telegram
      // на этом же пределе стоит защита от переростков.
      bodyLimitBytes: Math.max(
        config.telegramWebhook.bodyLimitBytes,
        config.tbankPayments.bodyLimitBytes,
        1_600_000
      ),
      readiness,
      ...(adminAuth ? { adminAuth } : {}),
      ...(orders ? { orders } : {}),
      ...(manualPayments ? { manualPayments } : {}),
      ...(adminOperations ? { adminOperations } : {}),
      ...(adminEvents ? { adminEvents } : {}),
      ...(participantsExport ? { participantsExport } : {}),
      ...(adminBroadcast ? { adminBroadcast } : {}),
      ...(adminOutreach ? { adminOutreach } : {}),
      ...(adminAccommodation ? { adminAccommodation } : {}),
      ...(adminEventParticipants ? { adminEventParticipants } : {}),
      ...(importParticipants ? { importParticipants } : {}),
      ...(adminExpenses ? { adminExpenses } : {}),
      ...(adminInventory ? { adminInventory } : {}),
      ...(adminTeam ? { adminTeam } : {}),
      ...(adminStaff ? { adminStaff } : {}),
      ...(adminOverview ? { adminOverview } : {}),
      ...(adminEventReport ? { adminEventReport } : {}),
      siteRegistration: { handler: siteRegistration, logger },
      ...(zvonobot && config.zvonobot.enabled
        ? {
            zvonobot: {
              config: {
                secret: config.zvonobot.secret,
                bodyLimitBytes: config.zvonobot.bodyLimitBytes
              },
              handler: zvonobot,
              logger
            }
          }
        : {}),
      ...(tbank?.refunds ? { fullRefunds: tbank.refunds } : {}),
      ...(tbank
        ? {
            tbankWebhook: {
              config: {
                bodyLimitBytes: config.tbankPayments.bodyLimitBytes
              },
              verifier: tbank.provider,
              handler: tbank.webhook,
              logger
            }
          }
        : {}),
      ...(maxProcessor && config.max.enabled
        ? {
            maxWebhook: {
              config: {
                pathSecret: config.max.pathSecret,
                headerSecret: config.max.headerSecret,
                bodyLimitBytes: config.max.bodyLimitBytes
              },
              processor: maxProcessor,
              logger
            }
          }
        : {}),
      ...(config.telegramWebhook.enabled && processor
        ? {
            webhook: {
              config: {
                pathSecret: config.telegramWebhook.pathSecret,
                headerSecret: config.telegramWebhook.headerSecret,
                bodyLimitBytes: config.telegramWebhook.bodyLimitBytes
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
