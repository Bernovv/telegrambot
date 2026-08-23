import { setTimeout as delay } from "node:timers/promises";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
  type AnyMessageContent,
  type WAMessage,
  type WASocket
} from "baileys";
import { SocksProxyAgent } from "socks-proxy-agent";
import type { WhatsAppAccountClientOptions } from "./options.js";
import type {
  WhatsAppConnectionState,
  WhatsAppFileToSend,
  WhatsAppLookup,
  WhatsAppSelf,
  WhatsAppSendResult,
  WhatsAppSocket
} from "./socket.js";
import { jidOfPhone, type WhatsAppMessage } from "./updates.js";

/**
 * Соединение с WhatsApp — единственное место в проекте, знающее про `baileys`.
 *
 * Библиотека взята потому, что своей реализации здесь быть не может: переписка шифруется
 * сигнальным протоколом, и это не шесть вызовов, как у MAX, а собственная криптография с
 * ключами, которые меняются после каждого сообщения.
 *
 * Всё, что library-specific, кончается на границе этого файла: наружу торчит `WhatsAppSocket`
 * из шести методов. Замена библиотеки — или переезд на платный шлюз, если аккаунт забанят, —
 * это переписать один файл, а не канал.
 *
 * **Два адреса, а не один.** Сообщения идут по вебсокету на `web.whatsapp.com`, а файлы
 * качаются и заливаются обычным HTTPS на `mmg.whatsapp.net`. Прокси нужен обоим, и это не
 * теория: отдать его только сокету — значит получить работающую переписку и вложения,
 * которые не скачаются никогда и молча. Поэтому агент один и передаётся трижды: в сокет
 * (`agent`), в загрузку (`fetchAgent`) и в скачивание (`httpsAgent` в axios).
 */

/** Сколько ждать перед повтором соединения. Растёт, чтобы не долбиться в упавшую сеть. */
const RECONNECT_DELAYS_MS = [1_000, 5_000, 15_000, 30_000, 60_000] as const;

export type WhatsAppMessageHandler = (message: WhatsAppMessage, raw: unknown) => void;

export type WhatsAppStateHandler = (
  state: WhatsAppConnectionState,
  reason: string | null
) => void;

/** Куда клиент рассказывает о себе, когда его просят говорить вслух. */
export type WhatsAppDebugSink = (message: string) => void;

export interface WhatsAppAccountClient extends WhatsAppSocket {
  /** Поднимает соединение и держит его: обрыв — это повтор, а не конец работы. */
  start(): Promise<void>;
  onMessage(handler: WhatsAppMessageHandler): void;
  onState(handler: WhatsAppStateHandler): void;
  /**
   * Код привязки для входа с телефона.
   *
   * Восемь символов, которые вводят в приложении: «Связанные устройства» → «Привязать по
   * номеру телефона». Так, а не по QR: вход делается на сервере по SSH, а QR в терминале
   * ещё надо чем-то нарисовать и с чего-то отсканировать.
   */
  requestPairingCode(): Promise<string>;
  /**
   * Сервер прислал предложение привязаться — значит рукопожатие прошло и код спрашивать
   * можно.
   *
   * Раньше этого момента `requestPairingCode` падает с «Connection Closed»: сокет открыт,
   * но разговора с сервером ещё не было, и спрашивать некого. Событие приходит и когда
   * привязку ждут по QR, и когда по коду: это одно и то же предложение, просто показать
   * его можно двумя способами.
   *
   * Обработчик, поставленный после того как сигнал уже был, вызывается сразу: иначе всё
   * зависит от того, кто успел первым — соединение или скрипт.
   */
  onPairingReady(handler: () => void): void;
  /** Вошли ли уже. `false` — сессии нет, нужен код привязки. */
  isRegistered(): boolean;
}

export function createWhatsAppAccountClient(
  options: WhatsAppAccountClientOptions,
  /**
   * Куда сливать подробности протокола. Задают только при разборе неполадок: библиотека
   * разговорчива до неприличия, и в обычной работе её поток заглушает наш журнал.
   */
  debug: WhatsAppDebugSink | null = null
): WhatsAppAccountClient {
  const agent = options.proxyUrl === null
    ? undefined
    : new SocksProxyAgent(remoteDnsProxy(options.proxyUrl));
  const messageHandlers: WhatsAppMessageHandler[] = [];
  const stateHandlers: WhatsAppStateHandler[] = [];
  const logger = debug === null ? silentLogger() : debugLogger(debug);

  const pairingHandlers: (() => void)[] = [];

  let socket: WASocket | null = null;
  let registered = false;
  let closing = false;
  let attempt = 0;
  let state: WhatsAppConnectionState = "connecting";
  let stateReason: string | null = null;
  let pairingReady = false;

  /**
   * Сообщить о состоянии — и запомнить его.
   *
   * Память здесь не для удобства. Соединение поднимается событиями, и обработчик, который
   * поставили на полсекунды позже, чем случилось событие, не узнает о нём никогда: скрипт
   * будет ждать «на связи» у уже подключённого канала, пока не кончится срок. Поэтому
   * состояние хранится, а `onState` доигрывает его новому обработчику сразу.
   */
  function announce(next: WhatsAppConnectionState, reason: string | null): void {
    state = next;
    stateReason = reason;
    for (const handler of stateHandlers) {
      handler(next, reason);
    }
  }

  /**
   * Версия их веб-клиента, за которую мы себя выдаём.
   *
   * Встроенная в библиотеку устаревает: WhatsApp закрывает соединение старым версиям прямо
   * на рукопожатии, и снаружи это выглядит как «связь оборвалась без причины». Поэтому
   * сначала спрашиваем актуальную — **через тот же прокси**, иначе запрос уйдёт напрямую и
   * умрёт. Не ответили — работаем на встроенной: канал, который не поднимается из-за
   * недоступного справочника версий, хуже канала на версии постарше.
   */
  async function currentVersion(): Promise<[number, number, number] | null> {
    try {
      const fetched = await fetchLatestBaileysVersion(
        agent === undefined ? {} : { httpsAgent: agent, httpAgent: agent, proxy: false }
      );
      debug?.(`версия протокола: ${fetched.version.join(".")}`
        + `${fetched.isLatest ? "" : " (не самая свежая)"}`);

      return fetched.version;
    } catch (error) {
      debug?.(`версию протокола узнать не удалось (${describe(error)}), берём встроенную`);

      return null;
    }
  }

  async function open(): Promise<void> {
    const auth = await useMultiFileAuthState(options.sessionDir);
    const saveCreds = auth.saveCreds;
    registered = auth.state.creds.registered === true;
    const version = await currentVersion();

    const created = makeWASocket({
      auth: {
        creds: auth.state.creds,
        // Ключей у сигнального протокола много, и читаются они пачками на каждое
        // сообщение. Без кэша это сотни обращений к диску в секунду на оживлённом чате.
        keys: makeCacheableSignalKeyStore(auth.state.keys, logger)
      },
      logger,
      // Как аккаунт подписан в списке устройств у владельца номера.
      browser: Browsers.ubuntu(options.deviceName),
      ...(version === null ? {} : { version }),
      ...(agent === undefined ? {} : { agent, fetchAgent: agent }),
      defaultQueryTimeoutMs: options.requestTimeoutMs,
      // Мы не читатель, а собеседник: отмечать себя «в сети» значит забрать уведомления с
      // телефона владельца номера. Телефон должен продолжать жить своей жизнью — на нём
      // держится сама привязка.
      markOnlineOnConnect: false,
      // История нам не нужна: разговор начинается с того дня, когда включили канал.
      // Иначе первая же привязка вывалила бы в ленту переписку за годы.
      syncFullHistory: false,
      // Сообщение для повторной расшифровки взять неоткуда: своего хранилища сообщений у
      // нас нет, всё сказанное лежит в базе переписки, а не здесь.
      getMessage: () => Promise.resolve(undefined)
    });

    socket = created;
    created.ev.on("creds.update", () => {
      void saveCreds();
    });

    created.ev.on("connection.update", (update) => {
      if (typeof update.qr === "string" && update.qr !== "") {
        pairingReady = true;
        for (const handler of pairingHandlers) {
          handler();
        }
      }
      if (update.connection === "connecting") {
        announce("connecting", null);
      }
      if (update.connection === "open") {
        attempt = 0;
        registered = true;
        announce("ready", null);
      }
      if (update.connection === "close") {
        void handleClose(update.lastDisconnect?.error);
      }
    });

    created.ev.on("messages.upsert", (upsert) => {
      // `append` — это досылка старого при синхронизации, `notify` — то, что человек
      // написал только что. В переписку идёт второе: первое повторно вывалило бы в ленту
      // уже записанное, а на свежей привязке — ещё и переписку до нашего появления.
      if (upsert.type !== "notify") {
        return;
      }
      for (const message of upsert.messages) {
        for (const handler of messageHandlers) {
          handler(message as WhatsAppMessage, message);
        }
      }
    });
  }

  /**
   * Обрыв.
   *
   * Разница здесь всего одна, зато решающая: **выход из аккаунта — это не обрыв связи.**
   * Если владелец номера отвязал устройство или WhatsApp закрыл сессию, повторять
   * бессмысленно: каталог сессии больше не годится, и нужен новый код привязки. Молча
   * переподключаться в этом случае значит крутить бесполезный цикл, пока кто-нибудь не
   * заметит, что переписка встала.
   */
  async function handleClose(error: unknown): Promise<void> {
    socket = null;
    if (closing) {
      announce("closed", "остановка процесса");

      return;
    }

    const status = statusCodeOf(error);
    if (status === DisconnectReason.loggedOut) {
      announce("logged_out", "сервер счёл сессию недействительной (401)");

      return;
    }

    const wait = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)]
      ?? 60_000;
    attempt += 1;
    announce("closed", `связь оборвалась (${describe(error)}${
      status === null ? "" : `, код ${String(status)}`}), повтор через ${
      String(Math.round(wait / 1000))} с`);
    await delay(wait);
    if (closing) {
      return;
    }
    try {
      await open();
    } catch (cause) {
      void handleClose(cause);
    }
  }

  function required(): WASocket {
    if (socket === null) {
      // Ответ, ушедший «в никуда», очередь повторит; притвориться отправленным нельзя.
      throw new Error("Соединение с WhatsApp закрыто");
    }

    return socket;
  }

  async function send(jid: string, content: AnyMessageContent): Promise<WhatsAppSendResult> {
    const sent = await required().sendMessage(jid, content);

    return { providerMessageId: sent?.key.id ?? "" };
  }

  return {
    async start() {
      await open();
    },

    onMessage(handler) {
      messageHandlers.push(handler);
    },

    onState(handler) {
      stateHandlers.push(handler);
      handler(state, stateReason);
    },

    onPairingReady(handler) {
      pairingHandlers.push(handler);
      if (pairingReady) {
        handler();
      }
    },

    isRegistered() {
      return registered;
    },

    async requestPairingCode() {
      return await required().requestPairingCode(options.phone);
    },

    self(): WhatsAppSelf | null {
      const user = socket?.user;
      if (user === undefined || user === null) {
        return null;
      }
      const jid = user.id;

      return { jid, phone: jid.split("@")[0]?.split(":")[0] ?? "" };
    },

    async sendText(jid, text) {
      return await send(jid, { text });
    },

    async sendFile(input: WhatsAppFileToSend) {
      return await send(input.jid, mediaContentOf(input));
    },

    /**
     * Скачивание вложения.
     *
     * На входе — сообщение целиком, как мы его записали при приёме. `reuploadRequest` не
     * украшение: файл, пролежавший у них некоторое время, приходится просить телефон
     * выложить заново, и без этого старые вложения не забираются вовсе.
     */
    async downloadMedia(payload: unknown) {
      const current = required();
      const buffer = await downloadMediaMessage(
        payload as WAMessage,
        "buffer",
        agent === undefined ? {} : { options: { httpsAgent: agent, httpAgent: agent, proxy: false } },
        { logger, reuploadRequest: current.updateMediaMessage }
      );

      return new Uint8Array(buffer);
    },

    async lookupPhone(phone: string): Promise<WhatsAppLookup | null> {
      const jid = jidOfPhone(phone);
      const found = await required().onWhatsApp(jid);
      const first = found?.[0];
      if (first === undefined) {
        return null;
      }

      return { jid: first.jid, exists: Boolean(first.exists) };
    },

    close() {
      closing = true;
      // `end` рвёт соединение, не трогая сессию. `logout` отвязал бы устройство совсем — и
      // следующий запуск потребовал бы кода с телефона. Обычная остановка процесса не
      // должна стоить привязки.
      socket?.end(undefined);
      socket = null;

      return Promise.resolve();
    }
  };
}

/**
 * Чем отправлять файл.
 *
 * Единственный из трёх каналов, где отправляется всё: картинка, видео, документ, голосовое.
 * Тип сообщения выбирается по виду вложения — присланный документом голос не проиграется в
 * чате, а картинка, отправленная документом, придёт файлом без предпросмотра.
 */
function mediaContentOf(input: WhatsAppFileToSend): AnyMessageContent {
  const bytes = Buffer.from(input.bytes);
  const caption = input.caption === "" ? {} : { caption: input.caption };
  const mimetype = input.mimeType ?? "application/octet-stream";

  if (input.kind === "photo") {
    return { image: bytes, ...caption };
  }
  if (input.kind === "video") {
    return { video: bytes, ...caption };
  }
  if (input.kind === "voice") {
    return { audio: bytes, ptt: true, mimetype };
  }
  if (input.kind === "audio") {
    return { audio: bytes, mimetype };
  }

  return { document: bytes, mimetype, fileName: input.fileName, ...caption };
}

/**
 * Имя сайта разрешает прокси, а не мы.
 *
 * У SOCKS это разница между схемами: `socks5://` — «я сам узнаю адрес и попрошу прокси
 * соединиться с ним», `socks5h://` — «узнай адрес сам». Для Telegram через TDLib разницы
 * не было, и в его переменной буква `h` не нужна; здесь она решает.
 *
 * Причина местная: домены WhatsApp исключены из национальной системы доменных имён, и на
 * этом сервере их имена не разрешаются или разрешаются не туда. Соединение при этом умирает
 * молча — выглядит как неработающий прокси при живом прокси.
 *
 * Схема поэтому не спрашивается у настроек, а ставится здесь. Строку в `.env` однажды
 * перепишут целиком, и канал не должен от этого зависеть.
 */
function remoteDnsProxy(url: string): string {
  return url.replace(/^socks5:\/\//i, "socks5h://");
}

function statusCodeOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const output = (error as { readonly output?: { readonly statusCode?: unknown } }).output;

  return typeof output?.statusCode === "number" ? output.statusCode : null;
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

/**
 * Журнал, которого библиотека ждёт от нас.
 *
 * Свой тип, а не её: наружу она его не отдаёт, а по составу это обычный `pino`. Совпадение
 * по форме — всё, что нужно, и заодно это ещё одна вещь, которой не придётся менять при
 * смене библиотеки.
 */
interface BaileysLogger {
  level: string;
  child(obj: Record<string, unknown>): BaileysLogger;
  trace(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

/**
 * Журнал библиотеки — в тишину.
 *
 * Она разговорчива до неприличия: на каждое сообщение уходит десяток строк про ключи и
 * узлы протокола. Наш журнал ведёт приложение, и состояние канала оно узнаёт из `onState`,
 * а не из чужого потока отладки.
 */
/**
 * Журнал библиотеки — наружу, когда разбираются с неполадкой.
 *
 * Уровень `trace` намеренно: интересное здесь как раз в нём — узлы протокола, из-за которых
 * сервер закрывает соединение. Читать это в обычной работе невозможно, а в разборе только
 * оно и помогает.
 */
function debugLogger(sink: WhatsAppDebugSink): BaileysLogger {
  const write = (level: string) => (obj: unknown, msg?: string): void => {
    const text = msg ?? "";
    const detail = obj === undefined || obj === null || obj === "" ? "" : ` ${safeJson(obj)}`;
    sink(`[${level}] ${text}${detail}`);
  };
  const logger: BaileysLogger = {
    level: "trace",
    child: () => logger,
    trace: write("trace"),
    debug: write("debug"),
    info: write("info"),
    warn: write("warn"),
    error: write("error")
  };

  return logger;
}

function safeJson(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "bigint" ? String(item) : item)?.slice(0, 2_000) ?? "";
  } catch {
    return String(value);
  }
}

function silentLogger(): BaileysLogger {
  const noop = (): void => undefined;
  const logger: BaileysLogger = {
    level: "silent",
    child: () => logger,
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop
  };

  return logger;
}
