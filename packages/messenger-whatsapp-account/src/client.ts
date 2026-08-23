import { setTimeout as delay } from "node:timers/promises";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
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
  /** Вошли ли уже. `false` — сессии нет, нужен код привязки. */
  isRegistered(): boolean;
}

export function createWhatsAppAccountClient(
  options: WhatsAppAccountClientOptions
): WhatsAppAccountClient {
  const agent = options.proxyUrl === null ? undefined : new SocksProxyAgent(options.proxyUrl);
  const messageHandlers: WhatsAppMessageHandler[] = [];
  const stateHandlers: WhatsAppStateHandler[] = [];
  const logger = silentLogger();

  let socket: WASocket | null = null;
  let registered = false;
  let closing = false;
  let attempt = 0;

  function announce(state: WhatsAppConnectionState, reason: string | null): void {
    for (const handler of stateHandlers) {
      handler(state, reason);
    }
  }

  async function open(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(options.sessionDir);
    registered = state.creds.registered === true;

    const created = makeWASocket({
      auth: {
        creds: state.creds,
        // Ключей у сигнального протокола много, и читаются они пачками на каждое
        // сообщение. Без кэша это сотни обращений к диску в секунду на оживлённом чате.
        keys: makeCacheableSignalKeyStore(state.keys, logger)
      },
      logger,
      // Как аккаунт подписан в списке устройств у владельца номера.
      browser: Browsers.ubuntu(options.deviceName),
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
      announce("logged_out", "аккаунт отвязан — нужен новый вход по коду");

      return;
    }

    const wait = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)]
      ?? 60_000;
    attempt += 1;
    announce("closed", `связь оборвалась (${describe(error)}), повтор через ${
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
