import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConfirmPaymentService } from "./payment-confirmation.js";
import {
  HandleTBankPaymentWebhookService,
  InitializeTelegramTBankPaymentService,
  type ExternalPaymentInitializer,
  type PreparedTBankPaymentAttempt,
  type RecordTBankStatusEvent,
  type TBankPaymentInitializationRepository,
  type TBankWebhookRepository,
  type VerifiedTBankWebhook
} from "./tbank-payments.js";

const requestedAt = new Date("2026-07-24T13:00:00.000Z");

describe("InitializeTelegramTBankPaymentService", () => {
  it("initializes a created attempt and persists the bound provider response", async () => {
    const fixture = initializationFixture();

    const result = await fixture.service.execute(command);

    assert.deepEqual(result, {
      initialized: true,
      paymentUrl: "https://securepay.tinkoff.ru/new-pay",
      orderNumber: "BP-000001",
      amountKopecks: "239000",
      currency: "RUB"
    });
    assert.equal(fixture.providerCalls.length, 1);
    assert.deepEqual(fixture.initialized, [{
      paymentAttemptId: ATTEMPT_ID,
      providerPaymentId: "1234567890",
      paymentUrl: "https://securepay.tinkoff.ru/new-pay",
      providerStatus: "NEW",
      initializedAt: requestedAt
    }]);
  });

  it("returns the existing pending URL without another provider call", async () => {
    const fixture = initializationFixture({
      prepareStatus: "pending",
      paymentUrl: "https://securepay.tinkoff.ru/existing-pay"
    });

    const result = await fixture.service.execute(command);

    assert.equal(result.initialized, true);
    assert.equal(fixture.providerCalls.length, 0);
  });

  it("marks a retryable provider failure as uncertain", async () => {
    const fixture = initializationFixture({
      providerResult: {
        initialized: false,
        errorCode: "NETWORK_ERROR",
        retryable: true
      }
    });

    const result = await fixture.service.execute(command);

    assert.deepEqual(result, {
      initialized: false,
      reason: "initialization_in_progress"
    });
    assert.deepEqual(fixture.failures, [{
      paymentAttemptId: ATTEMPT_ID,
      errorCode: "NETWORK_ERROR",
      uncertain: true,
      failedAt: requestedAt
    }]);
  });
});

describe("HandleTBankPaymentWebhookService", () => {
  it("records AUTHORIZED without confirming the order", async () => {
    const fixture = webhookFixture();

    await fixture.service.execute({
      ...webhookEvent,
      status: "AUTHORIZED"
    }, requestedAt);

    assert.equal(fixture.confirmations.length, 0);
    assert.equal(fixture.events[0]?.internalStatus, "authorized");
    assert.equal(fixture.events[0]?.outcome, "processed");
  });

  it("confirms using the existing payment attempt and verified event evidence", async () => {
    const fixture = webhookFixture();

    await fixture.service.execute(webhookEvent, requestedAt);

    assert.equal(fixture.events.length, 0);
    assert.equal(fixture.confirmations.length, 1);
    assert.equal(fixture.confirmations[0]?.paymentAttemptId, ATTEMPT_ID);
    assert.equal(fixture.confirmations[0]?.eventKey, webhookEvent.eventKey);
    assert.equal(fixture.confirmations[0]?.providerPaymentId, "1234567890");
  });

  it("stores a mismatched amount for review and never confirms it", async () => {
    const fixture = webhookFixture();

    await fixture.service.execute({
      ...webhookEvent,
      amountKopecks: 1n
    }, requestedAt);

    assert.equal(fixture.confirmations.length, 0);
    assert.equal(fixture.events[0]?.attempt, null);
    assert.equal(fixture.events[0]?.outcome, "review");
  });

  it("delegates a refund notification before payment status handling", async () => {
    const refundEvents: VerifiedTBankWebhook[] = [];
    const fixture = webhookFixture({
      async execute(event) {
        refundEvents.push(event);
        return true;
      }
    });

    await fixture.service.execute({
      ...webhookEvent,
      status: "REFUNDED"
    }, requestedAt);

    assert.equal(refundEvents.length, 1);
    assert.equal(fixture.events.length, 0);
    assert.equal(fixture.confirmations.length, 0);
  });
});

function initializationFixture(options: {
  readonly prepareStatus?: "created" | "pending";
  readonly paymentUrl?: string | null;
  readonly providerResult?: Awaited<
    ReturnType<ExternalPaymentInitializer["initializePayment"]>
  >;
} = {}) {
  const initialized: {
    paymentAttemptId: string;
    providerPaymentId: string;
    paymentUrl: string;
    providerStatus: "NEW";
    initializedAt: Date;
  }[] = [];
  const failures: {
    paymentAttemptId: string;
    errorCode: string;
    uncertain: boolean;
    failedAt: Date;
  }[] = [];
  const providerCalls: unknown[] = [];
  const selectedAttempt = {
    ...attempt,
    paymentUrl: options.paymentUrl ?? null
  };
  const repository: TBankPaymentInitializationRepository = {
    async prepare() {
      return {
        status: options.prepareStatus ?? "created",
        attempt: selectedAttempt
      };
    },
    async markInitialized(
      paymentAttemptId,
      providerPaymentId,
      paymentUrl,
      providerStatus,
      initializedAt
    ) {
      initialized.push({
        paymentAttemptId,
        providerPaymentId,
        paymentUrl,
        providerStatus,
        initializedAt
      });
    },
    async markInitializationFailed(
      paymentAttemptId,
      errorCode,
      uncertain,
      failedAt
    ) {
      failures.push({ paymentAttemptId, errorCode, uncertain, failedAt });
    }
  };
  const provider: ExternalPaymentInitializer = {
    async initializePayment(input) {
      providerCalls.push(input);
      return options.providerResult ?? {
        initialized: true,
        providerPaymentId: "1234567890",
        paymentUrl: "https://securepay.tinkoff.ru/new-pay",
        providerStatus: "NEW"
      };
    }
  };

  return {
    service: new InitializeTelegramTBankPaymentService(
      repository,
      provider,
      {
        notificationUrl: "https://example.com/webhooks/payments/tbank",
        successUrl: "https://example.com/payments/success",
        failUrl: "https://example.com/payments/fail"
      }
    ),
    initialized,
    failures,
    providerCalls
  };
}

function webhookFixture(refundWebhook?: {
  execute(event: VerifiedTBankWebhook, receivedAt: Date): Promise<boolean>;
}) {
  const events: RecordTBankStatusEvent[] = [];
  const confirmations: NonNullable<
    Parameters<ConfirmPaymentService["execute"]>[0]["providerEvidence"]
  >[] = [];
  const repository: TBankWebhookRepository = {
    async findAttempt() {
      return webhookAttempt;
    },
    async recordStatusEvent(input) {
      events.push(input);
      return "recorded";
    }
  };
  const confirmPayment = {
    async execute(input: Parameters<ConfirmPaymentService["execute"]>[0]) {
      assert.ok(input.providerEvidence);
      confirmations.push(input.providerEvidence);
      return {
        paymentAttemptId: input.providerEvidence.paymentAttemptId,
        orderId: input.orderId,
        status: "paid" as const,
        paidAt: input.confirmedAt.toISOString(),
        amountKopecks: input.amountKopecks,
        walletCapturedKopecks: "0",
        ticketCount: 1,
        ticketNumbers: ["BP-000001-T001"],
        created: true
      };
    }
  } as unknown as ConfirmPaymentService;
  let id = 0;

  return {
    service: new HandleTBankPaymentWebhookService(
      repository,
      confirmPayment,
      {
        newId() {
          id += 1;
          return `00000000-0000-4000-8000-${id.toString().padStart(12, "0")}`;
        }
      },
      refundWebhook
    ),
    events,
    confirmations
  };
}

const ATTEMPT_ID = "00000000-0000-4000-8000-000000000001";

const attempt: PreparedTBankPaymentAttempt = {
  paymentAttemptId: ATTEMPT_ID,
  orderId: "00000000-0000-4000-8000-000000000002",
  orderNumber: "BP-000001",
  idempotencyKey: "tbank_init:order-1:1",
  merchantOrderId: "BP-000001-1",
  amountKopecks: "239000",
  currency: "RUB",
  description: "Билет BP-000001",
  paymentUrl: null
};

const command = {
  channel: "telegram" as const,
  publicOrderToken: "a".repeat(43),
  senderExternalUserId: "777",
  updateId: "1004",
  requestedAt
};

const webhookAttempt = {
  paymentAttemptId: ATTEMPT_ID,
  orderId: "00000000-0000-4000-8000-000000000002",
  idempotencyKey: "tbank_init:order-1:1",
  providerPaymentId: "1234567890",
  merchantOrderId: "BP-000001-1",
  amountKopecks: "239000",
  currency: "RUB"
};

const webhookEvent: VerifiedTBankWebhook = {
  providerPaymentId: "1234567890",
  merchantOrderId: "BP-000001-1",
  status: "CONFIRMED",
  success: true,
  errorCode: "0",
  amountKopecks: 239000n,
  payloadHash: "a".repeat(64),
  eventKey: "b".repeat(64)
};
