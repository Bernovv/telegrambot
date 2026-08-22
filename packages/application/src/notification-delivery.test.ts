import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_BROADCAST_DELIVERY_OPTIONS,
  HandleNotificationJobService,
  classifyBroadcastSendFailure,
  type AdminPurchaseContext,
  type BroadcastContext,
  type BroadcastContextRepository,
  type BroadcastDeliveryOptions,
  type BroadcastPacing,
  type ClaimNotificationDeliveryInput,
  type NotificationSender,
  type NotificationContextRepository,
  type NotificationDeliveryLedger,
  type ReminderContextRepository,
  type ReminderRecipientContext,
  type ScenarioPaymentContinuation,
  type SiteRegistrationContext,
  type TicketPngRenderer,
  type TicketDeliveryContext
} from "./notification-delivery.js";

describe("HandleNotificationJobService", () => {
  it("шлёт одно подтверждение на заказ, а не по одному на место, и не повторяется", async () => {
    const ledger = new MemoryLedger();
    const sender = new RecordingSender();
    const renderer = new RecordingRenderer();
    const service = createService(ledger, sender, renderer);

    const first = await service.execute(execution(ticketJob));
    const second = await service.execute(execution(ticketJob));

    assert.deepEqual(first, {
      eventType: "TicketsIssued",
      delivered: 1,
      duplicates: 0,
      ignored: false
    });
    assert.deepEqual(second, {
      eventType: "TicketsIssued",
      delivered: 0,
      duplicates: 1,
      ignored: false
    });
    assert.equal(sender.messages.length, 1);
    // QR больше не рисуется: в заказе два места, а картинок ноль.
    assert.equal(renderer.tokens.length, 0);
    assert.equal(
      sender.messages[0]?.text,
      "Оплата прошла ✅ Билет за вами! До встречи на Бизнес-Пикнике 🏕"
    );
  });

  it("после сбоя отправки повторяет попытку и доводит подтверждение до человека", async () => {
    const ledger = new MemoryLedger();
    // Отправитель падает один раз на первом сообщении, дальше работает.
    const sender = new RecordingSender("Оплата прошла");
    const service = createService(ledger, sender);

    await assert.rejects(service.execute(execution(ticketJob)), /Telegram send failed/);
    const retry = await service.execute(execution(ticketJob));

    assert.deepEqual(retry, {
      eventType: "TicketsIssued",
      delivered: 1,
      duplicates: 0,
      ignored: false
    });
    assert.deepEqual(ledger.failureCodes, ["ExternalDeliveryError"]);
  });

  it("formats and deduplicates an administrator purchase notification", async () => {
    const ledger = new MemoryLedger();
    const sender = new RecordingSender();
    const service = createService(ledger, sender);

    const result = await service.execute(execution(adminJob));

    assert.equal(result.delivered, 1);
    assert.equal(sender.messages[0]?.recipientId, "-1001234567890");
    assert.match(sender.messages[0]?.text ?? "", /@buyer купил 2 билет/);
    // По нику человека не найти в списке участников и нельзя позвонить — телефон обязателен.
    assert.match(sender.messages[0]?.text ?? "", /Телефон: \+79990000000/);
    assert.match(sender.messages[0]?.text ?? "", /2490,00 ₽/);
    assert.match(sender.messages[0]?.text ?? "", /Баланс: 100,00 ₽/);
    assert.match(sender.messages[0]?.text ?? "", /Внешняя оплата: 2390,00 ₽/);
  });

  it("sends an administrator purchase notification to every configured chat ID", async () => {
    const ledger = new MemoryLedger();
    const sender = new RecordingSender();
    const service = createService(
      ledger,
      sender,
      new RecordingRenderer(),
      undefined,
      undefined,
      undefined,
      ["376802789", "5596675886"]
    );

    const first = await service.execute(execution(adminJob));
    const retry = await service.execute(execution(adminJob));

    assert.deepEqual(first, {
      eventType: "AdminPurchaseNotificationRequested",
      delivered: 2,
      duplicates: 0,
      ignored: false
    });
    assert.deepEqual(retry, {
      eventType: "AdminPurchaseNotificationRequested",
      delivered: 0,
      duplicates: 2,
      ignored: false
    });
    assert.deepEqual(
      sender.messages.map((message) => message.recipientId).sort(),
      ["376802789", "5596675886"]
    );
  });

  it("шлёт организаторам заявку с сайта и не повторяет её при перезапуске задачи", async () => {
    const ledger = new MemoryLedger();
    const sender = new RecordingSender();
    const service = createService(
      ledger,
      sender,
      new RecordingRenderer(),
      undefined,
      undefined,
      undefined,
      ["376802789", "5596675886"]
    );

    const first = await service.execute(execution(siteRegistrationJob));
    const retry = await service.execute(execution(siteRegistrationJob));

    assert.deepEqual(first, {
      eventType: "SiteRegistrationSubmitted",
      delivered: 2,
      duplicates: 0,
      ignored: false
    });
    assert.equal(retry.duplicates, 2);
    const text = sender.messages[0]?.text ?? "";
    assert.match(text, /Новая заявка с сайта/);
    assert.match(text, /Имя: Мария Соколова/);
    // По телефону человеку перезванивают — он обязан быть в сообщении целиком.
    assert.match(text, /Телефон: \+79991234567/);
    assert.match(text, /Встреча: Бизнес-Среда, 26 августа/);
    assert.match(text, /Заявок с сайта на эту встречу: 7/);
  });

  it("говорит вслух, когда заявку некуда положить: встречи в панели нет", async () => {
    const ledger = new MemoryLedger();
    const sender = new RecordingSender();
    const service = createService(ledger, sender);
    const previous = siteRegistrationContext;
    siteRegistrationContext = {
      ...previous,
      eventTitle: null,
      eventStartsAt: null,
      assigned: false
    };

    try {
      await service.execute(execution(siteRegistrationJob));
    } finally {
      siteRegistrationContext = previous;
    }

    const text = sender.messages[0]?.text ?? "";
    assert.match(text, /Имя: Мария Соколова/);
    assert.match(text, /Встреча не определена/);
    assert.match(text, /занести в список руками/);
  });

  it("allows a new owner-bound redelivery request but deduplicates its retry", async () => {
    const ledger = new MemoryLedger();
    const sender = new RecordingSender();
    const service = createService(ledger, sender);

    const first = await service.execute(execution(redeliveryJob));
    const retry = await service.execute(execution(redeliveryJob));
    const nextRequest = await service.execute(execution({
      ...redeliveryJob,
      correlationId: "019c0123-4567-789a-bcde-f01234567893"
    }));

    assert.equal(first.delivered, 1);
    assert.equal(retry.duplicates, 1);
    assert.equal(nextRequest.delivered, 1);
    assert.equal(sender.messages.length, 2);
    assert.match(sender.messages[0]?.text ?? "", /^Повторная отправка подтверждения\./);
  });

  it("continues a scenario only from a confirmed payment domain event", async () => {
    const calls: Parameters<ScenarioPaymentContinuation["execute"]>[0][] = [];
    const continuation: ScenarioPaymentContinuation = {
      async execute(input) {
        calls.push(input);
      }
    };
    const service = createService(
      new MemoryLedger(),
      new RecordingSender(),
      new RecordingRenderer(),
      continuation
    );

    const result = await service.execute(execution(paymentConfirmedJob));

    assert.deepEqual(result, {
      eventType: "PaymentConfirmed",
      delivered: 0,
      duplicates: 0,
      ignored: false
    });
    assert.deepEqual(calls, [{
      orderId: ticketContext.orderId,
      sourceEventId: paymentConfirmedJob.correlationId,
      occurredAt: new Date(paymentConfirmedJob.createdAt)
    }]);
  });

  it("delivers scenario presentations once through the notification ledger", async () => {
    const ledger = new MemoryLedger();
    const sender = new RecordingSender();
    const service = createService(ledger, sender);

    const first = await service.execute(execution(scenarioPresentationJob));
    const retry = await service.execute(execution(scenarioPresentationJob));

    assert.deepEqual(first, {
      eventType: "ScenarioPresentationRequested",
      delivered: 1,
      duplicates: 0,
      ignored: false
    });
    assert.equal(retry.duplicates, 1);
    assert.equal(sender.scenarioMessages.length, 1);
    assert.equal(sender.scenarioMessages[0]?.sessionId, scenarioSessionId);
    assert.deepEqual(sender.scenarioMessages[0]?.presentation.buttons, [{
      text: "Завершить",
      edgeId: scenarioEdgeId
    }]);
  });

  it("rejects an unsafe scenario presentation before delivery", async () => {
    const sender = new RecordingSender();
    const service = createService(new MemoryLedger(), sender);

    await assert.rejects(
      service.execute(execution({
        ...scenarioPresentationJob,
        event: {
          ...scenarioPresentationJob.event,
          payload: {
            ...scenarioPresentationJob.event.payload,
            presentations: [{
              text: "Открыть",
              buttons: [{ text: "Ссылка", url: "http://example.test" }]
            }]
          }
        }
      })),
      /button URL/
    );
    assert.equal(sender.messages.length, 0);
  });

  // Анкета бота убрана 08.08.2026, но её события могли остаться в очереди с прошлых покупок.
  // Обработчик обязан такое просто пропустить, а не упасть: упавшая задача уходит в повторы,
  // а оттуда — в очередь мёртвых писем, где её потом ищут руками.
  it("ignores a questionnaire event left over in the queue", async () => {
    const sender = new RecordingSender();
    const service = createService(new MemoryLedger(), sender);

    const result = await service.execute(execution(questionnaireJob));

    assert.deepEqual(result, {
      eventType: "ParticipantQuestionnaireRequested",
      delivered: 0,
      duplicates: 0,
      ignored: true
    });
    assert.equal(sender.messages.length, 0);
  });

  it("is ignored for an event reminder when no reminder context repository is configured", async () => {
    const service = createService(new MemoryLedger(), new RecordingSender());

    const result = await service.execute(execution(reminderJob("10d")));

    assert.deepEqual(result, {
      eventType: "EventReminderDue",
      delivered: 0,
      duplicates: 0,
      ignored: true
    });
  });

  it("sends the right copy for each cadence step and deduplicates a retry", async () => {
    const ledger = new MemoryLedger();
    const sender = new RecordingSender();
    const service = createService(ledger, sender, new RecordingRenderer(), undefined, {
      async getReminderContext() {
        return reminderContext;
      }
    });

    const first = await service.execute(execution(reminderJob("day_of")));
    const retry = await service.execute(execution(reminderJob("day_of")));

    assert.deepEqual(first, {
      eventType: "EventReminderDue",
      delivered: 1,
      duplicates: 0,
      ignored: false
    });
    assert.deepEqual(retry, {
      eventType: "EventReminderDue",
      delivered: 0,
      duplicates: 1,
      ignored: false
    });
    assert.equal(sender.messages.length, 1);
    assert.match(sender.messages[0]?.text ?? "", /Доброе утро!/);

    const step10d = await service.execute(
      execution(reminderJob("10d", "019c0123-4567-789a-bcde-f01234567899"))
    );
    assert.equal(step10d.delivered, 1);
    assert.match(sender.messages[1]?.text ?? "", /осталось 10 дней/);
  });

  it("rejects an unrecognized cadence step instead of guessing a message", async () => {
    const service = createService(
      new MemoryLedger(),
      new RecordingSender(),
      new RecordingRenderer(),
      undefined,
      {
        async getReminderContext() {
          return reminderContext;
        }
      }
    );

    const result = await service.execute(execution(reminderJob("2d")));
    assert.deepEqual(result, {
      eventType: "EventReminderDue",
      delivered: 0,
      duplicates: 0,
      ignored: true
    });
  });

  it("is ignored for an admin broadcast when no broadcast context repository is configured", async () => {
    const service = createService(new MemoryLedger(), new RecordingSender());

    const result = await service.execute(execution(broadcastJob));

    assert.deepEqual(result, {
      eventType: "AdminBroadcastRequested",
      delivered: 0,
      duplicates: 0,
      ignored: true
    });
  });

  it("fans a broadcast out to every recipient once, marks sending then completed, and deduplicates a retry", async () => {
    const ledger = new MemoryLedger();
    const sender = new RecordingSender();
    const broadcasts = new FakeBroadcasts(broadcastContext);
    const service = createService(
      ledger,
      sender,
      new RecordingRenderer(),
      undefined,
      undefined,
      broadcasts
    );

    const first = await service.execute(execution(broadcastJob));
    const retry = await service.execute(execution(broadcastJob));

    assert.deepEqual(first, {
      eventType: "AdminBroadcastRequested",
      delivered: 2,
      duplicates: 0,
      failed: 0,
      ignored: false
    });
    assert.deepEqual(retry, {
      eventType: "AdminBroadcastRequested",
      delivered: 0,
      duplicates: 2,
      failed: 0,
      ignored: false
    });
    assert.equal(sender.messages.length, 2);
    assert.ok(sender.messages.every((message) => message.text === broadcastContext.messageText));
    assert.deepEqual(broadcasts.sendingCalls, [broadcastId, broadcastId]);
    assert.equal(broadcasts.completedCalls.length, 2);
    assert.deepEqual(broadcasts.completedCalls[0], [broadcastId, 2, 0]);
    assert.deepEqual(broadcasts.completedCalls[1], [broadcastId, 2, 0]);
  });

  it("не бросает всю рассылку из-за одного заблокировавшего бота: помечает его и идёт дальше", async () => {
    const sender = new TelegramFailingSender(
      new Map([
        ["201", [new TelegramApiError(403, "Forbidden: bot was blocked by the user")]]
      ])
    );
    const broadcasts = new FakeBroadcasts(broadcastContext);
    const service = createService(
      new MemoryLedger(),
      sender,
      new RecordingRenderer(),
      undefined,
      undefined,
      broadcasts
    );

    const result = await service.execute(execution(broadcastJob));

    assert.deepEqual(result, {
      eventType: "AdminBroadcastRequested",
      delivered: 1,
      duplicates: 0,
      failed: 1,
      ignored: false
    });
    assert.deepEqual(sender.messages.map((message) => message.recipientId), ["202"]);
    assert.deepEqual(broadcasts.blockedUserIds, ["019c0123-4567-789a-bcde-f0123456799e"]);
    // Кампания закрыта, а не осталась висеть в 'sending' до конца времён.
    assert.deepEqual(broadcasts.completedCalls, [[broadcastId, 1, 1]]);
  });

  it("удалённый чат идёт в неудачные, но флаг блокировки не ставит: причина другая", async () => {
    const sender = new TelegramFailingSender(
      new Map([["201", [new TelegramApiError(400, "Bad Request: chat not found")]]])
    );
    const broadcasts = new FakeBroadcasts(broadcastContext);
    const service = createService(
      new MemoryLedger(),
      sender,
      new RecordingRenderer(),
      undefined,
      undefined,
      broadcasts
    );

    const result = await service.execute(execution(broadcastJob));

    assert.equal(result.failed, 1);
    assert.equal(result.delivered, 1);
    assert.deepEqual(broadcasts.blockedUserIds, []);
  });

  it("повторяет отправку после 429 и выдерживает паузу, которую назвал Telegram", async () => {
    const sender = new TelegramFailingSender(
      new Map([
        [
          "201",
          [new TelegramApiError(429, "Too Many Requests: retry after 2", { retry_after: 2 })]
        ]
      ])
    );
    const broadcasts = new FakeBroadcasts(broadcastContext);
    const pacing = new CountingPacing();
    const service = createService(
      new MemoryLedger(),
      sender,
      new RecordingRenderer(),
      undefined,
      undefined,
      broadcasts,
      undefined,
      DEFAULT_BROADCAST_DELIVERY_OPTIONS,
      pacing
    );

    const result = await service.execute(execution(broadcastJob));

    assert.equal(result.delivered, 2);
    assert.equal(result.failed, 0);
    assert.ok(pacing.waits.includes(2_000));
  });

  it("держит заданный темп: между сообщениями выдерживается пауза", async () => {
    const pacing = new CountingPacing();
    const service = createService(
      new MemoryLedger(),
      new RecordingSender(),
      new RecordingRenderer(),
      undefined,
      undefined,
      new FakeBroadcasts(broadcastContext),
      undefined,
      { ...DEFAULT_BROADCAST_DELIVERY_OPTIONS, messagesPerSecond: 4 },
      pacing
    );

    await service.execute(execution(broadcastJob));

    // Двое получателей — одна пауза, перед первым ждать нечего.
    assert.deepEqual(pacing.waits, [250]);
  });

  it("сдаётся и отдаёт задачу очереди, когда временные ошибки идут подряд", async () => {
    const outage = new TelegramApiError(500, "Internal Server Error");
    const sender = new TelegramFailingSender(
      new Map([
        ["201", [outage, outage, outage]],
        ["202", [outage, outage, outage]]
      ])
    );
    const broadcasts = new FakeBroadcasts(broadcastContext);
    const service = createService(
      new MemoryLedger(),
      sender,
      new RecordingRenderer(),
      undefined,
      undefined,
      broadcasts,
      undefined,
      { ...DEFAULT_BROADCAST_DELIVERY_OPTIONS, transientFailureStreakLimit: 2 }
    );

    await assert.rejects(
      service.execute(execution(broadcastJob)),
      /Telegram is not accepting messages/
    );
    // Кампания осталась в 'sending' — очередь повторит задачу, уже отправленные не повторятся.
    assert.deepEqual(broadcasts.completedCalls, []);
  });

  it("после прерывания повторный прогон не пишет тем, кому уже написал", async () => {
    const outage = new TelegramApiError(500, "Internal Server Error");
    const sender = new TelegramFailingSender(
      new Map([["202", [outage, outage, outage]]])
    );
    const broadcasts = new FakeBroadcasts(broadcastContext);
    const service = createService(
      new MemoryLedger(),
      sender,
      new RecordingRenderer(),
      undefined,
      undefined,
      broadcasts,
      undefined,
      { ...DEFAULT_BROADCAST_DELIVERY_OPTIONS, transientFailureStreakLimit: 1 }
    );

    await assert.rejects(service.execute(execution(broadcastJob)));
    const retry = await service.execute(execution(broadcastJob));

    assert.deepEqual(retry, {
      eventType: "AdminBroadcastRequested",
      delivered: 1,
      duplicates: 1,
      failed: 0,
      ignored: false
    });
    assert.equal(sender.messages.filter((message) => message.recipientId === "201").length, 1);
    assert.equal(sender.messages.filter((message) => message.recipientId === "202").length, 1);
    assert.deepEqual(broadcasts.completedCalls, [[broadcastId, 2, 0]]);
  });

  it("доносит картинку и кнопку до отправителя без изменений", async () => {
    const sender = new RecordingSender();
    const image = {
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "image/png" as const
    };
    const button = { text: "Купить билет", url: "https://biz-day.ru/tariffs" };
    const service = createService(
      new MemoryLedger(),
      sender,
      new RecordingRenderer(),
      undefined,
      undefined,
      new FakeBroadcasts({ ...broadcastContext, image, button })
    );

    await service.execute(execution(broadcastJob));

    assert.equal(sender.broadcasts.length, 2);
    assert.ok(sender.broadcasts.every((sent) => sent.image === image));
    assert.ok(sender.broadcasts.every((sent) => sent.button === button));
  });

  it("не отправляет рассылку, где текст длиннее подписи к картинке", async () => {
    const broadcasts = new FakeBroadcasts({
      ...broadcastContext,
      messageText: "x".repeat(1_025),
      image: { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" }
    });
    const service = createService(
      new MemoryLedger(),
      new RecordingSender(),
      new RecordingRenderer(),
      undefined,
      undefined,
      broadcasts
    );

    await assert.rejects(
      service.execute(execution(broadcastJob)),
      /broadcast message is invalid/
    );
    assert.deepEqual(broadcasts.sendingCalls, []);
  });

  it("пробная рассылка уходит в административные чаты, а не в аудиторию", async () => {
    const sender = new RecordingSender();
    const broadcasts = new FakeBroadcasts({
      messageText: broadcastContext.messageText,
      isTest: true,
      image: null,
      button: null,
      recipients: []
    });
    const service = createService(
      new MemoryLedger(),
      sender,
      new RecordingRenderer(),
      undefined,
      undefined,
      broadcasts,
      ["-1001234567890", "555"]
    );

    const result = await service.execute(execution(broadcastJob));

    assert.equal(result.delivered, 2);
    assert.deepEqual(
      sender.messages.map((message) => message.recipientId),
      ["-1001234567890", "555"]
    );
    assert.ok(sender.messages.every((message) => message.text === broadcastContext.messageText));
  });
});

describe("classifyBroadcastSendFailure", () => {
  it("различает блокировку, недоступный чат, лимит и всё остальное", () => {
    assert.deepEqual(
      classifyBroadcastSendFailure(
        new TelegramApiError(403, "Forbidden: bot was blocked by the user")
      ),
      { kind: "blocked" }
    );
    assert.deepEqual(
      classifyBroadcastSendFailure(new TelegramApiError(403, "Forbidden: user is deactivated")),
      { kind: "unreachable" }
    );
    assert.deepEqual(
      classifyBroadcastSendFailure(new TelegramApiError(400, "Bad Request: chat not found")),
      { kind: "unreachable" }
    );
    assert.deepEqual(
      classifyBroadcastSendFailure(
        new TelegramApiError(429, "Too Many Requests", { retry_after: 7 })
      ),
      { kind: "transient", retryAfterSeconds: 7 }
    );
    // Незнакомую ошибку считаем временной: молча не доставить хуже, чем повторить лишний раз.
    assert.deepEqual(
      classifyBroadcastSendFailure(new Error("socket hang up")),
      { kind: "transient", retryAfterSeconds: null }
    );
    assert.deepEqual(
      classifyBroadcastSendFailure(new TelegramApiError(400, "Bad Request: message is too long")),
      { kind: "transient", retryAfterSeconds: null }
    );
  });
});

class FakeBroadcasts implements BroadcastContextRepository {
  readonly sendingCalls: string[] = [];
  readonly completedCalls: [string, number, number][] = [];
  readonly blockedUserIds: string[] = [];

  constructor(private readonly context: BroadcastContext) {}

  async getBroadcastContext(broadcastId: string) {
    return broadcastId === "019c0123-4567-789a-bcde-f01234567998" ? this.context : null;
  }

  async markBroadcastSending(broadcastId: string) {
    this.sendingCalls.push(broadcastId);
  }

  async markBroadcastCompleted(
    broadcastId: string,
    sentCount: number,
    failedCount: number
  ) {
    this.completedCalls.push([broadcastId, sentCount, failedCount]);
  }

  async markRecipientBlocked(userId: string) {
    this.blockedUserIds.push(userId);
  }
}

/** Ошибка ровно той формы, в какой её отдаёт Telegram и пробрасывает grammy. */
class TelegramApiError extends Error {
  constructor(
    readonly error_code: number,
    readonly description: string,
    readonly parameters?: { readonly retry_after: number }
  ) {
    super(description);
    this.name = "GrammyError";
  }
}

class TelegramFailingSender implements NotificationSender {
  readonly messages: { readonly recipientId: string; readonly text: string }[] = [];
  private readonly attempts = new Map<string, number>();

  constructor(
    private readonly failures: ReadonlyMap<string, readonly TelegramApiError[]>
  ) {}

  async sendBroadcastMessage(recipientId: string, message: { readonly text: string }) {
    return this.sendText(recipientId, message.text);
  }

  async sendText(recipientId: string, text: string) {
    const attempt = this.attempts.get(recipientId) ?? 0;
    this.attempts.set(recipientId, attempt + 1);
    const planned = this.failures.get(recipientId)?.[attempt];
    if (planned) {
      throw planned;
    }
    this.messages.push({ recipientId, text });
    return { providerMessageId: `m-${this.messages.length}` };
  }

  async sendImage(): Promise<{ readonly providerMessageId: string }> {
    throw new Error("not used");
  }

  async sendScenarioPresentation(): Promise<{ readonly providerMessageId: string }> {
    throw new Error("not used");
  }
}

/** Считает паузы, но не ждёт: тест не должен зависеть от настоящего времени. */
class CountingPacing {
  readonly waits: number[] = [];

  async wait(milliseconds: number) {
    this.waits.push(milliseconds);
  }
}

class MemoryLedger implements NotificationDeliveryLedger {
  readonly failureCodes: string[] = [];
  private readonly records = new Map<string, {
    readonly id: string;
    status: "sending" | "sent" | "failed";
    workerId: string;
  }>();

  async claim(input: ClaimNotificationDeliveryInput) {
    const existing = this.records.get(input.idempotencyKey);
    if (existing?.status === "sent") {
      return { state: "sent" as const, deliveryId: existing.id };
    }
    if (existing?.status === "sending") {
      return { state: "busy" as const, deliveryId: existing.id };
    }
    if (existing) {
      existing.status = "sending";
      existing.workerId = input.workerId;
      return { state: "claimed" as const, deliveryId: existing.id };
    }

    this.records.set(input.idempotencyKey, {
      id: input.deliveryId,
      status: "sending",
      workerId: input.workerId
    });
    return { state: "claimed" as const, deliveryId: input.deliveryId };
  }

  async markSent(deliveryId: string, workerId: string): Promise<void> {
    const record = this.find(deliveryId, workerId);
    record.status = "sent";
  }

  async markFailed(
    deliveryId: string,
    workerId: string,
    errorCode: string
  ): Promise<void> {
    const record = this.find(deliveryId, workerId);
    record.status = "failed";
    this.failureCodes.push(errorCode);
  }

  private find(deliveryId: string, workerId: string) {
    const record = [...this.records.values()].find((candidate) => candidate.id === deliveryId);
    assert.ok(record);
    assert.equal(record.workerId, workerId);
    return record;
  }
}

class RecordingSender implements NotificationSender {
  readonly messages: { readonly recipientId: string; readonly text: string }[] = [];
  readonly scenarioMessages: {
    readonly recipientId: string;
    readonly sessionId: string;
    readonly presentation: Parameters<
      NotificationSender["sendScenarioPresentation"]
    >[2];
  }[] = [];
  private failed = false;

  constructor(private readonly failOnceWhenTextIncludes?: string) {}

  readonly broadcasts: {
    readonly recipientId: string;
    readonly image: unknown;
    readonly button: unknown;
  }[] = [];

  async sendText(recipientId: string, text: string) {
    return this.record(recipientId, text);
  }

  async sendBroadcastMessage(
    recipientId: string,
    message: {
      readonly text: string;
      readonly image: unknown;
      readonly button: unknown;
    }
  ) {
    this.broadcasts.push({
      recipientId,
      image: message.image,
      button: message.button
    });
    return this.record(recipientId, message.text);
  }

  async sendImage(
    recipientId: string,
    _image: {
      readonly bytes: Uint8Array;
      readonly mimeType: "image/png";
      readonly width: number;
      readonly height: number;
    },
    _fileName: string,
    caption: string
  ) {
    return this.record(recipientId, caption);
  }

  async sendScenarioPresentation(
    recipientId: string,
    sessionId: string,
    presentation: Parameters<
      NotificationSender["sendScenarioPresentation"]
    >[2]
  ) {
    this.scenarioMessages.push({ recipientId, sessionId, presentation });
    return this.record(recipientId, presentation.text);
  }

  private async record(recipientId: string, text: string) {
    this.messages.push({ recipientId, text });
    if (
      this.failOnceWhenTextIncludes
      && text.includes(this.failOnceWhenTextIncludes)
      && !this.failed
    ) {
      this.failed = true;
      const error = new Error("Telegram send failed");
      error.name = "Telegram API/429";
      throw error;
    }

    return { providerMessageId: String(this.messages.length) };
  }
}

function createService(
  ledger: NotificationDeliveryLedger,
  sender: NotificationSender,
  renderer: TicketPngRenderer = new RecordingRenderer(),
  continuation?: ScenarioPaymentContinuation,
  reminderContexts?: ReminderContextRepository,
  broadcastContexts?: BroadcastContextRepository,
  adminChatIds: readonly string[] = ["-1001234567890"],
  broadcastOptions: BroadcastDeliveryOptions = DEFAULT_BROADCAST_DELIVERY_OPTIONS,
  broadcastPacing: BroadcastPacing = new CountingPacing()
): HandleNotificationJobService {
  let id = 0;
  const contexts: NotificationContextRepository = {
    async getTicketDeliveryContext(_orderId, ticketIds) {
      return {
        ...ticketContext,
        tickets: ticketContext.tickets.filter((ticket) => ticketIds.includes(ticket.id))
      };
    },
    async getAdminPurchaseContext() {
      return adminContext;
    },
    async getSiteRegistrationContext() {
      return siteRegistrationContext;
    },
    async getScenarioDeliveryContext() {
      return {
        recipientExternalUserId: ticketContext.recipientExternalUserId,
        recipientChannel: "telegram" as const,
        recipientBlocked: false
      };
    }
  };

  return new HandleNotificationJobService(
    contexts,
    ledger,
    sender,
    { publicToken() { return { token: "t".repeat(43) }; } },
    renderer,
    { newId() { id += 1; return `delivery-${id}`; } },
    adminChatIds,
    continuation,
    reminderContexts,
    broadcastContexts,
    broadcastOptions,
    broadcastPacing
  );
}

class RecordingRenderer implements TicketPngRenderer {
  readonly tokens: string[] = [];

  async renderPng(publicToken: string) {
    this.tokens.push(publicToken);
    const bytes = new Uint8Array(100);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    bytes.set([73, 72, 68, 82], 12);
    bytes.set([0, 0, 2, 0, 0, 0, 2, 0], 16);
    return {
      bytes,
      mimeType: "image/png" as const,
      width: 512,
      height: 512
    };
  }
}

function execution(job: unknown) {
  return {
    job,
    workerId: "worker-1",
    handledAt: new Date("2026-07-24T12:21:00.000Z"),
    leaseSeconds: 60
  };
}

const ticketContext: TicketDeliveryContext = {
  orderId: "019c0123-4567-789a-bcde-f0123456789a",
  orderNumber: "BP-ORDER",
  eventTitle: "Business Picnic",
  recipientExternalUserId: "123456789",
  recipientChannel: "telegram" as const,
  recipientBlocked: false,
  tickets: [
    {
      id: "019c0123-4567-789a-bcde-f0123456789b",
      ticketNumber: "BP-ORDER-T001"
    },
    {
      id: "019c0123-4567-789a-bcde-f0123456789c",
      ticketNumber: "BP-ORDER-T002"
    }
  ]
};

const adminContext: AdminPurchaseContext = {
  orderId: ticketContext.orderId,
  orderNumber: ticketContext.orderNumber,
  userId: "019c0123-4567-789a-bcde-f0123456789d",
  eventTitle: ticketContext.eventTitle,
  username: "buyer",
  phone: "+79990000000",
  ticketCount: 2,
  totalKopecks: 249_000n,
  walletKopecks: 10_000n,
  externalKopecks: 239_000n
};

let siteRegistrationContext: SiteRegistrationContext = {
  registrationId: "019c0123-4567-789a-bcde-f0123456780a",
  name: "Мария Соколова",
  phone: "+79991234567",
  eventTitle: "Бизнес-Среда, 26 августа",
  eventStartsAt: new Date("2026-08-26T16:00:00.000Z"),
  assigned: true,
  siteRegistrationCount: 7
};

const siteRegistrationJob = {
  jobType: "domain-event",
  schemaVersion: 1,
  correlationId: "019c0123-4567-789a-bcde-f0123456780b",
  event: {
    type: "SiteRegistrationSubmitted",
    schemaVersion: 1,
    payload: { registrationId: siteRegistrationContext.registrationId }
  }
};

const ticketJob = {
  jobType: "domain-event",
  schemaVersion: 1,
  correlationId: "019c0123-4567-789a-bcde-f01234567890",
  event: {
    type: "TicketsIssued",
    schemaVersion: 1,
    payload: {
      orderId: ticketContext.orderId,
      ticketIds: ticketContext.tickets.map((ticket) => ticket.id)
    }
  }
};

const adminJob = {
  jobType: "domain-event",
  schemaVersion: 1,
  correlationId: "019c0123-4567-789a-bcde-f01234567891",
  event: {
    type: "AdminPurchaseNotificationRequested",
    schemaVersion: 1,
    payload: { orderId: ticketContext.orderId }
  }
};

const redeliveryJob = {
  jobType: "domain-event",
  schemaVersion: 1,
  correlationId: "019c0123-4567-789a-bcde-f01234567892",
  event: {
    type: "TicketRedeliveryRequested",
    schemaVersion: 1,
    payload: {
      orderId: ticketContext.orderId,
      ownerUserId: adminContext.userId,
      ticketIds: [ticketContext.tickets[0]?.id]
    }
  }
};

const scenarioSessionId = "019c0123-4567-789a-bcde-f01234567894";
const scenarioEdgeId = "019c0123-4567-789a-bcde-f01234567895";

const paymentConfirmedJob = {
  jobType: "domain-event",
  schemaVersion: 1,
  correlationId: "019c0123-4567-789a-bcde-f01234567896",
  createdAt: "2026-07-26T12:30:00.000Z",
  event: {
    type: "PaymentConfirmed",
    schemaVersion: 1,
    payload: { orderId: ticketContext.orderId }
  }
};

const scenarioPresentationJob = {
  jobType: "domain-event",
  schemaVersion: 1,
  correlationId: "019c0123-4567-789a-bcde-f01234567897",
  event: {
    type: "ScenarioPresentationRequested",
    schemaVersion: 1,
    payload: {
      sessionId: scenarioSessionId,
      userId: adminContext.userId,
      presentations: [{
        text: "Оплата подтверждена",
        buttons: [{ text: "Завершить", edgeId: scenarioEdgeId }]
      }]
    }
  }
};

const questionnaireJob = {
  jobType: "domain-event",
  schemaVersion: 1,
  correlationId: "019c0123-4567-789a-bcde-f01234567994",
  event: {
    type: "ParticipantQuestionnaireRequested",
    schemaVersion: 1,
    payload: {
      orderId: ticketContext.orderId,
      userId: adminContext.userId,
      eventId: "019c0123-4567-789a-bcde-f01234567995"
    }
  }
};

const reminderContext: ReminderRecipientContext = {
  recipientExternalUserId: "123456789",
  recipientChannel: "telegram" as const,
  recipientBlocked: false,
  eventTitle: "Business Picnic"
};

function reminderJob(cadenceStep: string, orderId: string = ticketContext.orderId) {
  return {
    jobType: "domain-event",
    schemaVersion: 1,
    correlationId: "019c0123-4567-789a-bcde-f01234567996",
    event: {
      type: "EventReminderDue",
      schemaVersion: 1,
      payload: {
        orderId,
        userId: adminContext.userId,
        eventId: "019c0123-4567-789a-bcde-f01234567997",
        cadenceStep
      }
    }
  };
}

const broadcastId = "019c0123-4567-789a-bcde-f01234567998";

const broadcastContext: BroadcastContext = {
  messageText: "Скоро старт! Не забудьте паспорт.",
  isTest: false,
  image: null,
  button: null,
  recipients: [
    { userId: "019c0123-4567-789a-bcde-f0123456799e", recipientChannel: "telegram" as const, recipientExternalUserId: "201" },
    { userId: "019c0123-4567-789a-bcde-f0123456799f", recipientChannel: "telegram" as const, recipientExternalUserId: "202" }
  ]
};

const broadcastJob = {
  jobType: "domain-event",
  schemaVersion: 1,
  correlationId: "019c0123-4567-789a-bcde-f01234567999",
  event: {
    type: "AdminBroadcastRequested",
    schemaVersion: 1,
    payload: { broadcastId }
  }
};
