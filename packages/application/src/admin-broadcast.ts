import type { DomainEvent } from "@ticket-platform/domain";
import type { AdminRequestActor } from "@ticket-platform/contracts";
import type { IdGenerator, OutboxWriter, UnitOfWork } from "./identity.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AdminBroadcastOrderStatus =
  | "draft"
  | "awaiting_offer"
  | "awaiting_payment"
  | "payment_processing"
  | "paid"
  | "cancelled"
  | "expired"
  | "partially_refunded"
  | "refunded";

const ORDER_STATUSES: readonly AdminBroadcastOrderStatus[] = [
  "draft",
  "awaiting_offer",
  "awaiting_payment",
  "payment_processing",
  "paid",
  "cancelled",
  "expired",
  "partially_refunded",
  "refunded"
];

export type AdminBroadcastAudience = "orders" | "bot_users";

const AUDIENCES: readonly AdminBroadcastAudience[] = ["orders", "bot_users"];

/** Длина текста: без картинки это сообщение, с картинкой — подпись к фото. */
export const ADMIN_BROADCAST_TEXT_LIMIT = 3_500;
export const ADMIN_BROADCAST_CAPTION_LIMIT = 1_024;

export interface AdminBroadcastButton {
  readonly text: string;
  readonly url: string;
}

export interface CreateAdminBroadcastInput {
  readonly createdByAdminId: string;
  readonly messageText: string;
  readonly targetAudience: AdminBroadcastAudience;
  readonly targetEventId: string | null;
  readonly targetOrderStatus: AdminBroadcastOrderStatus | null;
  readonly button: AdminBroadcastButton | null;
  readonly imageId: string | null;
  readonly isTest: boolean;
}

export interface AdminBroadcastRepository {
  createBroadcast(input: CreateAdminBroadcastInput & { readonly id: string }): Promise<void>;
  imageExists(imageId: string): Promise<boolean>;
}

export interface CreateAdminBroadcastResult {
  readonly broadcastId: string;
}

/** Верхняя граница выборки получателей, та же, что у воркера при отправке. */
export const ADMIN_BROADCAST_AUDIENCE_LIMIT = 5_000;

export interface AdminBroadcastAudienceSelector {
  readonly targetAudience: AdminBroadcastAudience;
  readonly targetEventId: string | null;
  readonly targetOrderStatus: AdminBroadcastOrderStatus | null;
}

export interface AdminBroadcastAudienceRepository {
  countAudience(input: AdminBroadcastAudienceSelector): Promise<number>;
}

export interface CountAdminBroadcastAudienceResult {
  readonly recipientCount: number;
  readonly truncated: boolean;
  readonly limit: number;
}

export class CountAdminBroadcastAudienceService {
  constructor(private readonly repository: AdminBroadcastAudienceRepository) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly targetAudience?: string;
    readonly targetEventId?: string;
    readonly targetOrderStatus?: string;
  }): Promise<CountAdminBroadcastAudienceResult> {
    requireBroadcastPermission(input.actor);
    const recipientCount = await this.repository.countAudience(
      parseAudienceSelector(input)
    );

    return {
      recipientCount,
      truncated: recipientCount > ADMIN_BROADCAST_AUDIENCE_LIMIT,
      limit: ADMIN_BROADCAST_AUDIENCE_LIMIT
    };
  }
}

export interface AdminBroadcastSummary {
  readonly id: string;
  readonly status: "pending" | "sending" | "completed" | "cancelled";
  readonly isTest: boolean;
  readonly messageText: string;
  readonly targetAudience: AdminBroadcastAudience;
  readonly targetEventTitle: string | null;
  readonly targetOrderStatus: AdminBroadcastOrderStatus | null;
  readonly hasImage: boolean;
  readonly buttonText: string | null;
  readonly createdByAdminName: string | null;
  readonly recipientCount: number | null;
  readonly sentCount: number;
  readonly failedCount: number;
  readonly createdAt: string;
  readonly completedAt: string | null;
}

export interface AdminBroadcastHistoryRepository {
  listBroadcasts(limit: number): Promise<readonly AdminBroadcastSummary[]>;
}

/** Сколько последних рассылок показывает история. */
export const ADMIN_BROADCAST_HISTORY_LIMIT = 50;

export class ListAdminBroadcastsService {
  constructor(private readonly repository: AdminBroadcastHistoryRepository) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
  }): Promise<{ readonly items: readonly AdminBroadcastSummary[] }> {
    requireBroadcastPermission(input.actor);
    return { items: await this.repository.listBroadcasts(ADMIN_BROADCAST_HISTORY_LIMIT) };
  }
}

export class CreateAdminBroadcastService {
  constructor(
    private readonly repository: AdminBroadcastRepository,
    private readonly outboxWriter: OutboxWriter,
    private readonly unitOfWork: UnitOfWork,
    private readonly idGenerator: IdGenerator
  ) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly messageText: string;
    readonly targetAudience?: string;
    readonly targetEventId?: string;
    readonly targetOrderStatus?: string;
    readonly button?: { readonly text: string; readonly url: string };
    readonly imageId?: string;
    readonly isTest?: boolean;
    readonly now: Date;
  }): Promise<CreateAdminBroadcastResult> {
    requireBroadcastPermission(input.actor);
    const selector = parseAudienceSelector(input);
    const imageId = parseOptionalUuid(input.imageId, "Broadcast image ID is invalid");
    const messageText = parseMessageText(input.messageText, imageId !== null);
    const button = parseButton(input.button);
    if (Number.isNaN(input.now.getTime())) {
      throw new Error("Broadcast creation time is invalid");
    }

    // Ссылка на несуществующую картинку прошла бы внешним ключом, но упала бы у воркера уже
    // после того, как кампания создана и событие ушло в очередь.
    if (imageId !== null && !(await this.repository.imageExists(imageId))) {
      throw new Error("Broadcast image was not found");
    }

    const broadcastId = this.idGenerator.newId();

    return this.unitOfWork.transact(async () => {
      await this.repository.createBroadcast({
        id: broadcastId,
        createdByAdminId: input.actor.adminId,
        messageText,
        targetAudience: selector.targetAudience,
        targetEventId: selector.targetEventId,
        targetOrderStatus: selector.targetOrderStatus,
        button,
        imageId,
        isTest: input.isTest === true
      });
      await this.outboxWriter.append(broadcastRequestedEvent(broadcastId, this.idGenerator.newId(), input.now));
      return { broadcastId };
    });
  }
}

function broadcastRequestedEvent(
  broadcastId: string,
  eventId: string,
  occurredAt: Date
): DomainEvent {
  return {
    eventId,
    aggregateType: "admin_broadcast",
    aggregateId: broadcastId,
    eventType: "AdminBroadcastRequested",
    schemaVersion: 1,
    payload: { broadcastId },
    occurredAt
  };
}

function requireBroadcastPermission(actor: AdminRequestActor): void {
  if (actor.permission !== "broadcasts.send" || !UUID_PATTERN.test(actor.adminId)) {
    throw new Error("Administrator broadcast permission is invalid");
  }
}

function parseMessageText(value: string, hasImage: boolean): string {
  const trimmed = value.trim();
  const limit = hasImage ? ADMIN_BROADCAST_CAPTION_LIMIT : ADMIN_BROADCAST_TEXT_LIMIT;
  if (trimmed.length < 1 || trimmed.length > limit) {
    throw new Error("Broadcast message text is invalid");
  }
  return trimmed;
}

function parseAudienceSelector(input: {
  readonly targetAudience?: string;
  readonly targetEventId?: string;
  readonly targetOrderStatus?: string;
}): AdminBroadcastAudienceSelector {
  const targetAudience = parseAudience(input.targetAudience);
  const targetEventId = parseOptionalUuid(
    input.targetEventId,
    "Broadcast target event ID is invalid"
  );
  const targetOrderStatus = parseOptionalOrderStatus(input.targetOrderStatus);

  // Фильтры по заказам к «всем, кто открывал бота» неприменимы. Молча их проигнорировать —
  // значит показать в истории кампании условия, которые на отправку не влияли.
  if (targetAudience !== "orders" && (targetEventId !== null || targetOrderStatus !== null)) {
    throw new Error("Broadcast target audience does not accept order filters");
  }

  return { targetAudience, targetEventId, targetOrderStatus };
}

function parseAudience(value: string | undefined): AdminBroadcastAudience {
  if (value === undefined) {
    return "orders";
  }
  if (!(AUDIENCES as readonly string[]).includes(value)) {
    throw new Error("Broadcast target audience is invalid");
  }
  return value as AdminBroadcastAudience;
}

function parseButton(
  value: { readonly text: string; readonly url: string } | undefined
): AdminBroadcastButton | null {
  if (value === undefined) {
    return null;
  }
  const text = value.text.trim();
  if (text.length < 1 || text.length > 64) {
    throw new Error("Broadcast button text is invalid");
  }
  // Только https: Telegram откажется рисовать кнопку на другой схеме, а мы бы узнали об этом
  // на первом же получателе.
  if (!value.url.startsWith("https://") || value.url.length > 2_048) {
    throw new Error("Broadcast button URL is invalid");
  }
  return { text, url: value.url };
}

function parseOptionalUuid(value: string | undefined, message: string): string | null {
  if (value === undefined) {
    return null;
  }
  if (!UUID_PATTERN.test(value)) {
    throw new Error(message);
  }
  return value;
}

function parseOptionalOrderStatus(value: string | undefined): AdminBroadcastOrderStatus | null {
  if (value === undefined) {
    return null;
  }
  if (!(ORDER_STATUSES as readonly string[]).includes(value)) {
    throw new Error("Broadcast target order status is invalid");
  }
  return value as AdminBroadcastOrderStatus;
}
