import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConversationChannel } from "@ticket-platform/domain";
import {
  ResolveChannelLookupsBatchService,
  type ChannelLookupKey,
  type ChannelLookupOutcome,
  type ChannelLookupPort,
  type ChannelLookupQueueRepository,
  type QueuedChannelLookup
} from "./channel-lookup.js";

const CONTACT = "11111111-1111-4111-8111-111111111111";

class Queue implements ChannelLookupQueueRepository {
  found: unknown[] = [];
  notFound: ChannelLookupKey[] = [];
  retried: unknown[] = [];
  failed: unknown[] = [];
  claims: { readonly channel: ConversationChannel; readonly batchSize: number }[] = [];

  constructor(
    private readonly queued: QueuedChannelLookup[],
    private readonly checkedToday = 0
  ) {}

  async claimQueued(input: {
    readonly channel: ConversationChannel;
    readonly batchSize: number;
    readonly at: Date;
  }) {
    this.claims.push({ channel: input.channel, batchSize: input.batchSize });

    return this.queued.slice(0, input.batchSize);
  }

  async countCheckedSince() {
    return this.checkedToday;
  }

  async markFound(input: ChannelLookupKey & { readonly externalUserId: string }) {
    this.found.push(input);
  }

  async markNotFound(input: ChannelLookupKey & { readonly at: Date }) {
    this.notFound.push(input);
  }

  async markAttemptFailed(input: ChannelLookupKey & { readonly retryAt: Date }) {
    this.retried.push(input);
  }

  async markFailed(input: ChannelLookupKey & { readonly reason: string }) {
    this.failed.push(input);
  }
}

function port(outcome: ChannelLookupOutcome | (() => never)): ChannelLookupPort {
  return {
    async find() {
      if (typeof outcome === "function") {
        return outcome();
      }

      return outcome;
    }
  };
}

function queued(channel: ConversationChannel, attempts = 0): QueuedChannelLookup {
  return { contactId: CONTACT, channel, phoneE164: "+79001234567", attempts };
}

const ids = { newId: () => "22222222-2222-4222-8222-222222222222" };
const noPause = async () => undefined;

describe("проверка каналов по номеру", () => {
  it("найденному заводит ветку переписки, а не только пишет ответ", async () => {
    // Идентификатор без ветки — это число в базе: панель показала бы «найден» и не дала
    // бы поля ввода. Ровно этого работа и должна была избежать.
    const queue = new Queue([queued("max")]);
    const service = new ResolveChannelLookupsBatchService(
      "max",
      queue,
      port({
        kind: "found",
        externalUserId: "777",
        externalChatId: "777",
        username: "sergey"
      }),
      ids,
      undefined,
      noPause
    );

    const result = await service.execute({ at: new Date(), batchSize: 5 });

    assert.equal(result.found, 1);
    assert.equal(queue.found.length, 1);
    assert.deepEqual(queue.found[0], {
      contactId: CONTACT,
      channel: "max",
      externalUserId: "777",
      externalChatId: "777",
      username: "sergey",
      conversationId: ids.newId(),
      at: (queue.found[0] as { readonly at: Date }).at
    });
  });

  it("берёт из очереди только свой канал", async () => {
    const queue = new Queue([queued("telegram")]);
    const service = new ResolveChannelLookupsBatchService(
      "telegram",
      queue,
      port({ kind: "not_found" }),
      ids,
      undefined,
      noPause
    );

    await service.execute({ at: new Date(), batchSize: 3 });

    assert.equal(queue.claims[0]?.channel, "telegram");
  });

  it("упёршись в суточный потолок, наружу не ходит вовсе", async () => {
    // Потолок защищает аккаунт, через который идёт вся переписка с клиентами. Очередь
    // подождёт до завтра — это правильный исход, а не ошибка.
    const queue = new Queue([queued("whatsapp")], 150);
    const service = new ResolveChannelLookupsBatchService(
      "whatsapp",
      queue,
      port(() => {
        throw new Error("наружу ходить было нельзя");
      }),
      ids,
      { maxAttempts: 3, retryDelayMs: 1_000, pauseBetweenMs: 0, dailyLimit: 150 },
      noPause
    );

    const result = await service.execute({ at: new Date(), batchSize: 5 });

    assert.deepEqual(result, {
      claimed: 0,
      found: 0,
      notFound: 0,
      retried: 0,
      failed: 0,
      throttled: true
    });
    assert.equal(queue.claims.length, 0);
  });

  it("не забирает из очереди больше, чем осталось до потолка", async () => {
    const queue = new Queue([queued("telegram"), queued("telegram")], 149);
    const service = new ResolveChannelLookupsBatchService(
      "telegram",
      queue,
      port({ kind: "not_found" }),
      ids,
      { maxAttempts: 3, retryDelayMs: 1_000, pauseBetweenMs: 0, dailyLimit: 150 },
      noPause
    );

    await service.execute({ at: new Date(), batchSize: 10 });

    assert.equal(queue.claims[0]?.batchSize, 1);
  });

  it("сетевой отказ повторяет, а «нет такого» — нет", async () => {
    const failing = new Queue([queued("max")]);
    await new ResolveChannelLookupsBatchService(
      "max",
      failing,
      port({ kind: "failed", reason: "прокси лёг", retryAfterMs: null }),
      ids,
      { maxAttempts: 3, retryDelayMs: 1_000, pauseBetweenMs: 0, dailyLimit: 150 },
      noPause
    ).execute({ at: new Date(), batchSize: 5 });

    assert.equal(failing.retried.length, 1);
    assert.equal(failing.failed.length, 0);
  });

  it("исчерпав попытки, сдаётся и говорит почему", async () => {
    const queue = new Queue([queued("max", 2)]);
    await new ResolveChannelLookupsBatchService(
      "max",
      queue,
      port({ kind: "failed", reason: "лимит", retryAfterMs: null }),
      ids,
      { maxAttempts: 3, retryDelayMs: 1_000, pauseBetweenMs: 0, dailyLimit: 150 },
      noPause
    ).execute({ at: new Date(), batchSize: 5 });

    assert.equal(queue.failed.length, 1);
    assert.equal((queue.failed[0] as { readonly reason: string }).reason, "лимит");
  });

  it("ждёт столько, сколько назвал сам мессенджер, если это дольше нашего срока", async () => {
    // Попытка раньше названного срока не просто не сработает — она продлевает запрет.
    const queue = new Queue([queued("telegram")]);
    const at = new Date("2026-08-26T10:00:00.000Z");
    await new ResolveChannelLookupsBatchService(
      "telegram",
      queue,
      port({ kind: "failed", reason: "flood wait", retryAfterMs: 3_600_000 }),
      ids,
      { maxAttempts: 3, retryDelayMs: 1_000, pauseBetweenMs: 0, dailyLimit: 150 },
      noPause
    ).execute({ at, batchSize: 5 });

    const retry = (queue.retried[0] as { readonly retryAt: Date }).retryAt;
    assert.equal(retry.getTime(), at.getTime() + 3_600_000);
  });

  it("поломку самого вызова считает отказом, а не роняет проход", async () => {
    // Один сорвавшийся запрос не должен уносить с собой остальную очередь.
    const queue = new Queue([queued("whatsapp")]);
    const result = await new ResolveChannelLookupsBatchService(
      "whatsapp",
      queue,
      port(() => {
        throw new Error("сокет закрыт");
      }),
      ids,
      { maxAttempts: 3, retryDelayMs: 1_000, pauseBetweenMs: 0, dailyLimit: 150 },
      noPause
    ).execute({ at: new Date(), batchSize: 5 });

    assert.equal(result.retried, 1);
    assert.equal(queue.retried.length, 1);
  });
});
