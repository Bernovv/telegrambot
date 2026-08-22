import type { ScenarioPresentationModel } from "@ticket-platform/contracts";
import { encodeScenarioCallback } from "@ticket-platform/messenger-core";
import type { MaxApi, MaxButton } from "./max-api.js";

/**
 * Отправка уведомлений в MAX: билеты, напоминания, рассылки.
 *
 * Тот же порт, что у Telegram (`NotificationSender` в `application`), поэтому очередь
 * доставки, журнал, ретраи и dead-letter у каналов общие. Это и есть смысл объединения:
 * второй очереди со своими граблями не появляется.
 *
 * Проверки входа здесь не для красоты. Уведомление уходит из воркера, где рядом нет
 * человека, который заметит кривой текст; а неудачная отправка попадает в очередь повторов
 * и будет ломиться туда три часа. Дешевле отвергнуть сразу.
 */

/** Предел длины текста у MAX. Тот же, что у Telegram. */
const TEXT_LIMIT = 4_000;

export class MaxNotificationSender {
  constructor(private readonly api: MaxApi) {}

  async sendText(
    recipientId: string,
    text: string
  ): Promise<{ readonly providerMessageId: string }> {
    validateRecipient(recipientId);
    validateText(text, TEXT_LIMIT);
    return this.api.sendMessage({ userId: recipientId, text });
  }

  async sendBroadcastMessage(
    recipientId: string,
    message: {
      readonly text: string;
      readonly image: {
        readonly bytes: Uint8Array;
        readonly mimeType: "image/png" | "image/jpeg";
      } | null;
      readonly button: { readonly text: string; readonly url: string } | null;
    }
  ): Promise<{ readonly providerMessageId: string }> {
    validateRecipient(recipientId);
    const text = message.text.trim();
    validateText(text, TEXT_LIMIT);

    const buttons = message.button
      ? [[linkButton(message.button.text, message.button.url)]]
      : undefined;

    if (message.image) {
      return this.api.sendImage({
        userId: recipientId,
        bytes: message.image.bytes,
        fileName: "broadcast.png",
        caption: text,
        ...(buttons ? { buttons } : {})
      });
    }
    return this.api.sendMessage({
      userId: recipientId,
      text,
      ...(buttons ? { buttons } : {})
    });
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
      throw new Error("MAX notification image is invalid");
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.png$/.test(fileName)) {
      throw new Error("MAX notification file name is invalid");
    }
    validateText(caption, 1_024);

    return this.api.sendImage({
      userId: recipientId,
      bytes: image.bytes,
      fileName,
      caption
    });
  }

  async sendScenarioPresentation(
    recipientId: string,
    sessionId: string,
    presentation: ScenarioPresentationModel
  ): Promise<{ readonly providerMessageId: string }> {
    validateRecipient(recipientId);
    validateText(presentation.text, TEXT_LIMIT);
    if (presentation.buttons.length > 20) {
      throw new Error("MAX scenario presentation buttons are invalid");
    }

    // По кнопке в строке, как в Telegram: у экранов сценария длинные подписи, и в ряд они
    // не помещаются ни там, ни здесь.
    const buttons = presentation.buttons.map((button) => {
      validateButtonText(button.text);
      if ("edgeId" in button) {
        return [callbackButton(button.text, encodeScenarioCallback(sessionId, button.edgeId))];
      }
      if ("callbackData" in button) {
        if (
          button.callbackData.length < 1
          || Buffer.byteLength(button.callbackData, "utf8") > 64
        ) {
          throw new Error("MAX scenario callback data is invalid");
        }
        return [callbackButton(button.text, button.callbackData)];
      }
      if (!button.url.startsWith("https://") || button.url.length > 2_048) {
        throw new Error("MAX scenario URL is invalid");
      }
      return [linkButton(button.text, button.url)];
    });

    return this.api.sendMessage({
      userId: recipientId,
      text: presentation.text,
      ...(buttons.length > 0 ? { buttons } : {})
    });
  }
}

function callbackButton(text: string, payload: string): MaxButton {
  return { type: "callback", text, payload };
}

function linkButton(text: string, url: string): MaxButton {
  return { type: "link", text, url };
}

/** Идентификатор человека в MAX — число, как и в Telegram. */
function validateRecipient(recipientId: string): void {
  if (!/^-?\d{1,20}$/.test(recipientId)) {
    throw new Error("MAX notification recipient is invalid");
  }
}

function validateText(text: string, limit: number): void {
  if (!text || text.length > limit) {
    throw new Error("MAX notification text is invalid");
  }
}

function validateButtonText(text: string): void {
  if (!text || text.length > 128) {
    throw new Error("MAX button text is invalid");
  }
}
