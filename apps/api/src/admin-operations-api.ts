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
  AdminOrderDetail,
  AdminOrderSummary,
  AdminUserDetail,
  AdminUserSummary,
  CursorPage
} from "@ticket-platform/contracts";
import { z } from "zod";
import {
  RequireAdminPermission,
  type AuthenticatedAdminRequest
} from "./admin-auth.js";

const ADMIN_OPERATIONS = Symbol("ADMIN_OPERATIONS");
const idSchema = z.string().uuid();
const cursorSchema = z.string().regex(/^[A-Za-z0-9_-]{20,300}$/);

const userListQuerySchema = z.object({
  search: z.string().trim().min(2).max(100).optional(),
  blocked: z.enum(["true", "false"]).optional(),
  cursor: cursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
}).strict();

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

const cancelOrderBodySchema = z.object({
  reason: z.string().trim().min(3).max(500)
}).strict();

const orderListQuerySchema = z.object({
  search: z.string().trim().min(2).max(100).optional(),
  status: orderStatusSchema.optional(),
  userId: idSchema.optional(),
  eventId: idSchema.optional(),
  includeExcluded: z.enum(["true", "false"]).optional(),
  cursor: cursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
}).strict();

export interface AdminOperationsHandlers {
  readonly listUsers: {
    execute(input: {
      readonly actor: NonNullable<AuthenticatedAdminRequest["adminActor"]>;
      readonly search?: string;
      readonly blocked?: boolean;
      readonly cursor?: string;
      readonly limit?: number;
    }): Promise<CursorPage<AdminUserSummary>>;
  };
  readonly getUser: {
    execute(input: {
      readonly actor: NonNullable<AuthenticatedAdminRequest["adminActor"]>;
      readonly userId: string;
    }): Promise<AdminUserDetail | null>;
  };
  readonly listOrders: {
    execute(input: {
      readonly actor: NonNullable<AuthenticatedAdminRequest["adminActor"]>;
      readonly search?: string;
      readonly status?: string;
      readonly userId?: string;
      readonly eventId?: string;
      readonly includeExcluded?: boolean;
      readonly cursor?: string;
      readonly limit?: number;
    }): Promise<CursorPage<AdminOrderSummary>>;
  };
  readonly cancelOrder?: {
    execute(input: {
      readonly actor: NonNullable<AuthenticatedAdminRequest["adminActor"]>;
      readonly orderId: string;
      readonly reason: string;
      readonly now: Date;
    }): Promise<{
      readonly orderNumber: string;
      readonly walletReleasedKopecks: string;
    }>;
  };
  readonly getOrder: {
    execute(input: {
      readonly actor: NonNullable<AuthenticatedAdminRequest["adminActor"]>;
      readonly orderId: string;
    }): Promise<AdminOrderDetail | null>;
  };
}

@Controller("api/v1/users")
export class AdminUsersController {
  constructor(
    @Inject(ADMIN_OPERATIONS)
    private readonly handlers: AdminOperationsHandlers
  ) {}

  @Get()
  @RequireAdminPermission("users.read")
  async list(
    @Query() query: unknown,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<CursorPage<AdminUserSummary>> {
    const actor = requireActor(request);
    const parsed = userListQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw invalidAdminQuery();
    }
    try {
      return await this.handlers.listUsers.execute({
        actor,
        ...(parsed.data.search === undefined
          ? {}
          : { search: parsed.data.search }),
        ...(parsed.data.blocked === undefined
          ? {}
          : { blocked: parsed.data.blocked === "true" }),
        ...(parsed.data.cursor === undefined
          ? {}
          : { cursor: parsed.data.cursor }),
        ...(parsed.data.limit === undefined
          ? {}
          : { limit: parsed.data.limit })
      });
    } catch (error) {
      throw mapReadError(error);
    }
  }

  @Get(":id")
  @RequireAdminPermission("users.read")
  async get(
    @Param("id") userId: string,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<AdminUserDetail> {
    const actor = requireActor(request);
    const parsed = idSchema.safeParse(userId);
    if (!parsed.success) {
      throw invalidAdminQuery();
    }
    const user = await this.handlers.getUser.execute({
      actor,
      userId: parsed.data
    });
    if (!user) {
      throw new NotFoundException({
        code: "ADMIN_USER_NOT_FOUND",
        title: "User was not found"
      });
    }
    return user;
  }
}

@Controller("api/v1/orders")
export class AdminOrdersReadController {
  constructor(
    @Inject(ADMIN_OPERATIONS)
    private readonly handlers: AdminOperationsHandlers
  ) {}

  @Get()
  @RequireAdminPermission("orders.read")
  async list(
    @Query() query: unknown,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<CursorPage<AdminOrderSummary>> {
    const actor = requireActor(request);
    const parsed = orderListQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw invalidAdminQuery();
    }
    try {
      return await this.handlers.listOrders.execute({
        actor,
        ...(parsed.data.search === undefined
          ? {}
          : { search: parsed.data.search }),
        ...(parsed.data.status === undefined
          ? {}
          : { status: parsed.data.status }),
        ...(parsed.data.userId === undefined
          ? {}
          : { userId: parsed.data.userId }),
        ...(parsed.data.eventId === undefined
          ? {}
          : { eventId: parsed.data.eventId }),
        ...(parsed.data.includeExcluded === undefined
          ? {}
          : { includeExcluded: parsed.data.includeExcluded === "true" }),
        ...(parsed.data.cursor === undefined
          ? {}
          : { cursor: parsed.data.cursor }),
        ...(parsed.data.limit === undefined
          ? {}
          : { limit: parsed.data.limit })
      });
    } catch (error) {
      throw mapReadError(error);
    }
  }

  @Get(":id")
  @RequireAdminPermission("orders.read")
  async get(
    @Param("id") orderId: string,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<AdminOrderDetail> {
    const actor = requireActor(request);
    const parsed = idSchema.safeParse(orderId);
    if (!parsed.success) {
      throw invalidAdminQuery();
    }
    const order = await this.handlers.getOrder.execute({
      actor,
      orderId: parsed.data
    });
    if (!order) {
      throw new NotFoundException({
        code: "ADMIN_ORDER_NOT_FOUND",
        title: "Order was not found"
      });
    }
    return order;
  }

  @Post(":id/cancel")
  @RequireAdminPermission("orders.cancel")
  async cancel(
    @Param("id") orderId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ) {
    const actor = requireActor(request);
    const parsedId = idSchema.safeParse(orderId);
    const parsedBody = cancelOrderBodySchema.safeParse(body);
    if (!parsedId.success || !parsedBody.success) {
      throw invalidAdminQuery();
    }
    if (!this.handlers.cancelOrder) {
      throw new NotFoundException({
        code: "ADMIN_ORDER_CANCEL_UNAVAILABLE",
        title: "Order cancellation is not configured"
      });
    }
    try {
      return await this.handlers.cancelOrder.execute({
        actor,
        orderId: parsedId.data,
        reason: parsedBody.data.reason,
        now: new Date()
      });
    } catch (error) {
      if (error instanceof Error && error.message === "Order was not found") {
        throw new NotFoundException({
          code: "ADMIN_ORDER_NOT_FOUND",
          title: "Order was not found"
        });
      }
      if (
        error instanceof Error
        && (
          error.message.startsWith("Order in status ")
          || error.message.startsWith("Order cancellation ")
          || error.message.startsWith("Administrator order cancellation ")
          || error.message.includes("cannot transition")
        )
      ) {
        throw new BadRequestException({
          code: "ADMIN_ORDER_NOT_CANCELLABLE",
          title: "Этот заказ отменить нельзя"
        });
      }
      throw error;
    }
  }
}

@Module({})
export class AdminOperationsApiModule {
  static register(handlers: AdminOperationsHandlers): DynamicModule {
    return {
      module: AdminOperationsApiModule,
      controllers: [AdminUsersController, AdminOrdersReadController],
      providers: [{ provide: ADMIN_OPERATIONS, useValue: handlers }]
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

function invalidAdminQuery(): BadRequestException {
  return new BadRequestException({
    code: "INVALID_ADMIN_READ_QUERY",
    title: "Administrator read query is invalid"
  });
}

function mapReadError(error: unknown): unknown {
  if (
    error instanceof Error
    && error.message.startsWith("Administrator ")
    && error.message.endsWith(" is invalid")
  ) {
    return invalidAdminQuery();
  }
  return error;
}
