import type { ScenarioPresentationModel } from "@ticket-platform/contracts";
import { Api, InlineKeyboard, InputFile } from "grammy";
import { encodeScenarioCallback } from "@ticket-platform/messenger-core";

export interface TelegramNotificationApi {
  /**
   * Необязательный: у уведомлений документов не бывает, и требовать его от каждого
   * двойника в тестах значит чинить два десятка тестов ради одной новой возможности.
   * Отсутствие метода означает «этот отправитель документов не шлёт», и служба отправки
   * узнаёт об этом до попытки, а не после.
   */
  sendDocument?(
    chatId: string | number,
    document: InputFile,
    options: { readonly caption?: string }
  ): Promise<{ readonly message_id: number }>;
  sendMessage(
    chatId: string | number,
    text: string,
    options?: { readonly reply_markup: InlineKeyboard }
  ): Promise<{ readonly message_id: number }>;
  sendPhoto(
    chatId: string | number,
    photo: InputFile,
    options: {
      readonly caption: string;
      readonly reply_markup?: InlineKeyboard;
    }
  ): Promise<{ readonly message_id: number }>;
}

export interface TelegramBroadcastMessage {
  readonly text: string;
  readonly image: {
    readonly bytes: Uint8Array;
    readonly mimeType: "image/png" | "image/jpeg";
  } | null;
  readonly button: { readonly text: string; readonly url: string } | null;
}

export class GrammyTextNotificationSender {
  constructor(private readonly api: TelegramNotificationApi) {}

  async sendText(
    recipientId: string,
    text: string
  ): Promise<{ readonly providerMessageId: string }> {
    validateRecipient(recipientId);
    if (!text || text.length > 4_096) {
      throw new Error("Telegram notification text is invalid");
    }

    const message = await this.api.sendMessage(recipientId, text);
    validateMessageId(message.message_id);

    return { providerMessageId: String(message.message_id) };
  }

  async sendBroadcastMessage(
    recipientId: string,
    message: TelegramBroadcastMessage
  ): Promise<{ readonly providerMessageId: string }> {
    validateRecipient(recipientId);
    const text = message.text.trim();
    // Предел зависит от того, чем сообщение окажется: подписью к фото или обычным текстом.
    if (!text || text.length > (message.image ? 1_024 : 4_096)) {
      throw new Error("Telegram broadcast text is invalid");
    }

    const keyboard = message.button ? new InlineKeyboard() : null;
    if (keyboard && message.button) {
      validateButtonText(message.button.text);
      if (!message.button.url.startsWith("https://") || message.button.url.length > 2_048) {
        throw new Error("Telegram broadcast button URL is invalid");
      }
      keyboard.url(message.button.text, message.button.url);
    }

    if (message.image) {
      if (
        (message.image.mimeType !== "image/png" && message.image.mimeType !== "image/jpeg")
        || message.image.bytes.byteLength < 100
        || message.image.bytes.byteLength > 10 * 1_024 * 1_024
      ) {
        throw new Error("Telegram broadcast image is invalid");
      }
      const photo = await this.api.sendPhoto(
        recipientId,
        new InputFile(
          message.image.bytes,
          message.image.mimeType === "image/png" ? "broadcast.png" : "broadcast.jpg"
        ),
        { caption: text, ...(keyboard ? { reply_markup: keyboard } : {}) }
      );
      validateMessageId(photo.message_id);
      return { providerMessageId: String(photo.message_id) };
    }

    const sent = await this.api.sendMessage(
      recipientId,
      text,
      ...(keyboard ? [{ reply_markup: keyboard }] : [])
    );
    validateMessageId(sent.message_id);
    return { providerMessageId: String(sent.message_id) };
  }

  async sendImage(
    recipientId: string,
    image: {
      readonly bytes: Uint8Array;
      readonly mimeType: "image/png";
      readonly width: number;
      readonly height: number;
    },
    fileName: string,
    caption: string
  ): Promise<{ readonly providerMessageId: string }> {
    validateRecipient(recipientId);
    if (
      image.mimeType !== "image/png"
      || image.bytes.byteLength < 100
      || image.bytes.byteLength > 10 * 1_024 * 1_024
    ) {
      throw new Error("Telegram notification image is invalid");
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.png$/.test(fileName)) {
      throw new Error("Telegram notification file name is invalid");
    }
    if (!caption || caption.length > 1_024) {
      throw new Error("Telegram notification caption is invalid");
    }

    const message = await this.api.sendPhoto(
      recipientId,
      new InputFile(image.bytes, fileName),
      { caption }
    );
    validateMessageId(message.message_id);

    return { providerMessageId: String(message.message_id) };
  }

  /**
   * Файл от менеджера: фотография картинкой, остальное документом.
   *
   * Разница не косметическая. Фотография, отправленная документом, приходит человеку
   * файлом, который надо скачать, чтобы посмотреть; документ, отправленный картинкой,
   * Telegram просто не примет — он ждёт изображение.
   *
   * Подпись у Telegram ограничена 1024 знаками против 4096 у обычного сообщения. Более
   * длинную обрезаем: потерять хвост подписи лучше, чем не отправить файл вовсе.
   */
  async sendFile(input: {
    readonly recipientId: string;
    readonly bytes: Uint8Array;
    readonly fileName: string;
    readonly mimeType: string | null;
    readonly kind: string;
    readonly caption: string;
  }): Promise<{ readonly providerMessageId: string }> {
    validateRecipient(input.recipientId);
    if (input.bytes.byteLength < 1) {
      throw new Error("Telegram file is empty");
    }
    const caption = input.caption.slice(0, 1_024);
    const file = new InputFile(input.bytes, safeFileName(input.fileName));

    if (input.kind === "photo") {
      const photo = await this.api.sendPhoto(
        input.recipientId,
        file,
        // Telegram не принимает пустую подпись у фотографии — шлём пробел.
        { caption: caption === "" ? " " : caption }
      );
      validateMessageId(photo.message_id);
      return { providerMessageId: String(photo.message_id) };
    }

    if (!this.api.sendDocument) {
      // Отправитель без документов: так устроены двойники в тестах уведомлений, где
      // документов не бывает. Для очереди это отказ без повторов.
      throw new Error("Telegram document sending is not available");
    }
    const message = await this.api.sendDocument(
      input.recipientId,
      file,
      caption === "" ? {} : { caption }
    );
    validateMessageId(message.message_id);
    return { providerMessageId: String(message.message_id) };
  }

  async sendScenarioPresentation(
    recipientId: string,
    sessionId: string,
    presentation: ScenarioPresentationModel
  ): Promise<{ readonly providerMessageId: string }> {
    validateRecipient(recipientId);
    if (!presentation.text || presentation.text.length > 4_096) {
      throw new Error("Telegram scenario presentation text is invalid");
    }
    if (presentation.buttons.length > 20) {
      throw new Error("Telegram scenario presentation buttons are invalid");
    }
    const keyboard = new InlineKeyboard();
    for (const [index, button] of presentation.buttons.entries()) {
      if (index > 0) {
        keyboard.row();
      }
      validateButtonText(button.text);
      if ("edgeId" in button) {
        keyboard.text(
          button.text,
          encodeScenarioCallback(sessionId, button.edgeId)
        );
      } else if ("callbackData" in button) {
        if (
          button.callbackData.length < 1
          || Buffer.byteLength(button.callbackData, "utf8") > 64
        ) {
          throw new Error("Telegram scenario callback data is invalid");
        }
        keyboard.text(button.text, button.callbackData);
      } else {
        if (!button.url.startsWith("https://") || button.url.length > 2_048) {
          throw new Error("Telegram scenario URL is invalid");
        }
        keyboard.url(button.text, button.url);
      }
    }

    const message = await this.api.sendMessage(
      recipientId,
      presentation.text,
      ...(presentation.buttons.length > 0
        ? [{ reply_markup: keyboard }]
        : [])
    );
    validateMessageId(message.message_id);
    return { providerMessageId: String(message.message_id) };
  }
}

export function createTelegramNotificationSender(
  token: string,
  apiRoot?: string
): GrammyTextNotificationSender {
  if (!token) {
    throw new Error("Telegram bot token is required for notifications");
  }

  return new GrammyTextNotificationSender(
    new Api(token, apiRoot ? { apiRoot } : undefined)
  );
}

/**
 * Имя файла для Telegram.
 *
 * Присланное менеджером имя может содержать что угодно, включая разделители пути. Telegram
 * такое имя примет и покажет человеку — но лучше, чтобы у файла было имя, а не путь.
 */
function safeFileName(fileName: string): string {
  const cleaned = fileName.replace(/[/\\]/g, "_").trim();
  return cleaned === "" ? "file" : cleaned.slice(0, 200);
}

function validateRecipient(recipientId: string): void {
  if (!/^-?\d{1,20}$/.test(recipientId)) {
    throw new Error("Telegram recipient ID is invalid");
  }
}

function validateMessageId(messageId: number): void {
  if (!Number.isSafeInteger(messageId) || messageId < 1) {
    throw new Error("Telegram returned an invalid message ID");
  }
}

function validateButtonText(text: string): void {
  if (!text || text.length > 64) {
    throw new Error("Telegram scenario button text is invalid");
  }
}
