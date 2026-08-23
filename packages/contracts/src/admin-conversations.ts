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

/**
 * Можно ли отвечать в эту ветку.
 *
 * Единственное «нельзя» сегодня — **бот MAX**. Решение владельца от 23.08.2026: в MAX
 * разговаривает аккаунт компании, а бот только продаёт билеты. Если ответить можно двумя
 * способами, половина ответов уйдёт мимо аккаунта, и человек увидит у себя двух
 * собеседников вместо одного.
 *
 * Входящее в бота при этом продолжает записываться: человек напишет ему независимо от
 * наших планов — хотя бы в ответ на билет, — и терять сказанное нельзя. Ветка видна, она
 * просто только для чтения.
 *
 * Правило лежит в договорённостях, а не в панели: панель прячет поле ответа, а отказывает
 * сервер. Панель — это удобство, а не запрет.
 */
export function conversationAcceptsReply(
  channel: AdminConversationChannel,
  transport: AdminConversationTransport
): boolean {
  return !(channel === "max" && transport === "bot");
}

/** Почему в ветку нельзя ответить. Текст видит менеджер, поэтому он про дело. */
export const MAX_BOT_READ_ONLY_REASON =
  "В MAX отвечает аккаунт компании, а не бот. Ветка бота — только для чтения:"
  + " ответьте в ветке «MAX · аккаунт».";

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

/**
 * Чем кончилась попытка ответить.
 *
 * `assigned_to_other` — не ошибка, а развилка: диалог ведёт коллега, и решение перехватить
 * его принимает человек. Поэтому имя коллеги приходит обычным ответом, а не текстом ошибки:
 * панели нужно спросить внятно, а через ошибку структура не проходит.
 */
export type ConversationReplyResult =
  | { readonly status: "queued"; readonly messageId: string }
  | { readonly status: "assigned_to_other"; readonly assignedAdminName: string }
  /**
   * В эту ветку отвечать нельзя. Сегодня это только бот MAX: там разговаривает аккаунт
   * компании, а бот продаёт билеты. Причина приходит текстом — её показывают менеджеру.
   */
  | { readonly status: "read_only"; readonly reason: string };

/**
 * Файл, отправляемый из панели.
 *
 * Содержимое идёт base64 внутри JSON — тем же путём, что картинка рассылки. Multipart был бы
 * экономнее на треть, но потребовал бы отдельной обработки в прокси панели ради одной ручки.
 */
export interface SendConversationFileRequest {
  readonly fileName: string;
  readonly mimeType: string;
  readonly contentBase64: string;
  readonly caption?: string;
  readonly takeOver?: boolean;
}
