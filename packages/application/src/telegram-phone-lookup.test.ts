import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ResolveTelegramPhoneLookupsBatchService,
  type QueuedPhoneLookup,
  type TelegramPhoneLookupPort,
  type TelegramPhoneLookupQueueRepository
} from "./telegram-phone-lookup.js";

const at = new Date("2026-08-24T09:00:00.000Z");
const options = { maxAttempts: 3, retryDelayMs: 60_000, pauseBetweenMs: 0 };

function request(overrides: Partial<QueuedPhoneLookup> = {}): QueuedPhoneLookup {
  return {
    lookupId: "lookup-1",
    contactId: "contact-1",
    phoneE164: "+79990000000",
    attempts: 0,
    ...overrides
  };
}

class Queue implements TelegramPhoneLookupQueueRepository {
  found: {
    readonly telegramUserId: string;
    readonly conversationId: string;
    readonly contactId: string;
  }[] = [];
  notFound: string[] = [];
  retries: { readonly reason: string; readonly retryAt: Date }[] = [];
  failures: string[] = [];

  constructor(private readonly queued: readonly QueuedPhoneLookup[]) {}

  async claimQueued() {
    return this.queued;
  }

  async markFound(input: {
    readonly telegramUserId: string;
    readonly conversationId: string;
    readonly contactId: string;
  }) {
    this.found.push({
      telegramUserId: input.telegramUserId,
      conversationId: input.conversationId,
      contactId: input.contactId
    });
  }

  async markNotFound(input: { readonly lookupId: string }) {
    this.notFound.push(input.lookupId);
  }

  async markAttemptFailed(input: { readonly reason: string; readonly retryAt: Date }) {
    this.retries.push({ reason: input.reason, retryAt: input.retryAt });
  }

  async markFailed(input: { readonly reason: string }) {
    this.failures.push(input.reason);
  }
}

function port(outcome: Awaited<ReturnType<TelegramPhoneLookupPort["find"]>>): {
  readonly lookup: TelegramPhoneLookupPort;
  readonly asked: string[];
} {
  const asked: string[] = [];

  return {
    asked,
    lookup: {
      async find(phone) {
        asked.push(phone);
        return outcome;
      }
    }
  };
}

const ids = { newId: () => "conversation-1" };

describe("ResolveTelegramPhoneLookupsBatchService", () => {
  it("заводит ветку переписки тому, кого Telegram нашёл", async () => {
    // Ради этого всё и делается: найденный идентификатор без ветки — число в базе, а
    // менеджеру нужно поле ввода.
    const queue = new Queue([request()]);
    const telegram = port({ kind: "found", telegramUserId: "555" });
    const service = new ResolveTelegramPhoneLookupsBatchService(
      queue,
      telegram.lookup,
      ids,
      options
    );

    const result = await service.execute({ at, batchSize: 10 });

    assert.deepEqual(telegram.asked, ["+79990000000"]);
    assert.deepEqual(queue.found, [{
      telegramUserId: "555",
      conversationId: "conversation-1",
      contactId: "contact-1"
    }]);
    assert.equal(result.found, 1);
  });

  it("не повторяет «нет такого номера»", async () => {
    // Это ответ, а не сбой: спросив ещё раз, мы получим то же самое и потратим на это
    // запрос аккаунта.
    const queue = new Queue([request()]);
    const telegram = port({ kind: "not_found" });
    const service = new ResolveTelegramPhoneLookupsBatchService(
      queue,
      telegram.lookup,
      ids,
      options
    );

    const result = await service.execute({ at, batchSize: 10 });

    assert.deepEqual(queue.notFound, ["lookup-1"]);
    assert.equal(queue.retries.length, 0);
    assert.equal(result.notFound, 1);
  });

  it("ждёт столько, сколько назначил сам Telegram", async () => {
    // Собственное расписание тут ни при чём: попытка раньше названного срока не просто не
    // сработает, она продлевает запрет.
    const queue = new Queue([request()]);
    const telegram = port({
      kind: "failed",
      reason: "Too Many Requests: retry after 600",
      retryAfterMs: 600_000
    });
    const service = new ResolveTelegramPhoneLookupsBatchService(
      queue,
      telegram.lookup,
      ids,
      options
    );

    await service.execute({ at, batchSize: 10 });

    assert.equal(queue.retries.length, 1);
    assert.equal(
      queue.retries[0]?.retryAt.toISOString(),
      new Date(at.getTime() + 600_000).toISOString()
    );
  });

  it("сдаётся, исчерпав попытки", async () => {
    const queue = new Queue([request({ attempts: 2 })]);
    const telegram = port({ kind: "failed", reason: "прокси не отвечает", retryAfterMs: null });
    const service = new ResolveTelegramPhoneLookupsBatchService(
      queue,
      telegram.lookup,
      ids,
      options
    );

    const result = await service.execute({ at, batchSize: 10 });

    assert.deepEqual(queue.failures, ["прокси не отвечает"]);
    assert.equal(result.failed, 1);
  });

  it("падение самого вызова не роняет разбор очереди", async () => {
    // Одна оборванная строка не должна оставлять остальные без ответа: менеджеры ждут у
    // открытых карточек.
    const queue = new Queue([request()]);
    const service = new ResolveTelegramPhoneLookupsBatchService(
      queue,
      {
        async find() {
          throw new Error("сессия закрыта");
        }
      },
      ids,
      options
    );

    const result = await service.execute({ at, batchSize: 10 });

    assert.equal(result.retried, 1);
    assert.equal(queue.retries[0]?.reason, "сессия закрыта");
  });
});
