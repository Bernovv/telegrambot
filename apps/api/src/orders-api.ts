import {
  BadRequestException,
  Body,
  Controller,
  DynamicModule,
  Headers,
  Inject,
  Module,
  Post
} from "@nestjs/common";
import type {
  CreateOrderCommand,
  CreateOrderResult
} from "@ticket-platform/contracts";
import { z } from "zod";
import { RequireAdminPermission } from "./admin-auth.js";

const CREATE_ORDER = Symbol("CREATE_ORDER");

const walletSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }).strict(),
  z.object({ mode: z.literal("all") }).strict(),
  z.object({
    mode: z.literal("amount"),
    amountKopecks: z.string().regex(/^\d+$/).max(20)
  }).strict()
]);

const createOrderBodySchema = z.object({
  userId: z.string().uuid(),
  eventId: z.string().uuid(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  items: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().int().min(1).max(100)
  }).strict()).min(1).max(20),
  wallet: walletSchema
}).strict();

export interface CreateOrderCommandHandler {
  execute(command: CreateOrderCommand): Promise<CreateOrderResult>;
}

@Controller("api/v1/orders")
export class OrdersController {
  constructor(
    @Inject(CREATE_ORDER)
    private readonly createOrder: CreateOrderCommandHandler
  ) {}

  @Post()
  @RequireAdminPermission("orders.create")
  async execute(
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined
  ): Promise<CreateOrderResult> {
    const parsed = createOrderBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_ORDER_REQUEST",
        title: "Order request is invalid"
      });
    }
    if (
      !idempotencyKey
      || idempotencyKey.length < 8
      || idempotencyKey.length > 200
      || !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey)
    ) {
      throw new BadRequestException({
        code: "INVALID_IDEMPOTENCY_KEY",
        title: "Idempotency-Key header is invalid"
      });
    }

    return await this.createOrder.execute({
      ...parsed.data,
      idempotencyKey,
      source: "admin",
      createdAt: new Date()
    });
  }
}

@Module({})
export class OrdersApiModule {
  static register(createOrder: CreateOrderCommandHandler): DynamicModule {
    return {
      module: OrdersApiModule,
      controllers: [OrdersController],
      providers: [{ provide: CREATE_ORDER, useValue: createOrder }]
    };
  }
}
