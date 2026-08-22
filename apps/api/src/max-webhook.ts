import { createHash, timingSafeEqual } from "node:crypto";
import {
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
  PayloadTooLargeException,
  Post,
  UnauthorizedException
} from "@nestjs/common";
import type { MaxUpdateProcessor } from "@ticket-platform/messenger-max";
import type { Logger } from "@ticket-platform/observability";

const MAX_WEBHOOK_CONFIG = Symbol("MAX_WEBHOOK_CONFIG");
const MAX_UPDATE_PROCESSOR = Symbol("MAX_UPDATE_PROCESSOR");
const MAX_WEBHOOK_LOGGER = Symbol("MAX_WEBHOOK_LOGGER");

/**
 * Вебхук MAX.
 *
 * Отличий от телеграмного два, и оба идут от их стороны.
 *
 * **Секрет только один.** MAX при подписке принимает поле `secret` и присылает его обратно
 * заголовком `X-Max-Bot-Api-Secret`; отдельного секрета в пути у него нет — адрес мы задаём
 * сами. Поэтому путь тоже делаем секретным: два рубежа лучше одного, и первый отсекает
 * случайного сканера ещё до разбора тела.
 *
 * **Тело не проверяется схемой.** Телеграмный вебхук отвергает то, что не разобралось, и
 * это правильно: формат Telegram описан и стабилен. Формат MAX описан хуже, а незнакомый
 * тип обновления — обычное дело: они их добавляют. Отвергнутое обновление MAX повторит
 * несколько раз и бросит, то есть человек, написавший боту, просто пропадёт. Поэтому
 * принимаем всё, а разбирается пусть транспорт — он знает, какие типы умеет, и молча
 * пропускает остальные.
 */
export interface MaxWebhookEndpointConfig {
  readonly pathSecret: string;
  /** Секрет, который MAX присылает заголовком. Пусто — подписка оформлена без него. */
  readonly headerSecret: string | null;
  readonly bodyLimitBytes: number;
}

@Injectable()
export class MaxWebhookService {
  constructor(
    @Inject(MAX_WEBHOOK_CONFIG)
    private readonly config: MaxWebhookEndpointConfig,
    @Inject(MAX_UPDATE_PROCESSOR)
    private readonly processor: MaxUpdateProcessor,
    @Inject(MAX_WEBHOOK_LOGGER)
    private readonly logger: Logger
  ) {}

  async receive(
    pathSecret: string,
    headerSecret: string | undefined,
    body: unknown
  ): Promise<void> {
    if (!secretsEqual(pathSecret, this.config.pathSecret)) {
      // Именно `404`, а не `401`: чужому сканеру незачем знать, что здесь что-то есть.
      throw new NotFoundException();
    }
    const expectedHeader = this.config.headerSecret;
    if (expectedHeader !== null && !secretsEqual(headerSecret ?? "", expectedHeader)) {
      this.logger.error("max webhook header secret mismatch");
      throw new UnauthorizedException();
    }
    if (Buffer.byteLength(JSON.stringify(body ?? null), "utf8") > this.config.bodyLimitBytes) {
      throw new PayloadTooLargeException();
    }
    if (body === null || typeof body !== "object") {
      // Отвечаем `200` и на такое: повтор мусорного тела ничего не исправит, а несколько
      // повторов подряд — это несколько минут, в течение которых очередь у них занята нами.
      this.logger.error("max webhook payload is not an object");
      return;
    }

    await this.processor.handleUpdate(body);
  }
}

@Controller("webhooks/max")
export class MaxWebhookController {
  constructor(
    @Inject(MaxWebhookService)
    private readonly webhook: MaxWebhookService
  ) {}

  @Post(":pathSecret")
  @HttpCode(HttpStatus.OK)
  async receive(
    @Body() body: unknown,
    @Headers("x-max-bot-api-secret") headerSecret: string | undefined,
    @Headers("x-max-webhook-secret") legacyHeaderSecret: string | undefined,
    @Param("pathSecret") pathSecret: string
  ): Promise<{ readonly ok: true }> {
    await this.webhook.receive(pathSecret, headerSecret ?? legacyHeaderSecret, body);
    return { ok: true };
  }
}

@Module({})
export class MaxWebhookModule {
  static register(
    config: MaxWebhookEndpointConfig,
    processor: MaxUpdateProcessor,
    logger: Logger
  ): DynamicModule {
    return {
      module: MaxWebhookModule,
      controllers: [MaxWebhookController],
      providers: [
        MaxWebhookService,
        { provide: MAX_WEBHOOK_CONFIG, useValue: config },
        { provide: MAX_UPDATE_PROCESSOR, useValue: processor },
        { provide: MAX_WEBHOOK_LOGGER, useValue: logger }
      ]
    };
  }
}

function secretsEqual(actual: string, expected: string): boolean {
  const actualDigest = createHash("sha256").update(actual).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}
