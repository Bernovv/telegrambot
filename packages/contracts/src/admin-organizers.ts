/**
 * Команда мероприятия и доли от прибыли.
 *
 * Прибыль = выручка (оплаченные заказы плюс заведённые руками участники) минус
 * фактические расходы. Ничего из этого не хранится: и то, и другое считается на лету по
 * тем же таблицам, что показывают вкладки «Участники» и «Расходы», — иначе три экрана
 * однажды показали бы три разные цифры.
 *
 * Фиксированных оплат у организатора нет: повар и фотограф с твёрдой ценой — это строка
 * расходов. Держать их сумму ещё и здесь значило бы посчитать её дважды.
 */

export interface EventOrganizer {
  readonly id: string;
  readonly personName: string;
  readonly roleLabel: string;
  readonly sharePercent: string;
  readonly responsibilities: string;
  readonly note: string;
  /** Доля этого человека в копейках. Отрицательная, если мероприятие ушло в минус. */
  readonly shareKopecks: string;
}

export interface EventProfit {
  readonly revenueKopecks: string;
  readonly revenueFromOrdersKopecks: string;
  readonly revenueFromManualKopecks: string;
  readonly expensesKopecks: string;
  readonly profitKopecks: string;
  /**
   * Расчёт предварительный: у части расходов ещё нет факта, поэтому прибыль завышена, а
   * доли вместе с ней.
   */
  readonly preliminary: boolean;
  readonly expensesWithoutActual: number;
}

export interface EventTeamView {
  readonly eventId: string;
  readonly eventTitle: string;
  readonly calculatedAt: string;
  readonly profit: EventProfit;
  readonly organizers: readonly EventOrganizer[];
  /** Сумма процентов. Меньше ста — часть прибыли никому не назначена. */
  readonly allocatedPercent: string;
  readonly unallocatedKopecks: string;
  readonly canManage: boolean;
}

export interface CreateEventOrganizerRequest {
  readonly personName: string;
  readonly roleLabel?: string;
  readonly sharePercent: string;
  readonly responsibilities?: string;
  readonly note?: string;
}

export interface UpdateEventOrganizerRequest {
  readonly organizerId: string;
  readonly personName?: string;
  readonly roleLabel?: string;
  readonly sharePercent?: string;
  readonly responsibilities?: string;
  readonly note?: string;
}

export interface RemoveEventOrganizerRequest {
  readonly organizerId: string;
}
