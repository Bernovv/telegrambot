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
import type { Logger } from "@ticket-platform/observability";
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
  type AdminBroadcastHandlers
} from "./admin-broadcast-api.js";
import {
  AdminOutreachApiModule,
  type AdminOutreachHandler
} from "./admin-outreach-api.js";
import {
  AdminAccommodationApiModule,
  type AdminAccommodationHandler,
  type AdminEventParticipantsHandler,
  type ImportParticipantsHandler
} from "./admin-accommodation-api.js";
import {
  AdminExpensesApiModule,
  type AdminExpensesHandler
} from "./admin-expenses-api.js";
import {
  AdminInventoryApiModule,
  type AdminInventoryHandler
} from "./admin-inventory-api.js";
import {
  AdminTeamApiModule,
  type AdminTeamHandler
} from "./admin-team-api.js";
import {
  AdminStaffApiModule,
  type AdminStaffHandler
} from "./admin-staff-api.js";
import {
  AdminOverviewApiModule,
  type AdminEventReportHandler,
  type AdminOverviewHandler
} from "./admin-overview-api.js";
import {
  SiteRegistrationApiModule,
  type SiteRegistrationHandler
} from "./site-registration-api.js";
import {
  MaxWebhookModule,
  type MaxWebhookEndpointConfig
} from "./max-webhook.js";
import type { MaxUpdateProcessor } from "@ticket-platform/messenger-max";
import {
  ZvonobotWebhookModule,
  type ZvonobotWebhookEndpointConfig,
  type ZvonobotWebhookHandler
} from "./zvonobot-webhook.js";
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
  readonly adminBroadcast?: AdminBroadcastHandlers;
  readonly adminOutreach?: AdminOutreachHandler;
  readonly adminAccommodation?: AdminAccommodationHandler;
  readonly adminEventParticipants?: AdminEventParticipantsHandler;
  readonly importParticipants?: ImportParticipantsHandler;
  readonly adminExpenses?: AdminExpensesHandler;
  readonly adminInventory?: AdminInventoryHandler;
  readonly adminTeam?: AdminTeamHandler;
  /** Команда кабинета: роли и календари наставников. */
  readonly adminStaff?: AdminStaffHandler;
  readonly adminOverview?: AdminOverviewHandler;
  readonly adminEventReport?: AdminEventReportHandler;
  /** Форма регистрации на сайте. Единственный открытый путь записи, кроме вебхуков. */
  readonly siteRegistration?: {
    readonly handler: SiteRegistrationHandler;
    readonly logger: Logger;
  };
  /** Обратная связь с автообзвона. Поднимается, только когда задан ключ вебхука. */
  readonly zvonobot?: {
    readonly config: ZvonobotWebhookEndpointConfig;
    readonly handler: ZvonobotWebhookHandler;
    readonly logger: Logger;
  };
  readonly tbankWebhook?: {
    readonly config: TBankWebhookEndpointConfig;
    readonly verifier: TBankWebhookVerifier;
    readonly handler: TBankWebhookHandler;
    readonly logger: Logger;
  };
  /** Вебхук MAX. Поднимается только вместе с токеном бота. */
  readonly maxWebhook?: {
    readonly config: MaxWebhookEndpointConfig;
    readonly processor: MaxUpdateProcessor;
    readonly logger: Logger;
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
        ...(options.adminOutreach
          ? [AdminOutreachApiModule.register(options.adminOutreach)]
          : []),
        ...(options.adminAccommodation
          && options.adminEventParticipants
          && options.importParticipants
          ? [AdminAccommodationApiModule.register(
              options.adminAccommodation,
              options.adminEventParticipants,
              options.importParticipants
            )]
          : []),
        ...(options.adminExpenses
          ? [AdminExpensesApiModule.register(options.adminExpenses)]
          : []),
        ...(options.adminInventory
          ? [AdminInventoryApiModule.register(options.adminInventory)]
          : []),
        ...(options.adminTeam
          ? [AdminTeamApiModule.register(options.adminTeam)]
          : []),
        ...(options.adminStaff
          ? [AdminStaffApiModule.register(options.adminStaff)]
          : []),
        ...(options.adminOverview && options.adminEventReport
          ? [AdminOverviewApiModule.register(
              options.adminOverview,
              options.adminEventReport
            )]
          : []),
        ...(options.siteRegistration
          ? [SiteRegistrationApiModule.register(
              options.siteRegistration.handler,
              options.siteRegistration.logger
            )]
          : []),
        ...(options.maxWebhook
          ? [MaxWebhookModule.register(
              options.maxWebhook.config,
              options.maxWebhook.processor,
              options.maxWebhook.logger
            )]
          : []),
        ...(options.zvonobot
          ? [ZvonobotWebhookModule.register(
              options.zvonobot.config,
              options.zvonobot.handler,
              options.zvonobot.logger
            )]
          : []),
        ...(options.tbankWebhook
          ? [TBankWebhookModule.register(
              options.tbankWebhook.config,
              options.tbankWebhook.verifier,
              options.tbankWebhook.handler,
              options.tbankWebhook.logger
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
      || options.adminOutreach
      || options.adminAccommodation
      || options.adminExpenses
      || options.adminInventory
      || options.adminTeam
      || options.adminStaff
      || options.adminOverview
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
