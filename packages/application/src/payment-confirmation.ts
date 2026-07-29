import { createHash } from "node:crypto";
import type {
  DomainEvent,
  MoneyKopecks,
  OrderStatus
} from "@ticket-platform/domain";
import { assertOrderTransition } from "@ticket-platform/domain";
import type {
  IdGenerator,
  OutboxWriter,
  UnitOfWork
} from "./identity.js";

export type PaymentConfirmationSource = "manual" | "fake" | "internal" | "tbank";

export type PaymentConfirmationActor =
  | { readonly type: "admin"; readonly adminId: string }
  | { readonly type: "system" }
  | { readonly type: "payment_provider" };

export interface ManualPaymentEvidence {
  readonly method: "cash" | "bank_transfer" | "other";
  readonly externalReference: string;
  readonly reason: string;
  readonly requestId: string | null;
}

export interface TBankPaymentEvidence {
  readonly origin: "webhook" | "reconciliation";
  readonly paymentAttemptId: string;
  readonly eventRecordId: string;
  readonly eventKey: string;
  readonly providerPaymentId: string;
  readonly merchantOrderId: string;
  readonly providerStatus: "CONFIRMED";
  readonly providerErrorCode: string;
  readonly payloadHash: string;
}

export interface InternalPaymentEvidence {
  readonly reason: "zero_external_due";
  readonly userId: string;
  readonly eventId: string;
}

export interface ConfirmPaymentCommand {
  readonly orderId: string;
  readonly idempotencyKey: string;
  readonly source: PaymentConfirmationSource;
  readonly amountKopecks: string;
  readonly currency: string;
  readonly confirmedAt: Date;
  readonly actor: PaymentConfirmationActor;
  readonly manualEvidence?: ManualPaymentEvidence;
  readonly internalEvidence?: InternalPaymentEvidence;
  readonly providerEvidence?: TBankPaymentEvidence;
}

export interface PaymentOrderItem {
  readonly id: string;
  readonly quantity: number;
  readonly reservationStatus: "active" | "consumed" | "released" | "expired" | null;
  readonly reservationExpiresAt: Date | null;
}

export interface ConfirmablePaymentOrder {
  readonly id: string;
  readonly number: string;
  readonly userId: string;
  readonly eventId: string;
  readonly status: OrderStatus;
  readonly currency: string;
  readonly total: MoneyKopecks;
  readonly walletApplied: MoneyKopecks;
  readonly externalDue: MoneyKopecks;
  readonly offerVersionId: string | null;
  readonly offerAcceptedAt: Date | null;
  readonly expiresAt: Date;
  readonly items: readonly PaymentOrderItem[];
}

export interface IssuedTicket {
  readonly id: string;
  readonly orderItemId: string;
  readonly sequence: number;
  readonly ticketNumber: string;
  readonly tokenHash: string;
}

export interface ConfirmedPaymentRecord {
  readonly paymentAttemptId: string;
  readonly confirmationRequestHash: string;
  readonly orderId: string;
  readonly paidAt: Date;
  readonly amount: MoneyKopecks;
  readonly walletCaptured: MoneyKopecks;
  readonly tickets: readonly {
    readonly id: string;
    readonly ticketNumber: string;
  }[];
}

export interface PersistPaymentConfirmationInput {
  readonly paymentAttemptId: string;
  readonly manualPaymentId: string;
  readonly historyId: string;
  readonly auditId: string;
  readonly confirmationRequestHash: string;
  readonly command: ConfirmPaymentCommand;
  readonly order: ConfirmablePaymentOrder;
  readonly tickets: readonly IssuedTicket[];
}

export interface PaymentConfirmationRepository {
  lockIdempotencyKey(idempotencyKey: string): Promise<void>;
  findByIdempotencyKey(idempotencyKey: string): Promise<ConfirmedPaymentRecord | null>;
  lockOrder(orderId: string): Promise<ConfirmablePaymentOrder | null>;
  persistConfirmation(input: PersistPaymentConfirmationInput): Promise<void>;
}

export interface TicketReferenceGenerator {
  ticketNumber(orderNumber: string, ordinal: number): string;
  publicToken(ticketId: string): { readonly token: string; readonly sha256: string };
}

export interface ConfirmPaymentResult {
  readonly paymentAttemptId: string;
  readonly orderId: string;
  readonly status: "paid";
  readonly paidAt: string;
  readonly amountKopecks: string;
  readonly walletCapturedKopecks: string;
  readonly ticketCount: number;
  readonly ticketNumbers: readonly string[];
  readonly created: boolean;
}

export interface CompleteInternalOrderCommand {
  readonly orderId: string;
  readonly userId: string;
  readonly eventId: string;
  readonly currency: string;
  readonly idempotencyKey: string;
  readonly completedAt: Date;
}

export interface PaymentConfirmer {
  execute(command: ConfirmPaymentCommand): Promise<ConfirmPaymentResult>;
}

export class CompleteInternalOrderService {
  constructor(private readonly confirmer: PaymentConfirmer) {}

  execute(command: CompleteInternalOrderCommand): Promise<ConfirmPaymentResult> {
    return this.confirmer.execute({
      orderId: command.orderId,
      idempotencyKey: command.idempotencyKey,
      source: "internal",
      amountKopecks: "0",
      currency: command.currency,
      confirmedAt: command.completedAt,
      actor: { type: "system" },
      internalEvidence: {
        reason: "zero_external_due",
        userId: command.userId,
        eventId: command.eventId
      }
    });
  }
}

export class ConfirmPaymentService {
  constructor(
    private readonly repository: PaymentConfirmationRepository,
    private readonly outboxWriter: OutboxWriter,
    private readonly unitOfWork: UnitOfWork,
    private readonly idGenerator: IdGenerator,
    private readonly ticketReferences: TicketReferenceGenerator
  ) {}

  execute(command: ConfirmPaymentCommand): Promise<ConfirmPaymentResult> {
    const amount = validateCommand(command);
    const requestHash = hashConfirmationRequest(command);

    return this.unitOfWork.transact(async () => {
      await this.repository.lockIdempotencyKey(command.idempotencyKey);
      const existing = await this.repository.findByIdempotencyKey(command.idempotencyKey);

      if (existing) {
        if (existing.confirmationRequestHash !== requestHash) {
          throw new Error("Payment idempotency key was already used for another confirmation");
        }
        return toResult(existing, false);
      }

      const order = await this.repository.lockOrder(command.orderId);
      if (!order) {
        throw new Error("Order was not found");
      }
      validateOrder(order, command, amount);

      const paymentAttemptId = command.providerEvidence?.paymentAttemptId
        ?? this.idGenerator.newId();
      const tickets = issueTicketReferences(
        order,
        this.idGenerator,
        this.ticketReferences
      );
      await this.repository.persistConfirmation({
        paymentAttemptId,
        manualPaymentId: this.idGenerator.newId(),
        historyId: this.idGenerator.newId(),
        auditId: this.idGenerator.newId(),
        confirmationRequestHash: requestHash,
        command,
        order,
        tickets
      });

      const record: ConfirmedPaymentRecord = {
        paymentAttemptId,
        confirmationRequestHash: requestHash,
        orderId: order.id,
        paidAt: command.confirmedAt,
        amount,
        walletCaptured: order.walletApplied,
        tickets: tickets.map((ticket) => ({
          id: ticket.id,
          ticketNumber: ticket.ticketNumber
        }))
      };
      for (const event of paymentEvents(record, order, command, this.idGenerator)) {
        await this.outboxWriter.append(event);
      }

      return toResult(record, true);
    });
  }
}

function validateCommand(command: ConfirmPaymentCommand): MoneyKopecks {
  if (!/^[A-Za-z0-9._:-]{8,200}$/.test(command.idempotencyKey)) {
    throw new Error("Payment idempotency key is invalid");
  }
  if (!/^\d{1,20}$/.test(command.amountKopecks)) {
    throw new Error("Payment amount must be integer kopecks");
  }
  if (!/^[A-Z]{3}$/.test(command.currency)) {
    throw new Error("Payment currency is invalid");
  }
  if (Number.isNaN(command.confirmedAt.getTime())) {
    throw new Error("Payment confirmation time is invalid");
  }

  const amount = BigInt(command.amountKopecks);
  if (
    command.source !== "manual"
    && command.source !== "fake"
    && command.source !== "internal"
    && command.source !== "tbank"
  ) {
    throw new Error("Payment confirmation source is invalid");
  }
  if (command.source === "manual") {
    if (command.actor.type !== "admin" || !command.manualEvidence || amount <= 0n) {
      throw new Error("Manual payment requires an administrator, evidence, and a positive amount");
    }
    validateManualEvidence(command.manualEvidence);
  } else if (command.manualEvidence) {
    throw new Error("Manual payment evidence is only valid for manual confirmations");
  }

  if (command.source === "internal") {
    if (
      command.actor.type !== "system"
      || amount !== 0n
      || !command.internalEvidence
    ) {
      throw new Error("Internal confirmation requires a zero amount and system evidence");
    }
    validateInternalEvidence(command.internalEvidence);
  } else if (command.internalEvidence) {
    throw new Error("Internal evidence is only valid for internal confirmations");
  }

  if (command.source === "tbank") {
    if (command.actor.type !== "payment_provider" || !command.providerEvidence) {
      throw new Error("T-Bank payment requires verified provider evidence");
    }
    validateTBankEvidence(command.providerEvidence);
  } else if (command.providerEvidence) {
    throw new Error("Provider evidence is only valid for T-Bank confirmations");
  } else if (command.source === "fake" && command.actor.type !== "system") {
    throw new Error("Payment confirmation actor does not match its source");
  }

  return amount;
}

function validateInternalEvidence(evidence: InternalPaymentEvidence): void {
  if (
    evidence.reason !== "zero_external_due"
    || !UUID_PATTERN.test(evidence.userId)
    || !UUID_PATTERN.test(evidence.eventId)
  ) {
    throw new Error("Internal payment evidence is invalid");
  }
}

function validateTBankEvidence(evidence: TBankPaymentEvidence): void {
  if (
    (evidence.origin !== "webhook" && evidence.origin !== "reconciliation")
    ||
    !UUID_PATTERN.test(evidence.paymentAttemptId)
    || !UUID_PATTERN.test(evidence.eventRecordId)
    || !/^[a-f0-9]{64}$/.test(evidence.eventKey)
    || !/^\d{1,20}$/.test(evidence.providerPaymentId)
    || !/^[A-Za-z0-9._-]{1,50}$/.test(evidence.merchantOrderId)
    || evidence.providerStatus !== "CONFIRMED"
    || !/^[A-Za-z0-9_-]{1,20}$/.test(evidence.providerErrorCode)
    || !/^[a-f0-9]{64}$/.test(evidence.payloadHash)
  ) {
    throw new Error("T-Bank payment evidence is invalid");
  }
}

function validateManualEvidence(evidence: ManualPaymentEvidence): void {
  if (
    evidence.externalReference.trim().length < 1
    || evidence.externalReference.length > 120
    || evidence.reason.trim().length < 3
    || evidence.reason.length > 500
  ) {
    throw new Error("Manual payment evidence is invalid");
  }
  if (evidence.requestId !== null && evidence.requestId.length > 200) {
    throw new Error("Manual payment request ID is invalid");
  }
}

function validateOrder(
  order: ConfirmablePaymentOrder,
  command: ConfirmPaymentCommand,
  amount: MoneyKopecks
): void {
  assertOrderTransition(order.status, "paid");

  if (order.offerVersionId !== null && order.offerAcceptedAt === null) {
    throw new Error("Order offer must be accepted before payment");
  }
  const providerPayment = command.source === "tbank";
  if (
    !providerPayment
    && order.expiresAt.getTime() <= command.confirmedAt.getTime()
  ) {
    throw new Error("Order reservation has expired");
  }
  if (order.currency !== command.currency || order.externalDue !== amount) {
    throw new Error("Payment amount or currency does not match the immutable order split");
  }
  if (
    command.source === "internal"
    && (
      !command.internalEvidence
      || order.userId !== command.internalEvidence.userId
      || order.eventId !== command.internalEvidence.eventId
      || order.externalDue !== 0n
    )
  ) {
    throw new Error("Internal confirmation does not match the zero-due order owner");
  }
  if (order.total !== order.walletApplied + order.externalDue) {
    throw new Error("Order payment split requires reconciliation");
  }
  if (order.items.length === 0) {
    throw new Error("Order has no payable items");
  }

  for (const item of order.items) {
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) {
      throw new Error(`Order item quantity is invalid: ${item.id}`);
    }
    if (
      item.reservationStatus !== "active"
      || item.reservationExpiresAt === null
      || (
        !providerPayment
        && item.reservationExpiresAt.getTime() <= command.confirmedAt.getTime()
      )
    ) {
      throw new Error(`Order inventory reservation is not active: ${item.id}`);
    }
  }
}

function issueTicketReferences(
  order: ConfirmablePaymentOrder,
  idGenerator: IdGenerator,
  references: TicketReferenceGenerator
): readonly IssuedTicket[] {
  const tickets: IssuedTicket[] = [];
  let ordinal = 0;

  for (const item of order.items) {
    for (let sequence = 1; sequence <= item.quantity; sequence += 1) {
      ordinal += 1;
      const id = idGenerator.newId();
      tickets.push({
        id,
        orderItemId: item.id,
        sequence,
        ticketNumber: references.ticketNumber(order.number, ordinal),
        tokenHash: references.publicToken(id).sha256
      });
    }
  }

  return tickets;
}

function hashConfirmationRequest(command: ConfirmPaymentCommand): string {
  const manualEvidence = command.manualEvidence
    ? {
        method: command.manualEvidence.method,
        externalReference: command.manualEvidence.externalReference,
        reason: command.manualEvidence.reason
      }
    : null;
  const canonical = JSON.stringify({
    orderId: command.orderId,
    source: command.source,
    amountKopecks: command.amountKopecks,
    currency: command.currency,
    actor: command.actor,
    manualEvidence,
    internalEvidence: command.internalEvidence ?? null
  });

  return createHash("sha256").update(canonical).digest("hex");
}

function paymentEvents(
  payment: ConfirmedPaymentRecord,
  order: ConfirmablePaymentOrder,
  command: ConfirmPaymentCommand,
  idGenerator: IdGenerator
): readonly DomainEvent[] {
  const basePayload = {
    orderId: order.id,
    orderNumber: order.number,
    userId: order.userId,
    eventId: order.eventId,
    paymentAttemptId: payment.paymentAttemptId,
    source: command.source,
    totalKopecks: order.total.toString(),
    walletCapturedKopecks: payment.walletCaptured.toString(),
    externalPaidKopecks: payment.amount.toString(),
    ticketCount: payment.tickets.length
  };

  return [
    {
      eventId: idGenerator.newId(),
      aggregateType: "order",
      aggregateId: order.id,
      eventType: "PaymentConfirmed",
      schemaVersion: 1,
      payload: basePayload,
      occurredAt: command.confirmedAt
    },
    {
      eventId: idGenerator.newId(),
      aggregateType: "order",
      aggregateId: order.id,
      eventType: "TicketsIssued",
      schemaVersion: 1,
      payload: {
        ...basePayload,
        ticketIds: payment.tickets.map((ticket) => ticket.id)
      },
      occurredAt: command.confirmedAt
    },
    {
      eventId: idGenerator.newId(),
      aggregateType: "order",
      aggregateId: order.id,
      eventType: "AdminPurchaseNotificationRequested",
      schemaVersion: 1,
      payload: basePayload,
      occurredAt: command.confirmedAt
    }
  ];
}

function toResult(record: ConfirmedPaymentRecord, created: boolean): ConfirmPaymentResult {
  return {
    paymentAttemptId: record.paymentAttemptId,
    orderId: record.orderId,
    status: "paid",
    paidAt: record.paidAt.toISOString(),
    amountKopecks: record.amount.toString(),
    walletCapturedKopecks: record.walletCaptured.toString(),
    ticketCount: record.tickets.length,
    ticketNumbers: record.tickets.map((ticket) => ticket.ticketNumber),
    created
  };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
