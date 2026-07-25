import {
  BadRequestException,
  Body,
  Controller,
  DynamicModule,
  Headers,
  Inject,
  Module,
  Param,
  Post,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import type {
  ConfirmPaymentCommand,
  ConfirmPaymentResult
} from "@ticket-platform/application";
import { z } from "zod";
import {
  RequireAdminPermission,
  type AuthenticatedAdminRequest
} from "./admin-auth.js";

const CONFIRM_MANUAL_PAYMENT = Symbol("CONFIRM_MANUAL_PAYMENT");

const manualPaymentBodySchema = z.object({
  amountKopecks: z.string().regex(/^[1-9]\d{0,19}$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
  method: z.enum(["cash", "bank_transfer", "other"]),
  externalReference: z.string().trim().min(1).max(120),
  reason: z.string().trim().min(3).max(500)
}).strict();

export interface ConfirmManualPaymentHandler {
  execute(command: ConfirmPaymentCommand): Promise<ConfirmPaymentResult>;
}

@Controller("api/v1/orders")
export class ManualPaymentsController {
  constructor(
    @Inject(CONFIRM_MANUAL_PAYMENT)
    private readonly confirmPayment: ConfirmManualPaymentHandler
  ) {}

  @Post(":id/manual-payment")
  @RequireAdminPermission("orders.manual_paid")
  async execute(
    @Param("id") orderId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("x-request-id") requestId: string | undefined,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<ConfirmPaymentResult> {
    const parsedOrderId = z.string().uuid().safeParse(orderId);
    const parsedBody = manualPaymentBodySchema.safeParse(body);
    if (!parsedOrderId.success || !parsedBody.success) {
      throw new BadRequestException({
        code: "INVALID_MANUAL_PAYMENT_REQUEST",
        title: "Manual payment request is invalid"
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
    if (requestId !== undefined && requestId.length > 200) {
      throw new BadRequestException({
        code: "INVALID_REQUEST_ID",
        title: "X-Request-Id header is invalid"
      });
    }

    const actor = request.adminActor;
    if (!actor) {
      throw new UnauthorizedException();
    }

    return await this.confirmPayment.execute({
      orderId: parsedOrderId.data,
      idempotencyKey,
      source: "manual",
      amountKopecks: parsedBody.data.amountKopecks,
      currency: parsedBody.data.currency,
      confirmedAt: new Date(),
      actor: {
        type: "admin",
        adminId: actor.adminId
      },
      manualEvidence: {
        method: parsedBody.data.method,
        externalReference: parsedBody.data.externalReference,
        reason: parsedBody.data.reason,
        requestId: requestId ?? null
      }
    });
  }
}

@Module({})
export class ManualPaymentsApiModule {
  static register(confirmPayment: ConfirmManualPaymentHandler): DynamicModule {
    return {
      module: ManualPaymentsApiModule,
      controllers: [ManualPaymentsController],
      providers: [{ provide: CONFIRM_MANUAL_PAYMENT, useValue: confirmPayment }]
    };
  }
}
