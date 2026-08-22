import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SendConversationRepliesBatchService,
  type ConversationReplyQueueRepository,
  type ConversationReplySender,
  type QueuedReply
} from "./conversation-replies.js";

const at = new Date("2026-08-23T15:00:00.000Z");
const options = { maxAttempts: 3, retryDelayMs: 60_000, pauseBetweenMs: 1_000 };

function reply(overrides: Partial<QueuedReply> = {}): QueuedReply {
  return {
    messageId: "message-1",
    channel: "telegram",
    externalChatId: "123456789",
    body: "Детский билет 1500 ₽",
    attempts: 0,
    attachment: null,
    ...overrides
  };
}

class Queue implements ConversationReplyQueueRepository {
  sent: { readonly messageId: string; readonly providerMessageId: string | null }[] = [];
  failures: {
    readonly messageId: string;
    readonly reason: string;
    readonly retryAt: Date | null;
  }[] = [];

  constructor(private readonly queued: readonly QueuedReply[]) {}

  async claimQueued() {
    return this.queued;
  }

  async markSent(input: {
    readonly messageId: string;
    readonly providerMessageId: string | null;
  }) {
    this.sent.push(input);
  }

  async markAttemptFailed(input: {
    readonly messageId: string;
    readonly reason: string;
    readonly retryAt: Date | null;
  }) {
    this.failures.push(input);
  }
}

function sender(send: ConversationReplySender["sendText"]): ConversationReplySender {
  return { sendText: send };
}

describe("отправка ответов менеджера", () => {
  it("отправляет и запоминает идентификатор сообщения у мессенджера", async () => {
    const queue = new Queue([reply()]);
    const service = new SendConversationRepliesBatchService(
      queue,
      { telegram: sender(async () => ({ providerMessageId: "555" })) },
      options,
      async () => undefined
    );

    const result = await service.execute({ at, batchSize: 10 });

    assert.deepEqual(result, { claimed: 1, sent: 1, retried: 0, failed: 0 });
    assert.equal(queue.sent[0]?.providerMessageId, "555");
  });

  it("держит паузу между отправками, но не перед первой", async () => {
    // Десяток ответов, ушедших в одну секунду, для антиспама выглядит как рассылка.
    // Пауза перед первой отправкой при этом бессмысленна: она только задержит ответ.
    const pauses: number[] = [];
    const queue = new Queue([
      reply({ messageId: "a" }),
      reply({ messageId: "b" }),
      reply({ messageId: "c" })
    ]);
    const service = new SendConversationRepliesBatchService(
      queue,
      { telegram: sender(async () => ({ providerMessageId: "1" })) },
      options,
      async (ms) => {
        pauses.push(ms);
      }
    );

    await service.execute({ at, batchSize: 10 });

    assert.deepEqual(pauses, [1_000, 1_000]);
  });

  it("отправляет в том порядке, в каком реплики пришли из очереди", async () => {
    // Разговор, отправленный вразнобой, читается в чате задом наперёд.
    const order: string[] = [];
    const queue = new Queue([
      reply({ messageId: "a", body: "первое" }),
      reply({ messageId: "b", body: "второе" })
    ]);
    const service = new SendConversationRepliesBatchService(
      queue,
      {
        telegram: sender(async (_chatId, text) => {
          order.push(text);
          return { providerMessageId: "1" };
        })
      },
      options,
      async () => undefined
    );

    await service.execute({ at, batchSize: 10 });

    assert.deepEqual(order, ["первое", "второе"]);
  });

  it("сетевая заминка откладывает повтор, а не теряет ответ", async () => {
    const queue = new Queue([reply({ attempts: 1 })]);
    const service = new SendConversationRepliesBatchService(
      queue,
      {
        telegram: sender(() => {
          throw new Error("прокси недоступен");
        })
      },
      options,
      async () => undefined
    );

    const result = await service.execute({ at, batchSize: 10 });

    assert.equal(result.retried, 1);
    // Вторая попытка ждёт вдвое дольше первой.
    assert.equal(queue.failures[0]?.retryAt?.getTime(), at.getTime() + 120_000);
  });

  it("на последней попытке помечает не доставленным — менеджер должен это увидеть", async () => {
    const queue = new Queue([reply({ attempts: 2 })]);
    const service = new SendConversationRepliesBatchService(
      queue,
      {
        telegram: sender(() => {
          throw new Error("чат не найден");
        })
      },
      options,
      async () => undefined
    );

    const result = await service.execute({ at, batchSize: 10 });

    assert.equal(result.failed, 1);
    assert.equal(queue.failures[0]?.retryAt, null);
    assert.equal(queue.failures[0]?.reason, "чат не найден");
  });

  it("ответ в выключенный канал не висит в очереди, обещая доставку", async () => {
    const queue = new Queue([reply({ channel: "max" })]);
    const service = new SendConversationRepliesBatchService(
      queue,
      { telegram: sender(async () => ({ providerMessageId: "1" })) },
      options,
      async () => undefined
    );

    const result = await service.execute({ at, batchSize: 10 });

    assert.equal(result.failed, 1);
    assert.equal(queue.failures[0]?.retryAt, null);
    assert.match(queue.failures[0]?.reason ?? "", /канал отключён/);
  });
});

describe("отправка файла из панели", () => {
  const attachment = {
    attachmentId: "44444444-4444-4444-8444-444444444444",
    kind: "document" as const,
    storagePath: "2026/08/44444444-4444-4444-8444-444444444444.pdf",
    fileName: "Программа.pdf",
    mimeType: "application/pdf"
  };
  const files = {
    async read() {
      return new Uint8Array([1, 2, 3]);
    }
  };

  it("читает файл с диска и отправляет его подписью вместе с текстом", async () => {
    // Текст идёт подписью к файлу, а не отдельным сообщением: человек получает одну
    // реплику, как её и написали, а не две подряд.
    const queue = new Queue([reply({ attachment, body: "Вот программа" })]);
    const sent: { readonly fileName: string; readonly caption: string }[] = [];
    const service = new SendConversationRepliesBatchService(
      queue,
      {
        telegram: {
          sendText: async () => ({ providerMessageId: "1" }),
          sendFile: async (input) => {
            sent.push({ fileName: input.fileName, caption: input.caption });
            return { providerMessageId: "777" };
          }
        }
      },
      options,
      async () => undefined,
      files
    );

    const result = await service.execute({ at, batchSize: 10 });

    assert.equal(result.sent, 1);
    assert.deepEqual(sent, [{ fileName: "Программа.pdf", caption: "Вот программа" }]);
    assert.equal(queue.sent[0]?.providerMessageId, "777");
  });

  it("канал, который не умеет файлы, отказывает сразу и без повторов", async () => {
    // У MAX картинку отправить можно, а документ нет. Держать такое в очереди значит
    // обещать доставку, которой не будет: пять попыток дадут ровно тот же ответ.
    const queue = new Queue([reply({ attachment, channel: "max" })]);
    const service = new SendConversationRepliesBatchService(
      queue,
      { max: { sendText: async () => ({ providerMessageId: "1" }) } },
      options,
      async () => undefined,
      files
    );

    const result = await service.execute({ at, batchSize: 10 });

    assert.equal(result.failed, 1);
    assert.equal(queue.failures[0]?.retryAt, null);
    assert.match(queue.failures[0]?.reason ?? "", /не умеет отправлять файлы/);
  });

  it("нечитаемый файл — обычная неудача с повтором: диск бывает занят", async () => {
    const queue = new Queue([reply({ attachment })]);
    const service = new SendConversationRepliesBatchService(
      queue,
      {
        telegram: {
          sendText: async () => ({ providerMessageId: "1" }),
          sendFile: async () => ({ providerMessageId: "1" })
        }
      },
      options,
      async () => undefined,
      {
        read: () => {
          throw new Error("EBUSY");
        }
      }
    );

    const result = await service.execute({ at, batchSize: 10 });

    assert.equal(result.retried, 1);
    assert.notEqual(queue.failures[0]?.retryAt, null);
  });
});
