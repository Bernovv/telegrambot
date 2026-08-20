import {
  BadRequestException,
  Body,
  Controller,
  DynamicModule,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Module,
  Post,
  Req
} from "@nestjs/common";
import { InvalidSiteRegistrationError } from "@ticket-platform/application";
import type { SiteRegistrationResponse } from "@ticket-platform/contracts";
import type { Logger } from "@ticket-platform/observability";
import type { FastifyRequest } from "fastify";
import { z } from "zod";

const SITE_REGISTRATION_HANDLER = Symbol("SITE_REGISTRATION_HANDLER");
const SITE_REGISTRATION_LOGGER = Symbol("SITE_REGISTRATION_LOGGER");

export interface SiteRegistrationHandler {
  execute(input: {
    readonly name: string;
    readonly phone: string;
    readonly consent: boolean;
    readonly page?: string;
    readonly now: Date;
  }): Promise<SiteRegistrationResponse>;
}

const requestSchema = z.object({
  name: z.string().min(1).max(300),
  phone: z.string().min(1).max(32),
  consent: z.boolean(),
  page: z.string().max(200).optional()
});

/**
 * Ограничение частоты для формы, за которой не стоит вход.
 *
 * Считаем по адресу и по эндпоинту целиком: первое отсекает случайный повтор и перебор с
 * одной машины, второе — попытку залить в список сотню выдуманных людей с разных адресов.
 * Счётчик в памяти процесса и переживает только его: заявок здесь единицы в день, и ради
 * них заводить общее хранилище — менять понятную защиту на лишнюю зависимость.
 */
export interface SiteRegistrationRateLimits {
  readonly perAddress: number;
  readonly perAddressWindowMs: number;
  readonly total: number;
  readonly totalWindowMs: number;
}

export const DEFAULT_SITE_REGISTRATION_RATE_LIMITS: SiteRegistrationRateLimits = {
  perAddress: 5,
  perAddressWindowMs: 10 * 60 * 1_000,
  total: 60,
  totalWindowMs: 60 * 1_000
};

export class SiteRegistrationRateLimiter {
  private readonly byAddress = new Map<string, number[]>();
  private total: number[] = [];

  constructor(
    private readonly limits: SiteRegistrationRateLimits =
      DEFAULT_SITE_REGISTRATION_RATE_LIMITS
  ) {}

  tryConsume(address: string, now: Date): boolean {
    const at = now.getTime();
    this.total = within(this.total, at, this.limits.totalWindowMs);
    if (this.total.length >= this.limits.total) {
      return false;
    }

    const attempts = within(
      this.byAddress.get(address) ?? [],
      at,
      this.limits.perAddressWindowMs
    );
    if (attempts.length >= this.limits.perAddress) {
      this.byAddress.set(address, attempts);
      return false;
    }

    attempts.push(at);
    this.byAddress.set(address, attempts);
    this.total.push(at);
    // Карта растёт только адресами, которые действительно писали: чистим её по тому же
    // окну, иначе процесс, живущий месяцами, копил бы записи вечно.
    if (this.byAddress.size > 10_000) {
      for (const [key, value] of this.byAddress) {
        if (within(value, at, this.limits.perAddressWindowMs).length === 0) {
          this.byAddress.delete(key);
        }
      }
    }
    return true;
  }
}

@Injectable()
export class SiteRegistrationService {
  private readonly limiter = new SiteRegistrationRateLimiter();

  constructor(
    @Inject(SITE_REGISTRATION_HANDLER)
    private readonly handler: SiteRegistrationHandler,
    @Inject(SITE_REGISTRATION_LOGGER)
    private readonly logger: Logger
  ) {}

  async register(
    body: unknown,
    address: string,
    now: Date
  ): Promise<SiteRegistrationResponse> {
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "invalid_request",
        title: "Форма заполнена неверно"
      });
    }
    if (!this.limiter.tryConsume(address, now)) {
      this.logger.error("site registration rate limited", { address });
      throw new HttpException(
        { code: "too_many_requests", title: "Слишком много заявок подряд" },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    try {
      const result = await this.handler.execute({
        name: parsed.data.name,
        phone: parsed.data.phone,
        consent: parsed.data.consent,
        ...(parsed.data.page === undefined ? {} : { page: parsed.data.page }),
        now
      });
      this.logger.info("site registration accepted", { status: result.status });
      return result;
    } catch (error) {
      if (error instanceof InvalidSiteRegistrationError) {
        throw new BadRequestException({
          code: error.code,
          title: "Форма заполнена неверно"
        });
      }
      throw error;
    }
  }
}

@Controller("api/v1/site")
export class SiteRegistrationController {
  constructor(
    @Inject(SiteRegistrationService)
    private readonly service: SiteRegistrationService
  ) {}

  @Post("registrations")
  @HttpCode(HttpStatus.OK)
  register(
    @Body() body: unknown,
    @Req() request: FastifyRequest
  ): Promise<SiteRegistrationResponse> {
    return this.service.register(body, clientAddress(request), new Date());
  }
}

@Module({})
export class SiteRegistrationApiModule {
  static register(
    handler: SiteRegistrationHandler,
    logger: Logger
  ): DynamicModule {
    return {
      module: SiteRegistrationApiModule,
      controllers: [SiteRegistrationController],
      providers: [
        SiteRegistrationService,
        { provide: SITE_REGISTRATION_HANDLER, useValue: handler },
        { provide: SITE_REGISTRATION_LOGGER, useValue: logger }
      ]
    };
  }
}

/**
 * Адрес посетителя. Запрос приходит от nginx, поэтому в `request.ip` всегда `127.0.0.1`, а
 * настоящий адрес — в заголовке, который ставит сам nginx. Заголовку верим ровно настолько,
 * насколько он нужен: по нему считают частоту, и подделка стоит подделавшему его же лимита.
 */
function clientAddress(request: FastifyRequest): string {
  const forwarded = request.headers["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const first = (value ?? "").split(",")[0]?.trim() ?? "";
  return first !== "" ? first.slice(0, 64) : (request.ip ?? "unknown");
}

function within(
  timestamps: readonly number[],
  now: number,
  windowMs: number
): number[] {
  return timestamps.filter((at) => now - at < windowMs);
}
