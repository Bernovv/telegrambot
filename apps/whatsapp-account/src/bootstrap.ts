/**
 * Общее для скриптов аккаунта WhatsApp: поднять клиента и сказать вслух, что с соединением.
 *
 * От MAX отличается одним: там клиент поднимается «без токена» для скрипта входа, здесь
 * такого разделения нет вовсе. Каталог сессии нужен всегда — и когда сессия в нём уже есть,
 * и когда её только предстоит завести кодом привязки. Пустой каталог это не ошибка, а
 * состояние «ещё не входили».
 */
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { loadWhatsAppAccountConfig } from "@ticket-platform/config";
import type { WhatsAppAccountConfig } from "@ticket-platform/config";
import {
  createWhatsAppAccountClient,
  type WhatsAppAccountClient,
  type WhatsAppConnectionState
} from "@ticket-platform/messenger-whatsapp-account";

export type EnabledWhatsAppAccountConfig = Extract<WhatsAppAccountConfig, { enabled: true }>;

export interface OpenedWhatsAppAccount {
  readonly client: WhatsAppAccountClient;
  readonly config: EnabledWhatsAppAccountConfig;
}

export function requireAccountConfig(): EnabledWhatsAppAccountConfig {
  const config = loadWhatsAppAccountConfig(process.env);
  if (!config.enabled) {
    throw new Error(
      "Аккаунт компании в WhatsApp выключен: в .env нет WHATSAPP_ACCOUNT_SESSION_DIR."
      + " Что нужно заполнить — в docs/runbooks/whatsapp-account.md"
    );
  }

  return config;
}

/**
 * Поднять клиента и дождаться, чем кончится соединение.
 *
 * Ждём осознанно: у Baileys соединение поднимается событиями, и без ожидания скрипт успел
 * бы напечатать «связи нет» раньше, чем она появится. `ready` — вошли; `logged_out` —
 * привязки нет или её отозвали, и это не ошибка для скрипта входа, а его рабочий случай.
 */
export async function openAccount(
  /**
   * Куда печатать подробности протокола. Включается переменной `WHATSAPP_ACCOUNT_DEBUG=1`
   * и нужна ровно тогда, когда соединение рвётся без внятной причины: настоящая причина
   * лежит в узлах протокола, а наружу от них доходит только «Connection Closed».
   */
  debug: ((message: string) => void) | null = defaultDebugSink()
): Promise<OpenedWhatsAppAccount> {
  const config = requireAccountConfig();
  const client = createWhatsAppAccountClient({
    sessionDir: config.sessionDir,
    phone: config.phone,
    deviceName: config.deviceName,
    proxyUrl: config.proxyUrl,
    requestTimeoutMs: config.requestTimeoutMs
  }, debug);

  await client.start();

  return { client, config };
}

function defaultDebugSink(): ((message: string) => void) | null {
  if ((process.env.WHATSAPP_ACCOUNT_DEBUG ?? "") !== "1") {
    return null;
  }

  return (message: string) => {
    process.stderr.write(`${message}\n`);
  };
}

/**
 * Ждёт, пока соединение придёт в одно из состояний, которое можно показать человеку.
 *
 * Предел по времени обязателен: без него скрипт, запущенный при недоступном прокси, висел
 * бы молча — а именно про прокси и надо узнать в первую очередь.
 */
export async function waitForState(
  client: WhatsAppAccountClient,
  wanted: readonly WhatsAppConnectionState[],
  timeoutMs: number
): Promise<{ readonly state: WhatsAppConnectionState; readonly reason: string | null }> {
  return await new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ state: "closed", reason: "ответа нет: проверьте прокси" });
    }, timeoutMs);
    timer.unref();

    client.onState((state, reason) => {
      if (wanted.includes(state)) {
        clearTimeout(timer);
        resolve({ state, reason });
      }
    });
  });
}

/**
 * Ждёт предложения привязаться — момента, когда код можно спрашивать.
 *
 * Отдельно от состояния соединения, потому что это не состояние: сокет к этому времени уже
 * «соединяемся», и по нему не отличить «идёт рукопожатие» от «сервер готов». Спросить код
 * раньше — получить `Connection Closed`, что и происходило.
 */
export async function waitForPairingReady(
  client: WhatsAppAccountClient,
  timeoutMs: number
): Promise<PairingAttempt> {
  return await new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ ready: false, state: "closed", reason: "ответа от WhatsApp не было" });
    }, timeoutMs);
    timer.unref();

    client.onPairingReady(() => {
      clearTimeout(timer);
      resolve({ ready: true, state: "connecting", reason: null });
    });
    // Соединение может кончиться, так и не дойдя до предложения. Состояние и причину
    // обязательно наружу: отвергнутая сессия лечится не тем, чем мёртвый прокси, а снаружи
    // и то и другое выглядит одинаковым «не получилось».
    client.onState((state, reason) => {
      if (state === "closed" || state === "logged_out") {
        clearTimeout(timer);
        resolve({ ready: false, state, reason });
      }
    });
  });
}

export interface PairingAttempt {
  readonly ready: boolean;
  readonly state: WhatsAppConnectionState;
  readonly reason: string | null;
}

/**
 * Стереть сессию, оставив сам каталог.
 *
 * Каталог не трогаем намеренно: у него права `700` и владелец `root`, выставленные руками
 * при установке. Пересоздать его — значит однажды получить каталог с правами по умолчанию,
 * то есть ключи от всей переписки, открытые на чтение кому попало.
 *
 * Возвращает, сколько файлов убрано: ноль означает, что каталог и так был пуст, и причина
 * отказа не в сессии.
 */
export async function resetSession(sessionDir: string): Promise<number> {
  const entries = await readdir(sessionDir);
  for (const entry of entries) {
    await rm(join(sessionDir, entry), { recursive: true, force: true });
  }

  return entries.length;
}

/** Человеческое название состояния — для журнала и для вывода скриптов. */
export function describeState(state: WhatsAppConnectionState): string {
  switch (state) {
    case "connecting":
      return "соединяемся";
    case "ready":
      return "на связи";
    case "closed":
      return "связи нет";
    case "logged_out":
      return "устройство отвязано: нужен новый вход по коду";
  }
}
