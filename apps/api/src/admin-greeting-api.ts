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
  UnauthorizedException,
  UnprocessableEntityException
} from "@nestjs/common";
import {
  InvalidEventGreetingError,
  type AdminEventGreetingService
} from "@ticket-platform/application";
import { z } from "zod";
import {
  RequireAdminPermission,
  type AuthenticatedAdminRequest
} from "./admin-auth.js";

const ADMIN_GREETING = Symbol("ADMIN_GREETING");

const uuid = z.string().uuid();

/**
 * Настройки целиком. Пределы длины — с запасом над проверкой в сервисе: там они честные и с
 * объяснением, а здесь только отсекают заведомый мусор.
 */
const saveBody = z.object({
  isEnabled: z.boolean(),
  eventPhrase: z.string().max(1_000).nullable(),
  bodyTemplate: z.string().max(10_000).nullable()
}).strict();

export type AdminGreetingHandler = Pick<AdminEventGreetingService, "get" | "save">;

@Controller("api/v1/events")
export class AdminGreetingController {
  constructor(
    @Inject(ADMIN_GREETING)
    private readonly handler: AdminGreetingHandler
  ) {}

  @Get(":eventId/greeting")
  @RequireAdminPermission("events.read")
  async get(
    @Param("eventId") eventId: string,
    @Req() request: AuthenticatedAdminRequest
  ) {
    return execute(() =>
      this.handler.get({
        actor: requireActor(request),
        eventId: parse(uuid, eventId)
      })
    );
  }

  /**
   * Право то же, что у содержимого мероприятия: приветствие — это текст, который от имени
   * компании уходит людям, записавшимся на это мероприятие.
   */
  @Post(":eventId/greeting")
  @RequireAdminPermission("events.write")
  async save(
    @Param("eventId") eventId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const settings = parse(saveBody, body);
    return execute(() =>
      this.handler.save({
        actor: requireActor(request),
        eventId: parse(uuid, eventId),
        settings
      })
    );
  }
}

@Module({})
export class AdminGreetingApiModule {
  static register(handler: AdminGreetingHandler): DynamicModule {
    return {
      module: AdminGreetingApiModule,
      controllers: [AdminGreetingController],
      providers: [{ provide: ADMIN_GREETING, useValue: handler }]
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
    code: "INVALID_GREETING_REQUEST",
    title: "Настройки приветствия заполнены неверно"
  });
}

async function execute<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof InvalidEventGreetingError) {
      // Причина — для менеджера: какая подстановка не та или что слишком длинно.
      throw new UnprocessableEntityException({
        code: "INVALID_GREETING",
        title: error.reason
      });
    }
    if (!(error instanceof Error)) {
      throw error;
    }
    if (error.message === "Event was not found") {
      throw new NotFoundException({
        code: "EVENT_NOT_FOUND",
        title: "Мероприятие не найдено"
      });
    }
    if (
      error.message.startsWith("Administrator event greeting ")
      || error.message.startsWith("Event greeting request ")
    ) {
      throw invalidRequest();
    }
    throw error;
  }
}
