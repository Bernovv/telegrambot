/**
 * Сводка «что везём» и расселение по палаткам для одного мероприятия.
 *
 * Числа считаются на лету по оплаченным заказам — это отчёт, а не отдельная копия данных.
 * Единственное, что здесь хранится, — ручные объединения компаний и зафиксированные планы.
 */

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
  readonly canManage: boolean;
}

export interface MergeAccommodationPartiesRequest {
  readonly orderIds: readonly string[];
  readonly note?: string;
}

export interface SplitAccommodationGroupRequest {
  readonly groupId: string;
}

export interface FixAccommodationPlanRequest {
  readonly note?: string;
}
