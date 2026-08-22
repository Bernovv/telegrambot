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
