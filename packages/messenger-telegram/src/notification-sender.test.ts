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
});
