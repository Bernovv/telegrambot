/**
 * Процесс аккаунта компании: принимает то, что людям написали не боту, а живому имени.
 *
 * Отдельный процесс, а не часть бота, — решение из плана (фаза 2). Причина простая: бот
 * продаёт билеты, и его падение стоит денег. Аккаунт держит постоянное соединение по
 * MTProto через прокси за границей, то есть у него вдвое больше поводов упасть, и делить
 * с ним судьбу продаже билетов незачем.
 *
 * Что делает:
 *
 * - **Пишет входящие в общую ленту переписки.** Те же таблицы, что у бота и MAX, но с
 *   пометкой `transport: 'account'`: для человека бот и живое имя — два разных собеседника,
 *   и в карточке это две ветки, а не одна.
 * - **Забирает вложения сам.** У бота файл тянет воркер по ссылке Bot API; здесь
 *   идентификатор файла — число внутри сессии TDLib, и достать его может только тот, у
 *   кого эта сессия открыта.
 * - **Отправляет ответы менеджеров** — те, что написаны в панели в ветку этого канала.
 * - **Ищет людей в Telegram по номеру телефона.** Единственный способ узнать, есть ли у
 *   номера аккаунт, — спросить живым клиентом, а живой клиент здесь только один.
 * - **Рассылает от своего имени.** Смотрит, что лежит в «Избранном», показывает это панели
 *   и копирует выбранное участникам мероприятия — по одному, с паузой и только днём.
 */
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { v7 as uuidv7 } from "uuid";
import {
  ConversationLog,
  DownloadConversationAttachmentsBatchService,
  ResolveChannelLookupsBatchService,
  SendAccountBroadcastsService,
  SendConversationRepliesBatchService,
  SyncAccountSavedMessagesService
} from "@ticket-platform/application";
import type { IdGenerator } from "@ticket-platform/application";
import {
  loadAccountBroadcastsConfig,
  loadAppConfig,
  loadConversationAttachmentsConfig,
  loadConversationRepliesConfig,
  loadChannelLookupConfig
} from "@ticket-platform/config";
import {
  createAccountBroadcastPersistence,
  createConversationPersistence,
  createAttachmentDownloadPersistence,
  createConversationReplyQueue,
  createNodePostgresPool,
  createChannelLookupQueue
} from "@ticket-platform/database";
import {
  createTdlibAttachmentSource,
  createTdlibBroadcastSender,
  createTdlibPhoneLookup,
  createTdlibReplySender,
  createTdlibSavedMessageFileSource,
  createTdlibSavedMessagesSource,
  deletedSavedMessageIds,
  incomingPrivateMessage,
  isNewSavedMessage,
  participantOf,
  readAccountIdentity,
  readAuthorizationState,
  sessionPaths,
  TdlibSendConfirmations,
  toIncomingMessage
} from "@ticket-platform/messenger-telegram-account";
import { createLogger } from "@ticket-platform/observability";
import { openAccount, reportConnection } from "./bootstrap.js";
import {
  FileSystemAttachmentReader,
  FileSystemAttachmentStorage
} from "./conversation-file-storage.js";

async function main(): Promise<void> {
  const app = loadAppConfig(process.env);
  const logger = createLogger({ service: "tg-account", environment: app.appEnv });
  const attachments = loadConversationAttachmentsConfig(process.env);

  const { client, config } = await openAccount();

  const state = await readAuthorizationState(client);
  if (state !== "authorizationStateReady") {
    // Молча ждать авторизации нельзя. Процесс, который поднялся и ничего не принимает,
    // выглядит ровно как процесс, которому никто не пишет, — и разница обнаружится через
    // неделю по пустой карточке.
    throw new Error(
      `Аккаунт не авторизован (${state}). Вход: pnpm account:login на этом же сервере.`
    );
  }

  const identity = await readAccountIdentity(client);
  logger.info("account ready", {
    accountUserId: identity.userId,
    username: identity.username,
    phone: `+${identity.phone}`
  });

  const pool = createNodePostgresPool({ connectionString: app.databaseUrl });
  const ids: IdGenerator = { newId: uuidv7 };
  const conversations = new ConversationLog(
    createConversationPersistence(pool).repository,
    ids,
    (error, context) => {
      logger.error("conversation message not recorded", {
        channel: context.channel,
        direction: context.direction,
        errorType: error instanceof Error ? error.name : "UnknownError",
        errorMessage: error instanceof Error ? error.message : String(error)
      });
    }
  );

  const downloads = attachments.enabled
    ? new DownloadConversationAttachmentsBatchService(
      createAttachmentDownloadPersistence(pool, {
        transport: "account",
        channels: ["telegram"]
      }).repository,
      {
        telegram: createTdlibAttachmentSource(client, {
          onCleanupFailure: (error) => {
            logger.error("tdlib file not deleted after copy", {
              errorMessage: error instanceof Error ? error.message : String(error)
            });
          }
        })
      },
      new FileSystemAttachmentStorage(attachments.directory),
      {
        maxAttempts: attachments.maxAttempts,
        retryDelayMs: attachments.retryDelayMs,
        maxBytes: attachments.maxBytes
      }
    )
    : null;

  if (downloads === null) {
    logger.error("attachments are not stored", {
      reason: "CONVERSATION_FILES_DIR пуст — вложения аккаунта останутся только у Telegram"
    });
  }

  // Ответы менеджера из панели. Очередь та же, что у бота, но отобранная по транспорту и
  // каналу: ответ, написанный в аккаунт, обязан уйти от аккаунта. Ушедший от бота — это
  // письмо от другого собеседника, чем тот, с которым человек разговаривал. Канал назван
  // явно, потому что аккаунтов больше одного: чужую строку этот процесс отправить не может
  // и, забрав её, только похоронил бы.
  const replyOptions = loadConversationRepliesConfig(process.env);
  // Одно ожидание подтверждений на процесс: и ответы, и рассылка ждут одних и тех же
  // обновлений TDLib, и два слушателя означали бы двойную работу на каждом сообщении.
  const confirmations = new TdlibSendConfirmations(client);
  const replies = new SendConversationRepliesBatchService(
    createConversationReplyQueue(pool, {
      transport: "account",
      channels: ["telegram"]
    }).queue,
    {
      telegram: createTdlibReplySender(client, confirmations, {
        outgoingDirectory: join(sessionPaths(config.sessionDirectory).filesDirectory, "outgoing")
      })
    },
    {
      maxAttempts: replyOptions.maxAttempts,
      retryDelayMs: replyOptions.retryDelayMs,
      pauseBetweenMs: replyOptions.pauseBetweenMs
    },
    undefined,
    attachments.enabled ? new FileSystemAttachmentReader(attachments.directory) : null
  );

  /**
   * Поиск людей в Telegram по номеру телефона.
   *
   * Здесь же, а не в воркере, по той же причине, что и отправка: спросить Telegram может
   * только тот, у кого открыта сессия. Панель кладёт просьбу в очередь, этот проход её
   * разбирает и, найдя человека, заводит ему ветку переписки — ту, в которую менеджер и
   * напишет первым.
   */
  const lookupOptions = loadChannelLookupConfig(process.env, "telegram");
  const lookups = new ResolveChannelLookupsBatchService(
    "telegram",
    createChannelLookupQueue(pool).queue,
    createTdlibPhoneLookup(client),
    ids,
    {
      maxAttempts: lookupOptions.maxAttempts,
      retryDelayMs: lookupOptions.retryDelayMs,
      pauseBetweenMs: lookupOptions.pauseBetweenMs,
      dailyLimit: lookupOptions.dailyLimit
    }
  );

  /**
   * Рассылка от имени аккаунта.
   *
   * «Избранное» — это чат аккаунта с самим собой, и номер у него тот же, что у аккаунта.
   * Отсюда берётся содержимое: кружок записывают на телефоне, кидают в «Избранное», панель
   * его видит, рассылка копирует.
   */
  const broadcastOptions = loadAccountBroadcastsConfig(process.env);
  const selfChatId = Number(identity.userId);
  const broadcastPersistence = createAccountBroadcastPersistence(pool);
  const savedFileStorage = new FileSystemAttachmentStorage(attachments.directory);
  const savedMessages = new SyncAccountSavedMessagesService(
    broadcastPersistence.savedMessages,
    createTdlibSavedMessagesSource(client, selfChatId),
    attachments.enabled
      ? {
        source: createTdlibSavedMessageFileSource(client, {
          onCleanupFailure: (error) => {
            logger.error("tdlib saved file not deleted after copy", {
              errorMessage: error instanceof Error ? error.message : String(error)
            });
          }
        }),
        storage: {
          save: async (input) => await savedFileStorage.save({
            attachmentId: input.id,
            bytes: input.bytes,
            fileName: input.fileName,
            mimeType: input.mimeType
          })
        },
        maxBytes: attachments.maxBytes
      }
      : null,
    { limit: broadcastOptions.savedLimit, maxFileAttempts: 3 }
  );
  const broadcasts = new SendAccountBroadcastsService(
    broadcastPersistence.queue,
    createTdlibBroadcastSender(client, confirmations, selfChatId),
    ids,
    {
      enabled: broadcastOptions.enabled,
      pauseMinMs: broadcastOptions.pauseMinMs,
      pauseMaxMs: broadcastOptions.pauseMaxMs,
      idlePollMs: 30_000,
      dailyLimit: broadcastOptions.dailyLimit,
      window: {
        startHour: broadcastOptions.windowStartHour,
        endHour: broadcastOptions.windowEndHour,
        timeZone: broadcastOptions.windowTimeZone
      },
      maxAttempts: broadcastOptions.maxAttempts,
      retryDelayMs: broadcastOptions.retryDelayMs,
      leaseMs: 10 * 60_000,
      accountPauseMs: broadcastOptions.accountPauseMs
    }
  );
  let nextSavedSyncAt = 0;
  let nextBroadcastAt = 0;
  let lastBroadcastState = "";

  client.on("update", (update) => {
    // Новое в «Избранном» — смотрим сразу: человек, только что скинувший кружок, ждёт его
    // в панели, а не через полминуты.
    if (isNewSavedMessage(update, selfChatId)) {
      nextSavedSyncAt = 0;
    }
    const deleted = deletedSavedMessageIds(update, selfChatId);
    if (deleted !== null && deleted.length > 0) {
      void broadcastPersistence.savedMessages
        .markDeleted({ externalMessageIds: deleted, at: new Date() })
        .catch((error: unknown) => {
          logger.error("saved message deletion not recorded", {
            errorMessage: error instanceof Error ? error.message : String(error)
          });
        });
    }

    const incoming = incomingPrivateMessage(update);
    if (incoming === null) {
      return;
    }

    // Обработчик обновлений синхронный, и ждать в нём нельзя: очередь TDLib встала бы на
    // время запроса к базе. Запись уходит в свою цепочку, а неудача не имеет права
    // добраться сюда — служба записи исключений не бросает, но сеть до базы бросает.
    void record(incoming.message, incoming.senderUserId).catch((error: unknown) => {
      logger.error("incoming message not handled", {
        errorMessage: error instanceof Error ? error.message : String(error)
      });
    });
  });

  async function record(
    message: Parameters<typeof toIncomingMessage>[0],
    senderUserId: number
  ): Promise<void> {
    // Имя и ник берём у TDLib: в самом сообщении их нет, а карточка человека без ника
    // заводиться не станет. Запрос местный — TDLib отвечает из своей базы, не из сети.
    const user = await client.invoke({ _: "getUser", user_id: senderUserId });
    const recorded = await conversations.recordIncoming(
      toIncomingMessage(message, participantOf(user), { _: "updateNewMessage", message })
    );

    logger.info("incoming message", {
      senderUserId: String(senderUserId),
      messageId: String(message.id),
      stored: recorded?.stored ?? false
    });
  }

  const stopping = { now: false };
  const stop = (signal: string): void => {
    logger.info("shutting down", { signal });
    stopping.now = true;
  };
  process.once("SIGTERM", () => {
    stop("SIGTERM");
  });
  process.once("SIGINT", () => {
    stop("SIGINT");
  });

  await reportConnection(client);
  logger.info("listening", { proxy: config.proxy === null ? "none" : config.proxy.kind });

  // Три прохода с разной частотой. Ответ менеджера человек ждёт прямо сейчас; поиска по
  // номеру менеджер ждёт у открытой карточки, но торопиться с ним нельзя — за спешку тут
  // платит аккаунт; вложение нужно к моменту, когда диалог откроют. Отсюда отдельные
  // сроки, а не общий такт.
  let nextAttachmentSweepAt = 0;
  let nextLookupSweepAt = 0;
  while (!stopping.now) {
    try {
      const sent = await replies.execute({
        at: new Date(),
        batchSize: replyOptions.batchSize
      });
      if (sent.claimed > 0) {
        logger.info("replies sent", {
          claimed: sent.claimed,
          sent: sent.sent,
          retried: sent.retried,
          failed: sent.failed
        });
      }
    } catch (error) {
      logger.error("reply sweep failed", {
        errorMessage: error instanceof Error ? error.message : String(error)
      });
    }

    if (Date.now() >= nextSavedSyncAt) {
      try {
        const synced = await savedMessages.execute({ at: new Date() });
        if (synced.stored > 0 || synced.failed > 0) {
          logger.info("saved messages synced", {
            seen: synced.seen,
            stored: synced.stored,
            failed: synced.failed
          });
        }
      } catch (error) {
        logger.error("saved messages sync failed", {
          errorMessage: error instanceof Error ? error.message : String(error)
        });
      }
      nextSavedSyncAt = Date.now() + broadcastOptions.savedSyncIntervalMs;
    }

    if (Date.now() >= nextBroadcastAt) {
      try {
        const pass = await broadcasts.execute({ at: new Date() });
        nextBroadcastAt = pass.nextRunAt.getTime();
        if (pass.kind === "sent" || pass.kind === "failed" || pass.kind === "retry" || pass.kind === "stopped") {
          logger.info("account broadcast", {
            outcome: pass.kind,
            broadcastId: pass.broadcastId,
            ...(pass.kind === "sent" ? {} : { reason: pass.reason })
          });
        }
        // Пауза и простой пишутся один раз при смене, а не каждые полминуты.
        const state = pass.kind === "paused"
          ? `paused:${pass.until.toISOString()}`
          : pass.kind === "idle" ? `idle:${pass.reason}` : pass.kind;
        if (state !== lastBroadcastState && (pass.kind === "paused" || pass.kind === "idle")) {
          logger.info("account broadcast waiting", {
            state: pass.kind,
            ...(pass.kind === "paused"
              ? { until: pass.until.toISOString(), reason: pass.reason }
              : { reason: pass.reason })
          });
        }
        lastBroadcastState = state;
      } catch (error) {
        nextBroadcastAt = Date.now() + 60_000;
        logger.error("account broadcast pass failed", {
          errorMessage: error instanceof Error ? error.message : String(error)
        });
      }
    }

    if (Date.now() >= nextLookupSweepAt) {
      try {
        const resolved = await lookups.execute({
          at: new Date(),
          batchSize: lookupOptions.batchSize
        });
        if (resolved.claimed > 0 || resolved.throttled) {
          logger.info("phone lookups resolved", {
            claimed: resolved.claimed,
            found: resolved.found,
            notFound: resolved.notFound,
            retried: resolved.retried,
            failed: resolved.failed,
            // Упёрлись в суточный потолок — это штатный исход, но знать о нём нужно:
            // очередь стоит не потому, что сломалась.
            throttled: resolved.throttled
          });
        }
      } catch (error) {
        logger.error("phone lookup sweep failed", {
          errorMessage: error instanceof Error ? error.message : String(error)
        });
      }
      nextLookupSweepAt = Date.now() + lookupOptions.pollIntervalMs;
    }

    if (downloads !== null && Date.now() >= nextAttachmentSweepAt) {
      try {
        const result = await downloads.execute({
          at: new Date(),
          batchSize: attachments.batchSize
        });
        if (result.claimed > 0) {
          logger.info("attachments swept", {
            claimed: result.claimed,
            stored: result.stored,
            retried: result.retried,
            failed: result.failed
          });
        }
      } catch (error) {
        logger.error("attachment sweep failed", {
          errorMessage: error instanceof Error ? error.message : String(error)
        });
      }
      nextAttachmentSweepAt = Date.now() + attachments.pollIntervalMs;
    }

    // Спим до ближайшего дела: темп рассылки (20–30 секунд) короче такта ответов, и общий
    // такт растягивал бы паузу между её сообщениями до пятнадцати секунд сверху.
    const now = Date.now();
    await delay(Math.max(
      1_000,
      Math.min(replyOptions.pollIntervalMs, nextBroadcastAt - now, nextSavedSyncAt - now)
    ));
  }

  await client.close();
  await pool.close();
  logger.info("stopped");
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
