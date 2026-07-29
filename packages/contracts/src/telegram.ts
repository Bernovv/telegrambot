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
      readonly userId: string;
      readonly eventId: string;
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

export type ScenarioPresentationButton =
  | {
      readonly text: string;
      readonly edgeId: string;
    }
  | {
      readonly text: string;
      readonly callbackData: string;
    }
  | {
      readonly text: string;
      readonly url: string;
    };

export interface ScenarioPresentationModel {
  readonly text: string;
  readonly buttons: readonly ScenarioPresentationButton[];
}

export interface TelegramEventChoice {
  readonly eventId: string;
  readonly title: string;
  readonly startsAt: string;
  readonly timezone: string;
  readonly locationName: string | null;
  readonly minimumPriceKopecks: string | null;
  readonly currency: string | null;
  readonly salesStatus: "published" | "sales_paused" | "sold_out";
}

export interface StartTelegramScenarioCommand {
  readonly userId: string;
  readonly messengerIdentityId: string;
  readonly eventSlug: string | null;
  readonly updateId: string;
  readonly occurredAt: Date;
}

export type StartTelegramScenarioResult =
  | {
      readonly handled: false;
      readonly reason: "event_selection_required";
      readonly events: readonly TelegramEventChoice[];
      readonly hasMoreEvents: boolean;
    }
  | {
      readonly handled: false;
      readonly reason:
        | "event_not_found"
        | "participant_not_found"
        | "scenario_not_published"
        | "scenario_invalid";
    }
  | {
      readonly handled: true;
      readonly duplicate: boolean;
      readonly sessionId: string;
      readonly status: "waiting_input" | "completed" | "blocked";
      readonly presentations: readonly ScenarioPresentationModel[];
    };

export interface SelectTelegramEventCommand {
  readonly eventId: string;
  readonly senderExternalUserId: string;
  readonly updateId: string;
  readonly callbackQueryId: string;
  readonly occurredAt: Date;
}

export type SelectTelegramEventResult = StartTelegramScenarioResult;

export interface AdvanceTelegramScenarioCommand {
  readonly sessionId: string;
  readonly edgeId: string;
  readonly senderExternalUserId: string;
  readonly updateId: string;
  readonly callbackQueryId: string;
  readonly occurredAt: Date;
}

export type AdvanceTelegramScenarioResult =
  | {
      readonly accepted: false;
      readonly reason:
        | "session_not_found"
        | "session_not_waiting"
        | "invalid_transition";
    }
  | {
      readonly accepted: true;
      readonly duplicate: boolean;
      readonly sessionId: string;
      readonly status: "waiting_input" | "completed" | "blocked";
      readonly presentations: readonly ScenarioPresentationModel[];
    };

export interface SubmitTelegramScenarioInputCommand {
  readonly senderExternalUserId: string;
  readonly updateId: string;
  readonly text: string;
  readonly occurredAt: Date;
}

export type SubmitTelegramScenarioInputResult =
  | {
      readonly handled: false;
      readonly reason: "input_not_expected" | "input_ambiguous";
    }
  | {
      readonly handled: true;
      readonly accepted: boolean;
      readonly duplicate: boolean;
      readonly sessionId: string;
      readonly status: "waiting_input" | "completed" | "blocked";
      readonly presentations: readonly ScenarioPresentationModel[];
    };

export interface ResumeTelegramScenarioAfterOfferCommand {
  readonly orderId: string;
  readonly senderExternalUserId: string;
  readonly updateId: string;
  readonly occurredAt: Date;
}

export type ResumeTelegramScenarioAfterOfferResult =
  | {
      readonly handled: false;
      readonly reason: "action_not_expected" | "action_ambiguous";
    }
  | {
      readonly handled: true;
      readonly duplicate: boolean;
      readonly sessionId: string;
      readonly status: "waiting_input" | "completed" | "blocked";
      readonly presentations: readonly ScenarioPresentationModel[];
    };

export interface ResumeTelegramScenarioAfterPaymentCommand {
  readonly orderId: string;
  readonly sourceEventId: string;
  readonly occurredAt: Date;
}

export type ResumeTelegramScenarioAfterPaymentResult =
  | {
      readonly handled: false;
      readonly reason: "action_not_expected" | "action_ambiguous";
    }
  | {
      readonly handled: true;
      readonly duplicate: boolean;
      readonly sessionId: string;
      readonly status: "waiting_input" | "completed" | "blocked";
      readonly presentations: readonly ScenarioPresentationModel[];
    };
