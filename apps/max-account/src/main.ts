/**
 * Процесс аккаунта компании в MAX: принимает то, что людям написали живому имени, и
 * отправляет ответы менеджеров из панели.
 *
 * Отдельный процесс, а не часть бота, — решение из плана (фаза 3б). Причина простая: бот
 * продаёт билеты, и его падение стоит денег. Аккаунт держит постоянное соединение по
 * чужому внутреннему протоколу, который может измениться без предупреждения, — делить с
 * ним судьбу продаже билетов незачем.
 *
 * Что делает:
 *
 * - **Пишет входящие в общую ленту переписки.** Те же таблицы, что у ботов и у
 *   Telegram-аккаунта, но с пометкой `transport: 'account'`: для человека бот и живое имя —
 *   два разных собеседника, и в карточке это две ветки, а не одна.
 * - **Отправляет ответы менеджера**, отобранные из общей очереди по каналу и транспорту.
 * - **Забирает вложения сам.** Часть файлов у MAX выдаётся по ссылке, которую нужно
 *   спросить, и спросить может только тот, у кого открыта сессия аккаунта.
 *
 * Чего не делает: не разговаривает сценарием. Бот в этой ветке молчит — отвечает менеджер.
 */
import { setTimeout as delay } from "node:timers/promises";
import { v7 as uuidv7 } from "uuid";
import {
  ConversationLog,
  DownloadConversationAttachmentsBatchService,
  SendConversationRepliesBatchService
} from "@ticket-platform/application";
import type { IdGenerator } from "@ticket-platform/application";
import {
  loadAppConfig,
  loadConversationAttachmentsConfig,
  loadConversationRepliesConfig
} from "@ticket-platform/config";
import {
  createConversationPersistence,
  createAttachmentDownloadPersistence,
  createConversationReplyQueue,
  createNodePostgresPool
} from "@ticket-platform/database";
import {
  createMaxAccountAttachmentSource,
  createMaxAccountReplySender,
  incomingMessage,
  MaxChatDirectory,
  MaxOpcode,
  participantOf,
  toIncomingMessage,
  type MaxInboundFrame
} from "@ticket-platform/messenger-max-account";
import { createLogger } from "@ticket-platform/observability";
import { describeState, openAccount } from "./bootstrap.js";
import {
  FileSystemAttachmentReader,
  FileSystemAttachmentStorage
} from "./conversation-file-storage.js";

const MAX_MESSAGE_OPCODE = MaxOpcode.notifyMessage;

async function main(): Promise<void> {
  const app = loadAppConfig(process.env);
  const logger = createLogger({ service: "max-account", environment: app.appEnv });
  const attachments = loadConversationAttachmentsConfig(process.env);

  const { client, config } = await openAccount();

  const profile = client.currentProfile();
  const selfUserId = profile?.userId ?? "";
  if (selfUserId === "") {
    // Без своего номера нельзя отличить входящее от собственного ответа, и лента наполнится
    // отражениями наших же реплик. Молчать об этом нельзя.
    throw new Error("MAX не сказал, кто мы: в ответе на вход нет профиля аккаунта");
  }
  verifyPhone(profile?.phone ?? "", config.phone);

  logger.info("account ready", {
    accountUserId: selfUserId,
    phone: `+${profile?.phone ?? ""}`,
    deviceName: config.deviceName
  });

  // Состояние соединения — единственный честный ответ на вопрос «канал живой?». Вебсокет
  // рвётся молча, и тишина в ленте выглядит одинаково при обрыве и при отсутствии писем.
  client.onState((state, reason) => {
    const message = `канал MAX: ${describeState(state)}`;
    if (state === "ready" || state === "connecting" || state === "authorizing") {
      logger.info(message, { state, ...(reason === null ? {} : { reason }) });

      return;
    }
    logger.error(message, { state, ...(reason === null ? {} : { reason }) });
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
  const directory = new MaxChatDirectory(client);

  const downloads = attachments.enabled
    ? new DownloadConversationAttachmentsBatchService(
      createAttachmentDownloadPersistence(pool, {
        transport: "account",
        channels: ["max"]
      }).repository,
      { max: createMaxAccountAttachmentSource(client, {
        timeoutMs: attachments.downloadTimeoutMs
      }) },
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
      reason: "CONVERSATION_FILES_DIR пуст — вложения аккаунта останутся только у MAX"
    });
  }

  // Ответы менеджера из панели. Очередь та же, что у ботов, но отобранная по транспорту и
  // каналу: ответ, написанный в аккаунт MAX, обязан уйти от него же. Ушедший от бота — это
  // письмо от другого собеседника, чем тот, с которым человек разговаривал.
  const replyOptions = loadConversationRepliesConfig(process.env);
  const replies = new SendConversationRepliesBatchService(
    createConversationReplyQueue(pool, { transport: "account", channels: ["max"] }).queue,
    { max: createMaxAccountReplySender(client) },
    {
      maxAttempts: replyOptions.maxAttempts,
      retryDelayMs: replyOptions.retryDelayMs,
      pauseBetweenMs: replyOptions.pauseBetweenMs
    },
    undefined,
    attachments.enabled ? new FileSystemAttachmentReader(attachments.directory) : null
  );

  client.onEvent((frame: MaxInboundFrame) => {
    // Трассировка по флагу: обычным днём это поток в сотни строк, а в день разбирательства
    // единственный способ увидеть, что вообще присылает MAX. Включается MAX_ACCOUNT_TRACE=1
    // и снимается перезапуском — выкладка для этого не нужна.
    if (config.trace) {
      logger.info("frame", {
        opcode: frame.opcode,
        cmd: frame.cmd,
        keys: Object.keys(frame.payload ?? {}).join(",")
      });
    }

    const incoming = incomingMessage(frame, selfUserId);
    if (incoming === null) {
      // Сообщение, которое приехало и не прошло разбор, — это потерянная реплика клиента.
      // Молчать о ней нельзя: снаружи это неотличимо от «никто не писал».
      if (frame.opcode === MAX_MESSAGE_OPCODE) {
        logger.info("message frame not taken", {
          cmd: frame.cmd,
          keys: Object.keys(frame.payload ?? {}).join(",")
        });
      }

      return;
    }

    // Обработчик событий синхронный, и ждать в нём нельзя: разбор следующих кадров встал
    // бы на время запроса к базе. Запись уходит в свою цепочку, а неудача не имеет права
    // добраться сюда — служба записи исключений не бросает, но сеть до базы бросает.
    void record(incoming).catch((error: unknown) => {
      logger.error("incoming message not handled", {
        errorMessage: error instanceof Error ? error.message : String(error)
      });
    });
  });

  async function record(incoming: NonNullable<ReturnType<typeof incomingMessage>>) {
    // Групповое сообщение в карточке человека — это чужой разговор, попавший туда по
    // недосмотру. Тип чата в кадре не приезжает, поэтому его приходится спрашивать.
    if (!await directory.isDialog(incoming.chatId)) {
      logger.info("message skipped: not a dialog", { chatId: incoming.chatId });

      return;
    }

    // Имя и ник берём отдельным вызовом: в кадре только число, а карточка человека без
    // имени заводится безымянной. Справочник помнит ответ, второй раз спрашивать не будет.
    const user = await directory.user(incoming.senderUserId);
    const recorded = await conversations.recordIncoming(
      toIncomingMessage(incoming, participantOf(user), frameOf(incoming))
    );

    logger.info("incoming message", {
      senderUserId: incoming.senderUserId,
      chatId: incoming.chatId,
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

  logger.info("listening", { wsUrl: config.wsUrl });

  // Два прохода с разной частотой: ответ менеджера человек ждёт прямо сейчас, а вложение
  // нужно к моменту, когда диалог откроют. Отсюда отдельные сроки, а не общий такт.
  let nextAttachmentSweepAt = 0;
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

    await delay(replyOptions.pollIntervalMs);
  }

  await client.close();
  await pool.close();
  logger.info("stopped");
}

/** Кадр целиком — то, что кладётся в `payload` реплики: разобрать его можно будет потом. */
function frameOf(incoming: { readonly message: unknown; readonly chatId: string }): unknown {
  return { opcode: 128, chatId: incoming.chatId, message: incoming.message };
}

/**
 * Номер, под которым вошли, должен совпасть с настроенным.
 *
 * Перепутанный номер — это не опечатка в конфиге, а разговор клиента с посторонним
 * аккаунтом: панель будет писать от имени одного, а человек увидит другого.
 */
function verifyPhone(actual: string, expected: string): void {
  if (actual === "" || actual === expected.replace(/^\+/, "")) {
    return;
  }

  throw new Error(
    `Вошли под номером +${actual}, а в .env указан ${expected}.`
    + " Войдите заново: pnpm max:login --forget."
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
