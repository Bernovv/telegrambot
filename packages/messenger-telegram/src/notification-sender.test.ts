import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GrammyTextNotificationSender,
  type TelegramBroadcastSendError,
  classifyTelegramBroadcastError,
  type TelegramNotificationApi
} from "./notification-sender.js";
import { GrammyError, HttpError } from "grammy";

describe("GrammyTextNotificationSender", () => {
  it("sends plain text and returns the Telegram message ID", async () => {
    const calls: { readonly chatId: string | number; readonly text: string }[] = [];
    const sender = new GrammyTextNotificationSender({
      async sendMessage(chatId, text) {
        calls.push({ chatId, text });
        return { message_id: 42 };
      },
      async sendPhoto() {
        throw new Error("Unexpected photo call");
      }
    });

    const result = await sender.sendText("123456789", "Ticket message");

    assert.deepEqual(result, { providerMessageId: "42" });
    assert.deepEqual(calls, [{ chatId: "123456789", text: "Ticket message" }]);
  });

  it("rejects an invalid recipient or oversized text before the API call", async () => {
    let calls = 0;
    const api: TelegramNotificationApi = {
      async sendMessage() {
        calls += 1;
        return { message_id: 1 };
      },
      async sendPhoto() {
        calls += 1;
        return { message_id: 1 };
      }
    };
    const sender = new GrammyTextNotificationSender(api);

    await assert.rejects(sender.sendText("not-a-chat", "message"), /recipient/);
    await assert.rejects(sender.sendText("123", "x".repeat(4_097)), /text/);
    assert.equal(calls, 0);
  });

  it("uploads a bounded PNG with its ticket caption", async () => {
    const calls: {
      readonly chatId: string | number;
      readonly fileName: string | undefined;
      readonly caption: string;
      readonly bytes: Uint8Array;
    }[] = [];
    const sender = new GrammyTextNotificationSender({
      async sendMessage() {
        throw new Error("Unexpected text call");
      },
      async sendPhoto(chatId, photo, options) {
        const raw = await photo.toRaw();
        assert.ok(raw instanceof Uint8Array);
        calls.push({
          chatId,
          fileName: photo.filename,
          caption: options.caption,
          bytes: raw
        });
        return { message_id: 43 };
      }
    });
    const bytes = new Uint8Array(100);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);

    const result = await sender.sendImage(
      "123456789",
      { bytes, mimeType: "image/png", width: 512, height: 512 },
      "BP-000001-T001.png",
      "Ticket caption"
    );

    assert.deepEqual(result, { providerMessageId: "43" });
    assert.equal(calls[0]?.fileName, "BP-000001-T001.png");
    assert.equal(calls[0]?.caption, "Ticket caption");
    assert.deepEqual(calls[0]?.bytes, bytes);
  });

  it("sends scenario buttons with compact owner-bound callbacks", async () => {
    const calls: {
      readonly text: string;
      readonly keyboard: unknown;
    }[] = [];
    const sender = new GrammyTextNotificationSender({
      async sendMessage(_chatId, text, options) {
        calls.push({
          text,
          keyboard: options?.reply_markup?.inline_keyboard
        });
        return { message_id: 44 };
      },
      async sendPhoto() {
        throw new Error("Unexpected photo call");
      }
    });
    const sessionId = "019c0123-4567-789a-bcde-f0123456789a";
    const edgeId = "019c0123-4567-789a-bcde-f0123456789b";

    const result = await sender.sendScenarioPresentation(
      "123456789",
      sessionId,
      {
        text: "Оплата подтверждена",
        buttons: [{ text: "Продолжить", edgeId }]
      }
    );

    assert.deepEqual(result, { providerMessageId: "44" });
    assert.equal(calls[0]?.text, "Оплата подтверждена");
    assert.deepEqual(calls[0]?.keyboard, [[{
      text: "Продолжить",
      callback_data:
        "scenario:AZwBI0VneJq83vASNFZ4mg:AZwBI0VneJq83vASNFZ4mw"
    }]]);
  });

  it("sends broadcast links and disables link previews", async () => {
    const calls: unknown[] = [];
    const sender = new GrammyTextNotificationSender({
      async sendMessage(_chatId, _text, options) {
        calls.push(options);
        return { message_id: 45 };
      },
      async sendPhoto() {
        throw new Error("Unexpected photo call");
      }
    });

    const result = await sender.sendBroadcastMessage("123456789", {
      text: "Новая программа мероприятия",
      disableLinkPreview: true,
      buttons: [{ label: "Открыть", url: "https://example.com/event" }]
    });

    assert.deepEqual(result, { providerMessageId: "45" });
    const options = calls[0] as {
      reply_markup: { inline_keyboard: unknown };
      link_preview_options: { is_disabled: boolean };
    };
    assert.deepEqual(options.reply_markup.inline_keyboard, [[{
      text: "Открыть",
      url: "https://example.com/event"
    }]]);
    assert.deepEqual(options.link_preview_options, { is_disabled: true });
  });

  it("classifies Telegram rate limits, blocked users and transport failures", () => {
    const rateLimit = new GrammyError(
      "rate limited",
      {
        ok: false,
        error_code: 429,
        description: "Too Many Requests",
        parameters: { retry_after: 17 }
      },
      "sendMessage",
      {}
    );
    const blocked = new GrammyError(
      "blocked",
      {
        ok: false,
        error_code: 403,
        description: "Forbidden: bot was blocked by the user",
        parameters: {}
      },
      "sendMessage",
      {}
    );

    assert.deepEqual(
      pick(classifyTelegramBroadcastError(rateLimit)),
      ["rate_limit", "TelegramRateLimited", 17]
    );
    assert.deepEqual(
      pick(classifyTelegramBroadcastError(blocked)),
      ["blocked", "TelegramRecipientBlocked", undefined]
    );
    assert.deepEqual(
      pick(classifyTelegramBroadcastError(new HttpError("network", new Error()))),
      ["transient", "TelegramTransportError", undefined]
    );
  });
});

function pick(error: TelegramBroadcastSendError): readonly unknown[] {
  return [error.category, error.code, error.retryAfterSeconds];
}
