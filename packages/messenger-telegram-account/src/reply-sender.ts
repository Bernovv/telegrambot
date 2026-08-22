/// <reference types="@prebuilt-tdlib/types" />
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AttachmentKind, ConversationReplySender } from "@ticket-platform/application";
import type { Client } from "tdl";
import type { Update as TdUpdate } from "tdlib-types";

/**
 * Ответ менеджера, ушедший от имени аккаунта компании.
 *
 * Главная сложность здесь не в отправке, а в том, **когда считать сообщение отправленным**.
 * TDLib отвечает на `sendMessage` сразу, ещё до того как сообщение ушло: он возвращает
 * заготовку с временным номером и берётся доставить её сам. Настоящая судьба приходит
 * позже, отдельным обновлением, и она бывает двух видов — получилось и не получилось.
 *
 * Поверить первому ответу значило бы записывать «доставлено» тому, что не дошло: человек
 * закрылся настройками приватности, номер в чёрном списке, сообщение отвергнуто как спам.
 * Менеджер видел бы в ленте зелёную реплику и ждал ответа на письмо, которого не было.
 * Поэтому отправка ждёт подтверждения.
 */

/** Сколько ждать подтверждения. Обычно оно приходит за доли секунды. */
const CONFIRMATION_TIMEOUT_MS = 60_000;

interface Waiter {
  readonly resolve: (messageId: string) => void;
  readonly reject: (error: Error) => void;
}

/**
 * Ожидание судьбы отправленных сообщений.
 *
 * Слушает обновления один раз на процесс: подписка на каждое сообщение отдельно означала бы
 * рост числа обработчиков ровно на столько, сколько реплик мы отправили.
 */
export class TdlibSendConfirmations {
  private readonly waiting = new Map<string, Waiter>();

  constructor(client: Pick<Client, "on">) {
    client.on("update", (update: TdUpdate) => {
      if (update._ === "updateMessageSendSucceeded") {
        this.settle(update.message.chat_id, update.old_message_id, (waiter) => {
          waiter.resolve(String(update.message.id));
        });

        return;
      }
      if (update._ === "updateMessageSendFailed") {
        this.settle(update.message.chat_id, update.old_message_id, (waiter) => {
          waiter.reject(new Error(`Telegram отказался отправить: ${update.error.message}`));
        });
      }
    });
  }

  async confirm(
    chatId: number,
    temporaryMessageId: number,
    timeoutMs = CONFIRMATION_TIMEOUT_MS
  ): Promise<string> {
    const key = keyOf(chatId, temporaryMessageId);

    return await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(key);
        // Повтор из очереди может привести к второй копии у человека, если сообщение всё-таки
        // ушло. Это плохо, но заметно и поправимо, а молча записать доставленным то, чего
        // никто не получил, — незаметно и неисправимо.
        reject(new Error("Telegram не подтвердил отправку за минуту"));
      }, timeoutMs);

      this.waiting.set(key, {
        resolve: (messageId) => {
          clearTimeout(timer);
          resolve(messageId);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        }
      });
    });
  }

  private settle(chatId: number, oldMessageId: number, act: (waiter: Waiter) => void): void {
    const key = keyOf(chatId, oldMessageId);
    const waiter = this.waiting.get(key);
    if (waiter === undefined) {
      return;
    }
    this.waiting.delete(key);
    act(waiter);
  }
}

function keyOf(chatId: number, messageId: number): string {
  return `${String(chatId)}:${String(messageId)}`;
}

export interface TdlibReplySenderOptions {
  /** Куда класть файл перед отправкой: TDLib берёт файлы с диска, а не из памяти. */
  readonly outgoingDirectory: string;
}

export function createTdlibReplySender(
  client: Client,
  confirmations: TdlibSendConfirmations,
  options: TdlibReplySenderOptions
): ConversationReplySender {
  /**
   * Чат должен существовать в памяти TDLib, иначе отправка падает на «чат не найден».
   * После перезапуска процесса это обычное дело: чаты подгружаются по мере надобности, а
   * ответ менеджера как раз и есть надобность. Вызов дешёвый и повторяемый.
   */
  async function ensureChat(userId: number): Promise<void> {
    await client.invoke({ _: "createPrivateChat", user_id: userId, force: false });
  }

  function chatIdOf(recipientId: string): number {
    const chatId = Number(recipientId);
    if (!Number.isSafeInteger(chatId) || chatId <= 0) {
      throw new Error(`Не похоже на личный чат Telegram: ${recipientId}`);
    }

    return chatId;
  }

  return {
    async sendText(recipientId, text) {
      const chatId = chatIdOf(recipientId);
      await ensureChat(chatId);
      const draft = await client.invoke({
        _: "sendMessage",
        chat_id: chatId,
        input_message_content: {
          _: "inputMessageText",
          text: { _: "formattedText", text, entities: [] }
        }
      });

      return { providerMessageId: await confirmations.confirm(chatId, draft.id) };
    },

    async sendFile(input) {
      const chatId = chatIdOf(input.recipientId);
      await ensureChat(chatId);
      await mkdir(options.outgoingDirectory, { recursive: true });
      // Имя на диске своё, а не присланное менеджером: имя файла из панели может быть
      // каким угодно, включая путь наружу из папки. Человек при этом увидит имя, которое
      // Telegram возьмёт из содержимого сообщения, а не из нашего временного файла.
      const path = join(options.outgoingDirectory, `${randomUUID()}-${safeName(input.fileName)}`);
      await writeFile(path, input.bytes);

      try {
        const caption = { _: "formattedText" as const, text: input.caption, entities: [] };
        const draft = await client.invoke({
          _: "sendMessage",
          chat_id: chatId,
          input_message_content: input.kind === "photo"
            ? {
              _: "inputMessagePhoto",
              photo: { _: "inputPhoto", photo: { _: "inputFileLocal", path } },
              caption
            }
            : {
              _: "inputMessageDocument",
              document: { _: "inputDocument", document: { _: "inputFileLocal", path } },
              caption
            }
        });

        return { providerMessageId: await confirmations.confirm(chatId, draft.id) };
      } finally {
        // Файл у нас уже лежит в хранилище переписки — этот был только для передачи.
        // TDLib к моменту подтверждения его дочитал.
        await rm(path, { force: true });
      }
    },

    supportsFileKind(kind: AttachmentKind) {
      // Telegram принимает что угодно: непонятное уходит документом. Ограничение по размеру
      // стоит выше, в панели, и повторять его здесь незачем.
      return kind !== "location" && kind !== "contact";
    }
  };
}

function safeName(fileName: string): string {
  const cleaned = fileName.replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(-100);

  return cleaned === "" ? "file" : cleaned;
}
