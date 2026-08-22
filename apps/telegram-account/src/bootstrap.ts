/**
 * Общее для скриптов аккаунта компании: поднять клиента и привести прокси к `.env`.
 *
 * Порядок здесь не произвольный. Прокси настраивается **до** всего остального: без него с
 * этого сервера MTProto не доходит вовсе, и попытка войти без прокси выглядит не как ошибка,
 * а как бесконечное ожидание кода, который никогда не придёт.
 */
import { loadTelegramAccountConfig } from "@ticket-platform/config";
import type { TelegramAccountConfig } from "@ticket-platform/config";
import {
  createTelegramAccountClient,
  describeProxy,
  reconcileProxy,
  TdlibProxyStore,
  waitForConnection,
  type ConnectionState
} from "@ticket-platform/messenger-telegram-account";
import type { Client } from "tdl";

export interface OpenedAccount {
  readonly client: Client;
  readonly config: Extract<TelegramAccountConfig, { enabled: true }>;
}

export function requireAccountConfig(): Extract<TelegramAccountConfig, { enabled: true }> {
  const config = loadTelegramAccountConfig(process.env);
  if (!config.enabled) {
    throw new Error(
      "Аккаунт компании выключен: в .env нет TELEGRAM_ACCOUNT_API_ID."
      + " Что нужно заполнить — в docs/runbooks/telegram-account.md"
    );
  }

  return config;
}

export async function openAccount(): Promise<OpenedAccount> {
  const config = requireAccountConfig();
  const client = await createTelegramAccountClient({
    apiId: config.apiId,
    apiHash: config.apiHash,
    sessionDirectory: config.sessionDirectory,
    databaseEncryptionKey: config.databaseEncryptionKey,
    proxy: config.proxy,
    deviceModel: config.deviceModel,
    applicationVersion: process.env.APP_VERSION ?? "0.1.0"
  });

  // Ошибки TDLib, не привязанные к запросу, приходят сюда. Молчать о них нельзя: почти
  // всегда это и есть объяснение того, почему ничего не происходит.
  client.on("error", (error) => {
    console.error("TDLib:", error.message);
  });

  const applied = await reconcileProxy(new TdlibProxyStore(client), config.proxy);
  console.log(`Прокси: ${describeProxy(config.proxy)}`);
  if (applied.added) {
    console.log("  прокси добавлен в список TDLib и включён");
  }
  if (applied.removed > 0) {
    console.log(`  выброшено записей от прошлых настроек: ${applied.removed}`);
  }

  return { client, config };
}

/**
 * Дождаться соединения и сказать вслух, если его нет.
 *
 * TDLib об ошибках прокси не сообщает — он молча пробует снова, и снаружи это неотличимо от
 * «всё хорошо, просто ещё не готово». Отсюда явное ожидание с потолком по времени.
 */
export async function reportConnection(
  client: Client,
  timeoutMs = 30_000
): Promise<ConnectionState | null> {
  const state = await waitForConnection(client, timeoutMs);
  if (state === "ready") {
    console.log("Соединение с Telegram установлено.");

    return state;
  }

  console.error(
    `Соединения нет за ${Math.round(timeoutMs / 1000)} с, состояние: ${state ?? "неизвестно"}.`
  );
  console.error(
    "Почти всегда это прокси: не отвечает, не пускает по паролю или закрыт файрволом."
    + " Проверить с этого же сервера: curl -x socks5h://ХОСТ:ПОРТ https://api.telegram.org"
  );

  return state;
}
