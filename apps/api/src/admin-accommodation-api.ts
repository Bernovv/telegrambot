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
import { EVENT_PARTICIPANT_SOURCES } from "@ticket-platform/contracts";
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

const participantBody = z.object({
  displayName: z.string().trim().min(1).max(200),
  phone: z.string().trim().regex(/^\+[1-9][0-9]{7,14}$/).optional(),
  source: z.enum(EVENT_PARTICIPANT_SOURCES),
  ticketTitle: z.string().trim().max(200).optional(),
  adults: z.number().int().min(0).max(100),
  children: z.number().int().min(0).max(100),
  sleepingPlaces: z.number().int().min(0).max(200),
  note: z.string().trim().max(500).optional(),
  outreachContactId: uuid.optional()
}).strict();

const removeParticipantBody = z.object({
  participantId: uuid,
  reason: z.string().trim().min(3).max(500)
}).strict();

const excludeOrderBody = z.object({
  reason: z.string().trim().min(3).max(500)
}).strict();

export type AdminAccommodationHandler = Pick<
  AdminAccommodationService,
  | "summary"
  | "mergeParties"
  | "splitGroup"
  | "fixPlan"
  | "addParticipant"
  | "removeParticipant"
  | "excludeOrder"
  | "includeOrder"
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

@Controller("api/v1")
export class AdminParticipantsController {
  constructor(
    @Inject(ADMIN_ACCOMMODATION)
    private readonly handler: AdminAccommodationHandler
  ) {}

  @Post("events/:eventId/participants")
  @RequireAdminPermission("participants.manage")
  async add(
    @Param("eventId") eventId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(participantBody, body);
    await execute(() =>
      this.handler.addParticipant({
        actor: requireActor(request),
        eventId: parse(uuid, eventId),
        participant: {
          displayName: parsed.displayName,
          phone: parsed.phone ?? null,
          source: parsed.source,
          ticketTitle: parsed.ticketTitle ?? "",
          adults: parsed.adults,
          children: parsed.children,
          sleepingPlaces: parsed.sleepingPlaces,
          note: parsed.note ?? "",
          outreachContactId: parsed.outreachContactId ?? null
        }
      })
    );
    return { added: true };
  }

  @Post("events/:eventId/participants/remove")
  @RequireAdminPermission("participants.manage")
  async remove(
    @Param("eventId") eventId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(removeParticipantBody, body);
    await execute(() =>
      this.handler.removeParticipant({
        actor: requireActor(request),
        eventId: parse(uuid, eventId),
        participantId: parsed.participantId,
        reason: parsed.reason
      })
    );
    return { removed: true };
  }

  @Post("orders/:orderId/exclude")
  @RequireAdminPermission("orders.exclude")
  async exclude(
    @Param("orderId") orderId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(excludeOrderBody, body);
    await execute(() =>
      this.handler.excludeOrder({
        actor: requireActor(request),
        orderId: parse(uuid, orderId),
        reason: parsed.reason
      })
    );
    return { excluded: true };
  }

  @Post("orders/:orderId/include")
  @RequireAdminPermission("orders.exclude")
  async include(
    @Param("orderId") orderId: string,
    @Req() request: AuthenticatedAdminRequest
  ) {
    await execute(() =>
      this.handler.includeOrder({
        actor: requireActor(request),
        orderId: parse(uuid, orderId)
      })
    );
    return { included: true };
  }
}

@Module({})
export class AdminAccommodationApiModule {
  static register(handler: AdminAccommodationHandler): DynamicModule {
    return {
      module: AdminAccommodationApiModule,
      controllers: [AdminAccommodationController, AdminParticipantsController],
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
    if (error instanceof Error && error.message === "Order was not found") {
      throw new NotFoundException({
        code: "ORDER_NOT_FOUND",
        title: "Заказ не найден"
      });
    }
    if (
      error instanceof Error
      && error.message === "Event participant was not found"
    ) {
      throw new NotFoundException({
        code: "PARTICIPANT_NOT_FOUND",
        title: "Участник не найден"
      });
    }
    if (
      error instanceof Error
      && (
        error.message.startsWith("Administrator accommodation ")
        || error.message.startsWith("Accommodation ")
        || error.message.startsWith("Event participant ")
      )
    ) {
      throw invalidRequest();
    }
    throw error;
  }
}
