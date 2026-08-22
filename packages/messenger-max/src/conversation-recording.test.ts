import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ConversationRecorder,
  IncomingConversationMessage,
  OutgoingConversationMessage
} from "@ticket-platform/messenger-core";
import { recordIncomingMaxUpdate } from "./conversation-recording.js";

function recorder(): ConversationRecorder & {
  readonly incoming: IncomingConversationMessage[];
  readonly outgoing: OutgoingConversationMessage[];
} {
  const incoming: IncomingConversationMessage[] = [];
  const outgoing: OutgoingConversationMessage[] = [];
  return {
    incoming,
    outgoing,
    async recordIncoming(message) {
      incoming.push(message);
      return { conversationId: "c", messageId: "m", stored: true };
    },
    async recordOutgoing(message) {
      outgoing.push(message);
      return { conversationId: "c", messageId: "m", stored: true };
    }
  };
}

const sender = { user_id: 987654321, username: "nadin", name: "Надежда" };

describe("запись входящих в MAX", () => {
  it("пишет текст, идентификатор реплики и время обновления", async () => {
    const log = recorder();

    await recordIncomingMaxUpdate(log, {
      update_type: "message_created",
      timestamp: 1_800_000_000_000,
      message: { sender, body: { mid: "mid-1", text: "здравствуйте" } }
    });

    const stored = log.incoming[0];
    assert.equal(stored?.channel, "max");
    assert.equal(stored?.body, "здравствуйте");
    assert.equal(stored?.externalMessageId, "mid-1");
    assert.equal(stored?.sender.externalUserId, "987654321");
    assert.equal(stored?.occurredAt.getTime(), 1_800_000_000_000);
  });

  it("пишет и то обновление, тип которого нам незнаком", async () => {
    // Список типов у MAX пополняется без предупреждения. «Мы такого не ждали» не может
    // быть причиной потерять написанное человеком.
    const log = recorder();

    await recordIncomingMaxUpdate(log, {
      update_type: "message_something_new",
      message: { sender, body: { mid: "mid-2", text: "а можно с ребёнком?" } }
    });

    assert.equal(log.incoming[0]?.body, "а можно с ребёнком?");
  });

  it("правку отмечает правкой", async () => {
    const log = recorder();

    await recordIncomingMaxUpdate(log, {
      update_type: "message_edited",
      message: { sender, body: { mid: "mid-1", text: "а с двумя?" } }
    });

    assert.equal(log.incoming[0]?.editsExternalMessageId, "mid-1");
  });

  it("нашу же клавиатуру за вложение не считает", async () => {
    const log = recorder();

    await recordIncomingMaxUpdate(log, {
      update_type: "message_created",
      message: {
        sender,
        body: {
          mid: "mid-3",
          text: "фото",
          attachments: [
            { type: "inline_keyboard", payload: { buttons: [] } },
            { type: "image", payload: { token: "tok-1" } }
          ]
        }
      }
    });

    assert.equal(log.incoming[0]?.attachments.length, 1);
    assert.equal(log.incoming[0]?.attachments[0]?.kind, "photo");
    assert.equal(log.incoming[0]?.attachments[0]?.externalFileId, "tok-1");
  });

  it("вложение незнакомого вида пишет как «прочее», не теряя его", async () => {
    const log = recorder();

    await recordIncomingMaxUpdate(log, {
      update_type: "message_created",
      message: {
        sender,
        body: { mid: "mid-4", attachments: [{ type: "share", payload: { url: "https://…" } }] }
      }
    });

    assert.equal(log.incoming[0]?.attachments[0]?.kind, "other");
  });

  it("обновление без сообщения пропускает молча", async () => {
    const log = recorder();

    await recordIncomingMaxUpdate(log, { update_type: "bot_started", user: sender });

    assert.equal(log.incoming.length, 0);
  });
});
