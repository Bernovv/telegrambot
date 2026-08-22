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
  Res,
  UnauthorizedException
} from "@nestjs/common";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";
import type {
  AdminConversationsService,
  OpenConversationAttachmentService,
  SendConversationFileService,
  SendConversationReplyService
} from "@ticket-platform/application";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import {
  RequireAdminPermission,
  type AuthenticatedAdminRequest
} from "./admin-auth.js";

const ADMIN_CONVERSATIONS = Symbol("ADMIN_CONVERSATIONS");
const CONVERSATION_FILES = Symbol("CONVERSATION_FILES");

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

/**
 * Пять мегабайт. Столько же разрешает прокси панели, и столько влезает в общий предел тела
 * запроса с запасом на раздувание base64 примерно на треть.
 */
const FILE_LIMIT_BYTES = 5 * 1_024 * 1_024;

const fileBody = z.object({
  fileName: z.string().min(1).max(200),
  mimeType: z.string().min(3).max(200),
  contentBase64: z.string().min(4).max(Math.ceil(FILE_LIMIT_BYTES * 4 / 3) + 1_024),
  caption: z.string().max(4_000).optional(),
  takeOver: z.boolean().optional()
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
  openAttachment(input: {
    readonly actor: NonNullable<AuthenticatedAdminRequest["adminActor"]>;
    readonly attachmentId: string;
  }): ReturnType<OpenConversationAttachmentService["execute"]>;
  sendFile(input: {
    readonly actor: NonNullable<AuthenticatedAdminRequest["adminActor"]>;
    readonly conversationId: string;
    readonly fileName: string;
    readonly mimeType: string;
    readonly bytes: Uint8Array;
    readonly caption?: string | undefined;
    readonly takeOver?: boolean | undefined;
    readonly now: Date;
  }): ReturnType<SendConversationFileService["execute"]>;
}

/** Папка вложений на диске. Ту же переменную читает воркер, когда их туда кладёт. */
export interface ConversationFilesConfig {
  readonly directory: string;
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

  /**
   * Файл от менеджера.
   *
   * Содержимое приходит base64 внутри JSON — тем же путём, что картинка рассылки. Разбираем
   * его здесь и дальше несём байтами: чем раньше строка перестаёт существовать, тем меньше
   * шансов, что она попадёт в журнал целиком.
   */
  @Post(":id/files")
  @RequireAdminPermission("conversations.write")
  async sendFile(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const conversationId = parse(uuid, id);
    const parsed = parse(fileBody, body);
    const bytes = decodeBase64(parsed.contentBase64);
    if (bytes === null || bytes.byteLength > FILE_LIMIT_BYTES) {
      throw new BadRequestException({
        code: "INVALID_CONVERSATIONS_REQUEST",
        title: "Файл не разобрался или слишком большой"
      });
    }

    const result = await execute(() =>
      this.handler.sendFile({
        actor: requireActor(request),
        conversationId,
        fileName: parsed.fileName,
        mimeType: parsed.mimeType,
        bytes,
        caption: parsed.caption,
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

/** `null` — строка не base64. Проверяем обратным преобразованием: `Buffer` молча глотает мусор. */
function decodeBase64(value: string): Uint8Array | null {
  const bytes = Buffer.from(value, "base64");
  return bytes.toString("base64").replace(/=+$/, "") === value.replace(/=+$/, "")
    ? new Uint8Array(bytes)
    : null;
}

/**
 * Файл вложения.
 *
 * Панель просит его по идентификатору вложения, а не по пути, и это главное здесь: ручка,
 * принимающая путь, — способ прочитать с диска что угодно. Путь известен только базе.
 *
 * Собранный путь всё равно проверяется на выход за папку. Это второй рубеж от той же беды:
 * в базу путь кладём мы сами, но однажды туда попадёт то, чего мы не ждали, и тогда проверка
 * окажется единственным, что стоит между панелью и `/etc/passwd`.
 */
@Controller("api/v1/conversations")
export class AdminConversationFilesController {
  constructor(
    @Inject(ADMIN_CONVERSATIONS)
    private readonly handler: AdminConversationsHandler,
    @Inject(CONVERSATION_FILES)
    private readonly files: ConversationFilesConfig
  ) {}

  @Get("attachments/:id/file")
  @RequireAdminPermission("conversations.read")
  async openAttachment(
    @Param("id") id: string,
    @Req() request: AuthenticatedAdminRequest,
    // Ответ Fastify, а не Express: у api адаптер Fastify, и `setHeader`/`pipeline` здесь
    // не работают — их вызов падает с TypeError, а браузер видит 500 и битую картинку.
    // Отличить одно от другого типами нельзя: `@Res()` в Nest не типизирован, и на что
    // именно он указывает, знает только адаптер приложения.
    @Res({ passthrough: false }) response: FastifyReply
  ): Promise<void> {
    const attachmentId = parse(uuid, id);
    const found = await execute(() =>
      this.handler.openAttachment({ actor: requireActor(request), attachmentId })
    );
    if (!found) {
      throw new NotFoundException({
        code: "ATTACHMENT_NOT_FOUND",
        title: "Вложение не найдено или ещё не скачано"
      });
    }

    const absolute = resolveAttachmentPath(this.files.directory, found.storagePath);
    if (absolute === null) {
      throw new NotFoundException({
        code: "ATTACHMENT_NOT_FOUND",
        title: "Вложение не найдено или ещё не скачано"
      });
    }

    try {
      await stat(absolute);
    } catch {
      // Строка в базе есть, а файла нет: папку перенесли или почистили руками. Для панели
      // это то же самое, что «нет файла», но в логе видно, что расхождение существует.
      throw new NotFoundException({
        code: "ATTACHMENT_FILE_MISSING",
        title: "Файл вложения не найден на диске"
      });
    }

    // `inline`, а не `attachment`: голосовое слушают в ленте, а не скачивают. Имя всё
    // равно передаём — с ним «Сохранить как» предложит осмысленное.
    await response
      .header("content-type", found.mimeType ?? "application/octet-stream")
      .header("cache-control", "private, max-age=300")
      .header(
        "content-disposition",
        `inline; filename*=UTF-8''${encodeURIComponent(found.fileName ?? found.attachmentId)}`
      )
      .send(createReadStream(absolute));
  }
}

@Module({})
export class AdminConversationsApiModule {
  static register(
    handler: AdminConversationsHandler,
    files: ConversationFilesConfig
  ): DynamicModule {
    return {
      module: AdminConversationsApiModule,
      controllers: [
        AdminConversationsController,
        AdminConversationRepliesController,
        AdminConversationFilesController
      ],
      providers: [
        { provide: ADMIN_CONVERSATIONS, useValue: handler },
        { provide: CONVERSATION_FILES, useValue: files }
      ]
    };
  }
}

/**
 * Путь к файлу вложения на диске — или `null`, если он ведёт наружу.
 *
 * Второй рубеж от чтения чужих файлов. Путь в базу кладём мы сами, и сегодня он безопасен;
 * проверка нужна на день, когда туда попадёт то, чего мы не ждали, — и тогда она окажется
 * единственным, что стоит между панелью и `/etc/passwd`.
 *
 * Пустая папка означает, что скачивание не настроено: отдавать нечего, и это не ошибка.
 */
export function resolveAttachmentPath(
  directory: string,
  storagePath: string
): string | null {
  const root = resolve(directory.trim());
  if (directory.trim() === "" || !isAbsolute(root)) {
    return null;
  }
  // Абсолютный путь в базе отвергаем, а не приклеиваем к папке. Приклеенный `/etc/passwd`
  // остался бы внутри папки и был бы безопасен, но означал бы, что мы молча читаем не то,
  // что записали: такую строку должен увидеть человек, а не проглотить код.
  if (storagePath.trim() === "" || isAbsolute(storagePath)) {
    return null;
  }
  const absolute = resolve(join(root, storagePath));
  return absolute.startsWith(root + sep) ? absolute : null;
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
