/**
 * Переписка в карточке человека.
 *
 * Лента одна на все мессенджеры, и это главное свойство: человек, написавший вчера в MAX, а
 * сегодня в Telegram, ведёт с нами один разговор, а не два. Канал у каждой реплики свой и
 * виден, но порядок — общий, по времени.
 *
 * Диалоги при этом отдаются списком отдельно: у каждого своё состояние, свой ответственный
 * и свой чат, и отвечать придётся в конкретный, а не «в ленту».
 */

export type AdminConversationChannel = "telegram" | "max";

/** Бот или аккаунт компании. Для человека это два разных собеседника. */
export type AdminConversationTransport = "bot" | "account";

export type AdminConversationStatus = "open" | "closed";

export type AdminMessageDirection = "inbound" | "outbound";

export type AdminMessageAuthorKind = "client" | "manager" | "bot";

export type AdminMessageDeliveryStatus =
  | "received"
  | "queued"
  | "sent"
  | "delivered"
  | "failed";

export type AdminAttachmentKind =
  | "photo"
  | "video"
  | "voice"
  | "audio"
  | "document"
  | "sticker"
  | "contact"
  | "location"
  | "other";

export interface AdminConversationAttachment {
  readonly id: string;
  readonly kind: AdminAttachmentKind;
  readonly fileName: string | null;
  readonly mimeType: string | null;
  readonly sizeBytes: number | null;
  /**
   * Файл у нас и его можно открыть. `false` — либо ещё качается, либо не скачался вовсе;
   * в панели это разные подписи, поэтому рядом отдаётся и причина.
   */
  readonly isAvailable: boolean;
  readonly failureReason: string | null;
}

export interface AdminConversationMessage {
  readonly id: string;
  readonly conversationId: string;
  readonly channel: AdminConversationChannel;
  readonly transport: AdminConversationTransport;
  readonly direction: AdminMessageDirection;
  readonly authorKind: AdminMessageAuthorKind;
  readonly authorAdminId: string | null;
  /** Имя менеджера, «Бот» или имя человека — то, что подписывают под репликой. */
  readonly authorName: string;
  readonly body: string | null;
  readonly deliveryStatus: AdminMessageDeliveryStatus;
  readonly failureReason: string | null;
  /** Правка: человек переписал сказанное, и исходная реплика осталась выше по ленте. */
  readonly isEdit: boolean;
  readonly occurredAt: string;
  readonly attachments: readonly AdminConversationAttachment[];
}

export interface AdminConversationThread {
  readonly conversationId: string;
  readonly channel: AdminConversationChannel;
  readonly transport: AdminConversationTransport;
  readonly status: AdminConversationStatus;
  readonly assignedAdminId: string | null;
  readonly assignedAdminName: string | null;
  readonly lastMessageAt: string | null;
  readonly lastInboundAt: string | null;
  readonly messageCount: number;
}

export interface AdminPersonConversations {
  readonly threads: readonly AdminConversationThread[];
  /** Свежие сверху: панель разворачивает ленту сама. */
  readonly messages: readonly AdminConversationMessage[];
  /** Есть что показать дальше — панель дозапрашивает по `before`. */
  readonly hasMore: boolean;
}
