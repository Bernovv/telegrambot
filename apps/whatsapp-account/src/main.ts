/**
 * Процесс аккаунта компании в WhatsApp: принимает то, что людям написали живому имени, и
 * отправляет ответы менеджеров из панели.
 *
 * Третий такой процесс после Telegram и MAX, и отдельный он по той же причине: бот продаёт
 * билеты, и его падение стоит денег. Здесь причин упасть даже больше — соединение идёт через
 * прокси за границей, а библиотека живёт вместе с чужим протоколом.
 *
 * Что делает:
 *
 * - **Пишет входящие в общую ленту переписки** с пометкой `transport: 'account'`.
 * - **Отправляет ответы менеджера**, отобранные из общей очереди по каналу и транспорту.
 * - **Забирает вложения сам.** Файл у WhatsApp зашифрован ключом своего же сообщения, и
 *   расшифровать его может только тот, у кого открыта сессия аккаунта.
 *
 * Чего не делает: не разговаривает сценарием. Бота в этом канале нет вовсе — билеты
 * продаются в Telegram и MAX, здесь только живой разговор.
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
  createAttachmentDownloadPersistence,
  createConversationPersistence,
  createConversationReplyQueue,
  createNodePostgresPool
} from "@ticket-platform/database";
import {
  createWhatsAppAccountAttachmentSource,
  createWhatsAppAccountReplySender,
  incomingMessage,
  toIncomingMessage
} from "@ticket-platform/messenger-whatsapp-account";
import { createLogger } from "@ticket-platform/observability";
import { describeState, openAccount, waitForOutcome } from "./bootstrap.js";
import {
  FileSystemAttachmentReader,
  FileSystemAttachmentStorage
} from "./conversation-file-storage.js";

/** Сколько ждать первого соединения, прежде чем признать канал неподнявшимся. */
const STARTUP_TIMEOUT_MS = 60_000;

async function main(): Promise<void> {
  const app = loadAppConfig(process.env);
  const logger = createLogger({ service: "whatsapp-account", environment: app.appEnv });
  const attachments = loadConversationAttachmentsConfig(process.env);

  const { client, config } = await openAccount();

  // Состояние соединения — единственный честный ответ на вопрос «канал живой?». Вебсокет
  // рвётся молча, и тишина в ленте выглядит одинаково при обрыве и при отсутствии писем.
  client.onState((state, reason) => {
    const message = `канал WhatsApp: ${describeState(state)}`;
    if (state === "ready" || state === "connecting") {
      logger.info(message, { state, ...(reason === null ? {} : { reason }) });

      return;
    }
    logger.error(message, { state, ...(reason === null ? {} : { reason }) });
  });

  const started = await waitForOutcome(client, STARTUP_TIMEOUT_MS);
  if (started.kind === "pairing") {
    // Отдельный случай, а не «связи нет»: связь как раз есть, а привязки нет. Разница
    // существенная — второе чинится человеком с телефоном, и pm2 может перезапускать
    // процесс хоть сто раз, легче не станет.
    throw new Error(
      "Канал WhatsApp не привязан: WhatsApp предлагает привязать устройство."
      + " Привязать: pnpm wa:login на этом сервере, с телефоном под рукой."
    );
  }
  if (started.kind === "failed") {
    throw new Error(
      `Канал WhatsApp не поднялся${started.reason === null ? "" : `: ${started.reason}`}.`
      + " Что делать — в docs/runbooks/whatsapp-account.md"
    );
  }

  const self = client.self();
  verifyPhone(self?.phone ?? "", config.phone);
  logger.info("account ready", {
    accountJid: self?.jid ?? "",
    phone: `+${self?.phone ?? ""}`,
    deviceName: config.deviceName,
    proxy: config.proxyUrl === null ? "напрямую" : "через прокси"
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
        channels: ["whatsapp"]
      }).repository,
      { whatsapp: createWhatsAppAccountAttachmentSource(client) },
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
      reason: "CONVERSATION_FILES_DIR пуст — вложения аккаунта останутся только у WhatsApp"
    });
  }

  // Ответы менеджера из панели. Очередь та же, что у ботов, но отобранная по транспорту и
  // каналу: ответ, написанный в WhatsApp, обязан уйти оттуда же.
  const replyOptions = loadConversationRepliesConfig(process.env);
  const replies = new SendConversationRepliesBatchService(
    createConversationReplyQueue(pool, {
      transport: "account",
      channels: ["whatsapp"]
    }).queue,
    { whatsapp: createWhatsAppAccountReplySender(client) },
    {
      maxAttempts: replyOptions.maxAttempts,
      retryDelayMs: replyOptions.retryDelayMs,
      pauseBetweenMs: replyOptions.pauseBetweenMs
    },
    undefined,
    attachments.enabled ? new FileSystemAttachmentReader(attachments.directory) : null
  );

  client.onMessage((message, raw) => {
    const incoming = incomingMessage(message);
    if (incoming === null) {
      return;
    }

    // Обработчик событий синхронный, и ждать в нём нельзя: разбор следующих сообщений встал
    // бы на время запроса к базе. Запись уходит в свою цепочку, а неудача не имеет права
    // добраться сюда — служба записи исключений не бросает, но сеть до базы бросает.
    void conversations
      .recordIncoming(toIncomingMessage(incoming, raw))
      .then((recorded) => {
        logger.info("incoming message", {
          chatJid: incoming.chatJid,
          hasAttachment: incoming.attachments.length > 0,
          stored: recorded?.stored ?? false
        });
      })
      .catch((error: unknown) => {
        logger.error("incoming message not handled", {
          errorMessage: error instanceof Error ? error.message : String(error)
        });
      });
  });

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

  logger.info("listening", { sessionDir: config.sessionDir });

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

/**
 * Номер, под которым вошли, должен совпасть с настроенным.
 *
 * Перепутанный номер — это не опечатка в конфиге, а разговор клиента с посторонним: ответы
 * менеджеров ушли бы с чужого аккаунта, а входящие чужого попали бы в наши карточки.
 * Проверка стоит до первой отправки и роняет процесс, а не пишет предупреждение.
 */
function verifyPhone(actual: string, expected: string): void {
  if (actual === "") {
    throw new Error("WhatsApp не сказал, под каким номером мы вошли");
  }
  if (actual !== expected) {
    throw new Error(
      `Вошли под +${actual}, а в настройках +${expected}.`
      + " Либо привязан не тот номер, либо WHATSAPP_ACCOUNT_PHONE указывает не на тот аккаунт."
    );
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
