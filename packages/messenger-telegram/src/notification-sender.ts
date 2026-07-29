import type { ScenarioPresentationModel } from "@ticket-platform/contracts";
import type { AdminBroadcastContent } from "@ticket-platform/contracts";
import {
  Api,
  GrammyError,
  HttpError,
  InlineKeyboard,
  InputFile
} from "grammy";
import { encodeScenarioCallback } from "./scenario-callback.js";

export interface TelegramNotificationApi {
  sendMessage(
    chatId: string | number,
    text: string,
    options?: {
      readonly reply_markup?: InlineKeyboard;
      readonly link_preview_options?: { readonly is_disabled: true };
    }
  ): Promise<{ readonly message_id: number }>;
  sendPhoto(
    chatId: string | number,
    photo: InputFile,
    options: { readonly caption: string }
  ): Promise<{ readonly message_id: number }>;
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

  async sendBroadcastMessage(
    recipientId: string,
    content: AdminBroadcastContent
  ): Promise<{ readonly providerMessageId: string }> {
    validateRecipient(recipientId);
    if (!content.text || content.text.length > 4_096) {
      throw new Error("Telegram broadcast text is invalid");
    }
    if (content.buttons.length > 20) {
      throw new Error("Telegram broadcast buttons are invalid");
    }
    const keyboard = new InlineKeyboard();
    for (const [index, button] of content.buttons.entries()) {
      if (index > 0) {
        keyboard.row();
      }
      validateButtonText(button.label);
      if (!button.url.startsWith("https://") || button.url.length > 2_048) {
        throw new Error("Telegram broadcast URL is invalid");
      }
      keyboard.url(button.label, button.url);
    }

    try {
      const message = await this.api.sendMessage(recipientId, content.text, {
        ...(content.buttons.length > 0 ? { reply_markup: keyboard } : {}),
        ...(content.disableLinkPreview
          ? { link_preview_options: { is_disabled: true as const } }
          : {})
      });
      validateMessageId(message.message_id);
      return { providerMessageId: String(message.message_id) };
    } catch (error) {
      throw classifyTelegramBroadcastError(error);
    }
  }
}

export class TelegramBroadcastSendError extends Error {
  constructor(
    readonly category: "blocked" | "rate_limit" | "transient" | "permanent",
    readonly code: string,
    readonly retryAfterSeconds?: number
  ) {
    super(`Telegram broadcast send failed: ${code}`);
    this.name = "TelegramBroadcastSendError";
  }
}

export function classifyTelegramBroadcastError(
  error: unknown
): TelegramBroadcastSendError {
  if (error instanceof TelegramBroadcastSendError) {
    return error;
  }
  if (error instanceof HttpError) {
    return new TelegramBroadcastSendError(
      "transient",
      "TelegramTransportError"
    );
  }
  if (error instanceof GrammyError) {
    if (error.error_code === 429) {
      return new TelegramBroadcastSendError(
        "rate_limit",
        "TelegramRateLimited",
        error.parameters.retry_after
      );
    }
    if (
      error.error_code === 403
      && /(blocked|deactivated|chat not found)/i.test(error.description)
    ) {
      return new TelegramBroadcastSendError(
        "blocked",
        "TelegramRecipientBlocked"
      );
    }
    if (error.error_code >= 500) {
      return new TelegramBroadcastSendError(
        "transient",
        "TelegramServerError"
      );
    }
    return new TelegramBroadcastSendError(
      "permanent",
      error.error_code === 400
        ? "TelegramRequestRejected"
        : "TelegramAuthorizationRejected"
    );
  }
  return new TelegramBroadcastSendError(
    "transient",
    "TelegramUnknownError"
  );
}

export function createTelegramNotificationSender(
  token: string,
  timeoutSeconds = 20
): GrammyTextNotificationSender {
  if (!token) {
    throw new Error("Telegram bot token is required for notifications");
  }
  if (
    !Number.isSafeInteger(timeoutSeconds)
    || timeoutSeconds < 5
    || timeoutSeconds > 300
  ) {
    throw new Error("Telegram HTTP timeout must be between 5 and 300 seconds");
  }

  return new GrammyTextNotificationSender(new Api(token, { timeoutSeconds }));
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
