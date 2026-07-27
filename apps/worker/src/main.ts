import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  ConfirmPaymentService,
  DispatchOutboxBatchService,
  ExpireOrdersBatchService,
  HandleNotificationJobService,
  HmacTicketReferenceGenerator,
  ReconcileTBankPaymentsBatchService,
  ReconcileTBankRefundsBatchService,
  ResumeTelegramScenarioAfterPaymentService,
  SendEventRemindersBatchService,
  type IdGenerator
} from "@ticket-platform/application";
import { loadWorkerConfig } from "@ticket-platform/config";
import type { DomainEventJobV1 } from "@ticket-platform/contracts";
import {
  createEventReminderPersistence,
  createNotificationDeliveryPersistence,
  createNodePostgresPool,
  createOrderExpiryPersistence,
  createParticipantQuestionnairePersistence,
  createPaymentConfirmationPersistence,
  createScenarioRuntimePersistence,
  createTBankReconciliationPersistence,
  createTBankRefundPersistence,
  PostgresOutboxDispatchRepository,
  PostgresWorkerHeartbeatRepository
} from "@ticket-platform/database";
import { createTelegramNotificationSender } from "@ticket-platform/messenger-telegram";
import { createLogger } from "@ticket-platform/observability";
import { TBankPaymentProvider } from "@ticket-platform/payment-tbank";
import { QrTicketPngRenderer } from "@ticket-platform/ticket-rendering";
import { PgBoss } from "pg-boss";
import { v7 as uuidv7 } from "uuid";
import {
  assertPgBossQueuesProvisioned,
  OUTBOX_DISPATCH_QUEUE,
  PgBossOutboxPublisher
} from "./pgboss.js";

export async function bootstrapWorker(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const config = loadWorkerConfig(env);
  const logger = createLogger({ service: "worker", environment: config.appEnv });
  const workerId = env.WORKER_ID
    ?? env.RAILWAY_REPLICA_ID
    ?? `${hostname()}-${process.pid}-${randomUUID()}`;
  const startedAt = new Date();
  const abortController = new AbortController();
  const pool = createNodePostgresPool({
    connectionString: config.databaseUrl,
    maxConnections: config.databasePoolMax,
    applicationName: "ticket-platform-worker",
    onIdleClientError(error) {
      logger.error("postgres idle client failed", { errorType: error.name });
    }
  });
  const boss = new PgBoss({
    connectionString: config.databaseUrl,
    schema: config.pgBossSchema,
    max: config.databasePoolMax,
    application_name: "ticket-platform-worker-pgboss",
    migrate: false,
    schedule: false,
    useListenNotify: false
  });
  const heartbeat = new PostgresWorkerHeartbeatRepository(pool);
  const idGenerator: IdGenerator = { newId: uuidv7 };
  const expiryPersistence = createOrderExpiryPersistence(pool);
  const expireOrders = new ExpireOrdersBatchService(
    expiryPersistence.orderExpiryRepository,
    expiryPersistence.outboxWriter,
    expiryPersistence.unitOfWork,
    idGenerator
  );
  const dispatch = new DispatchOutboxBatchService(
    new PostgresOutboxDispatchRepository(pool),
    new PgBossOutboxPublisher(boss)
  );
  const reminderPersistence = createEventReminderPersistence(pool, idGenerator);
  const sendReminders = new SendEventRemindersBatchService(
    reminderPersistence.eventReminderRepository,
    reminderPersistence.outboxWriter,
    reminderPersistence.unitOfWork,
    idGenerator
  );
  const tbankReconciliation = config.tbankReconciliation.enabled
    ? (() => {
        const provider = new TBankPaymentProvider({
          baseUrl: config.tbankReconciliation.apiBaseUrl,
          terminalKey: config.tbankReconciliation.terminalKey,
          password: config.tbankReconciliation.password,
          timeoutMs: config.tbankReconciliation.timeoutMs
        });
        const confirmationPersistence = createPaymentConfirmationPersistence(
          pool,
          idGenerator
        );
        const confirmation = new ConfirmPaymentService(
          confirmationPersistence.paymentConfirmationRepository,
          confirmationPersistence.outboxWriter,
          confirmationPersistence.unitOfWork,
          idGenerator,
          new HmacTicketReferenceGenerator(
            config.tbankReconciliation.ticketTokenSecret
          ),
          confirmationPersistence.referralCommissionRepository
        );
        return {
          payments: new ReconcileTBankPaymentsBatchService(
            createTBankReconciliationPersistence(pool),
            provider,
            confirmation,
            idGenerator
          ),
          refunds: new ReconcileTBankRefundsBatchService(
            createTBankRefundPersistence(pool),
            provider,
            provider,
            idGenerator
          )
        };
      })()
    : undefined;
  let currentJobId: string | null = null;
  let heartbeatInFlight = false;
  let nextOrderExpirySweepAt = 0;
  let nextReminderSweepAt = 0;
  let nextTBankReconciliationSweepAt = 0;
  let lastOrderExpirySweepAt: string | null = null;
  let lastReminderSweepAt: string | null = null;
  let lastTBankReconciliationSweepAt: string | null = null;
  const orderExpiryWorkload = "order-expiry";
  const reminderWorkload = "event-reminders";
  const tbankReconciliationWorkload = "tbank-reconciliation";
  const workloads = [
    OUTBOX_DISPATCH_QUEUE,
    orderExpiryWorkload,
    reminderWorkload,
    ...(tbankReconciliation ? [tbankReconciliationWorkload] : [])
  ];

  boss.on("error", (error) => {
    logger.error("pg-boss failed", { errorType: error.name });
  });
  boss.on("warning", (warning) => {
    logger.error("pg-boss warning", { warningType: warning.message });
  });

  const stop = () => abortController.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  const recordHeartbeat = async () => {
    if (heartbeatInFlight) {
      return;
    }

    heartbeatInFlight = true;
    try {
      await heartbeat.record({
        workerId,
        serviceName: "worker",
        queues: workloads,
        version: config.appVersion,
        startedAt,
        currentJobId,
        metadata: {
          runtime: "node",
          queueDriver: "pg-boss",
          lastOrderExpirySweepAt,
          lastReminderSweepAt,
          lastTBankReconciliationSweepAt
        }
      });
    } catch (error) {
      logger.error("worker heartbeat failed", {
        errorType: error instanceof Error ? error.name : "UnknownError"
      });
    } finally {
      heartbeatInFlight = false;
    }
  };
  const heartbeatTimer = setInterval(
    () => void recordHeartbeat(),
    config.workerHeartbeatIntervalMs
  );

  try {
    await pool.ping();
    await boss.start();
    await assertPgBossQueuesProvisioned(boss);
    const notificationConfig = config.telegramNotifications;
    if (notificationConfig.enabled) {
      const notificationPersistence = createNotificationDeliveryPersistence(pool);
      const questionnairePersistence = createParticipantQuestionnairePersistence(pool, idGenerator);
      const scenarioPersistence = createScenarioRuntimePersistence(pool, idGenerator);
      const scenarioPaymentContinuation =
        new ResumeTelegramScenarioAfterPaymentService(
          scenarioPersistence.repository,
          scenarioPersistence.unitOfWork,
          scenarioPersistence.outboxWriter,
          idGenerator
        );
      const notificationHandler = new HandleNotificationJobService(
        notificationPersistence.notificationContexts,
        notificationPersistence.notificationLedger,
        createTelegramNotificationSender(notificationConfig.botToken, notificationConfig.apiRoot),
        new HmacTicketReferenceGenerator(notificationConfig.ticketTokenSecret),
        new QrTicketPngRenderer(),
        idGenerator,
        notificationConfig.adminChatIds,
        scenarioPaymentContinuation,
        notificationPersistence.notificationContexts,
        questionnairePersistence.questionnaireDraftRepository,
        notificationPersistence.notificationContexts,
        notificationPersistence.notificationContexts
      );

      await boss.work<DomainEventJobV1>(
        OUTBOX_DISPATCH_QUEUE,
        {
          batchSize: 1,
          localConcurrency: notificationConfig.localConcurrency
        },
        async (jobs) => {
          for (const job of jobs) {
            currentJobId = job.id;
            try {
              const result = await notificationHandler.execute({
                job: job.data,
                workerId,
                handledAt: new Date(),
                leaseSeconds: notificationConfig.leaseSeconds
              });
              if (result.delivered > 0 || result.duplicates > 0) {
                logger.info("notification domain event handled", {
                  eventType: result.eventType,
                  delivered: result.delivered,
                  duplicates: result.duplicates
                });
              }
            } catch (error) {
              logger.error("notification domain event failed", {
                jobId: job.id,
                errorType: error instanceof Error ? error.name : "UnknownError"
              });
              throw error;
            } finally {
              currentJobId = null;
            }
          }
        }
      );
    } else {
      logger.info("telegram notification consumer disabled", {
        queue: OUTBOX_DISPATCH_QUEUE
      });
    }
    await recordHeartbeat();
    logger.info("worker started", {
      version: config.appVersion,
      workerId,
      queues: workloads
    });

    while (!abortController.signal.aborted) {
      currentJobId = OUTBOX_DISPATCH_QUEUE;

      try {
        const result = await dispatch.execute({
          workerId,
          batchSize: config.outboxBatchSize,
          lockLeaseSeconds: config.outboxLockLeaseSeconds,
          retryBaseSeconds: config.outboxRetryBaseSeconds,
          retryMaxSeconds: config.outboxRetryMaxSeconds
        });

        if (result.claimed > 0) {
          logger.info("outbox batch dispatched", {
            claimed: result.claimed,
            published: result.published,
            failed: result.failed
          });
        }
      } catch (error) {
        logger.error("outbox batch failed", {
          errorType: error instanceof Error ? error.name : "UnknownError"
        });
      } finally {
        currentJobId = null;
      }

      if (Date.now() >= nextOrderExpirySweepAt) {
        currentJobId = orderExpiryWorkload;

        try {
          const result = await expireOrders.execute({
            at: new Date(),
            batchSize: config.orderExpiryBatchSize
          });
          lastOrderExpirySweepAt = new Date().toISOString();

          if (result.expired > 0) {
            logger.info("expired order batch processed", {
              expired: result.expired,
              walletReleasedKopecks: result.walletReleasedKopecks
            });
          }
        } catch (error) {
          logger.error("expired order batch failed", {
            errorType: error instanceof Error ? error.name : "UnknownError"
          });
        } finally {
          currentJobId = null;
          nextOrderExpirySweepAt = Date.now() + config.orderExpiryPollIntervalMs;
        }
      }

      if (Date.now() >= nextReminderSweepAt) {
        currentJobId = reminderWorkload;

        try {
          const result = await sendReminders.execute({
            at: new Date(),
            batchSize: config.reminderBatchSize
          });
          lastReminderSweepAt = new Date().toISOString();

          if (result.claimed > 0) {
            logger.info("event reminder batch processed", {
              claimed: result.claimed
            });
          }
        } catch (error) {
          logger.error("event reminder batch failed", {
            errorType: error instanceof Error ? error.name : "UnknownError"
          });
        } finally {
          currentJobId = null;
          nextReminderSweepAt = Date.now() + config.reminderPollIntervalMs;
        }
      }

      if (
        tbankReconciliation
        && config.tbankReconciliation.enabled
        && Date.now() >= nextTBankReconciliationSweepAt
      ) {
        currentJobId = tbankReconciliationWorkload;

        try {
          const result = await tbankReconciliation.payments.execute({
            workerId,
            at: new Date(),
            batchSize: config.tbankReconciliation.batchSize,
            leaseSeconds: config.tbankReconciliation.leaseSeconds,
            initialDelaySeconds: config.tbankReconciliation.initialDelaySeconds,
            retryBaseSeconds: config.tbankReconciliation.retryBaseSeconds,
            retryMaxSeconds: config.tbankReconciliation.retryMaxSeconds,
            emptyObservationThreshold:
              config.tbankReconciliation.emptyObservationThreshold
          });
          lastTBankReconciliationSweepAt = new Date().toISOString();

          if (result.claimed > 0) {
            logger.info("T-Bank reconciliation batch processed", {
              claimed: result.claimed,
              confirmed: result.confirmed,
              released: result.released,
              deferred: result.deferred,
              review: result.review
            });
          }
          const refundResult = await tbankReconciliation.refunds.execute({
            workerId,
            at: new Date(),
            batchSize: config.tbankReconciliation.batchSize,
            leaseSeconds: config.tbankReconciliation.leaseSeconds,
            retryBaseSeconds: config.tbankReconciliation.retryBaseSeconds,
            retryMaxSeconds: config.tbankReconciliation.retryMaxSeconds
          });
          if (refundResult.claimed > 0) {
            logger.info("T-Bank refund reconciliation batch processed", {
              claimed: refundResult.claimed,
              completed: refundResult.completed,
              deferred: refundResult.deferred,
              review: refundResult.review
            });
          }
        } catch (error) {
          logger.error("T-Bank reconciliation batch failed", {
            errorType: error instanceof Error ? error.name : "UnknownError"
          });
        } finally {
          currentJobId = null;
          nextTBankReconciliationSweepAt =
            Date.now() + config.tbankReconciliation.pollIntervalMs;
        }
      }

      try {
        await delay(config.outboxPollIntervalMs, undefined, { signal: abortController.signal });
      } catch (error) {
        if (!abortController.signal.aborted) {
          throw error;
        }
      }
    }
  } finally {
    clearInterval(heartbeatTimer);
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await recordHeartbeat();
    await boss.stop({ graceful: true, timeout: 30_000 });
    await pool.close();
    logger.info("worker stopped", { version: config.appVersion, workerId });
  }
}

await bootstrapWorker();
