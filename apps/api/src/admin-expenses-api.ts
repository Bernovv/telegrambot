import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  DynamicModule,
  Get,
  Inject,
  Module,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import type { AdminEventExpensesService } from "@ticket-platform/application";
import { VENDOR_KINDS } from "@ticket-platform/contracts";
import { z } from "zod";
import {
  RequireAdminPermission,
  type AuthenticatedAdminRequest
} from "./admin-auth.js";

const ADMIN_EXPENSES = Symbol("ADMIN_EXPENSES");

const uuid = z.string().uuid();
// Копейки строкой: сумма за мероприятие в number не помещается без потери точности.
const kopecks = z.string().regex(/^\d{1,15}$/);
const quantity = z.string().regex(/^\d{1,6}(?:\.\d{1,3})?$/);
const categoryCode = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);

const vendorBody = z.object({
  name: z.string().trim().min(1).max(200),
  kind: z.enum(VENDOR_KINDS),
  contactName: z.string().trim().max(200).optional(),
  phone: z.string().trim().regex(/^\+[1-9][0-9]{7,14}$/).optional(),
  telegram: z.string().trim().max(100).optional(),
  note: z.string().trim().max(1000).optional()
}).strict();

const expenseBody = z.object({
  categoryCode,
  vendorId: uuid.optional(),
  title: z.string().trim().min(1).max(200),
  quantity: quantity.optional(),
  unit: z.string().trim().max(40).optional(),
  plannedKopecks: kopecks,
  note: z.string().trim().max(1000).optional()
}).strict();

// Отмена идёт своим путём: статус 'cancelled' здесь запрещён намеренно, чтобы оплаченный
// расход нельзя было погасить обычной правкой и без причины.
const updateExpenseBody = z.object({
  expenseId: uuid,
  lockVersion: z.number().int().min(1),
  categoryCode: categoryCode.optional(),
  vendorId: uuid.nullable().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  quantity: quantity.optional(),
  unit: z.string().trim().max(40).optional(),
  plannedKopecks: kopecks.optional(),
  actualKopecks: kopecks.nullable().optional(),
  status: z.enum(["planned", "committed", "paid"]).optional(),
  paidAt: z.string().datetime().nullable().optional(),
  paymentMethod: z.string().trim().min(1).max(80).nullable().optional(),
  note: z.string().trim().max(1000).optional()
}).strict();

const cancelExpenseBody = z.object({
  expenseId: uuid,
  lockVersion: z.number().int().min(1),
  reason: z.string().trim().min(3).max(500)
}).strict();

export type AdminExpensesHandler = Pick<
  AdminEventExpensesService,
  "summary" | "addVendor" | "addExpense" | "updateExpense" | "cancelExpense"
>;

@Controller("api/v1")
export class AdminExpensesController {
  constructor(
    @Inject(ADMIN_EXPENSES)
    private readonly handler: AdminExpensesHandler
  ) {}

  @Get("events/:eventId/expenses")
  @RequireAdminPermission("expenses.read")
  async summary(
    @Param("eventId") eventId: string,
    @Req() request: AuthenticatedAdminRequest
  ) {
    return execute(() =>
      this.handler.summary({
        actor: requireActor(request),
        eventId: parse(uuid, eventId)
      })
    );
  }

  @Post("vendors")
  @RequireAdminPermission("expenses.manage")
  async addVendor(
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(vendorBody, body);
    await execute(() =>
      this.handler.addVendor({
        actor: requireActor(request),
        name: parsed.name,
        kind: parsed.kind,
        ...defined("contactName", parsed.contactName),
        ...defined("phone", parsed.phone),
        ...defined("telegram", parsed.telegram),
        ...defined("note", parsed.note)
      })
    );
    return { added: true };
  }

  @Post("events/:eventId/expenses")
  @RequireAdminPermission("expenses.manage")
  async addExpense(
    @Param("eventId") eventId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(expenseBody, body);
    await execute(() =>
      this.handler.addExpense({
        actor: requireActor(request),
        eventId: parse(uuid, eventId),
        categoryCode: parsed.categoryCode,
        title: parsed.title,
        plannedKopecks: parsed.plannedKopecks,
        ...defined("vendorId", parsed.vendorId),
        ...defined("quantity", parsed.quantity),
        ...defined("unit", parsed.unit),
        ...defined("note", parsed.note)
      })
    );
    return { added: true };
  }

  @Post("events/:eventId/expenses/update")
  @RequireAdminPermission("expenses.manage")
  async updateExpense(
    @Param("eventId") eventId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(updateExpenseBody, body);
    await execute(() =>
      this.handler.updateExpense({
        actor: requireActor(request),
        eventId: parse(uuid, eventId),
        expenseId: parsed.expenseId,
        lockVersion: parsed.lockVersion,
        changes: {
          ...defined("categoryCode", parsed.categoryCode),
          ...defined("vendorId", parsed.vendorId),
          ...defined("title", parsed.title),
          ...defined("quantity", parsed.quantity),
          ...defined("unit", parsed.unit),
          ...defined("plannedKopecks", parsed.plannedKopecks),
          ...defined("actualKopecks", parsed.actualKopecks),
          ...defined("status", parsed.status),
          ...defined("paymentMethod", parsed.paymentMethod),
          ...defined("note", parsed.note),
          ...(parsed.paidAt !== undefined
            ? { paidAt: parsed.paidAt === null ? null : new Date(parsed.paidAt) }
            : {})
        }
      })
    );
    return { updated: true };
  }

  @Post("events/:eventId/expenses/cancel")
  @RequireAdminPermission("expenses.manage")
  async cancelExpense(
    @Param("eventId") eventId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(cancelExpenseBody, body);
    await execute(() =>
      this.handler.cancelExpense({
        actor: requireActor(request),
        eventId: parse(uuid, eventId),
        expenseId: parsed.expenseId,
        lockVersion: parsed.lockVersion,
        reason: parsed.reason
      })
    );
    return { cancelled: true };
  }
}

@Module({})
export class AdminExpensesApiModule {
  static register(handler: AdminExpensesHandler): DynamicModule {
    return {
      module: AdminExpensesApiModule,
      controllers: [AdminExpensesController],
      providers: [{ provide: ADMIN_EXPENSES, useValue: handler }]
    };
  }
}

/**
 * Не переданное поле и переданное пустым — разные вещи: у расхода `vendorId: null` значит
 * «убрать подрядчика», а отсутствие ключа — «не трогать». Строгий режим TypeScript их
 * различает, и раскладывать разобранное тело россыпью нельзя.
 */
function defined<K extends string, V>(
  key: K,
  value: V | undefined
): Record<K, V> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw invalidRequest();
  }
  return result.data;
}

function requireActor(
  request: AuthenticatedAdminRequest
): NonNullable<AuthenticatedAdminRequest["adminActor"]> {
  if (!request.adminActor) {
    throw new UnauthorizedException();
  }
  return request.adminActor;
}

function invalidRequest(): BadRequestException {
  return new BadRequestException({
    code: "INVALID_EXPENSE_REQUEST",
    title: "Данные расхода заполнены неверно"
  });
}

async function execute<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    if (error.message === "Event was not found") {
      throw new NotFoundException({
        code: "EVENT_NOT_FOUND",
        title: "Мероприятие не найдено"
      });
    }
    if (error.message === "Event expense was not found") {
      throw new NotFoundException({
        code: "EXPENSE_NOT_FOUND",
        title: "Расход не найден"
      });
    }
    if (error.message === "Event expense was changed by someone else") {
      throw new ConflictException({
        code: "EXPENSE_CONFLICT",
        title: "Расход уже изменили — обновите страницу"
      });
    }
    if (error.message === "Vendor with this name already exists") {
      throw new ConflictException({
        code: "VENDOR_EXISTS",
        title: "Подрядчик с таким названием уже заведён"
      });
    }
    if (
      error.message.startsWith("Administrator expenses ")
      || error.message.startsWith("Event expense request ")
    ) {
      throw invalidRequest();
    }
    throw error;
  }
}
