import {
  BadRequestException,
  Body,
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
import type { AdminAccommodationService } from "@ticket-platform/application";
import { z } from "zod";
import {
  RequireAdminPermission,
  type AuthenticatedAdminRequest
} from "./admin-auth.js";

const ADMIN_ACCOMMODATION = Symbol("ADMIN_ACCOMMODATION");
const uuid = z.string().uuid();

const mergeBody = z.object({
  orderIds: z.array(uuid).min(2).max(20),
  note: z.string().trim().max(500).optional()
}).strict();

const splitBody = z.object({
  groupId: uuid
}).strict();

const fixPlanBody = z.object({
  note: z.string().trim().max(500).optional()
}).strict();

export type AdminAccommodationHandler = Pick<
  AdminAccommodationService,
  "summary" | "mergeParties" | "splitGroup" | "fixPlan"
>;

@Controller("api/v1/events")
export class AdminAccommodationController {
  constructor(
    @Inject(ADMIN_ACCOMMODATION)
    private readonly handler: AdminAccommodationHandler
  ) {}

  @Get(":eventId/accommodation")
  @RequireAdminPermission("accommodation.read")
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

  @Post(":eventId/accommodation/groups")
  @RequireAdminPermission("accommodation.manage")
  async merge(
    @Param("eventId") eventId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(mergeBody, body);
    await execute(() =>
      this.handler.mergeParties({
        actor: requireActor(request),
        eventId: parse(uuid, eventId),
        orderIds: parsed.orderIds,
        note: parsed.note ?? ""
      })
    );
    return { merged: true };
  }

  @Post(":eventId/accommodation/groups/split")
  @RequireAdminPermission("accommodation.manage")
  async split(
    @Param("eventId") eventId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(splitBody, body);
    await execute(() =>
      this.handler.splitGroup({
        actor: requireActor(request),
        eventId: parse(uuid, eventId),
        groupId: parsed.groupId
      })
    );
    return { split: true };
  }

  @Post(":eventId/accommodation/plans")
  @RequireAdminPermission("accommodation.manage")
  async fixPlan(
    @Param("eventId") eventId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(fixPlanBody, body);
    return execute(() =>
      this.handler.fixPlan({
        actor: requireActor(request),
        eventId: parse(uuid, eventId),
        note: parsed.note ?? ""
      })
    );
  }
}

@Module({})
export class AdminAccommodationApiModule {
  static register(handler: AdminAccommodationHandler): DynamicModule {
    return {
      module: AdminAccommodationApiModule,
      controllers: [AdminAccommodationController],
      providers: [{ provide: ADMIN_ACCOMMODATION, useValue: handler }]
    };
  }
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
    code: "INVALID_ACCOMMODATION_REQUEST",
    title: "Данные расселения заполнены неверно"
  });
}

async function execute<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof Error && error.message === "Event was not found") {
      throw new NotFoundException({
        code: "EVENT_NOT_FOUND",
        title: "Мероприятие не найдено"
      });
    }
    if (
      error instanceof Error
      && (
        error.message.startsWith("Administrator accommodation ")
        || error.message.startsWith("Accommodation ")
      )
    ) {
      throw invalidRequest();
    }
    throw error;
  }
}
