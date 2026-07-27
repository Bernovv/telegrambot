import {
  Body,
  Controller,
  DynamicModule,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Injectable,
  Module,
  PayloadTooLargeException,
  Post,
  UnauthorizedException
} from "@nestjs/common";
import type { VerifiedTBankWebhook } from "@ticket-platform/application";
import type { Logger } from "@ticket-platform/observability";

const TBANK_WEBHOOK_CONFIG = Symbol("TBANK_WEBHOOK_CONFIG");
const TBANK_WEBHOOK_VERIFIER = Symbol("TBANK_WEBHOOK_VERIFIER");
const TBANK_WEBHOOK_HANDLER = Symbol("TBANK_WEBHOOK_HANDLER");
const TBANK_WEBHOOK_LOGGER = Symbol("TBANK_WEBHOOK_LOGGER");

export interface TBankWebhookEndpointConfig {
  readonly bodyLimitBytes: number;
}

export interface TBankWebhookVerifier {
  verifyWebhook(payload: unknown): VerifiedTBankWebhook;
}

export interface TBankWebhookHandler {
  execute(event: VerifiedTBankWebhook, receivedAt: Date): Promise<void>;
}

@Injectable()
export class TBankWebhookService {
  constructor(
    @Inject(TBANK_WEBHOOK_CONFIG)
    private readonly config: TBankWebhookEndpointConfig,
    @Inject(TBANK_WEBHOOK_VERIFIER)
    private readonly verifier: TBankWebhookVerifier,
    @Inject(TBANK_WEBHOOK_HANDLER)
    private readonly handler: TBankWebhookHandler,
    @Inject(TBANK_WEBHOOK_LOGGER)
    private readonly logger: Logger
  ) {}

  async receive(body: unknown, receivedAt: Date): Promise<void> {
    const serializedBytes = Buffer.byteLength(JSON.stringify(body), "utf8");
    if (serializedBytes > this.config.bodyLimitBytes) {
      throw new PayloadTooLargeException();
    }

    let event: VerifiedTBankWebhook;
    try {
      event = this.verifier.verifyWebhook(body);
    } catch (error) {
      // Temporary diagnostic logging while validating the first live webhook in production.
      // T-Bank webhook bodies never include full card numbers or CVV, only masked data, so this
      // is safe to log. Remove once the launch-verification purchase succeeds end to end.
      this.logger.error("tbank webhook rejected", {
        errorMessage: error instanceof Error ? error.message : String(error),
        body
      });
      throw new UnauthorizedException();
    }
    await this.handler.execute(event, receivedAt);
  }
}

@Controller("webhooks/payments/tbank")
export class TBankWebhookController {
  constructor(
    @Inject(TBankWebhookService)
    private readonly webhook: TBankWebhookService
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @Header("content-type", "text/plain; charset=utf-8")
  async receive(@Body() body: unknown): Promise<string> {
    await this.webhook.receive(body, new Date());
    return "OK";
  }
}

@Module({})
export class TBankWebhookModule {
  static register(
    config: TBankWebhookEndpointConfig,
    verifier: TBankWebhookVerifier,
    handler: TBankWebhookHandler,
    logger: Logger
  ): DynamicModule {
    return {
      module: TBankWebhookModule,
      controllers: [TBankWebhookController],
      providers: [
        TBankWebhookService,
        { provide: TBANK_WEBHOOK_CONFIG, useValue: config },
        { provide: TBANK_WEBHOOK_VERIFIER, useValue: verifier },
        { provide: TBANK_WEBHOOK_HANDLER, useValue: handler },
        { provide: TBANK_WEBHOOK_LOGGER, useValue: logger }
      ]
    };
  }
}
