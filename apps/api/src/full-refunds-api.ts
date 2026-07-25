import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  DynamicModule,
  Headers,
  Inject,
  Module,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import type {
  RequestFullTBankRefundCommand,
  RequestFullTBankRefundResult
} from "@ticket-platform/application";
import { z } from "zod";
import {
  RequireAdminPermission,
  type AuthenticatedAdminRequest
} from "./admin-auth.js";

const REQUEST_FULL_REFUND = Symbol("REQUEST_FULL_REFUND");

const fullRefundBodySchema = z.object({
  reason: z.string().trim().min(3).max(500)
}).strict();

export interface RequestFullRefundHandler {
  execute(
    command: RequestFullTBankRefundCommand
  ): Promise<RequestFullTBankRefundResult>;
}

@Controller("api/v1/orders")
export class FullRefundsController {
  constructor(
    @Inject(REQUEST_FULL_REFUND)
    private readonly requestRefund: RequestFullRefundHandler
  ) {}

  @Post(":id/refunds/full")
  @RequireAdminPermission("payments.refund")
  async execute(
    @Param("id") orderId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<RequestFullTBankRefundResult> {
    const parsedOrderId = z.string().uuid().safeParse(orderId);
    const parsedBody = fullRefundBodySchema.safeParse(body);
    if (!parsedOrderId.success || !parsedBody.success) {
      throw new BadRequestException({
        code: "INVALID_FULL_REFUND_REQUEST",
        title: "Full refund request is invalid"
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
    const actor = request.adminActor;
    if (!actor) {
      throw new UnauthorizedException();
    }

    try {
      return await this.requestRefund.execute({
        orderId: parsedOrderId.data,
        idempotencyKey,
        reason: parsedBody.data.reason,
        actor,
        requestedAt: new Date()
      });
    } catch (error) {
      if (
        error instanceof Error
        && error.message === "Refundable order was not found"
      ) {
        throw new NotFoundException({
          code: "REFUNDABLE_ORDER_NOT_FOUND",
          title: "Refundable order was not found"
        });
      }
      if (
        error instanceof Error
        && (
          error.message === "Order is not available for a full T-Bank refund"
          || error.message
            === "Refund idempotency key was already used for another request"
        )
      ) {
        throw new ConflictException({
          code: "FULL_REFUND_CONFLICT",
          title: error.message
        });
      }
      throw error;
    }
  }
}

@Module({})
export class FullRefundsApiModule {
  static register(requestRefund: RequestFullRefundHandler): DynamicModule {
    return {
      module: FullRefundsApiModule,
      controllers: [FullRefundsController],
      providers: [{ provide: REQUEST_FULL_REFUND, useValue: requestRefund }]
    };
  }
}
