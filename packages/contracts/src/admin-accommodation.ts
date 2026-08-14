/**
 * Сводка «что везём» и расселение по палаткам для одного мероприятия.
 *
 * Числа считаются на лету по оплаченным заказам — это отчёт, а не отдельная копия данных.
 * Единственное, что здесь хранится, — ручные объединения компаний и зафиксированные планы.
 */

export const EVENT_PARTICIPANT_SOURCES = [
  "max",
  "site",
  "direct",
  "timepad",
  "other"
] as const;

export type EventParticipantSource = typeof EVENT_PARTICIPANT_SOURCES[number];

export const EVENT_PARTICIPANT_FIELD_TYPES = [
  "text",
  "number",
  "date",
  "select"
] as const;

export type EventParticipantFieldType =
  typeof EVENT_PARTICIPANT_FIELD_TYPES[number];

export interface EventParticipantFieldDefinition {
  readonly id: string;
  readonly label: string;
  readonly type: EventParticipantFieldType;
  readonly options: readonly string[] | null;
  /** Поле действует на всех мероприятиях, а не только на этом. */
  readonly global: boolean;
}

export interface EventParticipantFieldValue {
  readonly fieldId: string;
  readonly label: string;
  readonly type: EventParticipantFieldType;
  readonly options: readonly string[] | null;
  readonly value: string | null;
}

export interface EventParticipant {
  readonly id: string;
  readonly displayName: string;
  readonly phone: string | null;
  /** У списков из Timepad это единственный признак: телефон там указывают не все. */
  readonly email: string | null;
  readonly source: EventParticipantSource;
  readonly ticketTitle: string;
  readonly adults: number;
  readonly children: number;
  readonly sleepingPlaces: number;
  readonly note: string;
  readonly outreachContactId: string | null;
  readonly amountKopecks: string | null;
  readonly paidAt: string | null;
  readonly paymentMethod: string | null;
  readonly customFields: readonly EventParticipantFieldValue[];
  readonly createdAt: string;
}

export interface CreateEventParticipantRequest {
  readonly displayName: string;
  readonly phone?: string;
  readonly source: EventParticipantSource;
  readonly ticketTitle?: string;
  readonly adults: number;
  readonly children: number;
  readonly sleepingPlaces: number;
  readonly note?: string;
  readonly outreachContactId?: string;
}

export interface UpdateEventParticipantRequest {
  readonly participantId: string;
  readonly displayName?: string;
  readonly phone?: string | null;
  readonly source?: EventParticipantSource;
  readonly ticketTitle?: string;
  readonly adults?: number;
  readonly children?: number;
  readonly sleepingPlaces?: number;
  readonly note?: string;
  readonly amountKopecks?: string | null;
  readonly paidAt?: string | null;
  readonly paymentMethod?: string | null;
}

export interface CreateEventParticipantFieldRequest {
  readonly label: string;
  readonly type: EventParticipantFieldType;
  readonly options?: readonly string[];
  readonly scope: "event" | "global";
}

export interface DeleteEventParticipantRequest {
  readonly participantId: string;
  readonly reason: string;
}

export interface ExcludeOrderRequest {
  readonly reason: string;
}

export interface AccommodationHeadcount {
  readonly guests: number;
  readonly adults: number;
  readonly children: number;
}

export interface AccommodationProductBreakdown {
  readonly productId: string;
  readonly title: string;
  readonly ticketsSold: number;
  readonly guests: number;
  readonly adults: number;
  readonly children: number;
  readonly sleepingPlaces: number;
  /** Строка собрана из заведённых руками участников, а не из заказов бота. */
  readonly manual: boolean;
}

export interface AccommodationPartyView {
  readonly key: string;
  readonly title: string;
  readonly berths: number;
  readonly orderNumbers: readonly string[];
  readonly orderIds: readonly string[];
  readonly merged: boolean;
  readonly groupId: string | null;
  readonly note: string;
  readonly tents: readonly number[];
  readonly emptyBerths: number;
  /** Человек попросил палатку на себя: о подселении его больше не спрашивают. */
  readonly privateTent: boolean;
}

export interface AccommodationTentCount {
  readonly capacity: number;
  readonly count: number;
}

export interface AccommodationMergeSuggestion {
  readonly singleParties: number;
  readonly tentsNow: number;
  readonly tentsIfMerged: number;
}

export interface AccommodationFixedPlan {
  readonly id: string;
  readonly fixedAt: string;
  readonly fixedByAdminName: string | null;
  readonly note: string;
  readonly requiredBerths: number;
  readonly totalTents: number;
  readonly tents: readonly AccommodationTentCount[];
}

export interface AccommodationSummary {
  readonly eventId: string;
  readonly eventTitle: string;
  readonly calculatedAt: string;
  /** Гости по оплаченным заказам целиком, включая тех, кто уезжает на ночь. */
  readonly headcount: AccommodationHeadcount;
  /** Сколько дней кормим — по датам мероприятия, минимум один. */
  readonly eventDays: number;
  readonly mealsAdult: number;
  readonly mealsChild: number;
  readonly products: readonly AccommodationProductBreakdown[];
  readonly tentCapacities: readonly number[];
  readonly parties: readonly AccommodationPartyView[];
  readonly tents: readonly AccommodationTentCount[];
  readonly totalTents: number;
  readonly requiredBerths: number;
  readonly plannedBerths: number;
  readonly emptyBerths: number;
  /** Компании из одного человека — по ним нужно решение о подселении. */
  readonly singles: readonly AccommodationPartyView[];
  readonly mergeSuggestion: AccommodationMergeSuggestion | null;
  readonly lastPlan: AccommodationFixedPlan | null;
  /** Гостей прибавилось после того, как план зафиксировали. */
  readonly berthsSinceLastPlan: number;
  /**
   * Дети в заказах с ночёвкой, у которых нет своего спального места: детский билет
   * ночёвку не включает. Система это не решает — показывает, чтобы спросили родителей.
   */
  readonly childrenWithoutBerth: number;
  /** Гости из оплаченных заказов Telegram-бота. */
  readonly guestsFromOrders: number;
  /** Гости, заведённые руками: MAX, сайт, договорились напрямую. */
  readonly guestsFromParticipants: number;
  /** Заказы, помеченные тестовыми: в счёт не идут, из истории не удалены. */
  readonly excludedOrders: number;
  readonly participants: readonly EventParticipant[];
  readonly participantFields: readonly EventParticipantFieldDefinition[];
  readonly canManage: boolean;
  readonly canManageParticipants: boolean;
}

export interface MergeAccommodationPartiesRequest {
  readonly orderIds: readonly string[];
  readonly note?: string;
}

export interface SetPrivateTentRequest {
  readonly orderId: string;
  readonly wanted: boolean;
  readonly note?: string;
}

export interface SplitAccommodationGroupRequest {
  readonly groupId: string;
}

export interface FixAccommodationPlanRequest {
  readonly note?: string;
}
