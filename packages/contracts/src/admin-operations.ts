import type { MessengerChannel } from "./telegram.js";
import type { OrderChannel } from "./orders.js";

// Панель берёт типы контрактов из этого файла (см. paths в apps/admin-web/tsconfig.json),
// поэтому каналы переэкспортируются здесь: колонка «Канал» есть и в списке людей, и в
// списке заказов.
export type { MessengerChannel, OrderChannel };

export const ADMIN_ORDER_STATUSES = [
  "draft",
  "awaiting_offer",
  "awaiting_payment",
  "payment_processing",
  "paid",
  "cancelled",
  "expired",
  "partially_refunded",
  "refunded"
] as const;

export type AdminOrderStatus = typeof ADMIN_ORDER_STATUSES[number];

export interface AdminUserSummary {
  readonly id: string;
  readonly displayName: string | null;
  readonly telegramUsername: string | null;
  /**
   * В каких мессенджерах человек к нам приходил.
   *
   * Список, а не одно значение: один и тот же человек может открыть и Telegram, и MAX, и
   * тогда «канал» у него не один. Пусто — не открывал ни одного: так выглядят те, кого
   * завели импортом или руками.
   */
  readonly channels: readonly MessengerChannel[];
  /**
   * Полный номер, без маскирования: менеджеру нужно позвонить человеку и найти его в списке
   * участников. Панель закрыта двухфакторной аутентификацией и RBAC, а каждое открытие
   * карточки видно в аудите — маскирование здесь давало ложное чувство защиты и мешало работе.
   */
  readonly phone: string | null;
  readonly phoneStatus: string;
  readonly isBlocked: boolean;
  readonly registeredAt: string;
  readonly lastSeenAt: string | null;
  readonly orderCount: number;
  readonly paidOrderCount: number;
  readonly walletAvailableKopecks: string;
  readonly walletHeldKopecks: string;
}

export interface AdminOrderSummary {
  readonly id: string;
  readonly number: string;
  readonly status: AdminOrderStatus;
  readonly userId: string;
  readonly userDisplayName: string | null;
  readonly eventId: string;
  readonly eventTitle: string;
  readonly totalKopecks: string;
  readonly walletAppliedKopecks: string;
  readonly externalDueKopecks: string;
  readonly currency: string;
  readonly ticketCount: number;
  /** Где оформлен заказ. По нему же уходит билет. */
  readonly channel: OrderChannel;
  readonly createdAt: string;
  readonly paidAt: string | null;
  /** Заказ скрыт из отчётов: тестовый, истёкший или ошибочный. */
  readonly excludedAt: string | null;
  readonly excludedReason: string | null;
}

export interface CursorPage<TItem> {
  readonly items: readonly TItem[];
  readonly nextCursor: string | null;
}

export interface AdminUserDetail extends AdminUserSummary {
  readonly identities: readonly {
    readonly channel: string;
    readonly externalUserId: string;
    readonly username: string | null;
    readonly firstSeenAt: string;
    readonly lastSeenAt: string;
    readonly isBotBlocked: boolean;
  }[];
  readonly contacts: readonly {
    readonly type: string;
    readonly value: string;
    readonly verificationStatus: string;
    readonly isPrimary: boolean;
  }[];
  /** Откуда пришёл человек: метка источника, кампания и код партнёра из диплинка. */
  readonly touchpoints: readonly {
    readonly channel: string;
    readonly source: string | null;
    readonly campaign: string | null;
    readonly partnerCode: string | null;
    readonly occurredAt: string;
    readonly isFirstTouch: boolean;
  }[];
  readonly walletAccounts: readonly {
    readonly currency: string;
    readonly availableKopecks: string;
    readonly heldKopecks: string;
    readonly status: string;
    readonly version: string;
  }[];
  readonly recentOrders: readonly AdminOrderSummary[];
}

export interface AdminOrderDetail extends AdminOrderSummary {
  readonly expiresAt: string;
  readonly source: string;
  readonly lockVersion: number;
  readonly items: readonly {
    readonly id: string;
    readonly title: string;
    readonly quantity: number;
    readonly unitPriceKopecks: string;
    readonly lineTotalKopecks: string;
  }[];
  readonly paymentAttempts: readonly {
    readonly id: string;
    readonly provider: string;
    readonly status: string;
    readonly amountKopecks: string;
    readonly currency: string;
    readonly providerStatus: string | null;
    readonly createdAt: string;
    readonly confirmedAt: string | null;
  }[];
  readonly tickets: readonly {
    readonly id: string;
    readonly number: string;
    readonly status: string;
    readonly issuedAt: string;
    readonly checkedInAt: string | null;
    readonly revokedAt: string | null;
  }[];
  readonly history: readonly {
    readonly fromStatus: string | null;
    readonly toStatus: string;
    readonly reason: string;
    readonly actorType: string;
    readonly occurredAt: string;
  }[];
}

export const ADMIN_MANUAL_PAYMENT_METHODS = [
  "cash",
  "bank_transfer",
  "other"
] as const;

export type AdminManualPaymentMethod =
  typeof ADMIN_MANUAL_PAYMENT_METHODS[number];

export interface ConfirmAdminManualPaymentRequest {
  readonly amountKopecks: string;
  readonly currency: string;
  readonly method: AdminManualPaymentMethod;
  readonly externalReference: string;
  readonly reason: string;
}

export interface ConfirmAdminManualPaymentResult {
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

export interface RequestAdminFullRefundRequest {
  readonly reason: string;
}

export interface RequestAdminFullRefundResult {
  readonly refundRequestId: string;
  readonly orderId: string;
  readonly status: string;
  readonly externalAmountKopecks: string;
  readonly walletAmountKopecks: string;
  readonly currency: string;
  readonly created: boolean;
}

export type AdminBroadcastAudience = "orders" | "bot_users";

export const ADMIN_BROADCAST_AUDIENCES: readonly AdminBroadcastAudience[] = [
  "orders",
  "bot_users"
];

/** Длина текста: без картинки это сообщение, с картинкой — подпись к фото. */
export const ADMIN_BROADCAST_TEXT_LIMIT = 3_500;
export const ADMIN_BROADCAST_CAPTION_LIMIT = 1_024;

export const ADMIN_BROADCAST_IMAGE_MAX_BYTES = 1_048_576;

export interface AdminBroadcastButton {
  readonly text: string;
  readonly url: string;
}

export interface CreateAdminBroadcastRequest {
  readonly messageText: string;
  readonly targetAudience?: AdminBroadcastAudience;
  readonly targetEventId?: string;
  readonly targetOrderStatus?: AdminOrderStatus;
  readonly button?: AdminBroadcastButton;
  readonly imageId?: string;
  readonly isTest?: boolean;
}

export interface CreateAdminBroadcastResult {
  readonly broadcastId: string;
}

export interface AdminBroadcastAudienceFilters {
  readonly targetAudience?: AdminBroadcastAudience;
  readonly targetEventId?: string;
  readonly targetOrderStatus?: AdminOrderStatus;
}

export interface AdminBroadcastAudienceResult {
  readonly recipientCount: number;
  readonly truncated: boolean;
  readonly limit: number;
}

export interface UploadAdminBroadcastImageRequest {
  readonly fileName: string;
  /** Содержимое файла в base64 — без префикса data:. */
  readonly contentBase64: string;
}

export interface UploadAdminBroadcastImageResult {
  readonly imageId: string;
  readonly mimeType: "image/png" | "image/jpeg";
  readonly byteSize: number;
  readonly width: number;
  readonly height: number;
}

export interface AdminBroadcastSummary {
  readonly id: string;
  readonly status: "pending" | "sending" | "completed" | "cancelled";
  readonly isTest: boolean;
  readonly messageText: string;
  readonly targetAudience: AdminBroadcastAudience;
  readonly targetEventTitle: string | null;
  readonly targetOrderStatus: AdminOrderStatus | null;
  readonly hasImage: boolean;
  readonly buttonText: string | null;
  readonly createdByAdminName: string | null;
  readonly recipientCount: number | null;
  readonly sentCount: number;
  readonly failedCount: number;
  readonly createdAt: string;
  readonly completedAt: string | null;
}

export interface AdminBroadcastListResult {
  readonly items: readonly AdminBroadcastSummary[];
}
