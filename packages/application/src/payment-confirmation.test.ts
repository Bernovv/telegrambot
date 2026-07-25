import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DomainEvent } from "@ticket-platform/domain";
import {
  ConfirmPaymentService,
  type ConfirmablePaymentOrder,
  type ConfirmedPaymentRecord,
  type ConfirmPaymentCommand,
  type PaymentConfirmationRepository,
  type PersistPaymentConfirmationInput
} from "./payment-confirmation.js";

const confirmedAt = new Date("2026-07-24T12:20:00.000Z");

describe("ConfirmPaymentService", () => {
  it("confirms once, captures the immutable split, issues tickets, and emits work events", async () => {
    const repository = new RecordingRepository(order);
    const events: DomainEvent[] = [];
    const service = createService(repository, events);
    const retryEvidence = command.manualEvidence;
    assert.ok(retryEvidence);

    const first = await service.execute(command);
    const second = await service.execute({
      ...command,
      manualEvidence: {
        ...retryEvidence,
        requestId: "request-2"
      }
    });

    assert.deepEqual(first, {
      paymentAttemptId: "id-1",
      orderId: "order-1",
      status: "paid",
      paidAt: confirmedAt.toISOString(),
      amountKopecks: "239000",
      walletCapturedKopecks: "10000",
      ticketCount: 2,
      ticketNumbers: ["BP-ORDER-1-T001", "BP-ORDER-1-T002"],
      created: true
    });
    assert.deepEqual(second, { ...first, created: false });
    assert.equal(repository.persisted.length, 1);
    assert.equal(repository.persisted[0]?.tickets.length, 2);
    assert.deepEqual(
      events.map((event) => event.eventType),
      ["PaymentConfirmed", "TicketsIssued", "AdminPurchaseNotificationRequested"]
    );
    assert.equal(events[0]?.payload.walletCapturedKopecks, "10000");
  });

  it("rejects an idempotency key reused for different evidence", async () => {
    const repository = new RecordingRepository(order);
    const service = createService(repository, []);
    const manualEvidence = command.manualEvidence;
    assert.ok(manualEvidence);

    await service.execute(command);
    await assert.rejects(
      service.execute({
        ...command,
        manualEvidence: {
          ...manualEvidence,
          externalReference: "another-reference"
        }
      }),
      /already used/
    );
    assert.equal(repository.persisted.length, 1);
  });

  it("rejects an unaccepted offer and an amount that differs from the snapshot", async () => {
    const unacceptedRepository = new RecordingRepository({
      ...order,
      offerAcceptedAt: null
    });
    await assert.rejects(
      createService(unacceptedRepository, []).execute(command),
      /offer must be accepted/
    );

    const amountRepository = new RecordingRepository(order);
    await assert.rejects(
      createService(amountRepository, []).execute({
        ...command,
        amountKopecks: "238999"
      }),
      /does not match/
    );
    assert.equal(unacceptedRepository.persisted.length, 0);
    assert.equal(amountRepository.persisted.length, 0);
  });

  it("accepts a verified in-flight T-Bank payment while its reservations remain active", async () => {
    const repository = new RecordingRepository({
      ...order,
      status: "payment_processing",
      expiresAt: new Date("2026-07-24T12:19:00.000Z"),
      items: order.items.map((item) => ({
        ...item,
        reservationExpiresAt: new Date("2026-07-24T12:19:00.000Z")
      }))
    });

    const result = await createService(repository, []).execute({
      orderId: order.id,
      idempotencyKey: "tbank_init:order-1:1",
      source: "tbank",
      amountKopecks: "239000",
      currency: "RUB",
      confirmedAt,
      actor: { type: "payment_provider" },
      providerEvidence: {
        origin: "webhook",
        paymentAttemptId: "019c0123-4567-789a-bcde-000000000001",
        eventRecordId: "019c0123-4567-789a-bcde-000000000002",
        eventKey: "b".repeat(64),
        providerPaymentId: "1234567890",
        merchantOrderId: "tb_019c01234567789abcdef0123456789a_1",
        providerStatus: "CONFIRMED",
        providerErrorCode: "0",
        payloadHash: "a".repeat(64)
      }
    });

    assert.equal(result.status, "paid");
    assert.equal(repository.persisted[0]?.paymentAttemptId, "019c0123-4567-789a-bcde-000000000001");
  });
});

class RecordingRepository implements PaymentConfirmationRepository {
  readonly persisted: PersistPaymentConfirmationInput[] = [];
  private existing: ConfirmedPaymentRecord | null = null;

  constructor(private readonly order: ConfirmablePaymentOrder) {}

  async lockIdempotencyKey(): Promise<void> {}

  async findByIdempotencyKey(): Promise<ConfirmedPaymentRecord | null> {
    return this.existing;
  }

  async lockOrder(): Promise<ConfirmablePaymentOrder> {
    return this.order;
  }

  async persistConfirmation(input: PersistPaymentConfirmationInput): Promise<void> {
    this.persisted.push(input);
    this.existing = {
      paymentAttemptId: input.paymentAttemptId,
      confirmationRequestHash: input.confirmationRequestHash,
      orderId: input.order.id,
      paidAt: input.command.confirmedAt,
      amount: BigInt(input.command.amountKopecks),
      walletCaptured: input.order.walletApplied,
      tickets: input.tickets.map((ticket) => ({
        id: ticket.id,
        ticketNumber: ticket.ticketNumber
      }))
    };
  }
}

function createService(
  repository: PaymentConfirmationRepository,
  events: DomainEvent[]
): ConfirmPaymentService {
  let id = 0;

  return new ConfirmPaymentService(
    repository,
    { async append(event) { events.push(event); } },
    { async transact(work) { return work(); } },
    { newId() { id += 1; return `id-${id}`; } },
    {
      ticketNumber(_orderNumber, ordinal) {
        return `BP-ORDER-1-T${ordinal.toString().padStart(3, "0")}`;
      },
      publicToken(ticketId) {
        return { token: `token-${ticketId}`, sha256: "a".repeat(64) };
      }
    }
  );
}

const command: ConfirmPaymentCommand = {
  orderId: "order-1",
  idempotencyKey: "manual:payment:1",
  source: "manual",
  amountKopecks: "239000",
  currency: "RUB",
  confirmedAt,
  actor: { type: "admin", adminId: "admin-1" },
  manualEvidence: {
    method: "bank_transfer",
    externalReference: "bank-reference-1",
    reason: "Payment verified by sales manager",
    requestId: "request-1"
  }
};

const order: ConfirmablePaymentOrder = {
  id: "order-1",
  number: "BP-ORDER-1",
  userId: "user-1",
  eventId: "event-1",
  status: "awaiting_payment",
  currency: "RUB",
  total: 249_000n,
  walletApplied: 10_000n,
  externalDue: 239_000n,
  offerVersionId: "offer-1",
  offerAcceptedAt: new Date("2026-07-24T12:10:00.000Z"),
  expiresAt: new Date("2026-07-24T12:30:00.000Z"),
  items: [{
    id: "item-1",
    quantity: 2,
    reservationStatus: "active",
    reservationExpiresAt: new Date("2026-07-24T12:30:00.000Z")
  }]
};
