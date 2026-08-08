import type {
  AdminRequestActor,
  EventExpense,
  EventExpenseTotals,
  EventExpensesView,
  ExpenseCategory,
  ExpenseCategoryTotals,
  ExpenseStatus,
  Vendor,
  VendorKind
} from "@ticket-platform/contracts";
import type { IdGenerator } from "./identity.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KOPECKS_PATTERN = /^\d{1,15}$/;
const QUANTITY_PATTERN = /^\d{1,6}(?:\.\d{1,3})?$/;

/**
 * Расходы мероприятия.
 *
 * Смета и факт живут в одной строке: «планировали 30 000, отдали 34 500» — это одна запись
 * с двумя числами. Оплаченная строка не удаляется никогда — по расходам считаются доли
 * организаторов, и задним числом уменьшить их нельзя; ошиблись — отмена с причиной.
 */

export interface ExpensesEventRow {
  readonly id: string;
  readonly title: string;
}

export interface CreateVendorInput {
  readonly vendorId: string;
  readonly name: string;
  readonly kind: VendorKind;
  readonly contactName: string | null;
  readonly phone: string | null;
  readonly telegram: string | null;
  readonly note: string;
  readonly adminId: string;
}

export interface CreateExpenseInput {
  readonly expenseId: string;
  readonly eventId: string;
  readonly categoryCode: string;
  readonly vendorId: string | null;
  readonly title: string;
  readonly quantity: string;
  readonly unit: string;
  readonly plannedKopecks: string;
  readonly note: string;
  readonly adminId: string;
}

export interface UpdateExpenseInput {
  readonly eventId: string;
  readonly expenseId: string;
  readonly lockVersion: number;
  readonly auditId: string;
  readonly actorAdminId: string;
  readonly actorRole: string;
  readonly changes: {
    readonly categoryCode?: string;
    readonly vendorId?: string | null;
    readonly title?: string;
    readonly quantity?: string;
    readonly unit?: string;
    readonly plannedKopecks?: string;
    readonly actualKopecks?: string | null;
    readonly status?: Exclude<ExpenseStatus, "cancelled">;
    readonly paidAt?: Date | null;
    readonly paymentMethod?: string | null;
    readonly note?: string;
  };
}

export interface CancelExpenseInput {
  readonly eventId: string;
  readonly expenseId: string;
  readonly lockVersion: number;
  readonly reason: string;
  readonly auditId: string;
  readonly actorAdminId: string;
  readonly actorRole: string;
  readonly cancelledAt: Date;
}

export type ExpenseWriteOutcome = "applied" | "conflict" | "missing";

export interface AdminEventExpensesRepository {
  findEvent(eventId: string): Promise<ExpensesEventRow | null>;
  listExpenses(eventId: string): Promise<readonly EventExpense[]>;
  listCategories(): Promise<readonly ExpenseCategory[]>;
  listVendors(): Promise<readonly Vendor[]>;
  hasPermission(adminId: string, permission: string): Promise<boolean>;
  createVendor(input: CreateVendorInput): Promise<boolean>;
  createExpense(input: CreateExpenseInput): Promise<void>;
  updateExpense(input: UpdateExpenseInput): Promise<ExpenseWriteOutcome>;
  cancelExpense(input: CancelExpenseInput): Promise<ExpenseWriteOutcome>;
}

export interface ExpensesClock {
  now(): Date;
}

export class ExpensesEventNotFoundError extends Error {
  constructor() {
    super("Event was not found");
    this.name = "ExpensesEventNotFoundError";
  }
}

export class ExpenseNotFoundError extends Error {
  constructor() {
    super("Event expense was not found");
    this.name = "ExpenseNotFoundError";
  }
}

export class ExpenseConflictError extends Error {
  constructor() {
    super("Event expense was changed by someone else");
    this.name = "ExpenseConflictError";
  }
}

export class VendorAlreadyExistsError extends Error {
  constructor() {
    super("Vendor with this name already exists");
    this.name = "VendorAlreadyExistsError";
  }
}

export class AdminEventExpensesService {
  constructor(
    private readonly repository: AdminEventExpensesRepository,
    private readonly clock: ExpensesClock,
    private readonly idGenerator: IdGenerator
  ) {}

  async summary(input: {
    readonly actor: AdminRequestActor;
    readonly eventId: string;
  }): Promise<EventExpensesView> {
    requirePermission(input.actor, "expenses.read");
    requireUuid(input.eventId);

    const event = await this.repository.findEvent(input.eventId);
    if (!event) {
      throw new ExpensesEventNotFoundError();
    }

    const [expenses, categories, vendors, canManage] = await Promise.all([
      this.repository.listExpenses(input.eventId),
      this.repository.listCategories(),
      this.repository.listVendors(),
      this.repository.hasPermission(input.actor.adminId, "expenses.manage")
    ]);

    return buildExpensesView({
      event,
      expenses,
      categories,
      vendors,
      canManage,
      calculatedAt: this.clock.now()
    });
  }

  async addVendor(input: {
    readonly actor: AdminRequestActor;
    readonly name: string;
    readonly kind: VendorKind;
    readonly contactName?: string;
    readonly phone?: string;
    readonly telegram?: string;
    readonly note?: string;
  }): Promise<void> {
    requirePermission(input.actor, "expenses.manage");

    const name = input.name.trim();
    if (name.length < 1 || name.length > 200) {
      throw new Error("Event expense request is invalid");
    }
    const phone = optionalText(input.phone, 20);
    if (phone !== null && !/^\+[1-9][0-9]{7,14}$/.test(phone)) {
      throw new Error("Event expense request is invalid");
    }

    const created = await this.repository.createVendor({
      vendorId: this.idGenerator.newId(),
      name,
      kind: input.kind,
      contactName: optionalText(input.contactName, 200),
      phone,
      telegram: optionalText(input.telegram, 100),
      note: (input.note ?? "").trim().slice(0, 1000),
      adminId: input.actor.adminId
    });
    if (!created) {
      throw new VendorAlreadyExistsError();
    }
  }

  async addExpense(input: {
    readonly actor: AdminRequestActor;
    readonly eventId: string;
    readonly categoryCode: string;
    readonly vendorId?: string;
    readonly title: string;
    readonly quantity?: string;
    readonly unit?: string;
    readonly plannedKopecks: string;
    readonly note?: string;
  }): Promise<void> {
    requirePermission(input.actor, "expenses.manage");
    requireUuid(input.eventId);
    if (input.vendorId !== undefined) {
      requireUuid(input.vendorId);
    }

    const title = input.title.trim();
    if (title.length < 1 || title.length > 200) {
      throw new Error("Event expense request is invalid");
    }
    requireKopecks(input.plannedKopecks);
    const quantity = input.quantity ?? "1";
    requireQuantity(quantity);

    const event = await this.repository.findEvent(input.eventId);
    if (!event) {
      throw new ExpensesEventNotFoundError();
    }

    await this.repository.createExpense({
      expenseId: this.idGenerator.newId(),
      eventId: input.eventId,
      categoryCode: input.categoryCode,
      vendorId: input.vendorId ?? null,
      title,
      quantity,
      unit: (input.unit ?? "").trim().slice(0, 40),
      plannedKopecks: input.plannedKopecks,
      note: (input.note ?? "").trim().slice(0, 1000),
      adminId: input.actor.adminId
    });
  }

  async updateExpense(input: {
    readonly actor: AdminRequestActor;
    readonly eventId: string;
    readonly expenseId: string;
    readonly lockVersion: number;
    readonly changes: UpdateExpenseInput["changes"];
  }): Promise<void> {
    requirePermission(input.actor, "expenses.manage");
    requireUuid(input.eventId);
    requireUuid(input.expenseId);
    requireLockVersion(input.lockVersion);

    const changes = input.changes;
    if (changes.title !== undefined) {
      const title = changes.title.trim();
      if (title.length < 1 || title.length > 200) {
        throw new Error("Event expense request is invalid");
      }
    }
    if (changes.plannedKopecks !== undefined) {
      requireKopecks(changes.plannedKopecks);
    }
    if (changes.actualKopecks !== undefined && changes.actualKopecks !== null) {
      requireKopecks(changes.actualKopecks);
    }
    if (changes.quantity !== undefined) {
      requireQuantity(changes.quantity);
    }
    if (changes.vendorId !== undefined && changes.vendorId !== null) {
      requireUuid(changes.vendorId);
    }
    // «Оплачено» без суммы и даты — это не оплачено, а забытая строка, которая тихо
    // выпадет из фактических расходов и завысит прибыль.
    if (changes.status === "paid") {
      if (changes.actualKopecks === undefined || changes.actualKopecks === null) {
        throw new Error("Event expense request is invalid");
      }
      if (changes.paidAt === undefined || changes.paidAt === null) {
        throw new Error("Event expense request is invalid");
      }
    }

    const outcome = await this.repository.updateExpense({
      eventId: input.eventId,
      expenseId: input.expenseId,
      lockVersion: input.lockVersion,
      auditId: this.idGenerator.newId(),
      actorAdminId: input.actor.adminId,
      actorRole: input.actor.roleCodes[0] ?? "unknown",
      changes: {
        ...changes,
        ...(changes.title !== undefined ? { title: changes.title.trim() } : {})
      }
    });
    raiseOutcome(outcome);
  }

  async cancelExpense(input: {
    readonly actor: AdminRequestActor;
    readonly eventId: string;
    readonly expenseId: string;
    readonly lockVersion: number;
    readonly reason: string;
  }): Promise<void> {
    requirePermission(input.actor, "expenses.manage");
    requireUuid(input.eventId);
    requireUuid(input.expenseId);
    requireLockVersion(input.lockVersion);

    const reason = input.reason.trim();
    if (reason.length < 3 || reason.length > 500) {
      throw new Error("Event expense request is invalid");
    }

    const outcome = await this.repository.cancelExpense({
      eventId: input.eventId,
      expenseId: input.expenseId,
      lockVersion: input.lockVersion,
      reason,
      auditId: this.idGenerator.newId(),
      actorAdminId: input.actor.adminId,
      actorRole: input.actor.roleCodes[0] ?? "unknown",
      cancelledAt: this.clock.now()
    });
    raiseOutcome(outcome);
  }
}

export interface ExpensesViewInput {
  readonly event: ExpensesEventRow;
  readonly expenses: readonly EventExpense[];
  readonly categories: readonly ExpenseCategory[];
  readonly vendors: readonly Vendor[];
  readonly canManage: boolean;
  readonly calculatedAt: Date;
}

export function buildExpensesView(input: ExpensesViewInput): EventExpensesView {
  const perCategory = new Map<string, {
    label: string;
    planned: bigint;
    actual: bigint;
    count: number;
  }>();

  let planned = 0n;
  let actual = 0n;
  let openCount = 0;
  let cancelledCount = 0;

  for (const expense of input.expenses) {
    // Отменённая строка остаётся видна, но ни в смету, ни в факт не идёт: иначе доли
    // организаторов посчитались бы от денег, которых не тратили.
    if (expense.status === "cancelled") {
      cancelledCount += 1;
      continue;
    }

    const expensePlanned = BigInt(expense.plannedKopecks);
    const expenseActual = expense.actualKopecks === null
      ? 0n
      : BigInt(expense.actualKopecks);
    planned += expensePlanned;
    actual += expenseActual;
    if (expense.actualKopecks === null) {
      openCount += 1;
    }

    const bucket = perCategory.get(expense.categoryCode) ?? {
      label: expense.categoryLabel,
      planned: 0n,
      actual: 0n,
      count: 0
    };
    bucket.planned += expensePlanned;
    bucket.actual += expenseActual;
    bucket.count += 1;
    perCategory.set(expense.categoryCode, bucket);
  }

  const positions = new Map(
    input.categories.map((category) => [category.code, category.position])
  );

  const byCategory: ExpenseCategoryTotals[] = [...perCategory.entries()]
    .map(([code, bucket]) => ({
      categoryCode: code,
      categoryLabel: bucket.label,
      plannedKopecks: bucket.planned.toString(),
      actualKopecks: bucket.actual.toString(),
      count: bucket.count
    }))
    .sort((left, right) =>
      (positions.get(left.categoryCode) ?? 999)
      - (positions.get(right.categoryCode) ?? 999));

  const totals: EventExpenseTotals = {
    plannedKopecks: planned.toString(),
    actualKopecks: actual.toString(),
    openCount,
    cancelledCount
  };

  return {
    eventId: input.event.id,
    eventTitle: input.event.title,
    calculatedAt: input.calculatedAt.toISOString(),
    totals,
    byCategory,
    expenses: input.expenses,
    categories: input.categories,
    vendors: input.vendors,
    canManage: input.canManage
  };
}

function raiseOutcome(outcome: ExpenseWriteOutcome): void {
  if (outcome === "missing") {
    throw new ExpenseNotFoundError();
  }
  if (outcome === "conflict") {
    throw new ExpenseConflictError();
  }
}

function optionalText(value: string | undefined, max: number): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed.slice(0, max);
}

function requirePermission(
  actor: AdminRequestActor,
  permission: "expenses.read" | "expenses.manage"
): void {
  if (actor.permission !== permission || !UUID_PATTERN.test(actor.adminId)) {
    throw new Error("Administrator expenses permission is invalid");
  }
}

function requireUuid(value: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new Error("Event expense request is invalid");
  }
}

function requireKopecks(value: string): void {
  if (!KOPECKS_PATTERN.test(value)) {
    throw new Error("Event expense request is invalid");
  }
}

function requireQuantity(value: string): void {
  if (!QUANTITY_PATTERN.test(value) || Number(value) <= 0) {
    throw new Error("Event expense request is invalid");
  }
}

function requireLockVersion(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("Event expense request is invalid");
  }
}
