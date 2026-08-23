import type { ConversationChannel } from "@ticket-platform/domain";
import type { IdGenerator } from "./identity.js";

/**
 * Разбор очереди «есть ли человек в мессенджере».
 *
 * Один и тот же вопрос трём каналам: Telegram, MAX и WhatsApp. Ответить на него может
 * только тот, у кого открыта сессия — то есть процесс аккаунта компании, свой у каждого
 * канала. Поэтому служба одна, а работает в трёх процессах, и каждый разбирает свою часть
 * очереди.
 *
 * Осторожность здесь та же, что была у одного Telegram, и причина не изменилась:
 * **ответы отправляют людям, которые нам написали, а поиск спрашивает про тех, кто про нас
 * не знает.** Частые вопросы про чужие номера мессенджеры считают разведкой и отвечают
 * сначала задержкой, а потом запретом писать незнакомым — на том самом аккаунте, через
 * который идёт вся переписка с клиентами. Отсюда пауза между запросами заметно длиннее, чем
 * у отправки, потолок на сутки и уважение к сроку, который мессенджер называет сам.
 */

export interface QueuedChannelLookup {
  readonly contactId: string;
  readonly channel: ConversationChannel;
  readonly phoneE164: string;
  readonly attempts: number;
}

/** Ключ строки очереди. Суррогатного идентификатора у неё нет — пары достаточно. */
export interface ChannelLookupKey {
  readonly contactId: string;
  readonly channel: ConversationChannel;
}

export interface ChannelLookupQueueRepository {
  claimQueued(input: {
    readonly channel: ConversationChannel;
    readonly batchSize: number;
    readonly at: Date;
  }): Promise<readonly QueuedChannelLookup[]>;
  /**
   * Сколько проверок этот канал уже сделал за сутки.
   *
   * Считается по времени ответа, а не по времени просьбы: потолок защищает аккаунт от
   * количества обращений наружу, а не очередь от длины.
   */
  countCheckedSince(input: {
    readonly channel: ConversationChannel;
    readonly since: Date;
  }): Promise<number>;
  /**
   * Нашли. Здесь же заводится ветка переписки: без неё найденный идентификатор — число в
   * базе, а менеджеру нужно поле ввода. Ветка пустая, входящих в ней нет, и это нормально —
   * разговор начинаем мы.
   */
  markFound(input: ChannelLookupKey & {
    readonly externalUserId: string;
    readonly externalChatId: string;
    readonly username: string | null;
    readonly conversationId: string;
    readonly at: Date;
  }): Promise<void>;
  markNotFound(input: ChannelLookupKey & { readonly at: Date }): Promise<void>;
  markAttemptFailed(input: ChannelLookupKey & {
    readonly reason: string;
    readonly at: Date;
    readonly retryAt: Date;
  }): Promise<void>;
  markFailed(input: ChannelLookupKey & {
    readonly reason: string;
    readonly at: Date;
  }): Promise<void>;
}

export type ChannelLookupOutcome =
  | {
    readonly kind: "found";
    /** Кто это у мессенджера. Его же показывает карточка. */
    readonly externalUserId: string;
    /** Куда писать. У Telegram и MAX совпадает с идентификатором, у WhatsApp — адрес. */
    readonly externalChatId: string;
    readonly username: string | null;
  }
  | { readonly kind: "not_found" }
  | {
    readonly kind: "failed";
    readonly reason: string;
    readonly retryAfterMs: number | null;
  };

export interface ChannelLookupPort {
  find(phoneE164: string): Promise<ChannelLookupOutcome>;
}

export interface ResolveChannelLookupsOptions {
  readonly maxAttempts: number;
  readonly retryDelayMs: number;
  readonly pauseBetweenMs: number;
  /**
   * Потолок проверок в сутки на канал.
   *
   * Не про производительность, а про живучесть аккаунта: очередь может быть какой угодно
   * длины, наружу за сутки уходит не больше этого числа вопросов. Упёрлись — очередь
   * подождёт до завтра, и это правильный исход, а не ошибка.
   */
  readonly dailyLimit: number;
}

export const DEFAULT_CHANNEL_LOOKUP_OPTIONS: ResolveChannelLookupsOptions = {
  maxAttempts: 3,
  retryDelayMs: 300_000,
  pauseBetweenMs: 15_000,
  dailyLimit: 150
};

export interface ResolveChannelLookupsResult {
  readonly claimed: number;
  readonly found: number;
  readonly notFound: number;
  readonly retried: number;
  readonly failed: number;
  /** Упёрлись в суточный потолок и до завтра больше не спрашиваем. */
  readonly throttled: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1_000;

export class ResolveChannelLookupsBatchService {
  constructor(
    private readonly channel: ConversationChannel,
    private readonly repository: ChannelLookupQueueRepository,
    private readonly lookup: ChannelLookupPort,
    private readonly ids: IdGenerator,
    private readonly options: ResolveChannelLookupsOptions
      = DEFAULT_CHANNEL_LOOKUP_OPTIONS,
    /** Пауза вынесена наружу ради тестов: ждать по-настоящему им незачем. */
    private readonly pause: (ms: number) => Promise<void> = defaultPause
  ) {}

  async execute(input: {
    readonly at: Date;
    readonly batchSize: number;
  }): Promise<ResolveChannelLookupsResult> {
    // Потолок спрашиваем до того, как забрать строки: занятая и не разобранная строка
    // висит до конца аренды, а очередь всё это время выглядит короче, чем есть.
    const done = await this.repository.countCheckedSince({
      channel: this.channel,
      since: new Date(input.at.getTime() - DAY_MS)
    });
    const left = this.options.dailyLimit - done;
    if (left <= 0) {
      return {
        claimed: 0,
        found: 0,
        notFound: 0,
        retried: 0,
        failed: 0,
        throttled: true
      };
    }

    const queued = await this.repository.claimQueued({
      channel: this.channel,
      batchSize: Math.min(input.batchSize, left),
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

    return {
      claimed: queued.length,
      found,
      notFound,
      retried,
      failed,
      throttled: queued.length >= left
    };
  }

  private async resolve(
    request: QueuedChannelLookup,
    at: Date
  ): Promise<"found" | "not_found" | "retry" | "failed"> {
    let outcome: ChannelLookupOutcome;
    try {
      outcome = await this.lookup.find(request.phoneE164);
    } catch (error) {
      outcome = {
        kind: "failed",
        reason: error instanceof Error ? error.message : String(error),
        retryAfterMs: null
      };
    }

    const key: ChannelLookupKey = {
      contactId: request.contactId,
      channel: request.channel
    };

    if (outcome.kind === "found") {
      await this.repository.markFound({
        ...key,
        externalUserId: outcome.externalUserId,
        externalChatId: outcome.externalChatId,
        username: outcome.username,
        conversationId: this.ids.newId(),
        at
      });

      return "found";
    }
    if (outcome.kind === "not_found") {
      await this.repository.markNotFound({ ...key, at });

      return "not_found";
    }

    const attempts = request.attempts + 1;
    if (attempts >= this.options.maxAttempts) {
      await this.repository.markFailed({ ...key, reason: outcome.reason, at });

      return "failed";
    }
    // Срок, названный самим мессенджером, старше нашего расписания: попытка раньше времени
    // не просто не сработает, она продлевает запрет.
    const wait = Math.max(
      outcome.retryAfterMs ?? 0,
      this.options.retryDelayMs * 2 ** request.attempts
    );
    await this.repository.markAttemptFailed({
      ...key,
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
