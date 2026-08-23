/**
 * Внутренний протокол MAX — тот, которым разговаривает их собственный веб-клиент.
 *
 * Официального пользовательского API у MAX нет: есть Bot API (он у нас в
 * `packages/messenger-max`) и есть протокол клиента, по которому работает web.max.ru.
 * Аккаунту компании нужен второй — бот первым написать не может в принципе, и половина
 * воронки, приходящая с телефоном вместо ника, для бота недостижима.
 *
 * Устроен он просто: вебсокет и JSON, запрос-ответ по номеру. Никакой бинарной загадки —
 * то же самое «позвать метод и дождаться ответа», что у Bot API, только соединение
 * постоянное и события приходят сами.
 *
 * **Это не документированный интерфейс.** Коды операций и поля выяснены по открытым
 * реализациям (`MaxApiTeam/PyMax`, `nsdkinx/vkmax`) и могут поменяться без предупреждения —
 * молча, вместе с их веб-клиентом. Отсюда два правила во всём этом пакете: незнакомое не
 * выбрасывается, а сохраняется целиком, и всякая неудача обязана быть громкой.
 */

/** Адрес вебсокета их веб-клиента. */
export const MAX_ACCOUNT_WS_URL = "wss://ws-api.oneme.ru/websocket";

/** Версия протокола. Её ждёт сервер в каждом кадре. */
export const MAX_PROTOCOL_VERSION = 11;

/**
 * Тип кадра. Ответ отличается от события именно этим полем, а не наличием номера:
 * события тоже приходят пронумерованными, и разбор «по номеру» перепутал бы их с ответами.
 */
export const MaxCommand = {
  request: 0,
  response: 1,
  event: 2,
  error: 3
} as const;

/**
 * Коды операций. Здесь только те, что нужны переписке, — их у MAX больше двухсот.
 *
 * Названия наши, потому что чужих официальных нет.
 */
export const MaxOpcode = {
  /** Пинг. Без него сервер закрывает сокет примерно через минуту. */
  ping: 1,
  /** Приветствие: кто мы и с какого устройства. Идёт первым, до всего остального. */
  sessionInit: 6,
  /** Запрос кода на телефон. В ответе — временный токен для проверки кода. */
  authRequest: 17,
  /** Проверка кода. В ответе — постоянный токен, которым входят дальше. */
  auth: 18,
  /** Вход по постоянному токену. */
  login: 19,
  /** Выход: завершает сессию на их стороне, а не только у нас. */
  logout: 20,
  /** Сведения о людях по их идентификаторам. */
  contactInfo: 32,
  /** Поиск человека по номеру телефона — то самое «написать первым». */
  contactInfoByPhone: 46,
  /** Сведения о чате, включая его тип: диалог, группа или канал. */
  chatInfo: 48,
  messageSend: 64,
  messageEdit: 67,
  /** Адрес для загрузки картинки. */
  photoUpload: 80,
  /** Адрес для загрузки файла. */
  fileUpload: 87,
  /** Ссылка на скачивание файла из чужого сообщения. */
  fileDownload: 88,
  /** Пришло новое сообщение. Кадр-событие, ответом ни на что не является. */
  notifyMessage: 128
} as const;

export interface MaxOutboundFrame {
  readonly ver: number;
  readonly cmd: number;
  readonly seq: number;
  readonly opcode: number;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface MaxInboundFrame {
  readonly ver?: number;
  readonly cmd: number;
  readonly seq?: number;
  readonly opcode: number;
  readonly payload?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * Разбор пришедшего кадра.
 *
 * Мусор на входе — это не повод уронить процесс: сокет чужой, и что по нему приедет
 * завтра, мы не знаем. Непонятный кадр становится `null`, и это видно в журнале.
 */
export function parseInboundFrame(raw: string): MaxInboundFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const frame = parsed as Record<string, unknown>;
  if (typeof frame["opcode"] !== "number" || typeof frame["cmd"] !== "number") {
    return null;
  }
  const payload = frame["payload"];

  return {
    cmd: frame["cmd"],
    opcode: frame["opcode"],
    ...(typeof frame["seq"] === "number" ? { seq: frame["seq"] } : {}),
    ...(typeof payload === "object" && payload !== null
      ? { payload: payload as Record<string, unknown> }
      : {})
  };
}

/**
 * Ошибка, названная сервером MAX.
 *
 * Отказ приезжает двумя способами — кадром с `cmd = error` и полем `error` в обычном
 * ответе, — и различать их снаружи незачем: и то и другое означает «не сделано».
 */
export class MaxAccountError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly opcode: number
  ) {
    super(message);
    this.name = "MaxAccountError";
  }

  /**
   * Стоит ли повторять.
   *
   * Повтором лечится обрыв и «слишком часто»; отказ по токену, по правам и по блокировке —
   * не лечится, и держать такой ответ в очереди значит обещать доставку, которой не будет.
   */
  get retryable(): boolean {
    return this.code === "flood" || this.code === "internal" || this.code === "timeout";
  }
}

/** Достаёт ошибку из ответа, если она там есть. */
export function errorOf(frame: MaxInboundFrame): MaxAccountError | null {
  const payload = frame.payload ?? {};
  const error = payload["error"];
  if (frame.cmd !== MaxCommand.error && typeof error !== "string") {
    return null;
  }
  const code = typeof error === "string" ? error : "unknown";
  const message = typeof payload["message"] === "string" && payload["message"] !== ""
    ? payload["message"]
    : code;

  return new MaxAccountError(code, `MAX отказал: ${message}`, frame.opcode);
}
