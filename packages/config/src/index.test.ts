import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadApiConfig, loadTelegramBotConfig, loadWorkerConfig } from "./index.js";

describe("loadTelegramBotConfig", () => {
  it("loads long polling defaults for local development", () => {
    const config = loadTelegramBotConfig(validEnvironment());

    assert.equal(config.telegramDeliveryMode, "long-polling");
    assert.equal(config.telegramDefaultCountry, "RU");
    assert.equal(config.databasePoolMax, 10);
    assert.equal(config.orderNumberPrefix, "BP");
    assert.match(config.orderTokenSecret, /^local-only/);
    assert.deepEqual(config.tbankPayments, {
      enabled: false,
      bodyLimitBytes: 65_536
    });
  });

  it("defaults production to webhook without registering it", () => {
    const config = loadTelegramBotConfig(validEnvironment({
      APP_ENV: "production",
      ORDER_TOKEN_SECRET: "production-order-token-secret-123456789",
      TBANK_API_BASE_URL: "https://securepay.tinkoff.ru/v2"
    }));

    assert.equal(config.telegramDeliveryMode, "webhook");
  });

  it("shares the order token secret and prefix with the API, and defaults the purchase event slug", () => {
    const config = loadTelegramBotConfig(validEnvironment());

    assert.equal(config.orderTokenSecret, "local-only-order-token-secret-change-me");
    assert.equal(config.orderNumberPrefix, "BP");
    assert.equal(config.purchaseEventSlug, "business-picnic-2026");
  });

  it("requires an explicit order token secret in production", () => {
    assert.throws(
      () => loadTelegramBotConfig(validEnvironment({
        APP_ENV: "production",
        TBANK_API_BASE_URL: "https://securepay.tinkoff.ru/v2"
      })),
      /ORDER_TOKEN_SECRET/
    );
  });

  it("rejects invalid delivery mode and pool size", () => {
    assert.throws(
      () => loadTelegramBotConfig(validEnvironment({ TELEGRAM_DELIVERY_MODE: "automatic" })),
      /Unsupported TELEGRAM_DELIVERY_MODE/
    );
    assert.throws(
      () => loadTelegramBotConfig(validEnvironment({ DATABASE_POOL_MAX: "0" })),
      /DATABASE_POOL_MAX must be a positive integer/
    );
  });

  it("loads an explicitly enabled one-stage T-Bank integration", () => {
    const config = loadTelegramBotConfig(tbankEnvironment());

    assert.equal(config.tbankPayments.enabled, true);
    if (config.tbankPayments.enabled) {
      assert.equal(config.tbankPayments.apiBaseUrl, "https://rest-api-test.tinkoff.ru/v2");
      assert.equal(config.tbankPayments.payType, "O");
      assert.equal(config.tbankPayments.timeoutMs, 8_000);
    }
  });
});

describe("loadApiConfig", () => {
  it("keeps the webhook disabled by default outside production", () => {
    const config = loadApiConfig(validEnvironment());

    assert.equal(config.telegramWebhook.enabled, false);
    assert.equal(config.telegramWebhook.bodyLimitBytes, 262_144);
    assert.equal(config.apiPort, 3000);
    assert.equal(config.pgBossSchema, "pgboss");
    assert.equal(config.workerHeartbeatDegradedSeconds, 30);
    assert.equal(config.workerHeartbeatFailedSeconds, 60);
    assert.equal(config.outboxLagDegradedSeconds, 60);
    assert.equal(config.outboxLagFailedSeconds, 300);
    assert.equal(config.adminAuth.enabled, false);
    assert.deepEqual(config.offerStorage, { enabled: false });
    assert.equal(config.orderNumberPrefix, "BP");
    assert.match(config.orderTokenSecret, /^local-only/);
    assert.equal(config.tbankPayments.enabled, false);
    assert.equal(config.purchaseEventSlug, "business-picnic-2026");
  });

  it("rejects unsafe T-Bank endpoints and incomplete credentials", () => {
    assert.throws(
      () => loadApiConfig(tbankEnvironment({
        TBANK_API_BASE_URL: "https://example.com/v2"
      })),
      /TBANK_API_BASE_URL/
    );
    assert.throws(
      () => loadApiConfig(tbankEnvironment({
        TBANK_NOTIFICATION_URL: "http://example.com/webhook"
      })),
      /TBANK_NOTIFICATION_URL/
    );
    assert.throws(
      () => loadApiConfig(tbankEnvironment({ TBANK_PAY_TYPE: "T" })),
      /TBANK_PAY_TYPE/
    );
  });

  it("requires two independent URL-safe webhook secrets when enabled", () => {
    const config = loadApiConfig(validEnvironment({
      TELEGRAM_WEBHOOK_ENABLED: "true",
      TELEGRAM_WEBHOOK_PATH_SECRET: "path_secret_12345678901234567890",
      TELEGRAM_WEBHOOK_SECRET: "header_secret_123456789012345678"
    }));

    assert.equal(config.telegramWebhook.enabled, true);
    if (config.telegramWebhook.enabled) {
      assert.equal(config.telegramWebhook.pathSecret, "path_secret_12345678901234567890");
      assert.equal(config.telegramWebhook.headerSecret, "header_secret_123456789012345678");
    }
  });

  it("loads a trusted admin auth issuer and audience", () => {
    const config = loadApiConfig(validEnvironment({
      ADMIN_AUTH_ENABLED: "true",
      ADMIN_AUTH_ISSUER: "https://project.supabase.co/auth/v1/",
      ADMIN_AUTH_AUDIENCE: "authenticated"
    }));

    assert.deepEqual(config.adminAuth, {
      enabled: true,
      issuer: "https://project.supabase.co/auth/v1",
      audience: "authenticated"
    });
  });

  it("loads a bounded server-only immutable offer storage configuration", () => {
    const config = loadApiConfig(validEnvironment({
      OFFER_STORAGE_ENABLED: "true",
      OFFER_STORAGE_SUPABASE_URL: "https://project.supabase.co",
      OFFER_STORAGE_SERVICE_ROLE_KEY: "s".repeat(48),
      OFFER_STORAGE_BUCKET: "offer-snapshots"
    }));

    assert.deepEqual(config.offerStorage, {
      enabled: true,
      supabaseUrl: "https://project.supabase.co",
      serviceRoleKey: "s".repeat(48),
      bucket: "offer-snapshots"
    });
    assert.throws(
      () => loadApiConfig(validEnvironment({
        OFFER_STORAGE_ENABLED: "true",
        OFFER_STORAGE_SUPABASE_URL: "http://project.supabase.co",
        OFFER_STORAGE_SERVICE_ROLE_KEY: "s".repeat(48)
      })),
      /OFFER_STORAGE_SUPABASE_URL/
    );
  });

  it("rejects weak secrets and oversized body limits", () => {
    assert.throws(
      () => loadApiConfig(validEnvironment({
        TELEGRAM_WEBHOOK_ENABLED: "true",
        TELEGRAM_WEBHOOK_PATH_SECRET: "short",
        TELEGRAM_WEBHOOK_SECRET: "header_secret_123456789012345678"
      })),
      /TELEGRAM_WEBHOOK_PATH_SECRET/
    );
    assert.throws(
      () => loadApiConfig(validEnvironment({ TELEGRAM_WEBHOOK_BODY_LIMIT_BYTES: "1048577" })),
      /TELEGRAM_WEBHOOK_BODY_LIMIT_BYTES/
    );
    assert.throws(
      () => loadApiConfig(validEnvironment({
        HEALTH_WORKER_HEARTBEAT_DEGRADED_SECONDS: "60",
        HEALTH_WORKER_HEARTBEAT_FAILED_SECONDS: "60"
      })),
      /HEALTH_WORKER_HEARTBEAT_FAILED_SECONDS/
    );
    assert.throws(
      () => loadApiConfig(validEnvironment({
        HEALTH_OUTBOX_LAG_DEGRADED_SECONDS: "301",
        HEALTH_OUTBOX_LAG_FAILED_SECONDS: "300"
      })),
      /HEALTH_OUTBOX_LAG_FAILED_SECONDS/
    );
    assert.throws(
      () => loadApiConfig(validEnvironment({
        ADMIN_AUTH_ENABLED: "true",
        ADMIN_AUTH_ISSUER: "http://project.supabase.co/auth/v1"
      })),
      /ADMIN_AUTH_ISSUER/
    );
    assert.throws(
      () => loadApiConfig(validEnvironment({
        APP_ENV: "production",
        TBANK_API_BASE_URL: "https://securepay.tinkoff.ru/v2",
        TELEGRAM_WEBHOOK_ENABLED: "false",
        ADMIN_AUTH_ENABLED: "false"
      })),
      /ORDER_TOKEN_SECRET/
    );
  });
});

describe("loadWorkerConfig", () => {
  it("loads bounded outbox and heartbeat defaults", () => {
    const config = loadWorkerConfig(validEnvironment());

    assert.equal(config.pgBossSchema, "pgboss");
    assert.equal(config.outboxBatchSize, 50);
    assert.equal(config.outboxLockLeaseSeconds, 60);
    assert.equal(config.outboxRetryBaseSeconds, 5);
    assert.equal(config.outboxRetryMaxSeconds, 300);
    assert.equal(config.outboxPollIntervalMs, 1_000);
    assert.equal(config.workerHeartbeatIntervalMs, 10_000);
    assert.equal(config.orderExpiryBatchSize, 50);
    assert.equal(config.orderExpiryPollIntervalMs, 5_000);
    assert.equal(config.reminderBatchSize, 50);
    assert.equal(config.reminderPollIntervalMs, 300_000);
    assert.deepEqual(config.tbankReconciliation, { enabled: false });
    assert.deepEqual(config.telegramNotifications, { enabled: false });
  });

  it("loads an explicitly enabled bounded T-Bank reconciliation worker", () => {
    const config = loadWorkerConfig(validEnvironment({
      TBANK_RECONCILIATION_ENABLED: "true",
      TBANK_TERMINAL_KEY: "test-terminal",
      TBANK_PASSWORD: "test-password"
    }));

    assert.deepEqual(config.tbankReconciliation, {
      enabled: true,
      apiBaseUrl: "https://rest-api-test.tinkoff.ru/v2",
      terminalKey: "test-terminal",
      password: "test-password",
      ticketTokenSecret: "local-only-order-token-secret-change-me",
      timeoutMs: 8_000,
      batchSize: 10,
      leaseSeconds: 120,
      pollIntervalMs: 15_000,
      initialDelaySeconds: 60,
      retryBaseSeconds: 30,
      retryMaxSeconds: 3_600,
      emptyObservationThreshold: 3
    });
  });

  it("loads explicitly enabled Telegram notification delivery", () => {
    const config = loadWorkerConfig(validEnvironment({
      TELEGRAM_NOTIFICATIONS_ENABLED: "true",
      ADMIN_NOTIFICATION_TELEGRAM_CHAT_ID: "-1001234567890",
      ORDER_TOKEN_SECRET: "s".repeat(32)
    }));

    assert.deepEqual(config.telegramNotifications, {
      enabled: true,
      botToken: "test-token",
      adminChatIds: ["-1001234567890"],
      ticketTokenSecret: "s".repeat(32),
      leaseSeconds: 60,
      localConcurrency: 2
    });
  });

  it("loads multiple comma-separated administrator chat IDs", () => {
    const config = loadWorkerConfig(validEnvironment({
      TELEGRAM_NOTIFICATIONS_ENABLED: "true",
      ADMIN_NOTIFICATION_TELEGRAM_CHAT_ID: "376802789, 5596675886",
      ORDER_TOKEN_SECRET: "s".repeat(32)
    }));

    assert.equal(config.telegramNotifications.enabled, true);
    assert.deepEqual(
      config.telegramNotifications.enabled ? config.telegramNotifications.adminChatIds : [],
      ["376802789", "5596675886"]
    );
  });

  it("rejects runtime queue migrations and invalid bounds", () => {
    assert.throws(
      () => loadWorkerConfig(validEnvironment({ PG_BOSS_MIGRATE: "true" })),
      /Runtime pg-boss migrations are prohibited/
    );
    assert.throws(
      () => loadWorkerConfig(validEnvironment({ OUTBOX_BATCH_SIZE: "501" })),
      /OUTBOX_BATCH_SIZE/
    );
    assert.throws(
      () => loadWorkerConfig(validEnvironment({
        OUTBOX_RETRY_BASE_SECONDS: "10",
        OUTBOX_RETRY_MAX_SECONDS: "5"
      })),
      /OUTBOX_RETRY_MAX_SECONDS/
    );
    assert.throws(
      () => loadWorkerConfig(validEnvironment({ PG_BOSS_SCHEMA: "unsafe-schema" })),
      /PG_BOSS_SCHEMA/
    );
    assert.throws(
      () => loadWorkerConfig(validEnvironment({ ORDER_EXPIRY_BATCH_SIZE: "501" })),
      /ORDER_EXPIRY_BATCH_SIZE/
    );
    assert.throws(
      () => loadWorkerConfig(validEnvironment({ ORDER_EXPIRY_POLL_INTERVAL_MS: "999" })),
      /ORDER_EXPIRY_POLL_INTERVAL_MS/
    );
    assert.throws(
      () => loadWorkerConfig(validEnvironment({
        TELEGRAM_NOTIFICATIONS_ENABLED: "true",
        ADMIN_NOTIFICATION_TELEGRAM_CHAT_ID: "not-a-chat"
      })),
      /ADMIN_NOTIFICATION_TELEGRAM_CHAT_ID/
    );
    assert.throws(
      () => loadWorkerConfig(validEnvironment({
        TBANK_RECONCILIATION_ENABLED: "true",
        TBANK_TERMINAL_KEY: "test-terminal",
        TBANK_PASSWORD: "test-password",
        TBANK_RECONCILIATION_RETRY_BASE_SECONDS: "60",
        TBANK_RECONCILIATION_RETRY_MAX_SECONDS: "30"
      })),
      /TBANK_RECONCILIATION_RETRY_MAX_SECONDS/
    );
    assert.throws(
      () => loadWorkerConfig(validEnvironment({
        TBANK_RECONCILIATION_ENABLED: "true",
        TBANK_TERMINAL_KEY: "test-terminal",
        TBANK_PASSWORD: "test-password",
        TBANK_RECONCILIATION_LEASE_SECONDS: "60"
      })),
      /bounded batch timeout/
    );
  });
});

function validEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    APP_ENV: "local",
    DATABASE_URL: "postgresql://local/database",
    DATABASE_DIRECT_URL: "postgresql://local/database",
    TELEGRAM_BOT_TOKEN: "test-token",
    ...overrides
  };
}

function tbankEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return validEnvironment({
    TBANK_PAYMENTS_ENABLED: "true",
    TBANK_TERMINAL_KEY: "test-terminal",
    TBANK_PASSWORD: "test-password",
    TBANK_API_BASE_URL: "https://rest-api-test.tinkoff.ru/v2",
    TBANK_NOTIFICATION_URL: "https://example.com/webhooks/payments/tbank",
    TBANK_SUCCESS_URL: "https://example.com/payments/success",
    TBANK_FAIL_URL: "https://example.com/payments/fail",
    TBANK_PAY_TYPE: "O",
    ...overrides
  });
}
