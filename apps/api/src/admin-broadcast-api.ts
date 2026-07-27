import {
  BadRequestException,
  Body,
  Controller,
  DynamicModule,
  Inject,
  Module,
  Post,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import { z } from "zod";
import {
  RequireAdminPermission,
  type AuthenticatedAdminRequest
} from "./admin-auth.js";

const CREATE_ADMIN_BROADCAST = Symbol("CREATE_ADMIN_BROADCAST");

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
  targetOrderStatus: orderStatusSchema.optional()
}).strict();

export interface CreateAdminBroadcastHandler {
  execute(input: {
    readonly actor: NonNullable<AuthenticatedAdminRequest["adminActor"]>;
    readonly messageText: string;
    readonly targetEventId?: string;
    readonly targetOrderStatus?: string;
    readonly now: Date;
  }): Promise<{ readonly broadcastId: string }>;
}

@Controller("api/v1/broadcasts")
export class AdminBroadcastController {
  constructor(
    @Inject(CREATE_ADMIN_BROADCAST)
    private readonly handler: CreateAdminBroadcastHandler
  ) {}

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
        now: new Date()
      });
    } catch (error) {
      throw mapBroadcastError(error);
    }
  }
}

@Module({})
export class AdminBroadcastApiModule {
  static register(handler: CreateAdminBroadcastHandler): DynamicModule {
    return {
      module: AdminBroadcastApiModule,
      controllers: [AdminBroadcastController],
      providers: [{ provide: CREATE_ADMIN_BROADCAST, useValue: handler }]
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
