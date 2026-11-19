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
  Query,
  Req,
  Res,
  UnauthorizedException,
  UnprocessableEntityException
} from "@nestjs/common";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import {
  AccountBroadcastRequestError,
  type AdminAccountBroadcastService
} from "@ticket-platform/application";
import { ACCOUNT_BROADCAST_MAX_PARTS } from "@ticket-platform/contracts";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import {
  RequireAdminPermission,
  type AuthenticatedAdminRequest
} from "./admin-auth.js";
import { resolveAttachmentPath, type ConversationFilesConfig } from "./admin-conversations-api.js";

const ADMIN_ACCOUNT_BROADCAST = Symbol("ADMIN_ACCOUNT_BROADCAST");
const ACCOUNT_BROADCAST_FILES = Symbol("ACCOUNT_BROADCAST_FILES");

const uuid = z.string().uuid();

const createBody = z.object({
  savedMessageIds: z.array(uuid).min(1).max(ACCOUNT_BROADCAST_MAX_PARTS),
  eventId: uuid.optional(),
  testRecipient: z.string().trim().min(2).max(200).optional()
}).strict();

const audienceQuery = z.object({
  eventId: uuid,
  // Сообщения через запятую: GET без тела, а список короткий.
  savedMessageIds: z.string().max(ACCOUNT_BROADCAST_MAX_PARTS * 37).optional()
}).strict();

export type AdminAccountBroadcastHandler = Pick<
  AdminAccountBroadcastService,
  "listSavedMessages" | "openSavedMessageFile" | "countAudience" | "create" | "list" | "cancel"
>;

/**
 * Рассылка от рабочего аккаунта. Право одно на всё — то же, что у рассылки бота: и то и
 * другое уходит людям от имени компании.
 */
@Controller("api/v1/account-broadcasts")
export class AdminAccountBroadcastController {
  constructor(
    @Inject(ADMIN_ACCOUNT_BROADCAST)
    private readonly handler: AdminAccountBroadcastHandler,
    @Inject(ACCOUNT_BROADCAST_FILES)
    private readonly files: ConversationFilesConfig
  ) {}

  @Get()
  @RequireAdminPermission("broadcasts.send")
  async list(@Req() request: AuthenticatedAdminRequest) {
    return await execute(() => this.handler.list({ actor: requireActor(request) }));
  }

  @Get("saved")
  @RequireAdminPermission("broadcasts.send")
  async saved(@Req() request: AuthenticatedAdminRequest) {
    return await execute(() => this.handler.listSavedMessages({ actor: requireActor(request) }));
  }

  /** Кружок из «Избранного» целиком — чтобы перед запуском посмотреть, тот ли. */
  @Get("saved/:id/file")
  @RequireAdminPermission("broadcasts.send")
  async savedFile(
    @Param("id") id: string,
    @Req() request: AuthenticatedAdminRequest,
    // Ответ Fastify, как у вложений переписки: у api адаптер Fastify.
    @Res({ passthrough: false }) response: FastifyReply
  ): Promise<void> {
    const savedMessageId = parse(uuid, id);
    const found = await execute(() =>
      this.handler.openSavedMessageFile({ actor: requireActor(request), savedMessageId })
    );
    const absolute = found === null
      ? null
      : resolveAttachmentPath(this.files.directory, found.storagePath);
    if (found === null || absolute === null) {
      throw new NotFoundException({
        code: "SAVED_MESSAGE_FILE_NOT_FOUND",
        title: "Файла этого сообщения у нас нет"
      });
    }
    try {
      await stat(absolute);
    } catch {
      throw new NotFoundException({
        code: "SAVED_MESSAGE_FILE_MISSING",
        title: "Файл сообщения не найден на диске"
      });
    }

    await response
      .header("content-type", found.mimeType ?? "application/octet-stream")
      .header("cache-control", "private, max-age=300")
      .header(
        "content-disposition",
        `inline; filename*=UTF-8''${encodeURIComponent(found.fileName ?? savedMessageId)}`
      )
      .send(createReadStream(absolute));
  }

  @Get("audience")
  @RequireAdminPermission("broadcasts.send")
  async audience(@Query() query: unknown, @Req() request: AuthenticatedAdminRequest) {
    const parsed = parse(audienceQuery, query);
    const savedMessageIds = (parsed.savedMessageIds ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value !== "");
    return await execute(() =>
      this.handler.countAudience({
        actor: requireActor(request),
        eventId: parsed.eventId,
        savedMessageIds
      })
    );
  }

  @Post()
  @RequireAdminPermission("broadcasts.send")
  async create(@Body() body: unknown, @Req() request: AuthenticatedAdminRequest) {
    const parsed = parse(createBody, body);
    return await execute(() =>
      this.handler.create({
        actor: requireActor(request),
        savedMessageIds: parsed.savedMessageIds,
        ...(parsed.eventId === undefined ? {} : { eventId: parsed.eventId }),
        ...(parsed.testRecipient === undefined ? {} : { testRecipient: parsed.testRecipient }),
        now: new Date()
      })
    );
  }

  @Post(":id/cancel")
  @RequireAdminPermission("broadcasts.send")
  async cancel(@Param("id") id: string, @Req() request: AuthenticatedAdminRequest) {
    const broadcastId = parse(uuid, id);
    return await execute(() =>
      this.handler.cancel({ actor: requireActor(request), broadcastId, now: new Date() })
    );
  }
}

@Module({})
export class AdminAccountBroadcastApiModule {
  static register(
    handler: AdminAccountBroadcastHandler,
    files: ConversationFilesConfig
  ): DynamicModule {
    return {
      module: AdminAccountBroadcastApiModule,
      controllers: [AdminAccountBroadcastController],
      providers: [
        { provide: ADMIN_ACCOUNT_BROADCAST, useValue: handler },
        { provide: ACCOUNT_BROADCAST_FILES, useValue: files }
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

function invalidRequest(): BadRequestException {
  return new BadRequestException({
    code: "INVALID_ACCOUNT_BROADCAST_REQUEST",
    title: "Запрос рассылки заполнен неверно"
  });
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
    if (error instanceof AccountBroadcastRequestError) {
      // Причина — для менеджера: что именно не так и что сделать.
      switch (error.code) {
        case "invalid":
          throw new BadRequestException({
            code: "INVALID_ACCOUNT_BROADCAST_REQUEST",
            title: error.reason
          });
        case "event_not_found":
        case "test_recipient_not_found":
          throw new NotFoundException({ code: error.code.toUpperCase(), title: error.reason });
        case "already_sending":
          throw new ConflictException({ code: "ACCOUNT_BROADCAST_ALREADY_SENDING", title: error.reason });
        default:
          throw new UnprocessableEntityException({
            code: error.code.toUpperCase(),
            title: error.reason
          });
      }
    }
    if (error instanceof Error && error.message === "Administrator broadcast permission is invalid") {
      throw invalidRequest();
    }
    throw error;
  }
}
