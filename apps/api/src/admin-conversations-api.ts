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
  Query,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import type {
  AdminConversationsService,
  SendConversationReplyService
} from "@ticket-platform/application";
import { z } from "zod";
import {
  RequireAdminPermission,
  type AuthenticatedAdminRequest
} from "./admin-auth.js";

const ADMIN_CONVERSATIONS = Symbol("ADMIN_CONVERSATIONS");

const uuid = z.string().uuid();
const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  /**
   * Курсор — время реплики, а не номер страницы. Лента растёт сверху: пока менеджер читает,
   * человек пишет ещё, и вторая страница по номеру вернула бы то, что он уже видел.
   */
  before: z.string().datetime({ offset: true }).optional(),
  search: z.string().max(200).optional()
});

const replyBody = z.object({
  text: z.string().min(1).max(4_000),
  /** Отобрать чужой диалог себе. Панель спрашивает об этом отдельно. */
  takeOver: z.boolean().optional()
});

export interface AdminConversationsHandler {
  getPersonConversations(input: {
    readonly actor: NonNullable<AuthenticatedAdminRequest["adminActor"]>;
    readonly contactId: string;
    readonly limit?: number | undefined;
    readonly before?: Date | null | undefined;
    readonly search?: string | null | undefined;
  }): ReturnType<AdminConversationsService["getPersonConversations"]>;
  sendReply(input: {
    readonly actor: NonNullable<AuthenticatedAdminRequest["adminActor"]>;
    readonly conversationId: string;
    readonly text: string;
    readonly takeOver?: boolean | undefined;
    readonly now: Date;
  }): ReturnType<SendConversationReplyService["execute"]>;
}

/**
 * Переписка в карточке человека.
 *
 * Отдельная ручка, а не часть карточки, и причина в объёме: у разговорчивого человека реплик
 * сотни, а карточку открывают, чтобы посмотреть стадию и телефон. Тянуть всю переписку в
 * каждый такой заход значит платить за неё всегда, а читать — иногда.
 */
@Controller("api/v1/conversations")
export class AdminConversationsController {
  constructor(
    @Inject(ADMIN_CONVERSATIONS)
    private readonly handler: AdminConversationsHandler
  ) {}

  @Get("people/:id")
  @RequireAdminPermission("conversations.read")
  async getPersonConversations(
    @Param("id") id: string,
    @Query() query: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const contactId = parse(uuid, id);
    const page = parse(pageQuery, query ?? {});
    return await execute(() =>
      this.handler.getPersonConversations({
        actor: requireActor(request),
        contactId,
        limit: page.limit,
        before: page.before === undefined ? null : new Date(page.before),
        search: page.search ?? null
      })
    );
  }
}

/**
 * Ответ менеджера.
 *
 * Ручка кладёт реплику в очередь и отвечает сразу: ждать, пока Telegram ответит, панель не
 * должна — их сеть иногда думает секундами, а менеджер в это время смотрит на крутящуюся
 * кнопку и жмёт её второй раз.
 *
 * `assigned_to_other` — обычный ответ, а не ошибка. Это развилка: диалог ведёт коллега, и
 * решение перехватить его принимает человек, а не код.
 */
@Controller("api/v1/conversations")
export class AdminConversationRepliesController {
  constructor(
    @Inject(ADMIN_CONVERSATIONS)
    private readonly handler: AdminConversationsHandler
  ) {}

  @Post(":id/messages")
  @RequireAdminPermission("conversations.write")
  async sendReply(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const conversationId = parse(uuid, id);
    const parsed = parse(replyBody, body);
    const result = await execute(() =>
      this.handler.sendReply({
        actor: requireActor(request),
        conversationId,
        text: parsed.text,
        takeOver: parsed.takeOver,
        now: new Date()
      })
    );
    if (result.status === "not_found") {
      throw new NotFoundException({
        code: "CONVERSATION_NOT_FOUND",
        title: "Диалог не найден"
      });
    }
    return result;
  }
}

@Module({})
export class AdminConversationsApiModule {
  static register(handler: AdminConversationsHandler): DynamicModule {
    return {
      module: AdminConversationsApiModule,
      controllers: [AdminConversationsController, AdminConversationRepliesController],
      providers: [{ provide: ADMIN_CONVERSATIONS, useValue: handler }]
    };
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new BadRequestException({
      code: "INVALID_CONVERSATIONS_REQUEST",
      title: "Запрос переписки заполнен неверно"
    });
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

async function execute<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (
      error instanceof Error
      && error.message.startsWith("Administrator conversations ")
    ) {
      throw new BadRequestException({
        code: "INVALID_CONVERSATIONS_REQUEST",
        title: "Запрос переписки заполнен неверно"
      });
    }
    throw error;
  }
}
