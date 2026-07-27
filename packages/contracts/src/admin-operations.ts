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
  readonly phoneMasked: string | null;
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
  readonly createdAt: string;
  readonly paidAt: string | null;
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
    readonly valueMasked: string;
    readonly verificationStatus: string;
    readonly isPrimary: boolean;
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

export interface CreateAdminBroadcastRequest {
  readonly messageText: string;
  readonly targetEventId?: string;
  readonly targetOrderStatus?: AdminOrderStatus;
}

export interface CreateAdminBroadcastResult {
  readonly broadcastId: string;
}
