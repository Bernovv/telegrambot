import {
  errorOf,
  MaxAccountError,
  MaxCommand,
  MaxOpcode,
  MAX_PROTOCOL_VERSION,
  parseInboundFrame,
  type MaxInboundFrame,
  type MaxOutboundFrame
} from "./protocol.js";
import type { MaxAccountClientOptions } from "./options.js";

/**
 * Аккаунт компании в MAX: соединение, вызовы и события.
 *
 * Постоянный вебсокет вместо вебхука, как у бота, — и это меняет главное: **канал живёт,
 * пока живёт соединение**. Молчание тут неотличимо от «никто не писал», поэтому клиент
 * обязан говорить о своём состоянии вслух: обрыв, попытка переподключиться, отказ входа.
 * Всё, что здесь молча проглочено, снаружи выглядит как исправно работающий канал, в
 * котором почему-то нет сообщений.
 *
 * **Экземпляр должен быть один.** Вторая копия на том же токене — второе устройство в их
 * антифроде, а множественные входы с разных мест там ровно тот признак, за который
 * ограничивают аккаунт. Отсюда же правило: не запускать локально «просто посмотреть», пока
 * процесс работает на сервере.
 */

/** Пауза между пингами. Больше минуты сервер молчащий сокет закрывает. */
const KEEPALIVE_INTERVAL_MS = 30_000;

/** С чего начинается пауза перед повтором соединения и до чего доходит. */
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;

export type MaxAccountState =
  | "connecting"
  | "authorizing"
  | "ready"
  | "disconnected"
  /** Вход отвергнут: токен просрочен, отозван или аккаунт ограничен. Само не починится. */
  | "unauthorized";

export interface MaxAccountLogin {
  readonly token: string;
  readonly profile: MaxAccountProfile | null;
}

/** Заявка на привязку устройства: что показать человеку и по чему спрашивать ответ. */
export interface MaxQrRequest {
  /** Ссылка, которую человек считывает камерой в приложении MAX. */
  readonly link: string;
  readonly trackId: string;
  /** Когда попытка протухнет. Обычно две минуты. */
  readonly expiresAt: number;
  readonly pollIntervalMs: number;
}

export interface MaxAccountProfile {
  readonly userId: string;
  /** Как его вернул MAX — без плюса. */
  readonly phone: string;
  readonly displayName: string | null;
}

interface Pending {
  readonly opcode: number;
  readonly resolve: (frame: MaxInboundFrame) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

export class MaxAccountClient {
  private socket: WebSocket | null = null;
  private seq = 0;
  private readonly pending = new Map<number, Pending>();
  private keepalive: NodeJS.Timeout | null = null;
  private reconnectDelayMs = RECONNECT_MIN_MS;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private closing = false;
  private token: string | null;
  private state: MaxAccountState = "disconnected";
  private profile: MaxAccountProfile | null = null;
  private readonly eventHandlers: ((frame: MaxInboundFrame) => void)[] = [];
  private readonly stateHandlers: ((
    state: MaxAccountState,
    reason: string | null
  ) => void)[] = [];

  constructor(private readonly options: MaxAccountClientOptions) {
    this.token = options.token;
  }

  onEvent(handler: (frame: MaxInboundFrame) => void): void {
    this.eventHandlers.push(handler);
  }

  onState(handler: (state: MaxAccountState, reason: string | null) => void): void {
    this.stateHandlers.push(handler);
  }

  currentState(): MaxAccountState {
    return this.state;
  }

  /** Кто мы для MAX. Известно только после успешного входа. */
  currentProfile(): MaxAccountProfile | null {
    return this.profile;
  }

  /**
   * Поднять соединение и, если токен есть, войти.
   *
   * Возвращается после того, как соединение открыто и вход завершён, — а не после того,
   * как отправлен запрос. Процесс, объявивший себя готовым до входа, полчаса выглядит
   * живым и не принимает ни одного сообщения.
   */
  async connect(): Promise<void> {
    this.closing = false;
    await this.open();
    await this.invoke(MaxOpcode.sessionInit, {
      userAgent: this.userAgentPayload(),
      deviceId: this.options.deviceId
    });

    if (this.token !== null) {
      await this.loginByToken(this.token);
    } else {
      this.setState("authorizing", "токена нет, ждём вход по коду");
    }
  }

  /**
   * Вход по постоянному токену.
   *
   * `chatsSync: 0` — просим прислать состояние чатов с нуля. Историю мы у них не храним и
   * не читаем: наша история лежит в нашей же базе, а синхронизация тысяч чатов на каждом
   * запуске — это лишний трафик и лишний повод для их антифрода.
   */
  async loginByToken(token: string): Promise<MaxAccountProfile> {
    this.setState("authorizing", null);
    const frame = await this.invoke(MaxOpcode.login, {
      interactive: true,
      token,
      chatsSync: 0,
      contactsSync: 0,
      presenceSync: 0,
      draftsSync: 0,
      chatsCount: 40
    });

    this.token = token;
    this.profile = profileOf(frame.payload?.["profile"]);
    this.setState("ready", null);

    return this.profile ?? { userId: "", phone: "", displayName: null };
  }

  /** Первый шаг входа по коду: попросить код на номер. Возвращает временный токен. */
  async requestCode(phone: string): Promise<string> {
    const frame = await this.invoke(MaxOpcode.authRequest, {
      phone,
      type: "START_AUTH",
      language: "ru"
    });
    const token = frame.payload?.["token"];
    if (typeof token !== "string" || token === "") {
      throw new Error("MAX не прислал временный токен в ответ на запрос кода");
    }

    return token;
  }

  /**
   * Второй шаг: проверить код. В ответе приходит постоянный токен — тот самый, что живёт
   * потом в `.env` и заменяет собой всю авторизацию.
   */
  async submitCode(
    codeToken: string,
    code: string
  ): Promise<MaxAccountLogin> {
    const frame = await this.invoke(MaxOpcode.auth, {
      token: codeToken,
      verifyCode: code,
      authTokenType: "CHECK_CODE"
    });

    return this.acceptLogin(frame, "MAX принял код");
  }

  /**
   * Привязка устройства по QR — второй способ войти, и сегодня единственный работающий.
   *
   * Вход по коду их антифрод от нашего клиента не принимает: на первый же запрос он
   * отвечает требованием капчи, то есть отказывается считать нас настоящим клиентом.
   * Здесь разрешение даёт человек — тот, у кого уже есть вошедшее устройство: он видит в
   * приложении, какое устройство просится, и подтверждает его сам.
   *
   * Возвращает ссылку, которую нужно показать этому человеку кодом, и номер попытки, по
   * которому дальше спрашивают, подтвердил он или нет.
   */
  async requestQr(): Promise<MaxQrRequest> {
    const frame = await this.invoke(MaxOpcode.getQr, {});
    const payload = frame.payload ?? {};
    const link = payload["qrLink"];
    const trackId = payload["trackId"];
    if (typeof link !== "string" || link === "" || typeof trackId !== "string") {
      throw new Error("MAX не дал ссылку для привязки устройства");
    }

    return {
      link,
      trackId,
      expiresAt: numberOf(payload["expiresAt"]) ?? Date.now() + 120_000,
      pollIntervalMs: numberOf(payload["pollingInterval"]) ?? 2_000
    };
  }

  /** Подтвердил ли человек привязку. Ответ «ещё нет» — это не ошибка, а ожидание. */
  async qrConfirmed(trackId: string): Promise<boolean> {
    const frame = await this.invoke(MaxOpcode.getQrStatus, { trackId });
    const status = frame.payload?.["status"];

    return isRecord(status) && status["loginAvailable"] === true;
  }

  /** Забрать постоянный токен после подтверждения. */
  async confirmQr(trackId: string): Promise<MaxAccountLogin> {
    const frame = await this.invoke(MaxOpcode.loginByQr, { trackId });

    return this.acceptLogin(frame, "MAX подтвердил привязку");
  }

  /**
   * Разбор ответа на вход. Один на оба способа: и код, и QR отвечают одинаково.
   *
   * Отдельно ловится двухфакторный пароль: MAX в этом случае присылает не токен, а
   * требование пароля. Молча вернуть «нет токена» здесь нельзя — человек будет искать
   * поломку там, где её нет.
   */
  private acceptLogin(frame: MaxInboundFrame, what: string): MaxAccountLogin {
    const attributes = frame.payload?.["tokenAttrs"];
    const login = isRecord(attributes) ? attributes["LOGIN"] : undefined;
    const token = isRecord(login) ? login["token"] : undefined;
    if (typeof token !== "string" || token === "") {
      if (isRecord(frame.payload?.["passwordChallenge"])) {
        throw new Error(
          `${what}, но требует пароль входа. Привязка по QR работает только без него:`
          + " выключите пароль в настройках MAX и повторите."
        );
      }
      throw new Error(
        `${what}, но не прислал постоянный токен.`
        + " Скорее всего, у них поменялся ответ — смотреть тело в журнале."
      );
    }
    this.token = token;

    return { token, profile: profileOf(frame.payload?.["profile"]) };
  }

  /**
   * Вызов метода. Ждёт ответа с тем же номером и разбирает отказ.
   *
   * Ответ узнаётся по типу кадра, а не по одному номеру: события у MAX тоже пронумерованы,
   * и разбор «по номеру» однажды принял бы чужое входящее за ответ на наш запрос.
   */
  async invoke(
    opcode: number,
    payload: Readonly<Record<string, unknown>>
  ): Promise<MaxInboundFrame> {
    const socket = this.socket;
    if (socket === null || socket.readyState !== WebSocket.OPEN) {
      throw new Error("Соединения с MAX нет: вызов невозможен");
    }
    const seq = this.nextSeq();
    const frame: MaxOutboundFrame = {
      ver: MAX_PROTOCOL_VERSION,
      cmd: MaxCommand.request,
      seq,
      opcode,
      payload
    };

    return await new Promise<MaxInboundFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(new MaxAccountError(
          "timeout",
          `MAX не ответил на вызов ${String(opcode)} за`
          + ` ${String(Math.round(this.options.requestTimeoutMs / 1000))} с`,
          opcode
        ));
      }, this.options.requestTimeoutMs);

      this.pending.set(seq, { opcode, resolve, reject, timer });
      try {
        socket.send(JSON.stringify(frame));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(seq);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async close(): Promise<void> {
    this.closing = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopKeepalive();
    this.failPending(new Error("Соединение с MAX закрыто"));
    this.socket?.close();
    this.socket = null;
    this.setState("disconnected", "закрыто по нашей команде");

    return await Promise.resolve();
  }

  private async open(): Promise<void> {
    this.setState("connecting", null);
    const socket = new WebSocket(this.options.wsUrl, {
      headers: {
        // Их сервер ждёт обращения от веб-клиента. Без этих двух заголовков соединение
        // либо не открывается вовсе, либо закрывается сразу после открытия.
        origin: "https://web.max.ru",
        "user-agent": this.options.userAgent
      }
    });
    this.socket = socket;

    socket.addEventListener("message", (event: MessageEvent) => {
      this.receive(event.data);
    });
    socket.addEventListener("close", () => {
      this.handleDisconnect("соединение закрыто той стороной");
    });
    socket.addEventListener("error", () => {
      // Подробностей ошибки веб-сокет не отдаёт — только факт. Причина почти всегда видна
      // следом, в закрытии соединения.
      this.handleDisconnect("ошибка соединения");
    });

    await new Promise<void>((resolve, reject) => {
      const onOpen = (): void => {
        socket.removeEventListener("error", onError);
        resolve();
      };
      const onError = (): void => {
        socket.removeEventListener("open", onOpen);
        reject(new Error(`Не удалось открыть соединение с MAX (${this.options.wsUrl})`));
      };
      socket.addEventListener("open", onOpen, { once: true });
      socket.addEventListener("error", onError, { once: true });
    });

    this.reconnectDelayMs = RECONNECT_MIN_MS;
    this.startKeepalive();
  }

  private receive(data: unknown): void {
    const raw = typeof data === "string"
      ? data
      : data instanceof ArrayBuffer
        ? Buffer.from(data).toString("utf8")
        : null;
    if (raw === null) {
      return;
    }
    const frame = parseInboundFrame(raw);
    if (frame === null) {
      return;
    }

    if (frame.cmd === MaxCommand.response || frame.cmd === MaxCommand.error) {
      const seq = frame.seq;
      const waiting = seq === undefined ? undefined : this.pending.get(seq);
      if (seq !== undefined && waiting !== undefined) {
        this.pending.delete(seq);
        clearTimeout(waiting.timer);
        const error = errorOf(frame);
        if (error === null) {
          waiting.resolve(frame);
        } else {
          waiting.reject(error);
        }

        return;
      }
    }

    for (const handler of this.eventHandlers) {
      handler(frame);
    }
  }

  /**
   * Обрыв соединения.
   *
   * Переподключение обязательно и обязательно с нарастающей паузой: сеть до них падает
   * целиком, и десять попыток в секунду от нашего процесса — это то, что их сторона
   * увидит как атаку, а мы — как «канал не поднялся».
   */
  private handleDisconnect(reason: string): void {
    this.stopKeepalive();
    this.failPending(new Error(`Соединение с MAX потеряно: ${reason}`));
    this.socket = null;
    if (this.closing || this.state === "unauthorized") {
      return;
    }
    this.setState("disconnected", reason);
    if (this.reconnectTimer !== null) {
      return;
    }

    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.reconnect();
    }, delay);
  }

  private async reconnect(): Promise<void> {
    try {
      await this.connect();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      // Отказ входа — не сетевая беда: токен просрочен или аккаунт ограничен, и повторять
      // такое бесконечно значит стучаться в закрытую дверь и молчать об этом.
      if (error instanceof MaxAccountError && !error.retryable) {
        this.setState("unauthorized", reason);

        return;
      }
      this.handleDisconnect(reason);
    }
  }

  private startKeepalive(): void {
    this.stopKeepalive();
    this.keepalive = setInterval(() => {
      void this.invoke(MaxOpcode.ping, { interactive: false }).catch(() => {
        // Неудачный пинг сам по себе ничего не значит: настоящий обрыв придёт закрытием
        // сокета, и им же занимается переподключение.
      });
    }, KEEPALIVE_INTERVAL_MS);
  }

  private stopKeepalive(): void {
    if (this.keepalive !== null) {
      clearInterval(this.keepalive);
      this.keepalive = null;
    }
  }

  private failPending(error: Error): void {
    for (const [seq, waiting] of this.pending) {
      clearTimeout(waiting.timer);
      this.pending.delete(seq);
      waiting.reject(error);
    }
  }

  private setState(state: MaxAccountState, reason: string | null): void {
    if (this.state === state) {
      return;
    }
    this.state = state;
    for (const handler of this.stateHandlers) {
      handler(state, reason);
    }
  }

  private nextSeq(): number {
    this.seq = (this.seq + 1) % 0x10000;

    return this.seq;
  }

  private userAgentPayload(): Readonly<Record<string, unknown>> {
    return {
      deviceType: "WEB",
      locale: "ru_RU",
      osVersion: "Linux",
      deviceName: this.options.deviceName,
      headerUserAgent: this.options.userAgent,
      deviceLocale: "ru-RU",
      appVersion: this.options.appVersion,
      screen: "1920x1080 1.0x",
      timezone: "Europe/Moscow"
    };
  }
}

function profileOf(value: unknown): MaxAccountProfile | null {
  if (!isRecord(value)) {
    return null;
  }
  const contact = isRecord(value["contact"]) ? value["contact"] : value;
  const userId = contact["id"];
  const phone = value["phone"] ?? contact["phone"];
  const names = contact["names"];
  const first = Array.isArray(names) && isRecord(names[0]) ? names[0] : null;
  const displayName = first === null
    ? null
    : [first["name"], first["firstName"], first["lastName"]]
      .find((part) => typeof part === "string" && part !== "");

  return {
    userId: typeof userId === "number" || typeof userId === "string" ? String(userId) : "",
    phone: typeof phone === "number" || typeof phone === "string"
      ? String(phone).replace(/^\+/, "")
      : "",
    displayName: typeof displayName === "string" ? displayName : null
  };
}

function numberOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
