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

const CREATE_ADMIN_BROADCAST = Symbol("CREATE_ADMIN_BROADCAST");
const COUNT_ADMIN_BROADCAST_AUDIENCE = Symbol("COUNT_ADMIN_BROADCAST_AUDIENCE");

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

const createBroadcastBodySchema = z.object({
  messageText: z.string().trim().min(1).max(3_500),
  targetEventId: z.string().uuid().optional(),
  targetOrderStatus: orderStatusSchema.optional(),
  isTest: z.boolean().optional()
}).strict();

const audienceQuerySchema = z.object({
  targetEventId: z.string().uuid().optional(),
  targetOrderStatus: orderStatusSchema.optional()
}).strict();

export interface CreateAdminBroadcastHandler {
  execute(input: {
    readonly actor: NonNullable<AuthenticatedAdminRequest["adminActor"]>;
    readonly messageText: string;
    readonly targetEventId?: string;
    readonly targetOrderStatus?: string;
    readonly isTest?: boolean;
    readonly now: Date;
  }): Promise<{ readonly broadcastId: string }>;
}

export interface CountAdminBroadcastAudienceHandler {
  execute(input: {
    readonly actor: NonNullable<AuthenticatedAdminRequest["adminActor"]>;
    readonly targetEventId?: string;
    readonly targetOrderStatus?: string;
  }): Promise<{
    readonly recipientCount: number;
    readonly truncated: boolean;
    readonly limit: number;
  }>;
}

@Controller("api/v1/broadcasts")
export class AdminBroadcastController {
  constructor(
    @Inject(CREATE_ADMIN_BROADCAST)
    private readonly handler: CreateAdminBroadcastHandler,
    @Inject(COUNT_ADMIN_BROADCAST_AUDIENCE)
    private readonly audienceHandler: CountAdminBroadcastAudienceHandler
  ) {}

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
      return await this.audienceHandler.execute({
        actor,
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
      return await this.handler.execute({
        actor,
        messageText: parsed.data.messageText,
        ...(parsed.data.targetEventId === undefined
          ? {}
          : { targetEventId: parsed.data.targetEventId }),
        ...(parsed.data.targetOrderStatus === undefined
          ? {}
          : { targetOrderStatus: parsed.data.targetOrderStatus }),
        ...(parsed.data.isTest === undefined ? {} : { isTest: parsed.data.isTest }),
        now: new Date()
      });
    } catch (error) {
      throw mapBroadcastError(error);
    }
  }
}

@Module({})
export class AdminBroadcastApiModule {
  static register(
    handler: CreateAdminBroadcastHandler,
    audienceHandler: CountAdminBroadcastAudienceHandler
  ): DynamicModule {
    return {
      module: AdminBroadcastApiModule,
      controllers: [AdminBroadcastController],
      providers: [
        { provide: CREATE_ADMIN_BROADCAST, useValue: handler },
        { provide: COUNT_ADMIN_BROADCAST_AUDIENCE, useValue: audienceHandler }
      ]
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
  if (error instanceof Error && error.message.startsWith("Broadcast ")) {
    return new BadRequestException({
      code: "INVALID_BROADCAST_REQUEST",
      title: "Broadcast request is invalid"
    });
  }
  return error;
}
