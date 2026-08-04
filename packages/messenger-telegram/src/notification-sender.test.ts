import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GrammyTextNotificationSender,
  type TelegramNotificationApi
} from "./notification-sender.js";

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
          keyboard: options?.reply_markup.inline_keyboard
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
});

describe("GrammyTextNotificationSender.sendBroadcastMessage", () => {
  it("без картинки шлёт текст, с кнопкой-ссылкой в клавиатуре", async () => {
    const calls: { readonly text: string; readonly markup: unknown }[] = [];
    const sender = new GrammyTextNotificationSender({
      async sendMessage(_chatId, text, options) {
        calls.push({ text, markup: options?.reply_markup });
        return { message_id: 7 };
      },
      async sendPhoto() {
        throw new Error("Unexpected photo call");
      }
    });

    const result = await sender.sendBroadcastMessage("123456789", {
      text: "  Успей купить  ",
      image: null,
      button: { text: "Купить билет", url: "https://biz-day.ru/tariffs" }
    });

    assert.deepEqual(result, { providerMessageId: "7" });
    assert.equal(calls[0]?.text, "Успей купить");
    assert.deepEqual(
      (calls[0]?.markup as { readonly inline_keyboard: unknown[] }).inline_keyboard,
      [[{ text: "Купить билет", url: "https://biz-day.ru/tariffs" }]]
    );
  });

  it("с картинкой шлёт фото, а текст уходит подписью — и кнопка остаётся", async () => {
    const calls: {
      readonly caption: string;
      readonly bytes: Uint8Array;
      readonly markup: unknown;
    }[] = [];
    const sender = new GrammyTextNotificationSender({
      async sendMessage() {
        throw new Error("Unexpected text call");
      },
      async sendPhoto(_chatId, photo, options) {
        const raw = await photo.toRaw();
        assert.ok(raw instanceof Uint8Array);
        calls.push({
          caption: options.caption,
          bytes: raw,
          markup: options.reply_markup
        });
        return { message_id: 9 };
      }
    });

    const bytes = new Uint8Array(200).fill(7);
    const result = await sender.sendBroadcastMessage("123456789", {
      text: "Подпись",
      image: { bytes, mimeType: "image/jpeg" },
      button: { text: "Купить", url: "https://biz-day.ru" }
    });

    assert.deepEqual(result, { providerMessageId: "9" });
    assert.equal(calls[0]?.caption, "Подпись");
    assert.deepEqual(calls[0]?.bytes, bytes);
    assert.ok(calls[0]?.markup);
  });

  it("режет по подписи, а не по длине сообщения, когда есть картинка", async () => {
    let calls = 0;
    const sender = new GrammyTextNotificationSender({
      async sendMessage() {
        calls += 1;
        return { message_id: 1 };
      },
      async sendPhoto() {
        calls += 1;
        return { message_id: 1 };
      }
    });
    const image = { bytes: new Uint8Array(200).fill(1), mimeType: "image/png" as const };

    await assert.rejects(
      sender.sendBroadcastMessage("123", { text: "x".repeat(1_025), image, button: null }),
      /broadcast text is invalid/
    );
    // Без картинки та же длина проходит: это уже обычное сообщение.
    await sender.sendBroadcastMessage("123", {
      text: "x".repeat(1_025),
      image: null,
      button: null
    });
    assert.equal(calls, 1);
  });

  it("не отправляет кнопку на не-https и не отправляет крошечную «картинку»", async () => {
    let calls = 0;
    const sender = new GrammyTextNotificationSender({
      async sendMessage() {
        calls += 1;
        return { message_id: 1 };
      },
      async sendPhoto() {
        calls += 1;
        return { message_id: 1 };
      }
    });

    await assert.rejects(
      sender.sendBroadcastMessage("123", {
        text: "Привет",
        image: null,
        button: { text: "Купить", url: "http://biz-day.ru" }
      }),
      /button URL is invalid/
    );
    await assert.rejects(
      sender.sendBroadcastMessage("123", {
        text: "Привет",
        image: { bytes: new Uint8Array(10), mimeType: "image/png" },
        button: null
      }),
      /broadcast image is invalid/
    );
    assert.equal(calls, 0);
  });
});
