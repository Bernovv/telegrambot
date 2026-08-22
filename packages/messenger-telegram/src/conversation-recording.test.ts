import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ConversationRecorder,
  IncomingConversationMessage,
  OutgoingConversationMessage
} from "@ticket-platform/messenger-core";
import { recordIncomingUpdate } from "./conversation-recording.js";

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

const from = { id: 123456789, username: "NadinKa88", first_name: "Надежда", last_name: "П." };
const chat = { id: 123456789, type: "private" };

describe("запись входящих в Telegram", () => {
  it("пишет обычный текст с ником и именем отправителя", async () => {
    const log = recorder();

    await recordIncomingUpdate(log, {
      message: { message_id: 77, date: 1_800_000_000, chat, from, text: "а с ребёнком можно?" }
    });

    const stored = log.incoming[0];
    assert.equal(stored?.body, "а с ребёнком можно?");
    assert.equal(stored?.externalMessageId, "77");
    assert.equal(stored?.sender.username, "NadinKa88");
    assert.equal(stored?.sender.displayName, "Надежда П.");
    assert.equal(stored?.occurredAt.getTime(), 1_800_000_000_000);
  });

  it("пишет голосовое, которого бот сегодня не понимает вовсе", async () => {
    // Ради этого случая middleware и стоит: голосовое не попадает ни в один обработчик,
    // и до сих пор от него не оставалось ничего.
    const log = recorder();

    await recordIncomingUpdate(log, {
      message: {
        message_id: 78,
        date: 1_800_000_100,
        chat,
        from,
        voice: { file_id: "AgAD-voice", mime_type: "audio/ogg", file_size: 41_234 }
      }
    });

    const stored = log.incoming[0];
    assert.equal(stored?.body, null);
    assert.deepEqual(stored?.attachments, [{
      kind: "voice",
      fileName: null,
      mimeType: "audio/ogg",
      sizeBytes: 41_234,
      externalFileId: "AgAD-voice"
    }]);
  });

  it("из лестницы размеров фотографии берёт самый крупный кадр", async () => {
    const log = recorder();

    await recordIncomingUpdate(log, {
      message: {
        message_id: 79,
        date: 1_800_000_200,
        chat,
        from,
        caption: "вот такой",
        photo: [
          { file_id: "small", file_size: 1_000 },
          { file_id: "large", file_size: 90_000 }
        ]
      }
    });

    assert.equal(log.incoming[0]?.body, "вот такой");
    assert.equal(log.incoming[0]?.attachments[0]?.externalFileId, "large");
  });

  it("правка приходит отдельной репликой и знает, что она правка", async () => {
    const log = recorder();

    await recordIncomingUpdate(log, {
      edited_message: {
        message_id: 77,
        date: 1_800_000_000,
        edit_date: 1_800_000_060,
        chat,
        from,
        text: "а с двумя детьми можно?"
      }
    });

    const stored = log.incoming[0];
    assert.equal(stored?.editsExternalMessageId, "77");
    // Время правки, а не исходной отправки: иначе две правки подряд неотличимы.
    assert.equal(stored?.occurredAt.getTime(), 1_800_000_060_000);
  });

  it("групповой чат не пишет: в карточке человека ему не место", async () => {
    const log = recorder();

    await recordIncomingUpdate(log, {
      message: {
        message_id: 80,
        date: 1_800_000_300,
        chat: { id: -100, type: "supergroup" },
        from,
        text: "всем привет"
      }
    });

    assert.equal(log.incoming.length, 0);
  });

  it("обновление без отправителя пропускает молча", async () => {
    const log = recorder();

    await recordIncomingUpdate(log, { message: { message_id: 81, chat, text: "?" } });

    assert.equal(log.incoming.length, 0);
  });
});
