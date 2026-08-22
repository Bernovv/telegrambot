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
 *
 * Чего пока не делает: не отправляет. Ответ из панели по этому каналу — следующий шаг.
 */
import { setTimeout as delay } from "node:timers/promises";
import { v7 as uuidv7 } from "uuid";
import { ConversationLog, DownloadConversationAttachmentsBatchService } from "@ticket-platform/application";
import type { IdGenerator } from "@ticket-platform/application";
import { loadAppConfig, loadConversationAttachmentsConfig } from "@ticket-platform/config";
import {
  createConversationPersistence,
  createAttachmentDownloadPersistence,
  createNodePostgresPool
} from "@ticket-platform/database";
import {
  createTdlibAttachmentSource,
  incomingPrivateMessage,
  participantOf,
  readAccountIdentity,
  readAuthorizationState,
  toIncomingMessage
} from "@ticket-platform/messenger-telegram-account";
import { createLogger } from "@ticket-platform/observability";
import { openAccount, reportConnection } from "./bootstrap.js";
import { FileSystemAttachmentStorage } from "./conversation-file-storage.js";

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
      createAttachmentDownloadPersistence(pool, "account").repository,
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

  client.on("update", (update) => {
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

  while (!stopping.now) {
    if (downloads !== null) {
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
    }
    await delay(attachments.pollIntervalMs);
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
