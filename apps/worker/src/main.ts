import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  ConfirmPaymentService,
  CreditScenarioWalletService,
  DispatchOutboxBatchService,
  ExpireOrdersBatchService,
  HandleNotificationJobService,
  HmacTicketReferenceGenerator,
  ReconcileTBankPaymentsBatchService,
  ReconcileTBankRefundsBatchService,
  ResumeTelegramScenarioAfterPaymentService,
  SetUserStatusService,
  AddUserCategoryService,
  BuildSegmentAudienceSnapshotsBatchService,
  PrepareBroadcastDeliveriesBatchService,
  SendNextBroadcastDeliveryService,
  type IdGenerator
} from "@ticket-platform/application";
import { loadWorkerConfig } from "@ticket-platform/config";
import type { DomainEventJobV1 } from "@ticket-platform/contracts";
import {
  createNotificationDeliveryPersistence,
  createNodePostgresPool,
  createOrderExpiryPersistence,
  createPaymentConfirmationPersistence,
  createScenarioRuntimePersistence,
  createTBankReconciliationPersistence,
  createTBankRefundPersistence,
  createSegmentAudienceSnapshotPersistence,
  createBroadcastPreparationPersistence,
  createBroadcastDeliveryPersistence,
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
  const snapshotPersistence = createSegmentAudienceSnapshotPersistence(pool);
  const buildSegmentAudienceSnapshots =
    new BuildSegmentAudienceSnapshotsBatchService(
      snapshotPersistence.repository,
      snapshotPersistence.unitOfWork,
      snapshotPersistence.outboxWriter,
      idGenerator
    );
  const broadcastPreparationPersistence =
    createBroadcastPreparationPersistence(pool);
  const prepareBroadcastDeliveries =
    new PrepareBroadcastDeliveriesBatchService(
      broadcastPreparationPersistence.repository,
      broadcastPreparationPersistence.unitOfWork,
      broadcastPreparationPersistence.outboxWriter,
      idGenerator
    );
  const dispatch = new DispatchOutboxBatchService(
    new PostgresOutboxDispatchRepository(pool),
    new PgBossOutboxPublisher(boss)
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
          )
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
  let nextSegmentAudienceSnapshotSweepAt = 0;
  let nextBroadcastPreparationSweepAt = 0;
  let nextTBankReconciliationSweepAt = 0;
  let lastOrderExpirySweepAt: string | null = null;
  let lastSegmentAudienceSnapshotSweepAt: string | null = null;
  let lastBroadcastPreparationSweepAt: string | null = null;
  let lastBroadcastDeliveryAt: string | null = null;
  let lastTBankReconciliationSweepAt: string | null = null;
  const orderExpiryWorkload = "order-expiry";
  const segmentAudienceSnapshotWorkload = "segment-audience-snapshot";
  const broadcastPreparationWorkload = "broadcast-preparation";
  const broadcastDeliveryWorkload = "broadcast-delivery";
  const tbankReconciliationWorkload = "tbank-reconciliation";
  const workloads = [
    OUTBOX_DISPATCH_QUEUE,
    orderExpiryWorkload,
    segmentAudienceSnapshotWorkload,
    broadcastPreparationWorkload,
    ...(config.telegramNotifications.enabled ? [broadcastDeliveryWorkload] : []),
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
          lastSegmentAudienceSnapshotSweepAt,
          lastBroadcastPreparationSweepAt,
          lastBroadcastDeliveryAt,
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
  let broadcastDeliveryLoop: Promise<void> | undefined;

  try {
    await pool.ping();
    await boss.start();
    await assertPgBossQueuesProvisioned(boss);
    const notificationConfig = config.telegramNotifications;
    if (notificationConfig.enabled) {
      const telegramSender = createTelegramNotificationSender(
        notificationConfig.botToken,
        notificationConfig.httpTimeoutSeconds
      );
      const notificationPersistence = createNotificationDeliveryPersistence(pool);
      const scenarioPersistence = createScenarioRuntimePersistence(pool, idGenerator);
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
      const scenarioPaymentContinuation =
        new ResumeTelegramScenarioAfterPaymentService(
          scenarioPersistence.repository,
          scenarioPersistence.unitOfWork,
          scenarioPersistence.outboxWriter,
          idGenerator,
          undefined,
          undefined,
          scenarioWalletCreditor,
          scenarioUserClassifier
        );
      const notificationHandler = new HandleNotificationJobService(
        notificationPersistence.notificationContexts,
        notificationPersistence.notificationLedger,
        telegramSender,
        new HmacTicketReferenceGenerator(notificationConfig.ticketTokenSecret),
        new QrTicketPngRenderer(),
        idGenerator,
        notificationConfig.adminChatId,
        scenarioPaymentContinuation
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

      const sendBroadcastDelivery = new SendNextBroadcastDeliveryService(
        createBroadcastDeliveryPersistence(pool),
        telegramSender,
        idGenerator,
        {
          leaseSeconds: notificationConfig.broadcastDeliveryLeaseSeconds,
          maxAttempts: notificationConfig.broadcastDeliveryMaxAttempts,
          retryBaseSeconds:
            notificationConfig.broadcastDeliveryRetryBaseSeconds,
          retryMaxSeconds:
            notificationConfig.broadcastDeliveryRetryMaxSeconds,
          autoPauseMinimumAttempts:
            notificationConfig.broadcastAutoPauseMinimumAttempts,
          autoPauseFailurePercent:
            notificationConfig.broadcastAutoPauseFailurePercent
        }
      );
      broadcastDeliveryLoop = (async () => {
        while (!abortController.signal.aborted) {
          try {
            const result = await sendBroadcastDelivery.execute({
              workerId,
              at: new Date()
            });
            if (result.state !== "idle") {
              lastBroadcastDeliveryAt = new Date().toISOString();
            }
            if (
              result.state === "completed"
              || result.state === "paused"
              || result.state === "failed"
            ) {
              logger.info("broadcast delivery processed", {
                state: result.state,
                broadcastId: result.broadcastId,
                deliveryId: result.deliveryId
              });
            }
          } catch (error) {
            logger.error("broadcast delivery failed", {
              errorType: error instanceof Error ? error.name : "UnknownError"
            });
          }
          try {
            await delay(
              notificationConfig.broadcastDeliveryPollIntervalMs,
              undefined,
              { signal: abortController.signal }
            );
          } catch (error) {
            if (!abortController.signal.aborted) {
              throw error;
            }
          }
        }
      })();
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

      if (Date.now() >= nextSegmentAudienceSnapshotSweepAt) {
        currentJobId = segmentAudienceSnapshotWorkload;

        try {
          const result = await buildSegmentAudienceSnapshots.execute({
            at: new Date(),
            batchSize: config.segmentAudienceSnapshotBatchSize
          });
          lastSegmentAudienceSnapshotSweepAt = new Date().toISOString();

          if (result.claimed > 0) {
            logger.info("segment audience snapshots materialized", {
              claimed: result.claimed,
              completed: result.completed,
              capturedMembers: result.capturedMembers
            });
          }
        } catch (error) {
          logger.error("segment audience snapshot batch failed", {
            errorType: error instanceof Error ? error.name : "UnknownError"
          });
        } finally {
          currentJobId = null;
          nextSegmentAudienceSnapshotSweepAt =
            Date.now() + config.segmentAudienceSnapshotPollIntervalMs;
        }
      }

      if (Date.now() >= nextBroadcastPreparationSweepAt) {
        currentJobId = broadcastPreparationWorkload;

        try {
          const result = await prepareBroadcastDeliveries.execute({
            at: new Date(),
            batchSize: config.broadcastPreparationBatchSize
          });
          lastBroadcastPreparationSweepAt = new Date().toISOString();

          if (result.claimed > 0) {
            logger.info("broadcast deliveries prepared", {
              claimed: result.claimed,
              prepared: result.prepared,
              plannedRecipients: result.plannedRecipients,
              reachableRecipients: result.reachableRecipients,
              skippedRecipients: result.skippedRecipients
            });
          }
        } catch (error) {
          logger.error("broadcast delivery preparation failed", {
            errorType: error instanceof Error ? error.name : "UnknownError"
          });
        } finally {
          currentJobId = null;
          nextBroadcastPreparationSweepAt =
            Date.now() + config.broadcastPreparationPollIntervalMs;
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
    await broadcastDeliveryLoop;
    await boss.stop({ graceful: true, timeout: 30_000 });
    await pool.close();
    logger.info("worker stopped", { version: config.appVersion, workerId });
  }
}

await bootstrapWorker();
