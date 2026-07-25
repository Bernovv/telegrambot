export interface TelegramStartUser {
  readonly externalUserId: string;
  readonly username?: string | null;
  readonly firstName?: string | null;
  readonly lastName?: string | null;
  readonly languageCode?: string | null;
}

export interface HandleTelegramStartCommand {
  readonly updateId: string;
  readonly user: TelegramStartUser;
  readonly startPayload?: string | null;
  readonly receivedAt: Date;
}

export interface HandleTelegramStartResult {
  readonly userId: string;
  readonly messengerIdentityId: string;
  readonly isNewUser: boolean;
  readonly phoneRequired: boolean;
  readonly selectedEventSlug: string | null;
}

export interface TelegramContactPayload {
  readonly phoneNumber: string;
  readonly externalUserId?: string | null;
}

export interface HandleTelegramContactCommand {
  readonly updateId: string;
  readonly senderExternalUserId: string;
  readonly contact: TelegramContactPayload;
  readonly receivedAt: Date;
}

export type HandleTelegramContactResult =
  | {
      readonly accepted: false;
      readonly reason: "third_party_contact";
    }
  | {
      readonly accepted: true;
      readonly phoneNewlyVerified: boolean;
      readonly bonusCredited: boolean;
      readonly bonusReason: "credited" | "already_credited" | "campaign_inactive";
      readonly bonusAmountKopecks: string;
      readonly availableBalanceKopecks: string;
    };

export interface AcceptTelegramOfferCommand {
  readonly publicOrderToken: string;
  readonly senderExternalUserId: string;
  readonly updateId: string;
  readonly callbackQueryId: string;
  readonly messageId: string | null;
  readonly acceptedAt: Date;
}

export type AcceptTelegramOfferResult =
  | {
      readonly accepted: true;
      readonly newlyAccepted: boolean;
      readonly orderId: string;
      readonly orderNumber: string;
      readonly currency: string;
      readonly totalKopecks: string;
      readonly walletAppliedKopecks: string;
      readonly externalDueKopecks: string;
    }
  | {
      readonly accepted: false;
      readonly reason:
        | "order_not_found"
        | "order_expired"
        | "order_not_acceptable"
        | "offer_unavailable";
    };

export interface InitializeTelegramPaymentCommand {
  readonly publicOrderToken: string;
  readonly senderExternalUserId: string;
  readonly updateId: string;
  readonly requestedAt: Date;
}

export type InitializeTelegramPaymentResult =
  | {
      readonly initialized: true;
      readonly paymentUrl: string;
      readonly orderNumber: string;
      readonly amountKopecks: string;
      readonly currency: string;
    }
  | {
      readonly initialized: false;
      readonly reason:
        | "order_not_found"
        | "payment_unavailable"
        | "initialization_in_progress";
    };

export interface ListTelegramTicketsCommand {
  readonly senderExternalUserId: string;
}

export interface TelegramTicketSummary {
  readonly ticketId: string;
  readonly ticketNumber: string;
  readonly orderNumber: string;
  readonly eventTitle: string;
  readonly status: "issued" | "checked_in" | "revoked" | "refunded";
  readonly issuedAt: string;
}

export interface ListTelegramTicketsResult {
  readonly identityFound: boolean;
  readonly tickets: readonly TelegramTicketSummary[];
}

export interface RequestTelegramTicketRedeliveryCommand {
  readonly ticketId: string;
  readonly senderExternalUserId: string;
  readonly updateId: string;
  readonly requestedAt: Date;
}

export type RequestTelegramTicketRedeliveryResult =
  | {
      readonly accepted: true;
      readonly newlyRequested: boolean;
      readonly ticketNumber: string;
    }
  | {
      readonly accepted: false;
      readonly reason: "ticket_unavailable";
    };
