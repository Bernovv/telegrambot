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
import type {
  AdminAccommodationService,
  AdminEventParticipantsService
} from "@ticket-platform/application";
import {
  EVENT_PARTICIPANT_FIELD_TYPES,
  EVENT_PARTICIPANT_SOURCES
} from "@ticket-platform/contracts";
import { z } from "zod";
import {
  RequireAdminPermission,
  type AuthenticatedAdminRequest
} from "./admin-auth.js";

const ADMIN_ACCOMMODATION = Symbol("ADMIN_ACCOMMODATION");
const ADMIN_EVENT_PARTICIPANTS = Symbol("ADMIN_EVENT_PARTICIPANTS");

type ParticipantChanges = {
  displayName?: string;
  phone?: string | null;
  source?: (typeof EVENT_PARTICIPANT_SOURCES)[number];
  ticketTitle?: string;
  adults?: number;
  children?: number;
  sleepingPlaces?: number;
  note?: string;
  amountKopecks?: string | null;
  paidAt?: Date | null;
  paymentMethod?: string | null;
};
const uuid = z.string().uuid();

const mergeBody = z.object({
  orderIds: z.array(uuid).min(2).max(20),
  note: z.string().trim().max(500).optional()
}).strict();

const splitBody = z.object({
  groupId: uuid
}).strict();

const privateTentBody = z.object({
  orderId: uuid,
  wanted: z.boolean(),
  note: z.string().trim().max(500).optional()
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

const updateParticipantBody = z.object({
  participantId: uuid,
  displayName: z.string().trim().min(1).max(200).optional(),
  phone: z.string().trim().regex(/^\+[1-9][0-9]{7,14}$/).nullable().optional(),
  source: z.enum(EVENT_PARTICIPANT_SOURCES).optional(),
  ticketTitle: z.string().trim().max(200).optional(),
  adults: z.number().int().min(0).max(100).optional(),
  children: z.number().int().min(0).max(100).optional(),
  sleepingPlaces: z.number().int().min(0).max(200).optional(),
  note: z.string().trim().max(500).optional(),
  amountKopecks: z.string().regex(/^\d{1,15}$/).nullable().optional(),
  paidAt: z.string().datetime().nullable().optional(),
  paymentMethod: z.string().trim().min(1).max(80).nullable().optional()
}).strict();

// Ответ адресуется либо заказу, либо ручному участнику — ровно одному из двух.
const answerBody = z.object({
  orderId: uuid.optional(),
  participantId: uuid.optional(),
  fieldId: uuid,
  value: z.string().max(500).nullable()
}).strict().refine(
  (body) => (body.orderId === undefined) !== (body.participantId === undefined),
  { message: "exactly one target" }
);

const participantFieldBody = z.object({
  label: z.string().trim().min(1).max(80),
  type: z.enum(EVENT_PARTICIPANT_FIELD_TYPES),
  options: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  scope: z.enum(["event", "global"])
}).strict();

const participantFieldValueBody = z.object({
  participantId: uuid,
  fieldId: uuid,
  value: z.string().max(500).nullable()
}).strict();

const deleteParticipantFieldBody = z.object({
  fieldId: uuid
}).strict();

const excludeOrderBody = z.object({
  reason: z.string().trim().min(3).max(500)
}).strict();

export type AdminEventParticipantsHandler = Pick<
  AdminEventParticipantsService,
  "list" | "saveAnswer"
>;

export type AdminAccommodationHandler = Pick<
  AdminAccommodationService,
  | "summary"
  | "mergeParties"
  | "splitGroup"
  | "fixPlan"
  | "setPrivateTent"
  | "addParticipant"
  | "updateParticipant"
  | "removeParticipant"
  | "addParticipantField"
  | "removeParticipantField"
  | "setParticipantFieldValue"
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

  /** «Живут одни»: человек попросил палатку на себя, о подселении его больше не спрашиваем. */
  @Post(":eventId/accommodation/private-tent")
  @RequireAdminPermission("accommodation.manage")
  async setPrivateTent(
    @Param("eventId") eventId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(privateTentBody, body);
    await execute(() =>
      this.handler.setPrivateTent({
        actor: requireActor(request),
        eventId: parse(uuid, eventId),
        orderId: parsed.orderId,
        wanted: parsed.wanted,
        ...(parsed.note !== undefined ? { note: parsed.note } : {})
      })
    );
    return { saved: true };
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
    private readonly handler: AdminAccommodationHandler,
    @Inject(ADMIN_EVENT_PARTICIPANTS)
    private readonly participants: AdminEventParticipantsHandler
  ) {}

  /**
   * Единый список: покупатели бота и заведённые руками. Право то же, что у сводки
   * «что везём», — это те же люди и те же телефоны, показанные иначе.
   */
  @Get("events/:eventId/participants")
  @RequireAdminPermission("accommodation.read")
  async list(
    @Param("eventId") eventId: string,
    @Req() request: AuthenticatedAdminRequest
  ) {
    return execute(() =>
      this.participants.list({
        actor: requireActor(request),
        eventId: parse(uuid, eventId)
      })
    );
  }

  /**
   * Один ответ бумажной анкеты. По одному полю, а не формой целиком: анкеты вносят
   * стопкой, и обрыв связи не должен стоить получаса работы.
   */
  @Post("events/:eventId/participants/answers")
  @RequireAdminPermission("participants.manage")
  async saveAnswer(
    @Param("eventId") eventId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(answerBody, body);
    await execute(() =>
      this.participants.saveAnswer({
        actor: requireActor(request),
        eventId: parse(uuid, eventId),
        ...(parsed.orderId !== undefined ? { orderId: parsed.orderId } : {}),
        ...(parsed.participantId !== undefined
          ? { participantId: parsed.participantId }
          : {}),
        fieldId: parsed.fieldId,
        value: parsed.value
      })
    );
    return { saved: true };
  }

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

  @Post("events/:eventId/participants/update")
  @RequireAdminPermission("participants.manage")
  async update(
    @Param("eventId") eventId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(updateParticipantBody, body);
    // Собираем изменения по одному: при `exactOptionalPropertyTypes` «ключа нет» и «ключ
    // есть со значением undefined» — разные вещи, а разница тут смысловая: не менять
    // против очистить.
    const changes: ParticipantChanges = {};
    if (parsed.displayName !== undefined) {
      changes.displayName = parsed.displayName;
    }
    if (parsed.phone !== undefined) {
      changes.phone = parsed.phone;
    }
    if (parsed.source !== undefined) {
      changes.source = parsed.source;
    }
    if (parsed.ticketTitle !== undefined) {
      changes.ticketTitle = parsed.ticketTitle;
    }
    if (parsed.adults !== undefined) {
      changes.adults = parsed.adults;
    }
    if (parsed.children !== undefined) {
      changes.children = parsed.children;
    }
    if (parsed.sleepingPlaces !== undefined) {
      changes.sleepingPlaces = parsed.sleepingPlaces;
    }
    if (parsed.note !== undefined) {
      changes.note = parsed.note;
    }
    if (parsed.amountKopecks !== undefined) {
      changes.amountKopecks = parsed.amountKopecks;
    }
    if (parsed.paymentMethod !== undefined) {
      changes.paymentMethod = parsed.paymentMethod;
    }
    if (parsed.paidAt !== undefined) {
      changes.paidAt = parsed.paidAt === null ? null : new Date(parsed.paidAt);
    }
    await execute(() =>
      this.handler.updateParticipant({
        actor: requireActor(request),
        eventId: parse(uuid, eventId),
        participantId: parsed.participantId,
        changes
      })
    );
    return { updated: true };
  }

  @Post("events/:eventId/participant-fields")
  @RequireAdminPermission("participants.manage")
  async addField(
    @Param("eventId") eventId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(participantFieldBody, body);
    await execute(() =>
      this.handler.addParticipantField({
        actor: requireActor(request),
        eventId: parse(uuid, eventId),
        label: parsed.label,
        type: parsed.type,
        options: parsed.options ?? null,
        scope: parsed.scope
      })
    );
    return { added: true };
  }

  @Post("events/:eventId/participant-fields/delete")
  @RequireAdminPermission("participants.manage")
  async removeField(
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(deleteParticipantFieldBody, body);
    await execute(() =>
      this.handler.removeParticipantField({
        actor: requireActor(request),
        fieldId: parsed.fieldId
      })
    );
    return { removed: true };
  }

  @Post("events/:eventId/participant-fields/value")
  @RequireAdminPermission("participants.manage")
  async setFieldValue(
    @Param("eventId") eventId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const parsed = parse(participantFieldValueBody, body);
    await execute(() =>
      this.handler.setParticipantFieldValue({
        actor: requireActor(request),
        eventId: parse(uuid, eventId),
        participantId: parsed.participantId,
        fieldId: parsed.fieldId,
        value: parsed.value
      })
    );
    return { saved: true };
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
  static register(
    handler: AdminAccommodationHandler,
    participants: AdminEventParticipantsHandler
  ): DynamicModule {
    return {
      module: AdminAccommodationApiModule,
      controllers: [AdminAccommodationController, AdminParticipantsController],
      providers: [
        { provide: ADMIN_ACCOMMODATION, useValue: handler },
        { provide: ADMIN_EVENT_PARTICIPANTS, useValue: participants }
      ]
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
      && error.message === "Questionnaire answer target was not found"
    ) {
      throw new NotFoundException({
        code: "ANSWER_TARGET_NOT_FOUND",
        title: "Заказ или участник не найден"
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
        || error.message.startsWith("Administrator participants ")
        || error.message.startsWith("Accommodation ")
        || error.message.startsWith("Event participant ")
      )
    ) {
      throw invalidRequest();
    }
    throw error;
  }
}
