/**
 * Общее для скриптов аккаунта WhatsApp: поднять клиента и сказать вслух, что с соединением.
 *
 * От MAX отличается одним: там клиент поднимается «без токена» для скрипта входа, здесь
 * такого разделения нет вовсе. Каталог сессии нужен всегда — и когда сессия в нём уже есть,
 * и когда её только предстоит завести кодом привязки. Пустой каталог это не ошибка, а
 * состояние «ещё не входили».
 */
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
export async function openAccount(): Promise<OpenedWhatsAppAccount> {
  const config = requireAccountConfig();
  const client = createWhatsAppAccountClient({
    sessionDir: config.sessionDir,
    phone: config.phone,
    deviceName: config.deviceName,
    proxyUrl: config.proxyUrl,
    requestTimeoutMs: config.requestTimeoutMs
  });

  await client.start();

  return { client, config };
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
