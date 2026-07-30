import type { AdminBroadcastContent } from "@ticket-platform/contracts";
import {
  InvalidBroadcastPersonalizationError,
  renderBroadcastContent,
  type BroadcastPersonalizationContext
} from "./broadcast-personalization.js";
import type { IdGenerator } from "./identity.js";

export type BroadcastDeliveryFailureCategory =
  | "blocked"
  | "rate_limit"
  | "transient"
  | "permanent";

export class BroadcastDeliverySendError extends Error {
  constructor(
    readonly category: BroadcastDeliveryFailureCategory,
    readonly code: string,
    readonly retryAfterSeconds?: number
  ) {
    super(`Broadcast delivery failed: ${code}`);
    this.name = "BroadcastDeliverySendError";
  }
}

export interface ClaimedBroadcastDelivery {
  readonly deliveryId: string;
  readonly broadcastId: string;
  readonly userId: string;
  readonly telegramIdentityId: string;
  readonly recipientId: string;
  readonly schemaVersion: 1 | 2 | 3;
  readonly content: AdminBroadcastContent;
  readonly personalizationContext: BroadcastPersonalizationContext;
  readonly attemptCount: number;
}

export interface BroadcastDeliveryCompletion {
  readonly broadcastStatus: "sending" | "paused" | "completed" | "cancelled";
}

export interface BroadcastDeliveryRepository {
  claimNext(input: {
    readonly workerId: string;
    readonly claimedAt: Date;
    readonly leaseSeconds: number;
    readonly lifecycleEventId: string;
  }): Promise<ClaimedBroadcastDelivery | null>;
  markSent(input: {
    readonly delivery: ClaimedBroadcastDelivery;
    readonly workerId: string;
    readonly providerMessageId: string;
    readonly sentAt: Date;
    readonly lifecycleEventId: string;
  }): Promise<BroadcastDeliveryCompletion>;
  markFailed(input: {
    readonly delivery: ClaimedBroadcastDelivery;
    readonly workerId: string;
    readonly failedAt: Date;
    readonly errorCode: string;
    readonly retryAt: Date | null;
    readonly blocked: boolean;
    readonly autoPauseMinimumAttempts: number;
    readonly autoPauseFailurePercent: number;
    readonly lifecycleEventId: string;
  }): Promise<BroadcastDeliveryCompletion>;
}

export interface BroadcastMessageSender {
  sendBroadcastMessage(
    recipientId: string,
    content: AdminBroadcastContent
  ): Promise<{ readonly providerMessageId: string }>;
}

export interface SendNextBroadcastDeliveryResult {
  readonly state:
    | "idle"
    | "sent"
    | "retry_scheduled"
    | "failed"
    | "paused"
    | "cancelled"
    | "completed";
  readonly broadcastId?: string;
  readonly deliveryId?: string;
}

export interface BroadcastDeliveryExecutionPolicy {
  readonly leaseSeconds: number;
  readonly maxAttempts: number;
  readonly retryBaseSeconds: number;
  readonly retryMaxSeconds: number;
  readonly autoPauseMinimumAttempts: number;
  readonly autoPauseFailurePercent: number;
}

export class InvalidBroadcastDeliveryExecutionError extends Error {
  constructor() {
    super("Broadcast delivery execution input is invalid");
    this.name = "InvalidBroadcastDeliveryExecutionError";
  }
}

export class SendNextBroadcastDeliveryService {
  constructor(
    private readonly repository: BroadcastDeliveryRepository,
    private readonly sender: BroadcastMessageSender,
    private readonly idGenerator: IdGenerator,
    private readonly policy: BroadcastDeliveryExecutionPolicy
  ) {
    validatePolicy(policy);
  }

  async execute(input: {
    readonly workerId: string;
    readonly at: Date;
  }): Promise<SendNextBroadcastDeliveryResult> {
    if (
      !input.workerId
      || input.workerId.length > 200
      || Number.isNaN(input.at.getTime())
    ) {
      throw new InvalidBroadcastDeliveryExecutionError();
    }

    const delivery = await this.repository.claimNext({
      workerId: input.workerId,
      claimedAt: input.at,
      leaseSeconds: this.policy.leaseSeconds,
      lifecycleEventId: this.idGenerator.newId()
    });
    if (!delivery) {
      return { state: "idle" };
    }

    let sent: { readonly providerMessageId: string };
    try {
      const content = renderBroadcastContent(
        delivery.content,
        delivery.schemaVersion,
        delivery.personalizationContext
      );
      sent = await this.sender.sendBroadcastMessage(
        delivery.recipientId,
        content
      );
    } catch (error) {
      const failure = error instanceof InvalidBroadcastPersonalizationError
        ? new BroadcastDeliverySendError(
            "permanent",
            error.reason === "output_too_long"
              ? "BroadcastPersonalizationOutputTooLong"
              : "BroadcastPersonalizationInvalid"
          )
        : normalizeFailure(error);
      const retryAt = retryAtFor(
        failure,
        delivery.attemptCount,
        input.at,
        this.policy
      );
      const completion = await this.repository.markFailed({
        delivery,
        workerId: input.workerId,
        failedAt: input.at,
        errorCode: failure.code,
        retryAt,
        blocked: failure.category === "blocked",
        autoPauseMinimumAttempts: this.policy.autoPauseMinimumAttempts,
        autoPauseFailurePercent: this.policy.autoPauseFailurePercent,
        lifecycleEventId: this.idGenerator.newId()
      });
      return {
        state: completion.broadcastStatus === "cancelled"
          ? "cancelled"
          : completion.broadcastStatus === "paused"
          ? "paused"
          : completion.broadcastStatus === "completed"
            ? "completed"
            : retryAt
              ? "retry_scheduled"
              : "failed",
        broadcastId: delivery.broadcastId,
        deliveryId: delivery.deliveryId
      };
    }

    const completion = await this.repository.markSent({
      delivery,
      workerId: input.workerId,
      providerMessageId: sent.providerMessageId,
      sentAt: input.at,
      lifecycleEventId: this.idGenerator.newId()
    });
    return {
      state: completion.broadcastStatus === "completed"
        ? "completed"
        : completion.broadcastStatus === "cancelled"
          ? "cancelled"
          : "sent",
      broadcastId: delivery.broadcastId,
      deliveryId: delivery.deliveryId
    };
  }
}

function normalizeFailure(error: unknown): BroadcastDeliverySendError {
  if (error instanceof BroadcastDeliverySendError) {
    return error;
  }
  if (
    error
    && typeof error === "object"
    && "category" in error
    && "code" in error
    && (
      error.category === "blocked"
      || error.category === "rate_limit"
      || error.category === "transient"
      || error.category === "permanent"
    )
    && typeof error.code === "string"
    && /^[A-Za-z][A-Za-z0-9_]{0,99}$/.test(error.code)
    && (
      !("retryAfterSeconds" in error)
      || error.retryAfterSeconds === undefined
      || (
        Number.isSafeInteger(error.retryAfterSeconds)
        && Number(error.retryAfterSeconds) > 0
      )
    )
  ) {
    return new BroadcastDeliverySendError(
      error.category,
      error.code,
      "retryAfterSeconds" in error
        ? Number(error.retryAfterSeconds)
        : undefined
    );
  }
  return new BroadcastDeliverySendError("transient", "UnknownDeliveryError");
}

function retryAtFor(
  failure: BroadcastDeliverySendError,
  attemptCount: number,
  at: Date,
  policy: BroadcastDeliveryExecutionPolicy
): Date | null {
  if (
    failure.category === "blocked"
    || failure.category === "permanent"
    || attemptCount >= policy.maxAttempts
  ) {
    return null;
  }
  const seconds = failure.category === "rate_limit"
    ? Math.min(
        policy.retryMaxSeconds,
        Math.max(1, failure.retryAfterSeconds ?? policy.retryBaseSeconds)
      )
    : Math.min(
        policy.retryMaxSeconds,
        policy.retryBaseSeconds * (2 ** Math.max(0, attemptCount - 1))
      );
  return new Date(at.getTime() + seconds * 1_000);
}

function validatePolicy(policy: BroadcastDeliveryExecutionPolicy): void {
  if (
    !integerBetween(policy.leaseSeconds, 10, 3_600)
    || !integerBetween(policy.maxAttempts, 1, 20)
    || !integerBetween(policy.retryBaseSeconds, 1, 300)
    || !integerBetween(
      policy.retryMaxSeconds,
      policy.retryBaseSeconds,
      86_400
    )
    || !integerBetween(policy.autoPauseMinimumAttempts, 10, 100_000)
    || !integerBetween(policy.autoPauseFailurePercent, 1, 100)
  ) {
    throw new InvalidBroadcastDeliveryExecutionError();
  }
}

function integerBetween(value: number, minimum: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}
