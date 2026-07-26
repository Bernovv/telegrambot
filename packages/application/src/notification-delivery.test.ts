import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HandleNotificationJobService,
  type AdminPurchaseContext,
  type ClaimNotificationDeliveryInput,
  type NotificationSender,
  type NotificationContextRepository,
  type NotificationDeliveryLedger,
  type ScenarioPaymentContinuation,
  type TicketPngRenderer,
  type TicketDeliveryContext
} from "./notification-delivery.js";

describe("HandleNotificationJobService", () => {
  it("delivers every ticket once and skips a completed retry", async () => {
    const ledger = new MemoryLedger();
    const sender = new RecordingSender();
    const renderer = new RecordingRenderer();
    const service = createService(ledger, sender, renderer);

    const first = await service.execute(execution(ticketJob));
    const second = await service.execute(execution(ticketJob));

    assert.deepEqual(first, {
      eventType: "TicketsIssued",
      delivered: 2,
      duplicates: 0,
      ignored: false
    });
    assert.deepEqual(second, {
      eventType: "TicketsIssued",
      delivered: 0,
      duplicates: 2,
      ignored: false
    });
    assert.equal(sender.messages.length, 2);
    assert.equal(renderer.tokens.length, 2);
    assert.match(sender.messages[0]?.text ?? "", /Билет: BP-ORDER-T001/);
    assert.match(sender.messages[0]?.text ?? "", /Код билета: t{43}/);
  });

  it("resumes after a partial failure without repeating a sent ticket", async () => {
    const ledger = new MemoryLedger();
    const sender = new RecordingSender("BP-ORDER-T002");
    const service = createService(ledger, sender);

    await assert.rejects(service.execute(execution(ticketJob)), /Telegram send failed/);
    const retry = await service.execute(execution(ticketJob));

    assert.deepEqual(retry, {
      eventType: "TicketsIssued",
      delivered: 1,
      duplicates: 1,
      ignored: false
    });
    assert.equal(sender.messages.filter((message) => message.text.includes("T001")).length, 1);
    assert.equal(sender.messages.filter((message) => message.text.includes("T002")).length, 2);
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
    assert.match(sender.messages[0]?.text ?? "", /2490,00 ₽/);
    assert.match(sender.messages[0]?.text ?? "", /Баланс: 100,00 ₽/);
    assert.match(sender.messages[0]?.text ?? "", /Внешняя оплата: 2390,00 ₽/);
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
    assert.match(sender.messages[0]?.text ?? "", /^Повторная отправка билета\./);
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
});

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

  async sendText(recipientId: string, text: string) {
    return this.record(recipientId, text);
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
  continuation?: ScenarioPaymentContinuation
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
    async getScenarioDeliveryContext() {
      return {
        recipientExternalUserId: ticketContext.recipientExternalUserId,
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
    "-1001234567890",
    continuation
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
  ticketCount: 2,
  totalKopecks: 249_000n,
  walletKopecks: 10_000n,
  externalKopecks: 239_000n
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
