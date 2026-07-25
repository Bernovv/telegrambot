import { createHash, timingSafeEqual } from "node:crypto";
import {
  BadRequestException,
  Body,
  Controller,
  DynamicModule,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  UnauthorizedException
} from "@nestjs/common";
import type {
  TelegramUpdate,
  TelegramUpdateProcessor
} from "@ticket-platform/messenger-telegram";
import { z } from "zod";

const WEBHOOK_CONFIG = Symbol("TELEGRAM_WEBHOOK_CONFIG");
const UPDATE_PROCESSOR = Symbol("TELEGRAM_UPDATE_PROCESSOR");

const telegramUserSchema = z.object({
  id: z.number().int(),
  is_bot: z.boolean(),
  first_name: z.string()
}).passthrough();

const telegramChatSchema = z.object({
  id: z.number().int(),
  type: z.enum(["private", "group", "supergroup", "channel"])
}).passthrough();

const telegramMessageSchema = z.object({
  message_id: z.number().int(),
  date: z.number().int().nonnegative(),
  chat: telegramChatSchema,
  from: telegramUserSchema.optional(),
  text: z.string().optional(),
  contact: z.object({
    phone_number: z.string(),
    first_name: z.string(),
    user_id: z.number().int().optional()
  }).passthrough().optional()
}).passthrough();

const telegramUpdateSchema = z.object({
  update_id: z.number().int().nonnegative(),
  message: telegramMessageSchema.optional()
}).passthrough();

export interface TelegramWebhookEndpointConfig {
  readonly pathSecret: string;
  readonly headerSecret: string;
}

@Injectable()
export class TelegramWebhookService {
  constructor(
    @Inject(WEBHOOK_CONFIG)
    private readonly config: TelegramWebhookEndpointConfig,
    @Inject(UPDATE_PROCESSOR)
    private readonly processor: TelegramUpdateProcessor
  ) {}

  async receive(pathSecret: string, headerSecret: string | undefined, body: unknown): Promise<void> {
    if (!secretsEqual(pathSecret, this.config.pathSecret)) {
      throw new NotFoundException();
    }

    if (!headerSecret || !secretsEqual(headerSecret, this.config.headerSecret)) {
      throw new UnauthorizedException();
    }

    const parsed = telegramUpdateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("Invalid Telegram update");
    }

    await this.processor.handleUpdate(parsed.data as unknown as TelegramUpdate);
  }
}

@Controller("webhooks/telegram")
export class TelegramWebhookController {
  constructor(
    @Inject(TelegramWebhookService)
    private readonly webhook: TelegramWebhookService
  ) {}

  @Post(":pathSecret")
  @HttpCode(HttpStatus.OK)
  async receive(
    @Param("pathSecret") pathSecret: string,
    @Headers("x-telegram-bot-api-secret-token") headerSecret: string | undefined,
    @Body() body: unknown
  ): Promise<{ readonly ok: true }> {
    await this.webhook.receive(pathSecret, headerSecret, body);
    return { ok: true };
  }
}

@Module({})
export class TelegramWebhookModule {
  static register(
    config: TelegramWebhookEndpointConfig,
    processor: TelegramUpdateProcessor
  ): DynamicModule {
    return {
      module: TelegramWebhookModule,
      controllers: [TelegramWebhookController],
      providers: [
        TelegramWebhookService,
        { provide: WEBHOOK_CONFIG, useValue: config },
        { provide: UPDATE_PROCESSOR, useValue: processor }
      ]
    };
  }
}

function secretsEqual(actual: string, expected: string): boolean {
  const actualDigest = createHash("sha256").update(actual).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}
