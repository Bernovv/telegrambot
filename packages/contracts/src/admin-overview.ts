/**
 * Обзор мероприятия: деньги, люди и готовность на одном экране.
 *
 * Ничего не считает заново — собирает то, что уже посчитали вкладки «Участники»,
 * «Расходы», «Инвентарь» и «Команда». Своя арифметика здесь означала бы, что однажды
 * обзор и вкладка покажут разные числа.
 */

export interface EventOverviewMoney {
  readonly revenueKopecks: string;
  readonly revenueFromOrdersKopecks: string;
  readonly revenueFromManualKopecks: string;
  readonly expensesPlannedKopecks: string;
  readonly expensesActualKopecks: string;
  readonly profitKopecks: string;
  /** Расход внесён не целиком: прибыль завышена, доли вместе с ней. */
  readonly preliminary: boolean;
  readonly expensesWithoutActual: number;
  readonly organizers: readonly {
    readonly personName: string;
    readonly sharePercent: string;
    readonly shareKopecks: string;
  }[];
  readonly unallocatedKopecks: string;
}

export interface EventOverviewPeople {
  readonly capacity: number;
  readonly occupiedUnits: number;
  readonly people: number;
  readonly guests: number;
  readonly adults: number;
  readonly children: number;
  readonly sleepingPlaces: number;
  readonly fromOrders: number;
  readonly fromManual: number;
  readonly questionnaireAnswered: number;
  readonly questionnairePeople: number;
}

/** Пункт чек-листа готовности: что сделано, а что ещё нет и почему это важно. */
export interface EventOverviewReadinessItem {
  readonly code: string;
  readonly label: string;
  readonly done: boolean;
  readonly hint: string;
  /** Куда идти доделывать: сегмент вкладки внутри мероприятия. */
  readonly tab: string;
}

export interface EventOverview {
  readonly eventId: string;
  readonly eventTitle: string;
  readonly calculatedAt: string;
  /** Пусто, если у смотрящего нет права видеть финансы мероприятия. */
  readonly money: EventOverviewMoney | null;
  readonly people: EventOverviewPeople;
  readonly readiness: readonly EventOverviewReadinessItem[];
  readonly readinessDone: number;
}
