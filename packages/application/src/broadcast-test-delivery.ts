import type {
  AdminBroadcastContent,
  AdminBroadcastTestDelivery,
  AdminRequestActor,
  RequestAdminBroadcastTestSendRequest
} from "@ticket-platform/contracts";
import {
  buildAdminEventAuditContext,
  type AdminEventAuditContext,
  type AdminEventMutationMetadata
} from "./admin-event-management.js";
import type { BroadcastMessageSender } from "./broadcast-delivery.js";
import {
  InvalidBroadcastPersonalizationError,
  renderBroadcastContent,
  type BroadcastPersonalizationContext
} from "./broadcast-personalization.js";
import type { IdGenerator } from "./identity.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TELEGRAM_USER_ID_PATTERN = /^\d{1,20}$/;
const SAFE_ERROR_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,99}$/;

export interface ClaimedBroadcastTestDelivery {
  readonly deliveryId: string;
  readonly broadcastId: string;
  readonly recipientId: string;
  readonly schemaVersion: 1 | 2 | 3;
  readonly content: AdminBroadcastContent;
  readonly personalizationContext: BroadcastPersonalizationContext;
}

export interface BroadcastTestDeliveryRepository {
  request(input: {
    readonly deliveryId: string;
    readonly broadcastId: string;
    readonly expectedLockVersion: number;
    readonly recipientTelegramUserId: string;
    readonly requestedEventId: string;
    readonly audit: AdminEventAuditContext;
  }): Promise<
    | {
        readonly status: "queued";
        readonly value: AdminBroadcastTestDelivery;
      }
    | {
        readonly status:
          | "not_found"
          | "version_conflict"
          | "recipient_unavailable";
      }
  >;
  claimNext(input: {
    readonly workerId: string;
    readonly claimedAt: Date;
    readonly leaseSeconds: number;
    readonly uncertainEventId: string;
  }): Promise<ClaimedBroadcastTestDelivery | null>;
  markSent(input: {
    readonly delivery: ClaimedBroadcastTestDelivery;
    readonly workerId: string;
    readonly providerMessageId: string;
    readonly sentAt: Date;
    readonly lifecycleEventId: string;
  }): Promise<void>;
  markFailed(input: {
    readonly delivery: ClaimedBroadcastTestDelivery;
    readonly workerId: string;
    readonly errorCode: string;
    readonly failedAt: Date;
    readonly lifecycleEventId: string;
  }): Promise<void>;
}

export class InvalidAdminBroadcastTestSendError extends Error {
  constructor() {
    super("Administrator broadcast test send is invalid");
    this.name = "InvalidAdminBroadcastTestSendError";
  }
}

export class AdminBroadcastTestRecipientUnavailableError extends Error {
  constructor() {
    super("Telegram test recipient is unavailable");
    this.name = "AdminBroadcastTestRecipientUnavailableError";
  }
}

export class AdminBroadcastTestSendNotFoundError extends Error {
  constructor() {
    super("Administrator broadcast was not found for test send");
    this.name = "AdminBroadcastTestSendNotFoundError";
  }
}

export class AdminBroadcastTestSendVersionConflictError extends Error {
  constructor() {
    super("Administrator broadcast version is stale for test send");
    this.name = "AdminBroadcastTestSendVersionConflictError";
  }
}

export class RequestAdminBroadcastTestSendService {
  constructor(
    private readonly repository: BroadcastTestDeliveryRepository,
    private readonly idGenerator: IdGenerator
  ) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly broadcastId: string;
    readonly request: RequestAdminBroadcastTestSendRequest;
    readonly metadata: AdminEventMutationMetadata;
  }): Promise<AdminBroadcastTestDelivery> {
    requirePermission(input.actor);
    requireUuid(input.broadcastId);
    if (
      !Number.isSafeInteger(input.request.expectedLockVersion)
      || input.request.expectedLockVersion < 1
      || !TELEGRAM_USER_ID_PATTERN.test(
        input.request.recipientTelegramUserId
      )
    ) {
      throw new InvalidAdminBroadcastTestSendError();
    }
    const result = await this.repository.request({
      deliveryId: requireUuid(this.idGenerator.newId()),
      broadcastId: input.broadcastId,
      expectedLockVersion: input.request.expectedLockVersion,
      recipientTelegramUserId: input.request.recipientTelegramUserId,
      requestedEventId: requireUuid(this.idGenerator.newId()),
      audit: buildAudit(
        input.actor,
        input.request.reason,
        input.metadata,
        this.idGenerator
      )
    });
    if (result.status === "not_found") {
      throw new AdminBroadcastTestSendNotFoundError();
    }
    if (result.status === "version_conflict") {
      throw new AdminBroadcastTestSendVersionConflictError();
    }
    if (result.status === "recipient_unavailable") {
      throw new AdminBroadcastTestRecipientUnavailableError();
    }
    if (result.status !== "queued") {
      throw new InvalidAdminBroadcastTestSendError();
    }
    return result.value;
  }
}

export interface SendNextBroadcastTestDeliveryResult {
  readonly state: "idle" | "sent" | "failed";
  readonly broadcastId?: string;
  readonly deliveryId?: string;
}

export class SendNextBroadcastTestDeliveryService {
  constructor(
    private readonly repository: BroadcastTestDeliveryRepository,
    private readonly sender: BroadcastMessageSender,
    private readonly idGenerator: IdGenerator,
    private readonly leaseSeconds: number
  ) {
    if (
      !Number.isSafeInteger(leaseSeconds)
      || leaseSeconds < 10
      || leaseSeconds > 3_600
    ) {
      throw new InvalidAdminBroadcastTestSendError();
    }
  }

  async execute(input: {
    readonly workerId: string;
    readonly at: Date;
  }): Promise<SendNextBroadcastTestDeliveryResult> {
    if (
      !input.workerId
      || input.workerId.length > 200
      || Number.isNaN(input.at.getTime())
    ) {
      throw new InvalidAdminBroadcastTestSendError();
    }
    const delivery = await this.repository.claimNext({
      workerId: input.workerId,
      claimedAt: input.at,
      leaseSeconds: this.leaseSeconds,
      uncertainEventId: requireUuid(this.idGenerator.newId())
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
      await this.repository.markFailed({
        delivery,
        workerId: input.workerId,
        errorCode: error instanceof InvalidBroadcastPersonalizationError
          ? error.reason === "output_too_long"
            ? "BroadcastPersonalizationOutputTooLong"
            : "BroadcastPersonalizationInvalid"
          : safeErrorCode(error),
        failedAt: input.at,
        lifecycleEventId: requireUuid(this.idGenerator.newId())
      });
      return {
        state: "failed",
        broadcastId: delivery.broadcastId,
        deliveryId: delivery.deliveryId
      };
    }
    await this.repository.markSent({
      delivery,
      workerId: input.workerId,
      providerMessageId: sent.providerMessageId,
      sentAt: input.at,
      lifecycleEventId: requireUuid(this.idGenerator.newId())
    });
    return {
      state: "sent",
      broadcastId: delivery.broadcastId,
      deliveryId: delivery.deliveryId
    };
  }
}

function safeErrorCode(error: unknown): string {
  if (
    error
    && typeof error === "object"
    && "code" in error
    && typeof error.code === "string"
    && SAFE_ERROR_CODE_PATTERN.test(error.code)
  ) {
    return error.code;
  }
  return "BroadcastTestSendFailed";
}

function buildAudit(
  actor: AdminRequestActor,
  reason: string,
  metadata: AdminEventMutationMetadata,
  idGenerator: IdGenerator
): AdminEventAuditContext {
  try {
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 1 || normalizedReason.length > 500) {
      throw new Error("Invalid reason");
    }
    return buildAdminEventAuditContext(
      actor,
      normalizedReason,
      metadata,
      idGenerator
    );
  } catch {
    throw new InvalidAdminBroadcastTestSendError();
  }
}

function requirePermission(actor: AdminRequestActor): void {
  if (
    actor.permission !== "broadcasts.send"
    || !UUID_PATTERN.test(actor.adminId)
  ) {
    throw new InvalidAdminBroadcastTestSendError();
  }
}

function requireUuid(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new InvalidAdminBroadcastTestSendError();
  }
  return value;
}
