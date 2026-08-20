import {
  BadRequestException,
  Controller,
  DynamicModule,
  Get,
  Inject,
  Module,
  NotFoundException,
  Param,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import type {
  AdminEventOverviewService,
  AdminEventReportService
} from "@ticket-platform/application";
import { z } from "zod";
import {
  RequireAdminPermission,
  type AuthenticatedAdminRequest
} from "./admin-auth.js";

const ADMIN_OVERVIEW = Symbol("ADMIN_OVERVIEW");
const ADMIN_EVENT_REPORT = Symbol("ADMIN_EVENT_REPORT");

const uuid = z.string().uuid();

export type AdminOverviewHandler = Pick<AdminEventOverviewService, "summary">;
export type AdminEventReportHandler = Pick<AdminEventReportService, "execute">;

@Controller("api/v1/events")
export class AdminOverviewController {
  constructor(
    @Inject(ADMIN_OVERVIEW)
    private readonly handler: AdminOverviewHandler,
    @Inject(ADMIN_EVENT_REPORT)
    private readonly reportService: AdminEventReportHandler
  ) {}

  /**
   * Отчёт закрыт тем же правом, что и обзор: денег в нём нет, а «кто откуда пришёл» — это
   * то же самое знание о мероприятии, что и список участников.
   */
  @Get(":eventId/report")
  @RequireAdminPermission("events.read")
  async report(
    @Param("eventId") eventId: string,
    @Req() request: AuthenticatedAdminRequest
  ) {
    requireActor(request);
    return execute(() =>
      this.reportService.execute({ eventId: parse(uuid, eventId) })
    );
  }

  /**
   * Обзор читается по общему праву на мероприятия. Денежный блок внутри закрыт отдельно:
   * решает сам сервис, спрашивая `event_finance.read`, — иначе пришлось бы держать две
   * ручки, отличающиеся одним полем.
   */
  @Get(":eventId/overview")
  @RequireAdminPermission("events.read")
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
}

@Module({})
export class AdminOverviewApiModule {
  static register(
    handler: AdminOverviewHandler,
    report: AdminEventReportHandler
  ): DynamicModule {
    return {
      module: AdminOverviewApiModule,
      controllers: [AdminOverviewController],
      providers: [
        { provide: ADMIN_OVERVIEW, useValue: handler },
        { provide: ADMIN_EVENT_REPORT, useValue: report }
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
    code: "INVALID_OVERVIEW_REQUEST",
    title: "Запрос обзора составлен неверно"
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
    if (error.message.startsWith("Administrator overview ")) {
      throw invalidRequest();
    }
    throw error;
  }
}
