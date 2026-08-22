import type { MessengerChannel } from "@ticket-platform/domain";
import { createHash } from "node:crypto";
import type {
  InitializeTelegramPaymentCommand,
  InitializeTelegramPaymentResult
} from "@ticket-platform/contracts";
import type { IdGenerator } from "./identity.js";
import type { ConfirmPaymentService } from "./payment-confirmation.js";

export interface PreparedTBankPaymentAttempt {
  readonly paymentAttemptId: string;
  readonly orderId: string;
  readonly orderNumber: string;
  readonly idempotencyKey: string;
  readonly merchantOrderId: string;
  readonly amountKopecks: string;
  readonly currency: string;
  readonly description: string;
  readonly paymentUrl: string | null;
}

export type PrepareTBankPaymentResult =
  | { readonly status: "created"; readonly attempt: PreparedTBankPaymentAttempt }
  | { readonly status: "pending"; readonly attempt: PreparedTBankPaymentAttempt }
  | { readonly status: "uncertain" }
  | { readonly status: "not_found" }
  | { readonly status: "unavailable" };

export interface TBankPaymentInitializationRepository {
  prepare(input: {
    readonly channel: MessengerChannel;
    readonly publicOrderTokenHash: string;
    readonly senderExternalUserId: string;
    readonly requestedAt: Date;
  }): Promise<PrepareTBankPaymentResult>;
  markInitialized(
    paymentAttemptId: string,
    providerPaymentId: string,
    paymentUrl: string,
    providerStatus: "NEW",
    initializedAt: Date
  ): Promise<void>;
  markInitializationFailed(
    paymentAttemptId: string,
    errorCode: string,
    uncertain: boolean,
    failedAt: Date
  ): Promise<void>;
}

export interface ExternalPaymentInitializer {
  initializePayment(input: {
    readonly merchantOrderId: string;
    readonly amountKopecks: bigint;
    readonly description: string;
    readonly notificationUrl: string;
    readonly successUrl: string;
    readonly failUrl: string;
    readonly payType: "O";
  }): Promise<
    | {
        readonly initialized: true;
        readonly providerPaymentId: string;
        readonly paymentUrl: string;
        readonly providerStatus: "NEW";
      }
    | {
        readonly initialized: false;
        readonly errorCode: string;
        readonly retryable: boolean;
      }
  >;
}

export interface TBankPaymentUrls {
  readonly notificationUrl: string;
  readonly successUrl: string;
  readonly failUrl: string;
}

export class InitializeTelegramTBankPaymentService {
  constructor(
    private readonly repository: TBankPaymentInitializationRepository,
    private readonly provider: ExternalPaymentInitializer,
    private readonly urls: TBankPaymentUrls
  ) {}

  async execute(
    command: InitializeTelegramPaymentCommand
  ): Promise<InitializeTelegramPaymentResult> {
    if (
      !/^[A-Za-z0-9_-]{43}$/.test(command.publicOrderToken)
      || !/^\d{1,30}$/.test(command.senderExternalUserId)
      || Number.isNaN(command.requestedAt.getTime())
    ) {
      return { initialized: false, reason: "order_not_found" };
    }
    const prepared = await this.repository.prepare({
      channel: command.channel,
      publicOrderTokenHash: createHash("sha256")
        .update(command.publicOrderToken)
        .digest("hex"),
      senderExternalUserId: command.senderExternalUserId,
      requestedAt: command.requestedAt
    });
    if (prepared.status === "not_found") {
      return { initialized: false, reason: "order_not_found" };
    }
    if (prepared.status === "unavailable") {
      return { initialized: false, reason: "payment_unavailable" };
    }
    if (prepared.status === "uncertain") {
      return { initialized: false, reason: "initialization_in_progress" };
    }
    if (prepared.status === "pending") {
      if (!prepared.attempt.paymentUrl) {
        throw new Error("Pending T-Bank payment attempt has no payment URL");
      }
      return initializedResult(prepared.attempt, prepared.attempt.paymentUrl);
    }

    let initialization: Awaited<
      ReturnType<ExternalPaymentInitializer["initializePayment"]>
    >;
    try {
      initialization = await this.provider.initializePayment({
        merchantOrderId: prepared.attempt.merchantOrderId,
        amountKopecks: BigInt(prepared.attempt.amountKopecks),
        description: prepared.attempt.description,
        notificationUrl: this.urls.notificationUrl,
        successUrl: this.urls.successUrl,
        failUrl: this.urls.failUrl,
        payType: "O"
      });
    } catch {
      initialization = {
        initialized: false,
        errorCode: "NETWORK_ERROR",
        retryable: true
      };
    }

    if (!initialization.initialized) {
      await this.repository.markInitializationFailed(
        prepared.attempt.paymentAttemptId,
        initialization.errorCode,
        initialization.retryable,
        command.requestedAt
      );
      return {
        initialized: false,
        reason: initialization.retryable
          ? "initialization_in_progress"
          : "payment_unavailable"
      };
    }

    await this.repository.markInitialized(
      prepared.attempt.paymentAttemptId,
      initialization.providerPaymentId,
      initialization.paymentUrl,
      initialization.providerStatus,
      command.requestedAt
    );
    return initializedResult(prepared.attempt, initialization.paymentUrl);
  }
}

export type TBankWebhookStatus =
  | "NEW"
  | "FORM_SHOWED"
  | "DEADLINE_EXPIRED"
  | "CANCELED"
  | "PREAUTHORIZING"
  | "AUTHORIZING"
  | "AUTHORIZED"
  | "AUTH_FAIL"
  | "REJECTED"
  | "3DS_CHECKING"
  | "3DS_CHECKED"
  | "REVERSING"
  | "PARTIAL_REVERSED"
  | "REVERSED"
  | "CONFIRMING"
  | "CONFIRMED"
  | "REFUNDING"
  | "PARTIAL_REFUNDED"
  | "REFUNDED";

export interface VerifiedTBankWebhook {
  readonly providerPaymentId: string;
  readonly merchantOrderId: string;
  readonly status: TBankWebhookStatus;
  readonly success: boolean;
  readonly errorCode: string;
  readonly amountKopecks: bigint;
  readonly payloadHash: string;
  readonly eventKey: string;
}

export interface TBankWebhookPaymentAttempt {
  readonly paymentAttemptId: string;
  readonly orderId: string;
  readonly idempotencyKey: string;
  readonly providerPaymentId: string;
  readonly merchantOrderId: string;
  readonly amountKopecks: string;
  readonly currency: string;
}

export interface RecordTBankStatusEvent {
  readonly eventRecordId: string;
  readonly attempt: TBankWebhookPaymentAttempt | null;
  readonly event: VerifiedTBankWebhook;
  readonly internalStatus:
    | "pending"
    | "authorized"
    | "failed"
    | "cancelled"
    | "partially_refunded"
    | "refunded"
    | null;
  readonly outcome: "processed" | "review";
  readonly receivedAt: Date;
}

export interface TBankWebhookRepository {
  findAttempt(
    providerPaymentId: string,
    merchantOrderId: string
  ): Promise<TBankWebhookPaymentAttempt | null>;
  recordStatusEvent(
    input: RecordTBankStatusEvent
  ): Promise<"recorded" | "duplicate">;
}

export interface TBankRefundWebhookHandler {
  execute(event: VerifiedTBankWebhook, receivedAt: Date): Promise<boolean>;
}

export class HandleTBankPaymentWebhookService {
  constructor(
    private readonly repository: TBankWebhookRepository,
    private readonly confirmPayment: ConfirmPaymentService,
    private readonly idGenerator: IdGenerator,
    private readonly refundWebhook?: TBankRefundWebhookHandler
  ) {}

  async execute(event: VerifiedTBankWebhook, receivedAt: Date): Promise<void> {
    if (
      isRefundStatus(event.status)
      && await this.refundWebhook?.execute(event, receivedAt)
    ) {
      return;
    }
    const attempt = await this.repository.findAttempt(
      event.providerPaymentId,
      event.merchantOrderId
    );
    const matches = attempt
      && attempt.amountKopecks === event.amountKopecks.toString()
      && attempt.currency === "RUB";

    if (!matches) {
      await this.repository.recordStatusEvent({
        eventRecordId: this.idGenerator.newId(),
        attempt: null,
        event,
        internalStatus: null,
        outcome: "review",
        receivedAt
      });
      return;
    }

    if (event.status === "CONFIRMED" && event.success && event.errorCode === "0") {
      await this.confirmPayment.execute({
        orderId: attempt.orderId,
        idempotencyKey: attempt.idempotencyKey,
        source: "tbank",
        amountKopecks: attempt.amountKopecks,
        currency: attempt.currency,
        confirmedAt: receivedAt,
        actor: { type: "payment_provider" },
        providerEvidence: {
          origin: "webhook",
          paymentAttemptId: attempt.paymentAttemptId,
          eventRecordId: this.idGenerator.newId(),
          eventKey: event.eventKey,
          providerPaymentId: event.providerPaymentId,
          merchantOrderId: event.merchantOrderId,
          providerStatus: "CONFIRMED",
          providerErrorCode: event.errorCode,
          payloadHash: event.payloadHash
        }
      });
      return;
    }

    const internalStatus = mapStatus(event);
    await this.repository.recordStatusEvent({
      eventRecordId: this.idGenerator.newId(),
      attempt,
      event,
      internalStatus,
      outcome: internalStatus === null ? "review" : "processed",
      receivedAt
    });
  }
}

function isRefundStatus(status: TBankWebhookStatus): boolean {
  return status === "REFUNDING"
    || status === "PARTIAL_REFUNDED"
    || status === "REFUNDED";
}

function initializedResult(
  attempt: PreparedTBankPaymentAttempt,
  paymentUrl: string
): InitializeTelegramPaymentResult {
  return {
    initialized: true,
    paymentUrl,
    orderNumber: attempt.orderNumber,
    amountKopecks: attempt.amountKopecks,
    currency: attempt.currency
  };
}

function mapStatus(
  event: VerifiedTBankWebhook
): RecordTBankStatusEvent["internalStatus"] {
  if (event.status === "AUTHORIZED" && event.success) {
    return "authorized";
  }
  if (
    event.status === "CONFIRMED"
    || event.status === "PARTIAL_REFUNDED"
    || event.status === "REFUNDED"
    || event.status === "REFUNDING"
    || event.status === "PARTIAL_REVERSED"
  ) {
    return null;
  }
  if (
    event.status === "CANCELED"
    || event.status === "DEADLINE_EXPIRED"
    || event.status === "REVERSED"
  ) {
    return "cancelled";
  }
  if (event.status === "AUTH_FAIL" || event.status === "REJECTED") {
    return "failed";
  }
  return "pending";
}
