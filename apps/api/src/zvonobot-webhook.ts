import { timingSafeEqual } from "node:crypto";
import {
  Body,
  Controller,
  DynamicModule,
  HttpCode,
  HttpStatus,
  Inject,
  Injectable,
  Module,
  Param,
  PayloadTooLargeException,
  Post,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import { InvalidZvonobotCallError } from "@ticket-platform/application";
import type { Logger } from "@ticket-platform/observability";
import type { FastifyRequest } from "fastify";

const ZVONOBOT_WEBHOOK_CONFIG = Symbol("ZVONOBOT_WEBHOOK_CONFIG");
const ZVONOBOT_WEBHOOK_HANDLER = Symbol("ZVONOBOT_WEBHOOK_HANDLER");
const ZVONOBOT_WEBHOOK_LOGGER = Symbol("ZVONOBOT_WEBHOOK_LOGGER");

/** Тело вебхука заведомо небольшое: это отчёт об одном звонке, а не выгрузка. */
export const ZVONOBOT_BODY_LIMIT_BYTES = 64 * 1024;

export interface ZvonobotWebhookEndpointConfig {
  /**
   * Ключ, без которого путь не отвечает.
   *
   * Проверяется и в пути, и в заголовке: настроить у себя вебхук с заголовком умеют не все
   * кабинеты, а поле «адрес» есть всегда. Путь при этом не логируется целиком, иначе ключ
   * лежал бы в журнале nginx открытым.
   */
  readonly secret: string;
  readonly bodyLimitBytes: number;
}

export interface ZvonobotWebhookHandler {
  execute(input: {
    readonly payload: unknown;
    readonly now: Date;
  }): Promise<{ readonly status: "accepted" | "duplicate" }>;
}

@Injectable()
export class ZvonobotWebhookService {
  constructor(
    @Inject(ZVONOBOT_WEBHOOK_CONFIG)
    private readonly config: ZvonobotWebhookEndpointConfig,
    @Inject(ZVONOBOT_WEBHOOK_HANDLER)
    private readonly handler: ZvonobotWebhookHandler,
    @Inject(ZVONOBOT_WEBHOOK_LOGGER)
    private readonly logger: Logger
  ) {}

  async receive(
    key: string,
    headerKey: string | undefined,
    body: unknown,
    now: Date
  ): Promise<{ readonly status: string }> {
    if (!this.authorized(key) && !this.authorized(headerKey ?? "")) {
      // Ни ключа, ни тела в журнал: сюда стучится кто угодно, и записывать содержимое
      // чужих запросов значит собирать мусор, среди которого однажды окажется чей-то номер.
      this.logger.error("zvonobot webhook rejected");
      throw new UnauthorizedException();
    }
    if (Buffer.byteLength(JSON.stringify(body ?? null), "utf8") > this.config.bodyLimitBytes) {
      throw new PayloadTooLargeException();
    }

    try {
      const result = await this.handler.execute({ payload: body, now });
      this.logger.info("zvonobot call received", { status: result.status });
      return { status: result.status };
    } catch (error) {
      if (error instanceof InvalidZvonobotCallError) {
        // Тело не объект — отвечаем «принято» всё равно.
        //
        // Это выглядит неправильно ровно до первой боевой кампании. Ответ, отличный от
        // `200`, для Звонобота значит «повторить», и мусорное тело он будет слать по кругу
        // до конца окна повторов, ничего этим не исправив. Записать нечего, спорить не о
        // чем, и единственное осмысленное действие — принять и забыть.
        this.logger.error("zvonobot webhook payload not an object");
        return { status: "ignored" };
      }
      throw error;
    }
  }

  /** Сравнение постоянного времени: ключ подбирают по времени ответа. */
  private authorized(candidate: string): boolean {
    const expected = Buffer.from(this.config.secret, "utf8");
    const actual = Buffer.from(candidate, "utf8");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}

/**
 * Приёмник обратной связи Звонобота.
 *
 * Ключ стоит в пути, а не в теле: тело придумывает их сторона, а путь настраиваем мы.
 * Адрес получается вида `/api/v1/zvonobot/<ключ>/calls` и целиком является секретом —
 * поэтому он не должен попадать ни в переписку, ни в задачи.
 */
@Controller("api/v1/zvonobot")
export class ZvonobotWebhookController {
  constructor(
    @Inject(ZvonobotWebhookService)
    private readonly webhook: ZvonobotWebhookService
  ) {}

  @Post(":key/calls")
  @HttpCode(HttpStatus.OK)
  receive(
    @Param("key") key: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<{ readonly status: string }> {
    const header = request.headers["x-zvonobot-key"];
    return this.webhook.receive(
      key,
      Array.isArray(header) ? header[0] : header,
      body,
      new Date()
    );
  }
}

@Module({})
export class ZvonobotWebhookModule {
  static register(
    config: ZvonobotWebhookEndpointConfig,
    handler: ZvonobotWebhookHandler,
    logger: Logger
  ): DynamicModule {
    return {
      module: ZvonobotWebhookModule,
      controllers: [ZvonobotWebhookController],
      providers: [
        ZvonobotWebhookService,
        { provide: ZVONOBOT_WEBHOOK_CONFIG, useValue: config },
        { provide: ZVONOBOT_WEBHOOK_HANDLER, useValue: handler },
        { provide: ZVONOBOT_WEBHOOK_LOGGER, useValue: logger }
      ]
    };
  }
}
