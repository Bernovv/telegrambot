import {
  BadRequestException,
  Body,
  Controller,
  DynamicModule,
  Get,
  Inject,
  Module,
  Post,
  Query,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import { z } from "zod";
import {
  RequireAdminPermission,
  type AuthenticatedAdminRequest
} from "./admin-auth.js";

const ADMIN_BROADCAST_HANDLERS = Symbol("ADMIN_BROADCAST_HANDLERS");

const orderStatusSchema = z.enum([
  "draft",
  "awaiting_offer",
  "awaiting_payment",
  "payment_processing",
  "paid",
  "cancelled",
  "expired",
  "partially_refunded",
  "refunded"
]);

const audienceSchema = z.enum(["orders", "bot_users"]);

const createBroadcastBodySchema = z.object({
  messageText: z.string().trim().min(1).max(3_500),
  targetAudience: audienceSchema.optional(),
  targetEventId: z.string().uuid().optional(),
  targetOrderStatus: orderStatusSchema.optional(),
  button: z.object({
    text: z.string().trim().min(1).max(64),
    url: z.string().url().startsWith("https://").max(2_048)
  }).strict().optional(),
  imageId: z.string().uuid().optional(),
  isTest: z.boolean().optional()
}).strict();

const audienceQuerySchema = z.object({
  targetAudience: audienceSchema.optional(),
  targetEventId: z.string().uuid().optional(),
  targetOrderStatus: orderStatusSchema.optional()
}).strict();

// Картинка приходит внутри JSON в base64, а не отдельной multipart-загрузкой: так запрос
// проходит тем же путём, что и все остальные мутации админки, — с той же проверкой источника,
// тем же заголовком и тем же ограничением на размер тела.
const uploadImageBodySchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentBase64: z.string().min(100).max(1_400_000)
}).strict();

type Actor = NonNullable<AuthenticatedAdminRequest["adminActor"]>;

export interface CreateAdminBroadcastHandler {
  execute(input: {
    readonly actor: Actor;
    readonly messageText: string;
    readonly targetAudience?: string;
    readonly targetEventId?: string;
    readonly targetOrderStatus?: string;
    readonly button?: { readonly text: string; readonly url: string };
    readonly imageId?: string;
    readonly isTest?: boolean;
    readonly now: Date;
  }): Promise<{ readonly broadcastId: string }>;
}

export interface CountAdminBroadcastAudienceHandler {
  execute(input: {
    readonly actor: Actor;
    readonly targetAudience?: string;
    readonly targetEventId?: string;
    readonly targetOrderStatus?: string;
  }): Promise<{
    readonly recipientCount: number;
    readonly truncated: boolean;
    readonly limit: number;
  }>;
}

export interface StoreAdminBroadcastImageHandler {
  execute(input: {
    readonly actor: Actor;
    readonly contentBase64: string;
  }): Promise<{
    readonly imageId: string;
    readonly mimeType: "image/png" | "image/jpeg";
    readonly byteSize: number;
    readonly width: number;
    readonly height: number;
  }>;
}

export interface ListAdminBroadcastsHandler {
  execute(input: { readonly actor: Actor }): Promise<{ readonly items: readonly unknown[] }>;
}

export interface AdminBroadcastHandlers {
  readonly create: CreateAdminBroadcastHandler;
  readonly audience: CountAdminBroadcastAudienceHandler;
  readonly image: StoreAdminBroadcastImageHandler;
  readonly list: ListAdminBroadcastsHandler;
}

@Controller("api/v1/broadcasts")
export class AdminBroadcastController {
  constructor(
    @Inject(ADMIN_BROADCAST_HANDLERS)
    private readonly handlers: AdminBroadcastHandlers
  ) {}

  @Get()
  @RequireAdminPermission("broadcasts.send")
  async list(
    @Req() request: AuthenticatedAdminRequest
  ): Promise<{ readonly items: readonly unknown[] }> {
    const actor = requireActor(request);
    try {
      return await this.handlers.list.execute({ actor });
    } catch (error) {
      throw mapBroadcastError(error);
    }
  }

  // Объявлен до `create`, иначе Nest не различит их по методу: маршрут узкий и только на чтение.
  @Get("audience")
  @RequireAdminPermission("broadcasts.send")
  async audience(
    @Query() queryParameters: unknown,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<{
    readonly recipientCount: number;
    readonly truncated: boolean;
    readonly limit: number;
  }> {
    const actor = requireActor(request);
    const parsed = audienceQuerySchema.safeParse(queryParameters);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_BROADCAST_REQUEST",
        title: "Broadcast request is invalid"
      });
    }

    try {
      return await this.handlers.audience.execute({
        actor,
        ...(parsed.data.targetAudience === undefined
          ? {}
          : { targetAudience: parsed.data.targetAudience }),
        ...(parsed.data.targetEventId === undefined
          ? {}
          : { targetEventId: parsed.data.targetEventId }),
        ...(parsed.data.targetOrderStatus === undefined
          ? {}
          : { targetOrderStatus: parsed.data.targetOrderStatus })
      });
    } catch (error) {
      throw mapBroadcastError(error);
    }
  }

  @Post()
  @RequireAdminPermission("broadcasts.send")
  async create(
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<{ readonly broadcastId: string }> {
    const actor = requireActor(request);
    const parsed = createBroadcastBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_BROADCAST_REQUEST",
        title: "Broadcast request is invalid"
      });
    }

    try {
      return await this.handlers.create.execute({
        actor,
        messageText: parsed.data.messageText,
        ...(parsed.data.targetAudience === undefined
          ? {}
          : { targetAudience: parsed.data.targetAudience }),
        ...(parsed.data.targetEventId === undefined
          ? {}
          : { targetEventId: parsed.data.targetEventId }),
        ...(parsed.data.targetOrderStatus === undefined
          ? {}
          : { targetOrderStatus: parsed.data.targetOrderStatus }),
        ...(parsed.data.button === undefined ? {} : { button: parsed.data.button }),
        ...(parsed.data.imageId === undefined ? {} : { imageId: parsed.data.imageId }),
        ...(parsed.data.isTest === undefined ? {} : { isTest: parsed.data.isTest }),
        now: new Date()
      });
    } catch (error) {
      throw mapBroadcastError(error);
    }
  }
}

@Controller("api/v1/broadcast-images")
export class AdminBroadcastImageController {
  constructor(
    @Inject(ADMIN_BROADCAST_HANDLERS)
    private readonly handlers: AdminBroadcastHandlers
  ) {}

  @Post()
  @RequireAdminPermission("broadcasts.send")
  async upload(
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<{
    readonly imageId: string;
    readonly mimeType: "image/png" | "image/jpeg";
    readonly byteSize: number;
    readonly width: number;
    readonly height: number;
  }> {
    const actor = requireActor(request);
    const parsed = uploadImageBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_BROADCAST_IMAGE",
        title: "Broadcast image is invalid"
      });
    }

    try {
      return await this.handlers.image.execute({
        actor,
        contentBase64: parsed.data.contentBase64
      });
    } catch (error) {
      throw mapBroadcastError(error);
    }
  }
}

@Module({})
export class AdminBroadcastApiModule {
  static register(handlers: AdminBroadcastHandlers): DynamicModule {
    return {
      module: AdminBroadcastApiModule,
      controllers: [AdminBroadcastController, AdminBroadcastImageController],
      providers: [{ provide: ADMIN_BROADCAST_HANDLERS, useValue: handlers }]
    };
  }
}

function requireActor(
  request: AuthenticatedAdminRequest
): NonNullable<AuthenticatedAdminRequest["adminActor"]> {
  if (!request.adminActor) {
    throw new UnauthorizedException();
  }
  return request.adminActor;
}

function mapBroadcastError(error: unknown): unknown {
  if (
    error instanceof Error
    && error.message.startsWith("Administrator ")
    && error.message.endsWith(" is invalid")
  ) {
    return new BadRequestException({
      code: "INVALID_BROADCAST_REQUEST",
      title: "Broadcast request is invalid"
    });
  }
  // Про картинку отвечаем отдельным кодом: «проверьте текст и условия» на негодный файл
  // отправляет админа искать ошибку не там.
  if (error instanceof Error && error.message.startsWith("Broadcast image ")) {
    return new BadRequestException({
      code: "INVALID_BROADCAST_IMAGE",
      title: "Broadcast image is invalid"
    });
  }
  if (error instanceof Error && error.message.startsWith("Broadcast ")) {
    return new BadRequestException({
      code: "INVALID_BROADCAST_REQUEST",
      title: "Broadcast request is invalid"
    });
  }
  return error;
}
