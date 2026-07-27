import "reflect-metadata";
import {
  Controller,
  DynamicModule,
  Get,
  Inject,
  Module,
  Res
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication
} from "@nestjs/platform-fastify";
import {
  getLivenessSnapshot,
  isReadyStatus,
  type ReadinessCheck
} from "@ticket-platform/application";
import type { TelegramUpdateProcessor } from "@ticket-platform/messenger-telegram";
import type { FastifyReply } from "fastify";
import {
  AdminAuthorizationModule,
  RequireAdminPermission,
  type AdminAuthorizationModuleOptions
} from "./admin-auth.js";
import {
  TelegramWebhookModule,
  type TelegramWebhookEndpointConfig
} from "./telegram-webhook.js";
import {
  OrdersApiModule,
  type CreateOrderCommandHandler
} from "./orders-api.js";
import {
  ManualPaymentsApiModule,
  type ConfirmManualPaymentHandler
} from "./manual-payments-api.js";
import {
  FullRefundsApiModule,
  type RequestFullRefundHandler
} from "./full-refunds-api.js";
import {
  AdminOperationsApiModule,
  type AdminOperationsHandlers
} from "./admin-operations-api.js";
import {
  AdminEventsApiModule,
  type AdminEventsHandlers
} from "./admin-events-api.js";
import {
  ParticipantsExportApiModule,
  type ExportParticipantsHandler
} from "./participants-export-api.js";
import {
  AdminBroadcastApiModule,
  type CreateAdminBroadcastHandler
} from "./admin-broadcast-api.js";
import {
  TBankWebhookModule,
  type TBankWebhookEndpointConfig,
  type TBankWebhookHandler,
  type TBankWebhookVerifier
} from "./tbank-webhook.js";

const APP_VERSION = Symbol("APP_VERSION");
const READINESS_CHECK = Symbol("READINESS_CHECK");

@Controller("health")
class HealthController {
  constructor(
    @Inject(APP_VERSION) private readonly version: string,
    @Inject(READINESS_CHECK) private readonly readiness: ReadinessCheck
  ) {}

  @Get()
  health() {
    return this.live();
  }

  @Get("live")
  live() {
    return getLivenessSnapshot("api", this.version);
  }

  @Get("ready")
  async ready(@Res({ passthrough: true }) response: FastifyReply) {
    const report = await this.readiness.execute();

    if (!isReadyStatus(report.status)) {
      response.status(503);
    }

    return {
      service: report.service,
      status: report.status,
      version: report.version,
      checkedAt: report.checkedAt
    };
  }
}

@Controller("api/v1/operations")
class OperationsController {
  constructor(
    @Inject(READINESS_CHECK) private readonly readiness: ReadinessCheck
  ) {}

  @Get("health")
  @RequireAdminPermission("system.read")
  health() {
    return this.readiness.execute();
  }
}

export interface ApiApplicationOptions {
  readonly appVersion: string;
  readonly bodyLimitBytes: number;
  readonly readiness: ReadinessCheck;
  readonly adminAuth?: AdminAuthorizationModuleOptions;
  readonly orders?: CreateOrderCommandHandler;
  readonly manualPayments?: ConfirmManualPaymentHandler;
  readonly fullRefunds?: RequestFullRefundHandler;
  readonly adminOperations?: AdminOperationsHandlers;
  readonly adminEvents?: AdminEventsHandlers;
  readonly participantsExport?: ExportParticipantsHandler;
  readonly adminBroadcast?: CreateAdminBroadcastHandler;
  readonly tbankWebhook?: {
    readonly config: TBankWebhookEndpointConfig;
    readonly verifier: TBankWebhookVerifier;
    readonly handler: TBankWebhookHandler;
  };
  readonly webhook?: {
    readonly config: TelegramWebhookEndpointConfig;
    readonly processor: TelegramUpdateProcessor;
  };
}

@Module({})
class ApiModule {
  static register(options: ApiApplicationOptions): DynamicModule {
    return {
      module: ApiModule,
      imports: [
        ...(options.webhook
          ? [TelegramWebhookModule.register(options.webhook.config, options.webhook.processor)]
          : []),
        ...(options.adminAuth
          ? [AdminAuthorizationModule.register(options.adminAuth)]
          : []),
        ...(options.orders ? [OrdersApiModule.register(options.orders)] : []),
        ...(options.manualPayments
          ? [ManualPaymentsApiModule.register(options.manualPayments)]
          : []),
        ...(options.fullRefunds
          ? [FullRefundsApiModule.register(options.fullRefunds)]
          : []),
        ...(options.adminOperations
          ? [AdminOperationsApiModule.register(options.adminOperations)]
          : []),
        ...(options.adminEvents
          ? [AdminEventsApiModule.register(options.adminEvents)]
          : []),
        ...(options.participantsExport
          ? [ParticipantsExportApiModule.register(options.participantsExport)]
          : []),
        ...(options.adminBroadcast
          ? [AdminBroadcastApiModule.register(options.adminBroadcast)]
          : []),
        ...(options.tbankWebhook
          ? [TBankWebhookModule.register(
              options.tbankWebhook.config,
              options.tbankWebhook.verifier,
              options.tbankWebhook.handler
            )]
          : [])
      ],
      controllers: [
        HealthController,
        ...(options.adminAuth ? [OperationsController] : [])
      ],
      providers: [
        { provide: APP_VERSION, useValue: options.appVersion },
        { provide: READINESS_CHECK, useValue: options.readiness }
      ]
    };
  }
}

export async function createApiApplication(
  options: ApiApplicationOptions
): Promise<NestFastifyApplication> {
  if (
    (
      options.orders
      || options.manualPayments
      || options.fullRefunds
      || options.adminOperations
      || options.adminEvents
      || options.participantsExport
      || options.adminBroadcast
    )
    && !options.adminAuth
  ) {
    throw new Error("Administrator APIs require administrator authentication");
  }

  return NestFactory.create<NestFastifyApplication>(
    ApiModule.register(options),
    new FastifyAdapter({ bodyLimit: options.bodyLimitBytes }),
    { logger: false, abortOnError: false }
  );
}
