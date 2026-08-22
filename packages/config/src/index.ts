export type AppEnvironment = "local" | "test" | "staging" | "production";

export interface AppConfig {
  readonly appEnv: AppEnvironment;
  readonly appVersion: string;
  readonly databaseUrl: string;
  readonly databaseDirectUrl: string;
}

export type TelegramDeliveryMode = "long-polling" | "webhook";

export type TBankPaymentsConfig =
  | { readonly enabled: false; readonly bodyLimitBytes: number }
  | {
      readonly enabled: true;
      readonly bodyLimitBytes: number;
      readonly apiBaseUrl: string;
      readonly terminalKey: string;
      readonly password: string;
      readonly notificationUrl: string;
      readonly successUrl: string;
      readonly failUrl: string;
      readonly payType: "O";
      readonly timeoutMs: number;
    };

export interface TelegramBotConfig extends AppConfig {
  readonly telegramBotToken: string;
  /** Optional reverse-proxy base URL in front of api.telegram.org (e.g. a Cloudflare
   * Worker), used where Telegram's API is blocked by the network. */
  readonly telegramApiRoot?: string;
  readonly telegramDeliveryMode: TelegramDeliveryMode;
  readonly telegramDefaultCountry: string;
  readonly databasePoolMax: number;
  readonly orderTokenSecret: string;
  readonly orderNumberPrefix: string;
  /** Single-event MVP: which published event's catalog "Купить билет" sells from in chat. */
  readonly purchaseEventSlug: string;
  readonly tbankPayments: TBankPaymentsConfig;
}

export type TelegramWebhookConfig =
  | { readonly enabled: false; readonly bodyLimitBytes: number }
  | {
      readonly enabled: true;
      readonly bodyLimitBytes: number;
      readonly botToken: string;
      readonly apiRoot?: string;
      readonly pathSecret: string;
      readonly headerSecret: string;
      readonly defaultCountry: string;
    };

/**
 * Канал MAX внутри общего api.
 *
 * Выключен, пока не задан `MAX_BOT_TOKEN`: до объединения MAX живёт отдельным приложением
 * на своей базе, и поднимать второй приёмник на те же обновления нельзя — они бы оба
 * отвечали человеку, и он увидел бы двух собеседников.
 */
export type MaxChannelConfig =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly botToken: string;
      readonly apiBaseUrl: string;
      readonly pathSecret: string;
      /** Секрет заголовка. Пусто — подписка на вебхук оформлена без него. */
      readonly headerSecret: string | null;
      readonly bodyLimitBytes: number;
      readonly botUsername: string | null;
      readonly httpTimeoutMs: number;
    };

export type AdminAuthConfig =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly issuer: string;
      readonly audience: string;
      /**
       * Требовать второй фактор. Выключено — пароля достаточно, включая денежные
       * операции. Смысл держать это переключателем, а не удалённым кодом: механика
       * входа по коду остаётся на месте и включается обратно одной переменной, без
       * правки авторизации и повторной проверки того, что она ничего не пропускает.
       */
      readonly mfaRequired: boolean;
    };

export type OfferStorageConfig =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly supabaseUrl: string;
      readonly serviceRoleKey: string;
      readonly bucket: string;
    };

export type TBankReconciliationConfig =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly apiBaseUrl: string;
      readonly terminalKey: string;
      readonly password: string;
      readonly ticketTokenSecret: string;
      readonly timeoutMs: number;
      readonly batchSize: number;
      readonly leaseSeconds: number;
      readonly pollIntervalMs: number;
      readonly initialDelaySeconds: number;
      readonly retryBaseSeconds: number;
      readonly retryMaxSeconds: number;
      readonly emptyObservationThreshold: number;
    };

export interface ApiConfig extends AppConfig {
  readonly apiHost: string;
  readonly apiPort: number;
  readonly databasePoolMax: number;
  readonly pgBossSchema: string;
  readonly workerHeartbeatDegradedSeconds: number;
  readonly workerHeartbeatFailedSeconds: number;
  readonly outboxLagDegradedSeconds: number;
  readonly outboxLagFailedSeconds: number;
  readonly adminAuth: AdminAuthConfig;
  readonly offerStorage: OfferStorageConfig;
  readonly telegramWebhook: TelegramWebhookConfig;
  readonly orderTokenSecret: string;
  readonly orderNumberPrefix: string;
  /** Single-event MVP: which published event's catalog "Купить билет" sells from in chat. */
  readonly purchaseEventSlug: string;
  readonly siteRegistration: SiteRegistrationConfig;
  readonly max: MaxChannelConfig;
  readonly zvonobot: ZvonobotConfig;
  readonly tbankPayments: TBankPaymentsConfig;
  /**
   * Папка вложений переписки. Api их отдаёт панели, воркер их туда кладёт — переменная у
   * двух процессов одна, и разъехаться она не должна: api начал бы отвечать «файла нет»
   * на файлы, которые лежат в другой папке.
   */
  readonly conversationAttachments: ConversationAttachmentsConfig;
}

/**
 * Форма регистрации на сайте.
 *
 * Мероприятие не задаётся здесь именем: встречи еженедельные, и переменная, которую надо
 * менять каждую неделю, однажды не поменяется. Задаётся начало слага — выпуск заводят как
 * `sreda-2026-08-26`, и запись переезжает на ближайший сама.
 */
export interface SiteRegistrationConfig {
  readonly eventSlugPrefix: string;
  /** Служебная учётная запись из миграции 20260820120000: от её имени заводится участник. */
  readonly systemAdminId: string;
}

/**
 * Приёмник обратной связи Звонобота.
 *
 * Выключен, пока не задан `ZVONOBOT_WEBHOOK_SECRET`, и это не забывчивость, а поведение:
 * открытый путь, принимающий чужие тела без ключа, — это способ насыпать в воронку
 * выдуманных людей. Нет ключа — нет и пути, приложение поднимается без него.
 */
export type ZvonobotConfig =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly secret: string;
      readonly bodyLimitBytes: number;
    };

export interface WorkerConfig extends AppConfig {
  readonly databasePoolMax: number;
  readonly pgBossSchema: string;
  readonly outboxBatchSize: number;
  readonly outboxLockLeaseSeconds: number;
  readonly outboxRetryBaseSeconds: number;
  readonly outboxRetryMaxSeconds: number;
  readonly outboxPollIntervalMs: number;
  readonly workerHeartbeatIntervalMs: number;
  readonly orderExpiryBatchSize: number;
  readonly orderExpiryPollIntervalMs: number;
  readonly reminderBatchSize: number;
  readonly reminderPollIntervalMs: number;
  readonly eventCampaignSyncBatchSize: number;
  readonly eventCampaignSyncPollIntervalMs: number;
  readonly autoTaskBatchSize: number;
  readonly autoTaskPollIntervalMs: number;
  readonly zvonobotBatchSize: number;
  readonly zvonobotPollIntervalMs: number;
  readonly conversationAttachments: ConversationAttachmentsConfig;
  readonly conversationReplies: ConversationRepliesConfig;
  /** Служебная учётная запись из миграции 20260822160000: от её имени заводится заявка. */
  readonly zvonobotSystemAdminId: string;
  /** Отправитель уведомлений в MAX. Выключен — билеты по заказам MAX доставлены не будут. */
  readonly max: MaxChannelConfig;
  /** Страна по умолчанию при разборе телефонов: та же, что у вебхука Telegram. */
  readonly phoneDefaultCountry: string;
  readonly tbankReconciliation: TBankReconciliationConfig;
  readonly telegramNotifications:
    | { readonly enabled: false }
    | {
        readonly enabled: true;
        readonly botToken: string;
        readonly apiRoot?: string;
        readonly adminChatIds: readonly string[];
        readonly ticketTokenSecret: string;
        readonly leaseSeconds: number;
        readonly localConcurrency: number;
        readonly broadcastMessagesPerSecond: number;
      };
}

/**
 * Скачивание вложений переписки.
 *
 * Выключено, пока не задана папка. Это не осторожность ради осторожности: проход, которому
 * некуда писать, ронял бы каждую попытку и за сутки довёл бы все вложения до потолка
 * попыток — то есть тихо превратил бы «файлы у нас» в «файлов нет».
 */
export interface ConversationAttachmentsConfig {
  readonly enabled: boolean;
  /** Папка на диске. Внутри раскладка по годам и месяцам. */
  readonly directory: string;
  readonly batchSize: number;
  readonly pollIntervalMs: number;
  readonly maxBytes: number;
  readonly maxAttempts: number;
  readonly retryDelayMs: number;
  readonly downloadTimeoutMs: number;
}

function loadConversationAttachmentsConfig(
  env: NodeJS.ProcessEnv
): ConversationAttachmentsConfig {
  const directory = (env.CONVERSATION_FILES_DIR ?? "").trim();
  return {
    enabled: directory !== "",
    directory,
    batchSize: parseBoundedInteger(
      env.CONVERSATION_FILES_BATCH_SIZE ?? "20",
      "CONVERSATION_FILES_BATCH_SIZE",
      1,
      200
    ),
    // Пять минут: вложение нужно не сию секунду, а к тому моменту, когда менеджер откроет
    // диалог. Ломиться за файлами чаще — зря дёргать чужой api.
    pollIntervalMs: parseBoundedInteger(
      env.CONVERSATION_FILES_POLL_INTERVAL_MS ?? "300000",
      "CONVERSATION_FILES_POLL_INTERVAL_MS",
      10_000,
      3_600_000
    ),
    // 50 МБ — предел самого Telegram для бота. Больше он и не отдаст.
    maxBytes: parseBoundedInteger(
      env.CONVERSATION_FILES_MAX_BYTES ?? "52428800",
      "CONVERSATION_FILES_MAX_BYTES",
      1_024,
      2_147_483_648
    ),
    maxAttempts: parseBoundedInteger(
      env.CONVERSATION_FILES_MAX_ATTEMPTS ?? "5",
      "CONVERSATION_FILES_MAX_ATTEMPTS",
      1,
      100
    ),
    retryDelayMs: parseBoundedInteger(
      env.CONVERSATION_FILES_RETRY_DELAY_MS ?? "60000",
      "CONVERSATION_FILES_RETRY_DELAY_MS",
      1_000,
      3_600_000
    ),
    downloadTimeoutMs: parseBoundedInteger(
      env.CONVERSATION_FILES_TIMEOUT_MS ?? "30000",
      "CONVERSATION_FILES_TIMEOUT_MS",
      1_000,
      300_000
    )
  };
}

/**
 * Отправка ответов менеджера.
 *
 * Пауза между отправками — главная настройка здесь. Десяток ответов, ушедших в одну
 * секунду, для антиспама выглядит как рассылка, а для человека — как стена сообщений.
 */
export interface ConversationRepliesConfig {
  readonly batchSize: number;
  readonly pollIntervalMs: number;
  readonly pauseBetweenMs: number;
  readonly maxAttempts: number;
  readonly retryDelayMs: number;
}

function loadConversationRepliesConfig(
  env: NodeJS.ProcessEnv
): ConversationRepliesConfig {
  return {
    batchSize: parseBoundedInteger(
      env.CONVERSATION_REPLIES_BATCH_SIZE ?? "10",
      "CONVERSATION_REPLIES_BATCH_SIZE",
      1,
      100
    ),
    // Пятнадцать секунд: ответ менеджера человек ждёт, и минута тишины после «Отправлено»
    // читается как «не дошло». Проход по пустой очереди стоит одного запроса.
    pollIntervalMs: parseBoundedInteger(
      env.CONVERSATION_REPLIES_POLL_INTERVAL_MS ?? "15000",
      "CONVERSATION_REPLIES_POLL_INTERVAL_MS",
      5_000,
      600_000
    ),
    pauseBetweenMs: parseBoundedInteger(
      env.CONVERSATION_REPLIES_PAUSE_MS ?? "1000",
      "CONVERSATION_REPLIES_PAUSE_MS",
      0,
      60_000
    ),
    maxAttempts: parseBoundedInteger(
      env.CONVERSATION_REPLIES_MAX_ATTEMPTS ?? "5",
      "CONVERSATION_REPLIES_MAX_ATTEMPTS",
      1,
      100
    ),
    retryDelayMs: parseBoundedInteger(
      env.CONVERSATION_REPLIES_RETRY_DELAY_MS ?? "60000",
      "CONVERSATION_REPLIES_RETRY_DELAY_MS",
      1_000,
      3_600_000
    )
  };
}

export function loadAppConfig(env: NodeJS.ProcessEnv): AppConfig {
  const appEnv = parseAppEnvironment(env.APP_ENV ?? "local");

  return {
    appEnv,
    appVersion: env.APP_VERSION ?? "dev",
    databaseUrl: required(env.DATABASE_URL, "DATABASE_URL"),
    databaseDirectUrl: required(env.DATABASE_DIRECT_URL, "DATABASE_DIRECT_URL")
  };
}

export function loadTelegramBotConfig(env: NodeJS.ProcessEnv): TelegramBotConfig {
  const appConfig = loadAppConfig(env);
  const defaultMode = appConfig.appEnv === "production" ? "webhook" : "long-polling";
  const localOrderTokenSecret = "local-only-order-token-secret-change-me";
  const telegramApiRoot = parseOptionalApiRoot(env.TELEGRAM_API_ROOT);

  return {
    ...appConfig,
    telegramBotToken: required(env.TELEGRAM_BOT_TOKEN, "TELEGRAM_BOT_TOKEN"),
    ...(telegramApiRoot ? { telegramApiRoot } : {}),
    telegramDeliveryMode: parseTelegramDeliveryMode(env.TELEGRAM_DELIVERY_MODE ?? defaultMode),
    telegramDefaultCountry: env.TELEGRAM_DEFAULT_COUNTRY ?? "RU",
    databasePoolMax: parsePositiveInteger(env.DATABASE_POOL_MAX ?? "10", "DATABASE_POOL_MAX"),
    orderTokenSecret: parseSecret(
      env.ORDER_TOKEN_SECRET
        ?? (appConfig.appEnv === "production" ? undefined : localOrderTokenSecret),
      "ORDER_TOKEN_SECRET"
    ),
    orderNumberPrefix: parseOrderNumberPrefix(env.ORDER_NUMBER_PREFIX ?? "BP"),
    purchaseEventSlug: env.TELEGRAM_PURCHASE_EVENT_SLUG ?? "business-picnic-2026",
    tbankPayments: loadTBankPaymentsConfig(env, appConfig.appEnv)
  };
}

export function loadApiConfig(env: NodeJS.ProcessEnv): ApiConfig {
  const appConfig = loadAppConfig(env);
  const localOrderTokenSecret = "local-only-order-token-secret-change-me";
  const adminAuthEnabled = parseBoolean(
    env.ADMIN_AUTH_ENABLED ?? (appConfig.appEnv === "production" ? "true" : "false"),
    "ADMIN_AUTH_ENABLED"
  );
  const workerHeartbeatDegradedSeconds = parseBoundedInteger(
    env.HEALTH_WORKER_HEARTBEAT_DEGRADED_SECONDS ?? "30",
    "HEALTH_WORKER_HEARTBEAT_DEGRADED_SECONDS",
    1,
    3_599
  );
  const outboxLagDegradedSeconds = parseBoundedInteger(
    env.HEALTH_OUTBOX_LAG_DEGRADED_SECONDS ?? "60",
    "HEALTH_OUTBOX_LAG_DEGRADED_SECONDS",
    1,
    86_399
  );
  const webhookEnabled = parseBoolean(
    env.TELEGRAM_WEBHOOK_ENABLED ?? (appConfig.appEnv === "production" ? "true" : "false"),
    "TELEGRAM_WEBHOOK_ENABLED"
  );
  const bodyLimitBytes = parseBoundedInteger(
    env.TELEGRAM_WEBHOOK_BODY_LIMIT_BYTES ?? "262144",
    "TELEGRAM_WEBHOOK_BODY_LIMIT_BYTES",
    1_024,
    1_048_576
  );
  const webhookApiRoot = parseOptionalApiRoot(env.TELEGRAM_API_ROOT);
  const telegramWebhook: TelegramWebhookConfig = webhookEnabled
    ? {
        enabled: true,
        bodyLimitBytes,
        botToken: required(env.TELEGRAM_BOT_TOKEN, "TELEGRAM_BOT_TOKEN"),
        ...(webhookApiRoot ? { apiRoot: webhookApiRoot } : {}),
        pathSecret: parseSecret(env.TELEGRAM_WEBHOOK_PATH_SECRET, "TELEGRAM_WEBHOOK_PATH_SECRET"),
        headerSecret: parseSecret(env.TELEGRAM_WEBHOOK_SECRET, "TELEGRAM_WEBHOOK_SECRET"),
        defaultCountry: env.TELEGRAM_DEFAULT_COUNTRY ?? "RU"
      }
    : { enabled: false, bodyLimitBytes };

  return {
    ...appConfig,
    apiHost: env.API_HOST ?? "0.0.0.0",
    apiPort: parseBoundedInteger(env.PORT ?? "3000", "PORT", 1, 65_535),
    databasePoolMax: parsePositiveInteger(env.DATABASE_POOL_MAX ?? "10", "DATABASE_POOL_MAX"),
    pgBossSchema: parsePostgresIdentifier(env.PG_BOSS_SCHEMA ?? "pgboss", "PG_BOSS_SCHEMA"),
    workerHeartbeatDegradedSeconds,
    workerHeartbeatFailedSeconds: parseBoundedInteger(
      env.HEALTH_WORKER_HEARTBEAT_FAILED_SECONDS ?? "60",
      "HEALTH_WORKER_HEARTBEAT_FAILED_SECONDS",
      workerHeartbeatDegradedSeconds + 1,
      3_600
    ),
    outboxLagDegradedSeconds,
    outboxLagFailedSeconds: parseBoundedInteger(
      env.HEALTH_OUTBOX_LAG_FAILED_SECONDS ?? "300",
      "HEALTH_OUTBOX_LAG_FAILED_SECONDS",
      outboxLagDegradedSeconds + 1,
      86_400
    ),
    adminAuth: adminAuthEnabled
      ? {
          enabled: true,
          issuer: parseHttpsIssuer(env.ADMIN_AUTH_ISSUER, "ADMIN_AUTH_ISSUER"),
          audience: parseAudience(env.ADMIN_AUTH_AUDIENCE ?? "authenticated"),
          mfaRequired: parseBoolean(
            env.ADMIN_MFA_REQUIRED ?? "true",
            "ADMIN_MFA_REQUIRED"
          )
        }
      : { enabled: false },
    offerStorage: loadOfferStorageConfig(env),
    telegramWebhook,
    orderTokenSecret: parseSecret(
      env.ORDER_TOKEN_SECRET
        ?? (appConfig.appEnv === "production" ? undefined : localOrderTokenSecret),
      "ORDER_TOKEN_SECRET"
    ),
    orderNumberPrefix: parseOrderNumberPrefix(env.ORDER_NUMBER_PREFIX ?? "BP"),
    purchaseEventSlug: env.TELEGRAM_PURCHASE_EVENT_SLUG ?? "business-picnic-2026",
    siteRegistration: {
      eventSlugPrefix: parseEventSlugPrefix(
        env.SITE_REGISTRATION_EVENT_SLUG_PREFIX ?? "sreda"
      ),
      systemAdminId: "00000000-0000-4000-8000-000000000001"
    },
    max: loadMaxChannelConfig(env),
    zvonobot: loadZvonobotConfig(env),
    tbankPayments: loadTBankPaymentsConfig(env, appConfig.appEnv),
    conversationAttachments: loadConversationAttachmentsConfig(env)
  };
}

function parseEventSlugPrefix(value: string): string {
  const prefix = value.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(prefix) || prefix.length < 2) {
    throw new Error(
      "SITE_REGISTRATION_EVENT_SLUG_PREFIX must look like the beginning of an event slug"
    );
  }

  return prefix;
}

function loadOfferStorageConfig(env: NodeJS.ProcessEnv): OfferStorageConfig {
  const enabled = parseBoolean(
    env.OFFER_STORAGE_ENABLED ?? "false",
    "OFFER_STORAGE_ENABLED"
  );
  if (!enabled) {
    return { enabled: false };
  }
  return {
    enabled: true,
    supabaseUrl: parseHttpsBaseUrl(
      env.OFFER_STORAGE_SUPABASE_URL,
      "OFFER_STORAGE_SUPABASE_URL"
    ),
    serviceRoleKey: parseBoundedValue(
      env.OFFER_STORAGE_SERVICE_ROLE_KEY,
      "OFFER_STORAGE_SERVICE_ROLE_KEY",
      32,
      4_096
    ),
    bucket: parseStorageBucket(
      env.OFFER_STORAGE_BUCKET ?? "offer-snapshots"
    )
  };
}

export function loadWorkerConfig(env: NodeJS.ProcessEnv): WorkerConfig {
  const appConfig = loadAppConfig(env);
  const tbankReconciliation = loadTBankReconciliationConfig(env, appConfig.appEnv);
  const notificationsEnabled = parseBoolean(
    env.TELEGRAM_NOTIFICATIONS_ENABLED ?? "false",
    "TELEGRAM_NOTIFICATIONS_ENABLED"
  );
  const notificationsApiRoot = parseOptionalApiRoot(env.TELEGRAM_API_ROOT);
  const telegramNotifications: WorkerConfig["telegramNotifications"] = notificationsEnabled
    ? {
        enabled: true,
        botToken: required(env.TELEGRAM_BOT_TOKEN, "TELEGRAM_BOT_TOKEN"),
        ...(notificationsApiRoot ? { apiRoot: notificationsApiRoot } : {}),
        adminChatIds: parseTelegramChatIds(
          env.ADMIN_NOTIFICATION_TELEGRAM_CHAT_ID,
          "ADMIN_NOTIFICATION_TELEGRAM_CHAT_ID"
        ),
        ticketTokenSecret: parseSecret(
          env.ORDER_TOKEN_SECRET
            ?? (appConfig.appEnv === "production"
              ? undefined
              : "local-only-order-token-secret-change-me"),
          "ORDER_TOKEN_SECRET"
        ),
        leaseSeconds: parseBoundedInteger(
          env.NOTIFICATION_DELIVERY_LEASE_SECONDS ?? "60",
          "NOTIFICATION_DELIVERY_LEASE_SECONDS",
          10,
          3_600
        ),
        localConcurrency: parseBoundedInteger(
          env.NOTIFICATION_WORKER_CONCURRENCY ?? "2",
          "NOTIFICATION_WORKER_CONCURRENCY",
          1,
          20
        ),
        // Telegram принимает от бота порядка 30 сообщений в секунду и режет всё сверх этого
        // ответом 429. Держим запас: у воркера есть и другие отправки, кроме рассылки.
        broadcastMessagesPerSecond: parseBoundedInteger(
          env.BROADCAST_MESSAGES_PER_SECOND ?? "20",
          "BROADCAST_MESSAGES_PER_SECOND",
          1,
          30
        )
      }
    : { enabled: false };

  if (env.PG_BOSS_MIGRATE && env.PG_BOSS_MIGRATE !== "false") {
    throw new Error("Runtime pg-boss migrations are prohibited; use a reviewed versioned migration");
  }

  const retryBaseSeconds = parseBoundedInteger(
    env.OUTBOX_RETRY_BASE_SECONDS ?? "5",
    "OUTBOX_RETRY_BASE_SECONDS",
    1,
    300
  );
  const retryMaxSeconds = parseBoundedInteger(
    env.OUTBOX_RETRY_MAX_SECONDS ?? "300",
    "OUTBOX_RETRY_MAX_SECONDS",
    retryBaseSeconds,
    86_400
  );

  return {
    ...appConfig,
    databasePoolMax: parsePositiveInteger(env.DATABASE_POOL_MAX ?? "10", "DATABASE_POOL_MAX"),
    pgBossSchema: parsePostgresIdentifier(env.PG_BOSS_SCHEMA ?? "pgboss", "PG_BOSS_SCHEMA"),
    outboxBatchSize: parseBoundedInteger(
      env.OUTBOX_BATCH_SIZE ?? "50",
      "OUTBOX_BATCH_SIZE",
      1,
      500
    ),
    outboxLockLeaseSeconds: parseBoundedInteger(
      env.OUTBOX_LOCK_LEASE_SECONDS ?? "60",
      "OUTBOX_LOCK_LEASE_SECONDS",
      10,
      3_600
    ),
    outboxRetryBaseSeconds: retryBaseSeconds,
    outboxRetryMaxSeconds: retryMaxSeconds,
    outboxPollIntervalMs: parseBoundedInteger(
      env.OUTBOX_POLL_INTERVAL_MS ?? "1000",
      "OUTBOX_POLL_INTERVAL_MS",
      500,
      60_000
    ),
    workerHeartbeatIntervalMs: parseBoundedInteger(
      env.WORKER_HEARTBEAT_INTERVAL_MS ?? "10000",
      "WORKER_HEARTBEAT_INTERVAL_MS",
      1_000,
      60_000
    ),
    orderExpiryBatchSize: parseBoundedInteger(
      env.ORDER_EXPIRY_BATCH_SIZE ?? "50",
      "ORDER_EXPIRY_BATCH_SIZE",
      1,
      500
    ),
    orderExpiryPollIntervalMs: parseBoundedInteger(
      env.ORDER_EXPIRY_POLL_INTERVAL_MS ?? "5000",
      "ORDER_EXPIRY_POLL_INTERVAL_MS",
      1_000,
      60_000
    ),
    reminderBatchSize: parseBoundedInteger(
      env.EVENT_REMINDER_BATCH_SIZE ?? "50",
      "EVENT_REMINDER_BATCH_SIZE",
      1,
      500
    ),
    reminderPollIntervalMs: parseBoundedInteger(
      env.EVENT_REMINDER_POLL_INTERVAL_MS ?? "300000",
      "EVENT_REMINDER_POLL_INTERVAL_MS",
      60_000,
      3_600_000
    ),
    phoneDefaultCountry: env.TELEGRAM_DEFAULT_COUNTRY ?? "RU",
    eventCampaignSyncBatchSize: parseBoundedInteger(
      env.EVENT_CAMPAIGN_SYNC_BATCH_SIZE ?? "20",
      "EVENT_CAMPAIGN_SYNC_BATCH_SIZE",
      1,
      200
    ),
    // Минута: администратор заводит участника руками и почти сразу идёт в кампанию его
    // обзванивать. Проход дешёвый — кампании без изменений отсекаются одним запросом.
    eventCampaignSyncPollIntervalMs: parseBoundedInteger(
      env.EVENT_CAMPAIGN_SYNC_POLL_INTERVAL_MS ?? "60000",
      "EVENT_CAMPAIGN_SYNC_POLL_INTERVAL_MS",
      10_000,
      3_600_000
    ),
    autoTaskBatchSize: parseBoundedInteger(
      env.AUTO_TASK_BATCH_SIZE ?? "100",
      "AUTO_TASK_BATCH_SIZE",
      1,
      1_000
    ),
    // Пять минут: автозадача — это напоминание на завтра или на следующий день, и минута
    // задержки здесь ничего не решает. Проход отбирает поводы одним запросом.
    autoTaskPollIntervalMs: parseBoundedInteger(
      env.AUTO_TASK_POLL_INTERVAL_MS ?? "300000",
      "AUTO_TASK_POLL_INTERVAL_MS",
      30_000,
      3_600_000
    ),
    zvonobotBatchSize: parseBoundedInteger(
      env.ZVONOBOT_BATCH_SIZE ?? "100",
      "ZVONOBOT_BATCH_SIZE",
      1,
      1_000
    ),
    // Минута: человек только что сказал роботу «интересно», и звонок по горячему следу —
    // это и есть весь смысл затеи. Проход по пустой очереди стоит одного запроса.
    zvonobotPollIntervalMs: parseBoundedInteger(
      env.ZVONOBOT_POLL_INTERVAL_MS ?? "60000",
      "ZVONOBOT_POLL_INTERVAL_MS",
      10_000,
      3_600_000
    ),
    zvonobotSystemAdminId: "00000000-0000-4000-8000-000000000003",
    conversationAttachments: loadConversationAttachmentsConfig(env),
    conversationReplies: loadConversationRepliesConfig(env),
    max: loadMaxChannelConfig(env),
    tbankReconciliation,
    telegramNotifications
  };
}

/** Канал MAX: без токена бота не поднимается вовсе. */
function loadMaxChannelConfig(env: NodeJS.ProcessEnv): MaxChannelConfig {
  const botToken = (env.MAX_BOT_TOKEN ?? "").trim();
  if (botToken === "") {
    return { enabled: false };
  }
  const pathSecret = (env.MAX_WEBHOOK_PATH_SECRET ?? "").trim();
  if (pathSecret.length < 16) {
    throw new Error("MAX_WEBHOOK_PATH_SECRET must be at least 16 characters long");
  }
  const headerSecret = (env.MAX_WEBHOOK_SECRET ?? "").trim();
  const botUsername = (env.MAX_BOT_USERNAME ?? "").trim();

  return {
    enabled: true,
    botToken,
    apiBaseUrl: env.MAX_API_BASE_URL ?? "https://platform-api2.max.ru",
    pathSecret,
    headerSecret: headerSecret === "" ? null : headerSecret,
    bodyLimitBytes: parseBoundedInteger(
      env.MAX_WEBHOOK_BODY_LIMIT_BYTES ?? "262144",
      "MAX_WEBHOOK_BODY_LIMIT_BYTES",
      1_024,
      1_048_576
    ),
    botUsername: botUsername === "" ? null : botUsername,
    httpTimeoutMs: parseBoundedInteger(
      env.MAX_HTTP_TIMEOUT_MS ?? "10000",
      "MAX_HTTP_TIMEOUT_MS",
      1_000,
      60_000
    )
  };
}

/** Приёмник Звонобота: без ключа путь не поднимается вовсе. */
function loadZvonobotConfig(env: NodeJS.ProcessEnv): ZvonobotConfig {
  const secret = (env.ZVONOBOT_WEBHOOK_SECRET ?? "").trim();
  if (secret === "") {
    return { enabled: false };
  }
  if (secret.length < 16) {
    throw new Error("ZVONOBOT_WEBHOOK_SECRET must be at least 16 characters long");
  }
  return {
    enabled: true,
    secret,
    bodyLimitBytes: parseBoundedInteger(
      env.ZVONOBOT_BODY_LIMIT_BYTES ?? "65536",
      "ZVONOBOT_BODY_LIMIT_BYTES",
      1_024,
      1_048_576
    )
  };
}

function parseAppEnvironment(value: string): AppEnvironment {
  if (value === "local" || value === "test" || value === "staging" || value === "production") {
    return value;
  }

  throw new Error(`Unsupported APP_ENV: ${value}`);
}

function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function parseTelegramDeliveryMode(value: string): TelegramDeliveryMode {
  if (value === "long-polling" || value === "webhook") {
    return value;
  }

  throw new Error(`Unsupported TELEGRAM_DELIVERY_MODE: ${value}`);
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function parseBoundedInteger(value: string, name: string, min: number, max: number): number {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }

  return parsed;
}

function parseBoolean(value: string, name: string): boolean {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error(`${name} must be true or false`);
}

function parseSecret(value: string | undefined, name: string): string {
  const secret = required(value, name);

  if (!/^[A-Za-z0-9_-]{32,256}$/.test(secret)) {
    throw new Error(`${name} must contain 32-256 URL-safe characters`);
  }

  return secret;
}

function parsePostgresIdentifier(value: string, name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,49}$/.test(value)) {
    throw new Error(`${name} must be a PostgreSQL identifier of at most 50 characters`);
  }

  return value;
}

function parseHttpsIssuer(value: string | undefined, name: string): string {
  const raw = required(value, name);
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be a valid HTTPS URL`);
  }

  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new Error(`${name} must be a valid HTTPS URL`);
  }

  return url.toString().replace(/\/$/, "");
}

function parseHttpsBaseUrl(value: string | undefined, name: string): string {
  const raw = required(value, name);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be a valid HTTPS base URL`);
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.search
    || url.hash
    || (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error(`${name} must be a valid HTTPS base URL`);
  }
  return url.origin;
}

function parseStorageBucket(value: string): string {
  if (!/^[a-z0-9][a-z0-9._-]{1,62}$/.test(value)) {
    throw new Error(
      "OFFER_STORAGE_BUCKET must contain 2-63 lowercase safe characters"
    );
  }
  return value;
}

function parseAudience(value: string): string {
  if (!/^[A-Za-z0-9._:/-]{1,128}$/.test(value)) {
    throw new Error("ADMIN_AUTH_AUDIENCE must contain 1-128 safe characters");
  }

  return value;
}

function parseOrderNumberPrefix(value: string): string {
  if (!/^[A-Z0-9]{2,6}$/.test(value)) {
    throw new Error("ORDER_NUMBER_PREFIX must contain 2-6 uppercase letters or digits");
  }

  return value;
}

/** Optional https:// base URL of a proxy standing in for api.telegram.org. */
function parseOptionalApiRoot(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (!/^https:\/\/.+[^/]$/.test(trimmed)) {
    throw new Error("TELEGRAM_API_ROOT must be an https:// URL without a trailing slash");
  }

  return trimmed;
}

/** Accepts one chat ID, or several separated by commas (e.g. "111,222"). */
function parseTelegramChatIds(value: string | undefined, name: string): readonly string[] {
  const raw = required(value, name);
  const chatIds = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (chatIds.length === 0) {
    throw new Error(`${name} must contain at least one numeric Telegram chat ID`);
  }

  for (const chatId of chatIds) {
    if (!/^-?\d{1,20}$/.test(chatId)) {
      throw new Error(`${name} must contain only numeric Telegram chat IDs`);
    }
  }

  return chatIds;
}

function loadTBankPaymentsConfig(
  env: NodeJS.ProcessEnv,
  appEnv: AppEnvironment
): TBankPaymentsConfig {
  const enabled = parseBoolean(
    env.TBANK_PAYMENTS_ENABLED ?? "false",
    "TBANK_PAYMENTS_ENABLED"
  );
  const bodyLimitBytes = parseBoundedInteger(
    env.TBANK_WEBHOOK_BODY_LIMIT_BYTES ?? "65536",
    "TBANK_WEBHOOK_BODY_LIMIT_BYTES",
    1_024,
    262_144
  );
  if (!enabled) {
    return { enabled: false, bodyLimitBytes };
  }

  const apiBaseUrl = parseTBankApiBaseUrl(
    env.TBANK_API_BASE_URL ?? "https://rest-api-test.tinkoff.ru/v2"
  );
  if (
    appEnv === "production"
    && apiBaseUrl !== "https://securepay.tinkoff.ru/v2"
  ) {
    throw new Error("Production T-Bank API URL must use the official production host");
  }
  if (env.TBANK_PAY_TYPE !== undefined && env.TBANK_PAY_TYPE !== "O") {
    throw new Error("TBANK_PAY_TYPE must be O for one-stage payments");
  }

  return {
    enabled: true,
    bodyLimitBytes,
    apiBaseUrl,
    terminalKey: parseBoundedValue(
      env.TBANK_TERMINAL_KEY,
      "TBANK_TERMINAL_KEY",
      1,
      64
    ),
    password: parseBoundedValue(env.TBANK_PASSWORD, "TBANK_PASSWORD", 1, 200),
    notificationUrl: parseTBankCallbackUrl(
      env.TBANK_NOTIFICATION_URL,
      "TBANK_NOTIFICATION_URL"
    ),
    successUrl: parseTBankCallbackUrl(env.TBANK_SUCCESS_URL, "TBANK_SUCCESS_URL"),
    failUrl: parseTBankCallbackUrl(env.TBANK_FAIL_URL, "TBANK_FAIL_URL"),
    payType: "O",
    timeoutMs: parseBoundedInteger(
      env.TBANK_HTTP_TIMEOUT_MS ?? "8000",
      "TBANK_HTTP_TIMEOUT_MS",
      1_000,
      30_000
    )
  };
}

function loadTBankReconciliationConfig(
  env: NodeJS.ProcessEnv,
  appEnv: AppEnvironment
): TBankReconciliationConfig {
  const enabled = parseBoolean(
    env.TBANK_RECONCILIATION_ENABLED ?? "false",
    "TBANK_RECONCILIATION_ENABLED"
  );
  if (!enabled) {
    return { enabled: false };
  }

  const apiBaseUrl = parseTBankApiBaseUrl(
    env.TBANK_API_BASE_URL ?? "https://rest-api-test.tinkoff.ru/v2"
  );
  if (
    appEnv === "production"
    && apiBaseUrl !== "https://securepay.tinkoff.ru/v2"
  ) {
    throw new Error("Production T-Bank API URL must use the official production host");
  }
  const retryBaseSeconds = parseBoundedInteger(
    env.TBANK_RECONCILIATION_RETRY_BASE_SECONDS ?? "30",
    "TBANK_RECONCILIATION_RETRY_BASE_SECONDS",
    5,
    3_600
  );
  const timeoutMs = parseBoundedInteger(
    env.TBANK_HTTP_TIMEOUT_MS ?? "8000",
    "TBANK_HTTP_TIMEOUT_MS",
    1_000,
    30_000
  );
  const batchSize = parseBoundedInteger(
    env.TBANK_RECONCILIATION_BATCH_SIZE ?? "10",
    "TBANK_RECONCILIATION_BATCH_SIZE",
    1,
    100
  );
  const leaseSeconds = parseBoundedInteger(
    env.TBANK_RECONCILIATION_LEASE_SECONDS ?? "120",
    "TBANK_RECONCILIATION_LEASE_SECONDS",
    10,
    3_600
  );
  if (leaseSeconds * 1_000 < batchSize * timeoutMs + 10_000) {
    throw new Error(
      "TBANK_RECONCILIATION_LEASE_SECONDS must cover the bounded batch timeout"
    );
  }

  return {
    enabled: true,
    apiBaseUrl,
    terminalKey: parseBoundedValue(
      env.TBANK_TERMINAL_KEY,
      "TBANK_TERMINAL_KEY",
      1,
      64
    ),
    password: parseBoundedValue(env.TBANK_PASSWORD, "TBANK_PASSWORD", 1, 200),
    ticketTokenSecret: parseSecret(
      env.ORDER_TOKEN_SECRET
        ?? (appEnv === "production"
          ? undefined
          : "local-only-order-token-secret-change-me"),
      "ORDER_TOKEN_SECRET"
    ),
    timeoutMs,
    batchSize,
    leaseSeconds,
    pollIntervalMs: parseBoundedInteger(
      env.TBANK_RECONCILIATION_POLL_INTERVAL_MS ?? "15000",
      "TBANK_RECONCILIATION_POLL_INTERVAL_MS",
      1_000,
      300_000
    ),
    initialDelaySeconds: parseBoundedInteger(
      env.TBANK_RECONCILIATION_INITIAL_DELAY_SECONDS ?? "60",
      "TBANK_RECONCILIATION_INITIAL_DELAY_SECONDS",
      30,
      86_400
    ),
    retryBaseSeconds,
    retryMaxSeconds: parseBoundedInteger(
      env.TBANK_RECONCILIATION_RETRY_MAX_SECONDS ?? "3600",
      "TBANK_RECONCILIATION_RETRY_MAX_SECONDS",
      retryBaseSeconds,
      86_400
    ),
    emptyObservationThreshold: parseBoundedInteger(
      env.TBANK_RECONCILIATION_EMPTY_THRESHOLD ?? "3",
      "TBANK_RECONCILIATION_EMPTY_THRESHOLD",
      2,
      10
    )
  };
}

function parseTBankApiBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("TBANK_API_BASE_URL must be an official HTTPS T-Bank v2 URL");
  }
  if (
    url.protocol !== "https:"
    || !["securepay.tinkoff.ru", "rest-api-test.tinkoff.ru"].includes(url.hostname)
    || url.port
    || url.pathname.replace(/\/+$/, "") !== "/v2"
    || url.search
    || url.hash
  ) {
    throw new Error("TBANK_API_BASE_URL must be an official HTTPS T-Bank v2 URL");
  }
  return `${url.origin}/v2`;
}

function parseTBankCallbackUrl(value: string | undefined, name: string): string {
  const raw = parseBoundedValue(value, name, 1, 250);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be a valid HTTPS URL`);
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error(`${name} must be a valid HTTPS URL`);
  }
  return url.toString();
}

function parseBoundedValue(
  value: string | undefined,
  name: string,
  minimum: number,
  maximum: number
): string {
  const parsed = required(value, name);
  if (parsed.length < minimum || parsed.length > maximum) {
    throw new Error(`${name} must contain ${minimum}-${maximum} characters`);
  }
  return parsed;
}
