/**
 * Bot API мессенджера MAX — прямыми вызовами, без клиентской библиотеки.
 *
 * У MAX есть официальный пакет `@maxhub/max-bot-api`, и старый бот работал через него. Здесь
 * его нет намеренно, и причина не в неприязни к зависимостям.
 *
 * Нам от их API нужно четыре вызова: отправить сообщение, ответить на нажатие кнопки,
 * подписаться на вебхук и разобрать пришедший апдейт. Это полсотни строк. Библиотека же
 * тянет с собой свою модель бота, свой роутер, свой цикл опроса и свой обработчик ошибок,
 * который по умолчанию завершает процесс — с этим в старом боте уже пришлось бороться
 * (см. `max-bot/src/bot/handlers.ts`, `bot.catch`). Всё это дублирует то, что у нас уже
 * есть: маршрутизация живёт в разговорном слое, ошибки — в логгере, очередь — в воркере.
 *
 * Практическая сторона: их API — обычный HTTP с токеном в заголовке, и адреса здесь те же,
 * что вызывает библиотека (`platform-api2.max.ru`, `POST /messages`, `POST /answers`,
 * `POST /subscriptions`).
 */

/** Адрес их Bot API. Второй версии: первая помечена у них устаревшей. */
export const MAX_API_BASE_URL = "https://platform-api2.max.ru";

export interface MaxApiOptions {
  readonly token: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
}

/** Кнопка MAX в том виде, в каком её принимает их API. */
export type MaxButton =
  | { readonly type: "callback"; readonly text: string; readonly payload: string }
  | { readonly type: "link"; readonly text: string; readonly url: string }
  | { readonly type: "request_contact"; readonly text: string };

export interface MaxAttachment {
  readonly type: "inline_keyboard";
  readonly payload: { readonly buttons: readonly (readonly MaxButton[])[] };
}

export interface MaxSendResult {
  readonly providerMessageId: string;
}

export class MaxApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "MaxApiError";
  }

  /**
   * Стоит ли повторять.
   *
   * Отказ по токену или по правам повтором не лечится, а вот «слишком часто» и пятисотки
   * лечатся. Очередь доставки спрашивает именно об этом.
   */
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

export class MaxApi {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: MaxApiOptions) {
    this.baseUrl = (options.baseUrl ?? MAX_API_BASE_URL).replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  /**
   * Сообщение человеку.
   *
   * Адресат задаётся `user_id`, а не номером чата: проактивная отправка (билет после оплаты,
   * напоминание) приходит из воркера, где никакого текущего чата нет. Для ответа в диалоге
   * это тоже работает — у личной переписки чат один.
   */
  async sendMessage(input: {
    readonly userId: string;
    readonly text: string;
    readonly buttons?: readonly (readonly MaxButton[])[];
  }): Promise<MaxSendResult> {
    const attachments = toAttachments(input.buttons);
    const response = await this.call<{
      readonly message?: { readonly body?: { readonly mid?: string } };
    }>("messages", {
      query: { user_id: input.userId },
      body: {
        text: input.text,
        ...(attachments ? { attachments } : {})
      }
    });
    return { providerMessageId: response.message?.body?.mid ?? "" };
  }

  /**
   * Ответ на нажатие кнопки.
   *
   * Отвечать обязательно: иначе кнопка у человека «крутится» до таймаута. При этом MAX
   * требует непустое тело — на `{}` он отвечает 400 «message or notification required»,
   * поэтому шлём пробел. Это не наша причуда, а их поведение; в старом боте пришло к тому же.
   */
  async answerCallback(input: {
    readonly callbackId: string;
    readonly notification?: string;
  }): Promise<void> {
    await this.call("answers", {
      query: { callback_id: input.callbackId },
      body: { notification: input.notification ?? " " }
    });
  }

  /** Подписка на вебхук. Вызывается руками при выкладке, а не на каждом запуске. */
  async subscribeWebhook(input: {
    readonly url: string;
    readonly secret?: string;
    readonly updateTypes?: readonly string[];
  }): Promise<void> {
    await this.call("subscriptions", {
      body: {
        url: input.url,
        update_types: input.updateTypes ?? [
          "bot_started",
          "message_created",
          "message_callback"
        ],
        ...(input.secret === undefined ? {} : { secret: input.secret })
      }
    });
  }

  private async call<T>(
    method: string,
    options: {
      readonly query?: Readonly<Record<string, string>>;
      readonly body?: unknown;
    }
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/${method}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, value);
    }

    // Свой таймаут: без него зависший запрос держит место в очереди доставки до упора, а
    // очередь у нас общая с Telegram.
    const abort = AbortSignal.timeout(this.timeoutMs);
    const response = await fetch(url.href, {
      method: "POST",
      headers: {
        Authorization: this.options.token,
        "content-type": "application/json"
      },
      body: JSON.stringify(options.body ?? {}),
      signal: abort
    });

    const payload = await readJson(response);
    if (!response.ok) {
      const error = payload as { readonly code?: string; readonly message?: string };
      throw new MaxApiError(
        response.status,
        error.code ?? "unknown",
        error.message ?? `MAX API ${method} answered ${response.status}`
      );
    }
    return payload as T;
  }
}

function toAttachments(
  buttons: readonly (readonly MaxButton[])[] | undefined
): readonly MaxAttachment[] | null {
  if (!buttons || buttons.length === 0) {
    return null;
  }
  return [{ type: "inline_keyboard", payload: { buttons } }];
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === "") {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text.slice(0, 500) };
  }
}
