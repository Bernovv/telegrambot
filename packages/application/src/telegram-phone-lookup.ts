import type { IdGenerator } from "./identity.js";

/**
 * Разбор очереди поисков в Telegram по номеру.
 *
 * Живёт эта служба в процессе аккаунта компании и больше нигде: спросить Telegram может
 * только тот, у кого открыта сессия TDLib, а она одна на весь проект. Панель кладёт в
 * очередь просьбу, аккаунт её разбирает — так же, как с ответами менеджеров.
 *
 * Отличие от очереди ответов одно, и оно определяет всю осторожность здесь: **ответы
 * отправляют людям, которые нам написали, а поиск спрашивает про тех, кто про нас не
 * знает.** Частые вопросы про чужие номера Telegram считает разведкой и отвечает сначала
 * задержкой, а потом запретом писать незнакомым — на том самом аккаунте, через который
 * идёт вся переписка с клиентами. Отсюда пауза между запросами по умолчанию заметно
 * длиннее, чем у отправки, и отсюда же уважение к сроку, который Telegram называет сам.
 */

export interface QueuedPhoneLookup {
  readonly lookupId: string;
  readonly contactId: string;
  readonly phoneE164: string;
  readonly attempts: number;
}

export interface TelegramPhoneLookupQueueRepository {
  claimQueued(input: {
    readonly batchSize: number;
    readonly at: Date;
  }): Promise<readonly QueuedPhoneLookup[]>;
  /**
   * Нашли. Здесь же заводится ветка переписки: без неё найденный идентификатор — число в
   * базе, а менеджеру нужно поле ввода. Ветка пустая, входящих в ней нет, и это нормально —
   * разговор начинаем мы.
   */
  markFound(input: {
    readonly lookupId: string;
    readonly contactId: string;
    readonly telegramUserId: string;
    readonly conversationId: string;
    readonly at: Date;
  }): Promise<void>;
  markNotFound(input: {
    readonly lookupId: string;
    readonly at: Date;
  }): Promise<void>;
  markAttemptFailed(input: {
    readonly lookupId: string;
    readonly reason: string;
    readonly at: Date;
    readonly retryAt: Date;
  }): Promise<void>;
  markFailed(input: {
    readonly lookupId: string;
    readonly reason: string;
    readonly at: Date;
  }): Promise<void>;
}

export interface TelegramPhoneLookupPort {
  find(phoneE164: string): Promise<
    | { readonly kind: "found"; readonly telegramUserId: string }
    | { readonly kind: "not_found" }
    | {
      readonly kind: "failed";
      readonly reason: string;
      readonly retryAfterMs: number | null;
    }
  >;
}

export interface ResolvePhoneLookupsOptions {
  readonly maxAttempts: number;
  readonly retryDelayMs: number;
  readonly pauseBetweenMs: number;
}

export const DEFAULT_PHONE_LOOKUP_OPTIONS: ResolvePhoneLookupsOptions = {
  maxAttempts: 3,
  retryDelayMs: 300_000,
  pauseBetweenMs: 5_000
};

export interface ResolvePhoneLookupsResult {
  readonly claimed: number;
  readonly found: number;
  readonly notFound: number;
  readonly retried: number;
  readonly failed: number;
}

export class ResolveTelegramPhoneLookupsBatchService {
  constructor(
    private readonly repository: TelegramPhoneLookupQueueRepository,
    private readonly lookup: TelegramPhoneLookupPort,
    private readonly ids: IdGenerator,
    private readonly options: ResolvePhoneLookupsOptions = DEFAULT_PHONE_LOOKUP_OPTIONS,
    /** Пауза вынесена наружу ради тестов: ждать по-настоящему им незачем. */
    private readonly pause: (ms: number) => Promise<void> = defaultPause
  ) {}

  async execute(input: {
    readonly at: Date;
    readonly batchSize: number;
  }): Promise<ResolvePhoneLookupsResult> {
    const queued = await this.repository.claimQueued({
      batchSize: input.batchSize,
      at: input.at
    });

    let found = 0;
    let notFound = 0;
    let retried = 0;
    let failed = 0;

    for (const [index, request] of queued.entries()) {
      if (index > 0 && this.options.pauseBetweenMs > 0) {
        await this.pause(this.options.pauseBetweenMs);
      }
      const outcome = await this.resolve(request, input.at);
      if (outcome === "found") {
        found += 1;
      } else if (outcome === "not_found") {
        notFound += 1;
      } else if (outcome === "retry") {
        retried += 1;
      } else {
        failed += 1;
      }
    }

    return { claimed: queued.length, found, notFound, retried, failed };
  }

  private async resolve(
    request: QueuedPhoneLookup,
    at: Date
  ): Promise<"found" | "not_found" | "retry" | "failed"> {
    let outcome: Awaited<ReturnType<TelegramPhoneLookupPort["find"]>>;
    try {
      outcome = await this.lookup.find(request.phoneE164);
    } catch (error) {
      outcome = {
        kind: "failed",
        reason: error instanceof Error ? error.message : String(error),
        retryAfterMs: null
      };
    }

    if (outcome.kind === "found") {
      await this.repository.markFound({
        lookupId: request.lookupId,
        contactId: request.contactId,
        telegramUserId: outcome.telegramUserId,
        conversationId: this.ids.newId(),
        at
      });

      return "found";
    }
    if (outcome.kind === "not_found") {
      await this.repository.markNotFound({ lookupId: request.lookupId, at });

      return "not_found";
    }

    const attempts = request.attempts + 1;
    if (attempts >= this.options.maxAttempts) {
      await this.repository.markFailed({
        lookupId: request.lookupId,
        reason: outcome.reason,
        at
      });

      return "failed";
    }
    // Срок, названный самим Telegram, старше нашего расписания: попытка раньше времени не
    // просто не сработает, она продлевает запрет.
    const wait = Math.max(
      outcome.retryAfterMs ?? 0,
      this.options.retryDelayMs * 2 ** request.attempts
    );
    await this.repository.markAttemptFailed({
      lookupId: request.lookupId,
      reason: outcome.reason,
      at,
      retryAt: new Date(at.getTime() + wait)
    });

    return "retry";
  }
}

async function defaultPause(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
