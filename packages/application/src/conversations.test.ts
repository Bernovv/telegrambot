import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ConversationLog,
  conversationContactIdentifier,
  type ConversationRepository,
  type IncomingConversationMessage,
  type OutgoingConversationMessage,
  type RecordIncomingMessageInput,
  type RecordOutgoingMessageInput
} from "./conversations.js";

const sender = {
  externalUserId: "123456789",
  username: "NadinKa88",
  displayName: "Надежда"
};

function incoming(
  overrides: Partial<IncomingConversationMessage> = {}
): IncomingConversationMessage {
  return {
    channel: "telegram",
    transport: "bot",
    externalChatId: "123456789",
    sender,
    externalMessageId: "1001",
    editsExternalMessageId: null,
    body: "а с ребёнком можно?",
    attachments: [],
    occurredAt: new Date("2026-08-23T09:00:00.000Z"),
    payload: { update_id: 5 },
    ...overrides
  };
}

function outgoing(
  overrides: Partial<OutgoingConversationMessage> = {}
): OutgoingConversationMessage {
  return {
    channel: "telegram",
    transport: "bot",
    externalChatId: "123456789",
    recipient: sender,
    authorKind: "bot",
    authorAdminId: null,
    body: "Детский билет — 1500 ₽",
    externalMessageId: "2001",
    deliveryStatus: "sent",
    failureReason: null,
    occurredAt: new Date("2026-08-23T09:00:01.000Z"),
    ...overrides
  };
}

class RecordingRepository implements ConversationRepository {
  incoming: RecordIncomingMessageInput[] = [];
  outgoing: RecordOutgoingMessageInput[] = [];

  async recordIncoming(input: RecordIncomingMessageInput) {
    this.incoming.push(input);
    return { conversationId: input.conversationId, messageId: input.messageId, stored: true };
  }

  async recordOutgoing(input: RecordOutgoingMessageInput) {
    this.outgoing.push(input);
    return { conversationId: input.conversationId, messageId: input.messageId, stored: true };
  }
}

class BrokenRepository implements ConversationRepository {
  async recordIncoming(): Promise<never> {
    throw new Error("база недоступна");
  }

  async recordOutgoing(): Promise<never> {
    throw new Error("база недоступна");
  }
}

function idGenerator(): { newId(): string } {
  let counter = 0;
  return {
    newId(): string {
      counter += 1;
      return `id-${counter}`;
    }
  };
}

describe("ConversationLog", () => {
  it("выдаёт идентификаторы заранее — и по одному на каждое вложение", async () => {
    const repository = new RecordingRepository();
    const log = new ConversationLog(repository, idGenerator());

    await log.recordIncoming(incoming({
      attachments: [
        { kind: "photo", fileName: null, mimeType: "image/jpeg", sizeBytes: 100, externalFileId: "a" },
        { kind: "voice", fileName: null, mimeType: "audio/ogg", sizeBytes: 200, externalFileId: "b" }
      ]
    }));

    const stored = repository.incoming[0];
    assert.ok(stored);
    assert.equal(stored.attachmentIds.length, 2);
    assert.equal(new Set([
      stored.conversationId,
      stored.messageId,
      stored.contactId,
      ...stored.attachmentIds
    ]).size, 5, "идентификаторы не должны повторяться");
  });

  it("передаёт репозиторию всё сказанное как есть, вместе с телом обновления", async () => {
    const repository = new RecordingRepository();
    const log = new ConversationLog(repository, idGenerator());

    await log.recordIncoming(incoming({ editsExternalMessageId: "1001", body: "и с двумя?" }));

    const stored = repository.incoming[0];
    assert.equal(stored?.body, "и с двумя?");
    assert.equal(stored?.editsExternalMessageId, "1001");
    assert.deepEqual(stored?.payload, { update_id: 5 });
  });

  it("не бросает исключение, когда запись не удалась: разговор важнее журнала", async () => {
    // Сообщение записывается до того, как человек получит ответ. Если падение записи
    // выбрасывается наружу, бот замолкает — а это дороже, чем потерянная строка.
    const failures: string[] = [];
    const log = new ConversationLog(
      new BrokenRepository(),
      idGenerator(),
      (_error, context) => failures.push(`${context.direction}:${context.channel}`)
    );

    assert.equal(await log.recordIncoming(incoming()), null);
    assert.equal(await log.recordOutgoing(outgoing()), null);
    assert.deepEqual(failures, ["inbound:telegram", "outbound:telegram"]);
  });

  it("записывает ответ менеджера с его именем", async () => {
    const repository = new RecordingRepository();
    const log = new ConversationLog(repository, idGenerator());

    await log.recordOutgoing(outgoing({
      authorKind: "manager",
      authorAdminId: "00000000-0000-4000-8000-0000000000aa",
      deliveryStatus: "queued"
    }));

    const stored = repository.outgoing[0];
    assert.equal(stored?.authorKind, "manager");
    assert.equal(stored?.authorAdminId, "00000000-0000-4000-8000-0000000000aa");
  });
});

describe("conversationContactIdentifier", () => {
  it("в Telegram берёт ник и отбрасывает собачку", () => {
    assert.deepEqual(
      conversationContactIdentifier("telegram", { ...sender, username: "@NadinKa88" }),
      { telegramUsername: "NadinKa88", maxIdentifier: null }
    );
  });

  it("в Telegram без ника не подставляет числовой идентификатор", () => {
    // Колонку «ник» читают глазами и по ней ищут; число в ней не скажет никому ничего.
    // Такой диалог подождёт: появится ник или телефон — привяжется вместе с историей.
    assert.deepEqual(
      conversationContactIdentifier("telegram", { ...sender, username: null }),
      { telegramUsername: null, maxIdentifier: null }
    );
  });

  it("в MAX без ника берёт числовой идентификатор: он там единственное, что есть", () => {
    assert.deepEqual(
      conversationContactIdentifier("max", { ...sender, username: null }),
      { telegramUsername: null, maxIdentifier: "123456789" }
    );
  });
});
