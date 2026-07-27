import { v7 as uuidv7 } from "uuid";
import {
  AcceptTelegramOfferService,
  AdvanceTelegramScenarioService,
  CreateOrderService,
  GetTelegramReferralBalanceService,
  HandleTelegramContactService,
  HandleTelegramStartService,
  InitializeTelegramTBankPaymentService,
  ListTelegramTicketsService,
  RequestTelegramTicketRedeliveryService,
  ResumeTelegramScenarioAfterOfferService,
  StartTelegramScenarioService,
  SubmitTelegramScenarioInputService,
  TelegramPurchaseFlowService,
  TelegramQuestionnaireService,
  HmacOrderReferenceGenerator,
  type IdGenerator
} from "@ticket-platform/application";
import { loadTelegramBotConfig } from "@ticket-platform/config";
import {
  createOfferAcceptancePersistence,
  createNodePostgresPool,
  createOrderSalesPersistence,
  createParticipantQuestionnairePersistence,
  createPhonePersistence,
  createReferralBalancePersistence,
  createScenarioRuntimePersistence,
  createTBankPaymentPersistence,
  createTelegramPurchaseFlowPersistence,
  createTelegramTicketAccessPersistence,
  createTelegramStartPersistence
} from "@ticket-platform/database";
import { LibPhoneNumberNormalizer } from "@ticket-platform/messenger-core";
import {
  createTelegramBot,
  TelegramUpdateController
} from "@ticket-platform/messenger-telegram";
import { createLogger } from "@ticket-platform/observability";
import { TBankPaymentProvider } from "@ticket-platform/payment-tbank";

export async function bootstrapTelegramBot(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const config = loadTelegramBotConfig(env);
  const logger = createLogger({ service: "telegram-bot", environment: config.appEnv });

  if (config.telegramDeliveryMode !== "long-polling") {
    throw new Error("Webhook delivery belongs to the API runtime and is not wired yet");
  }

  const pool = createNodePostgresPool({
    connectionString: config.databaseUrl,
    maxConnections: config.databasePoolMax,
    applicationName: "ticket-platform-telegram-bot",
    onIdleClientError(error) {
      logger.error("postgres idle client failed", { errorType: error.name });
    }
  });
  const idGenerator: IdGenerator = { newId: uuidv7 };
  const startPersistence = createTelegramStartPersistence(pool, idGenerator);
  const phonePersistence = createPhonePersistence(pool, idGenerator);
  const offerPersistence = createOfferAcceptancePersistence(pool);
  const scenarioPersistence = createScenarioRuntimePersistence(pool, idGenerator);
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
  const ticketPersistence = createTelegramTicketAccessPersistence(pool);
  const paymentInitializationService = config.tbankPayments.enabled
    ? new InitializeTelegramTBankPaymentService(
        createTBankPaymentPersistence(pool, idGenerator).initializationRepository,
        new TBankPaymentProvider({
          baseUrl: config.tbankPayments.apiBaseUrl,
          terminalKey: config.tbankPayments.terminalKey,
          password: config.tbankPayments.password,
          timeoutMs: config.tbankPayments.timeoutMs
        }),
        {
          notificationUrl: config.tbankPayments.notificationUrl,
          successUrl: config.tbankPayments.successUrl,
          failUrl: config.tbankPayments.failUrl
        }
      )
    : undefined;
  const startService = new HandleTelegramStartService(
    startPersistence.identityRepository,
    startPersistence.idempotencyRepository,
    startPersistence.outboxWriter,
    startPersistence.unitOfWork,
    idGenerator
  );
  const contactService = new HandleTelegramContactService(
    new LibPhoneNumberNormalizer(config.telegramDefaultCountry),
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
  const orderSalesPersistence = createOrderSalesPersistence(pool, idGenerator);
  const createOrderService = new CreateOrderService(
    orderSalesPersistence.orderSalesRepository,
    orderSalesPersistence.outboxWriter,
    orderSalesPersistence.unitOfWork,
    idGenerator,
    new HmacOrderReferenceGenerator(config.orderTokenSecret, config.orderNumberPrefix)
  );
  const purchaseFlowPersistence = createTelegramPurchaseFlowPersistence(pool);
  const purchaseFlowService = new TelegramPurchaseFlowService(
    purchaseFlowPersistence.purchaseDraftRepository,
    purchaseFlowPersistence.eventCatalogRepository,
    createOrderService,
    phonePersistence.telegramUserResolver,
    idGenerator,
    config.purchaseEventSlug
  );
  const referralBalanceService = new GetTelegramReferralBalanceService(
    createReferralBalancePersistence(pool).referralBalanceRepository
  );
  const questionnairePersistence = createParticipantQuestionnairePersistence(pool, idGenerator);
  const questionnaireService = new TelegramQuestionnaireService(
    questionnairePersistence.questionnaireDraftRepository,
    questionnairePersistence.questionnaireResponseRepository,
    phonePersistence.telegramUserResolver
  );
  const controller = new TelegramUpdateController(
    startService,
    contactService,
    offerService,
    ticketListService,
    ticketRedeliveryService,
    paymentInitializationService,
    scenario,
    purchaseFlowService,
    referralBalanceService,
    questionnaireService
  );
  const bot = createTelegramBot(config.telegramBotToken, controller, logger, {
    ...(config.telegramApiRoot ? { apiRoot: config.telegramApiRoot } : {})
  });
  const stop = () => {
    void bot.stop().catch((error: unknown) => {
      logger.error("telegram-bot stop failed", {
        errorType: error instanceof Error ? error.name : "UnknownError"
      });
    });
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    await pool.ping();
    logger.info("telegram-bot database ready", {
      version: config.appVersion,
      tbankPaymentsEnabled: config.tbankPayments.enabled
    });
    await bot.start({
      onStart(botInfo) {
        logger.info("telegram-bot long polling started", {
          version: config.appVersion,
          botId: String(botInfo.id)
        });
      }
    });
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await pool.close();
    logger.info("telegram-bot stopped", { version: config.appVersion });
  }
}

await bootstrapTelegramBot();
