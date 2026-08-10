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
import type { AdminEventTeamService } from "@ticket-platform/application";
import { z } from "zod";
import {
  RequireAdminPermission,
  type AuthenticatedAdminRequest
} from "./admin-auth.js";

const ADMIN_TEAM = Symbol("ADMIN_TEAM");

const uuid = z.string().uuid();
/**
 * Проценты с двумя знаками: доли вида 33.33 нужны, третий знак — уже не деньги. Верхнюю
 * границу приходится ставить отдельно: три цифры это и «100», и «101».
 */
const percent = z.string()
  .regex(/^\d{1,3}(?:\.\d{1,2})?$/)
  .refine((value) => Number(value) <= 100);

const organizerBody = z.object({
  personName: z.string().trim().min(1).max(200),
  roleLabel: z.string().trim().max(80).optional(),
  sharePercent: percent,
  responsibilities: z.string().trim().max(1000).optional(),
  note: z.string().trim().max(1000).optional()
}).strict();

const updateOrganizerBody = z.object({
  organizerId: uuid,
  personName: z.string().trim().min(1).max(200).optional(),
  roleLabel: z.string().trim().max(80).optional(),
  sharePercent: percent.optional(),
  responsibilities: z.string().trim().max(1000).optional(),
  note: z.string().trim().max(1000).optional()
}).strict();

const removeOrganizerBody = z.object({ organizerId: uuid }).strict();

export type AdminTeamHandler = Pick<
  AdminEventTeamService,
  "summary" | "addOrganizer" | "updateOrganizer" | "removeOrganizer"
>;

@Controller("api/v1/events")
export class AdminTeamController {
  constructor(
    @Inject(ADMIN_TEAM)
    private readonly handler: AdminTeamHandler
  ) {}

  @Get(":eventId/team")
  @RequireAdminPermission("event_finance.read")
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

  @Post(":eventId/team")
  @RequireAdminPermission("event_finance.manage")
  async addOrganizer(
    @Param("eventId") eventId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(organizerBody, body);
    await execute(() =>
      this.handler.addOrganizer({
        actor: requireActor(request),
        eventId: parse(uuid, eventId),
        personName: parsed.personName,
        sharePercent: parsed.sharePercent,
        ...defined("roleLabel", parsed.roleLabel),
        ...defined("responsibilities", parsed.responsibilities),
        ...defined("note", parsed.note)
      })
    );
    return { added: true };
  }

  @Post(":eventId/team/update")
  @RequireAdminPermission("event_finance.manage")
  async updateOrganizer(
    @Param("eventId") eventId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(updateOrganizerBody, body);
    await execute(() =>
      this.handler.updateOrganizer({
        actor: requireActor(request),
        eventId: parse(uuid, eventId),
        organizerId: parsed.organizerId,
        changes: {
          ...defined("personName", parsed.personName),
          ...defined("roleLabel", parsed.roleLabel),
          ...defined("sharePercent", parsed.sharePercent),
          ...defined("responsibilities", parsed.responsibilities),
          ...defined("note", parsed.note)
        }
      })
    );
    return { updated: true };
  }

  @Post(":eventId/team/remove")
  @RequireAdminPermission("event_finance.manage")
  async removeOrganizer(
    @Param("eventId") eventId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(removeOrganizerBody, body);
    await execute(() =>
      this.handler.removeOrganizer({
        actor: requireActor(request),
        eventId: parse(uuid, eventId),
        organizerId: parsed.organizerId
      })
    );
    return { removed: true };
  }
}

@Module({})
export class AdminTeamApiModule {
  static register(handler: AdminTeamHandler): DynamicModule {
    return {
      module: AdminTeamApiModule,
      controllers: [AdminTeamController],
      providers: [{ provide: ADMIN_TEAM, useValue: handler }]
    };
  }
}

/** Строгий режим TypeScript отличает «не передали» от «передали пусто» — см. расходы. */
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
    code: "INVALID_ORGANIZER_REQUEST",
    title: "Данные организатора заполнены неверно"
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
    if (error.message === "Event organizer was not found") {
      throw new NotFoundException({
        code: "ORGANIZER_NOT_FOUND",
        title: "Организатор не найден"
      });
    }
    if (error.message === "Event organizer with this name already exists") {
      throw new ConflictException({
        code: "ORGANIZER_EXISTS",
        title: "Этот человек уже в команде мероприятия"
      });
    }
    if (error.message === "Event organizer shares exceed one hundred percent") {
      throw new ConflictException({
        code: "SHARES_EXCEED_HUNDRED",
        title: "Сумма долей больше ста процентов"
      });
    }
    if (
      error.message.startsWith("Administrator event finance ")
      || error.message.startsWith("Event organizer request ")
    ) {
      throw invalidRequest();
    }
    throw error;
  }
}
