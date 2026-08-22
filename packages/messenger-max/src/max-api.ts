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

export type MaxAttachment =
  | {
      readonly type: "inline_keyboard";
      readonly payload: { readonly buttons: readonly (readonly MaxButton[])[] };
    }
  | { readonly type: "image"; readonly payload: { readonly token: string } };

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
   * Картинка — билет.
   *
   * В MAX это три шага вместо одного: спросить адрес для загрузки, положить туда файл,
   * отправить сообщение с полученным токеном. Внутри одного метода, потому что снаружи это
   * одно действие: «показать человеку его QR».
   *
   * Загрузка возвращает токен не всегда сразу — иногда он приезжает только в ответе на
   * саму загрузку. Поэтому берём тот, который есть, и падаем, если нет ни одного: билет
   * без QR — это не билет, и молча отправить вместо него подпись хуже, чем не отправить.
   */
  async sendImage(input: {
    readonly userId: string;
    readonly bytes: Uint8Array;
    readonly fileName: string;
    readonly caption: string;
    readonly buttons?: readonly (readonly MaxButton[])[];
  }): Promise<MaxSendResult> {
    const token = await this.uploadImage(input.bytes, input.fileName);
    const attachments: MaxAttachment[] = [{ type: "image", payload: { token } }];
    const keyboard = toAttachments(input.buttons);
    if (keyboard) {
      attachments.push(...keyboard);
    }

    const response = await this.call<{
      readonly message?: { readonly body?: { readonly mid?: string } };
    }>("messages", {
      query: { user_id: input.userId },
      body: { text: input.caption, attachments }
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

  /** Адрес загрузки, сама загрузка и токен картинки. */
  private async uploadImage(bytes: Uint8Array, fileName: string): Promise<string> {
    const requested = await this.call<{
      readonly url?: string;
      readonly token?: string;
    }>("uploads", { query: { type: "image" } });
    const uploadUrl = requested.url;
    if (uploadUrl === undefined || uploadUrl === "") {
      throw new MaxApiError(502, "upload.no_url", "MAX did not return an upload URL");
    }

    const form = new FormData();
    form.append("data", new Blob([bytes], { type: "image/png" }), fileName);
    const response = await request(uploadUrl, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    const uploaded = await readJson(response);
    if (!response.ok) {
      throw new MaxApiError(
        response.status,
        "upload.failed",
        `MAX upload answered ${response.status}`
      );
    }

    const token = requested.token ?? photoToken(uploaded);
    if (token === null) {
      throw new MaxApiError(502, "upload.no_token", "MAX upload returned no photo token");
    }
    return token;
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
    const response = await request(url.href, {
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

/**
 * Запрос с разборчивой ошибкой.
 *
 * `fetch` при любой сетевой беде бросает `TypeError: fetch failed`, а настоящая причина
 * лежит в `cause` — и именно она нужна: у `platform-api2.max.ru` сертификат Минцифры,
 * которому Node по умолчанию не доверяет, и без `NODE_EXTRA_CA_CERTS` всё выглядит как
 * безымянный сетевой сбой. Разбираться с таким по логам — потерянный вечер.
 */
async function request(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error
      ? error.cause.message
      : error instanceof Error ? error.message : String(error);
    throw new MaxApiError(
      0,
      "network",
      `MAX недоступен: ${cause}.`
      + " Если речь о сертификате — процессу нужен NODE_EXTRA_CA_CERTS"
      + " с сертификатом Минцифры, выставленный до старта Node."
    );
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

/**
 * Токен картинки из ответа загрузки.
 *
 * Их API отвечает по-разному: иногда полем `token`, иногда картой `photos`, где ключ —
 * идентификатор фотографии. Берём первое, что нашлось: разница здесь не наша.
 */
function photoToken(uploaded: unknown): string | null {
  if (uploaded === null || typeof uploaded !== "object") {
    return null;
  }
  const body = uploaded as {
    readonly token?: unknown;
    readonly photos?: Readonly<Record<string, { readonly token?: unknown }>>;
  };
  if (typeof body.token === "string" && body.token !== "") {
    return body.token;
  }
  for (const photo of Object.values(body.photos ?? {})) {
    if (typeof photo?.token === "string" && photo.token !== "") {
      return photo.token;
    }
  }
  return null;
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
