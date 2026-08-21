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
  Post,
  Query,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import type { AdminStaffService } from "@ticket-platform/application";
import { LastHeadError } from "@ticket-platform/application";
import { STAFF_ROLES } from "@ticket-platform/contracts";
import { z } from "zod";
import {
  RequireAdminPermission,
  type AuthenticatedAdminRequest
} from "./admin-auth.js";

const ADMIN_STAFF = Symbol("ADMIN_STAFF");

const uuid = z.string().uuid();

const roleBody = z.object({
  adminId: uuid,
  role: z.enum(STAFF_ROLES),
  granted: z.boolean()
}).strict();

const slotsBody = z.object({
  mentorAdminId: uuid,
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  hours: z.array(z.number().int().min(0).max(23)).min(1).max(24),
  durationMinutes: z.number().int().min(15).max(480).optional()
}).strict();

const slotIdBody = z.object({ slotId: uuid }).strict();

const bookBody = z.object({
  slotId: uuid,
  contactId: uuid,
  note: z.string().trim().max(500).optional()
}).strict();

const slotQuery = z.object({
  mentorAdminId: uuid.optional(),
  onlyFree: z.enum(["true", "false"]).optional(),
  from: z.string().optional(),
  to: z.string().optional()
}).strict();

export type AdminStaffHandler = Pick<
  AdminStaffService,
  "view" | "setRole" | "listSlots" | "createSlots" | "cancelSlot" | "bookSlot"
  | "releaseSlot"
>;

/**
 * Команда кабинета.
 *
 * Путь `staff`, а не `team`: `events/:id/team` уже занято командой мероприятия и долями
 * от прибыли. Одно слово на две разные вещи в адресах — способ однажды отправить запрос
 * не туда.
 */
@Controller("api/v1/staff")
export class AdminStaffController {
  constructor(
    @Inject(ADMIN_STAFF)
    private readonly handler: AdminStaffHandler
  ) {}

  @Get()
  @RequireAdminPermission("team.read")
  async view(@Req() request: AuthenticatedAdminRequest) {
    return execute(() => this.handler.view({ actor: requireActor(request) }));
  }

  @Post("roles")
  @RequireAdminPermission("team.manage")
  async setRole(
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(roleBody, body);
    return execute(() =>
      this.handler.setRole({
        actor: requireActor(request),
        adminId: parsed.adminId,
        role: parsed.role,
        granted: parsed.granted
      })
    );
  }

  @Get("slots")
  @RequireAdminPermission("team.read")
  async listSlots(
    @Query() query: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(slotQuery, query ?? {});
    return execute(() =>
      this.handler.listSlots({
        actor: requireActor(request),
        filters: {
          ...defined("mentorAdminId", parsed.mentorAdminId),
          ...(parsed.onlyFree === undefined
            ? {}
            : { onlyFree: parsed.onlyFree === "true" }),
          ...defined("from", parsed.from),
          ...defined("to", parsed.to)
        }
      })
    );
  }

  @Post("slots")
  @RequireAdminPermission("mentor_slots.manage")
  async createSlots(
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(slotsBody, body);
    return execute(() =>
      this.handler.createSlots({
        actor: requireActor(request),
        mentorAdminId: parsed.mentorAdminId,
        fromDate: parsed.fromDate,
        toDate: parsed.toDate,
        weekdays: parsed.weekdays,
        hours: parsed.hours,
        ...defined("durationMinutes", parsed.durationMinutes)
      })
    );
  }

  @Post("slots/remove")
  @RequireAdminPermission("mentor_slots.manage")
  async cancelSlot(
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(slotIdBody, body);
    return execute(() =>
      this.handler.cancelSlot({
        actor: requireActor(request),
        slotId: parsed.slotId
      })
    );
  }

  @Post("slots/book")
  @RequireAdminPermission("mentor_slots.book")
  async bookSlot(
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(bookBody, body);
    const outcome = await execute(() =>
      this.handler.bookSlot({
        actor: requireActor(request),
        slotId: parsed.slotId,
        contactId: parsed.contactId,
        ...defined("note", parsed.note)
      })
    );
    if (outcome === "not_found") {
      throw new NotFoundException({
        code: "SLOT_NOT_FOUND",
        title: "Окошко не найдено"
      });
    }
    if (outcome === "already_booked") {
      throw new ConflictException({
        code: "SLOT_ALREADY_BOOKED",
        title: "Это окошко уже заняли — обновите список"
      });
    }
    return { booked: true };
  }

  @Post("slots/release")
  @RequireAdminPermission("mentor_slots.book")
  async releaseSlot(
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(slotIdBody, body);
    return execute(() =>
      this.handler.releaseSlot({
        actor: requireActor(request),
        slotId: parsed.slotId
      })
    );
  }
}

@Module({})
export class AdminStaffApiModule {
  static register(handler: AdminStaffHandler): DynamicModule {
    return {
      module: AdminStaffApiModule,
      controllers: [AdminStaffController],
      providers: [{ provide: ADMIN_STAFF, useValue: handler }]
    };
  }
}

/** Строгий режим TypeScript отличает «не передали» от «передали пусто». */
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
    code: "INVALID_STAFF_REQUEST",
    title: "Запрос по команде заполнен неверно"
  });
}

async function execute<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof LastHeadError) {
      throw new ConflictException({
        code: "LAST_HEAD",
        title: "Это последний руководитель — снять роль некому будет"
      });
    }
    if (!(error instanceof Error)) {
      throw error;
    }
    if (
      error.message.startsWith("Administrator team ")
      || error.message.startsWith("Mentor slot ")
      || error.message.startsWith("Staff role ")
    ) {
      throw invalidRequest();
    }
    throw error;
  }
}
