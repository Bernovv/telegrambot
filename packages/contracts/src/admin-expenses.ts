/**
 * Расходы мероприятия: подрядчики, статьи, смета и факт.
 *
 * Деньги везде в копейках строкой — как в заказах. Суммировать сотни строк в number нельзя
 * без потери точности, а показывать «34 499,99 ₽» вместо «34 500 ₽» в отчёте о расходах
 * значит потом искать копейку руками.
 */

export const VENDOR_KINDS = [
  "rent",
  "catering",
  "transport",
  "venue",
  "staff",
  "other"
] as const;

export type VendorKind = typeof VENDOR_KINDS[number];

/**
 * Что со строкой сметы:
 * `planned` — только запланировали, `committed` — договорились и подтвердили,
 * `paid` — заплатили, `cancelled` — отменили с причиной.
 */
export const EXPENSE_STATUSES = [
  "planned",
  "committed",
  "paid",
  "cancelled"
] as const;

export type ExpenseStatus = typeof EXPENSE_STATUSES[number];

export interface Vendor {
  readonly id: string;
  readonly name: string;
  readonly kind: VendorKind;
  readonly contactName: string | null;
  readonly phone: string | null;
  readonly telegram: string | null;
  readonly note: string;
  readonly isArchived: boolean;
  /** На скольких мероприятиях у него что-то заказывали — включая прошлые. */
  readonly expenseCount: number;
}

export interface ExpenseCategory {
  readonly code: string;
  readonly label: string;
  readonly position: number;
}

export interface EventExpense {
  readonly id: string;
  readonly categoryCode: string;
  readonly categoryLabel: string;
  readonly vendorId: string | null;
  readonly vendorName: string | null;
  readonly title: string;
  readonly quantity: string;
  readonly unit: string;
  readonly plannedKopecks: string;
  readonly actualKopecks: string | null;
  readonly status: ExpenseStatus;
  readonly paidAt: string | null;
  readonly paymentMethod: string | null;
  readonly note: string;
  readonly cancelledAt: string | null;
  readonly cancelledReason: string | null;
  readonly lockVersion: number;
}

export interface ExpenseCategoryTotals {
  readonly categoryCode: string;
  readonly categoryLabel: string;
  readonly plannedKopecks: string;
  readonly actualKopecks: string;
  readonly count: number;
}

export interface EventExpenseTotals {
  readonly plannedKopecks: string;
  readonly actualKopecks: string;
  /** Строк, где факта ещё нет: пока их больше нуля, расход посчитан не до конца. */
  readonly openCount: number;
  readonly cancelledCount: number;
}

export interface EventExpensesView {
  readonly eventId: string;
  readonly eventTitle: string;
  readonly calculatedAt: string;
  readonly totals: EventExpenseTotals;
  readonly byCategory: readonly ExpenseCategoryTotals[];
  readonly expenses: readonly EventExpense[];
  readonly categories: readonly ExpenseCategory[];
  readonly vendors: readonly Vendor[];
  readonly canManage: boolean;
}

export interface CreateVendorRequest {
  readonly name: string;
  readonly kind: VendorKind;
  readonly contactName?: string;
  readonly phone?: string;
  readonly telegram?: string;
  readonly note?: string;
}

export interface CreateEventExpenseRequest {
  readonly categoryCode: string;
  readonly vendorId?: string;
  readonly title: string;
  readonly quantity?: string;
  readonly unit?: string;
  readonly plannedKopecks: string;
  readonly note?: string;
}

export interface UpdateEventExpenseRequest {
  readonly expenseId: string;
  readonly lockVersion: number;
  readonly categoryCode?: string;
  readonly vendorId?: string | null;
  readonly title?: string;
  readonly quantity?: string;
  readonly unit?: string;
  readonly plannedKopecks?: string;
  readonly actualKopecks?: string | null;
  readonly status?: Exclude<ExpenseStatus, "cancelled">;
  readonly paidAt?: string | null;
  readonly paymentMethod?: string | null;
  readonly note?: string;
}

export interface CancelEventExpenseRequest {
  readonly expenseId: string;
  readonly lockVersion: number;
  readonly reason: string;
}
