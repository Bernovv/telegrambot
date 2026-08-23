/**
 * Общее для скриптов аккаунта MAX: поднять клиента и сказать вслух, что с соединением.
 *
 * Порядок здесь важен ровно в одном месте: клиент поднимается **без входа**, если токена
 * ещё нет. Иначе скриптом входа было бы невозможно воспользоваться — он и нужен для того,
 * чтобы токен появился.
 */
import { loadMaxAccountConfig } from "@ticket-platform/config";
import type { MaxAccountConfig } from "@ticket-platform/config";
import {
  MaxAccountClient,
  MAX_ACCOUNT_DEFAULTS,
  type MaxAccountState
} from "@ticket-platform/messenger-max-account";

export type EnabledMaxAccountConfig = Extract<MaxAccountConfig, { enabled: true }>;

export interface OpenedMaxAccount {
  readonly client: MaxAccountClient;
  readonly config: EnabledMaxAccountConfig;
}

export function requireAccountConfig(): EnabledMaxAccountConfig {
  const config = loadMaxAccountConfig(process.env);
  if (!config.enabled) {
    throw new Error(
      "Аккаунт компании в MAX выключен: в .env нет MAX_ACCOUNT_DEVICE_ID."
      + " Что нужно заполнить — в docs/runbooks/max-account.md"
    );
  }

  return config;
}

/**
 * Поднять клиента.
 *
 * `withToken: false` — соединение без входа, для скрипта входа. Во всех остальных случаях
 * отсутствие токена это остановка: процесс, который поднялся и ничего не принимает,
 * выглядит ровно как процесс, которому никто не пишет.
 */
export async function openAccount(
  options: { readonly withToken?: boolean } = {}
): Promise<OpenedMaxAccount> {
  const config = requireAccountConfig();
  const withToken = options.withToken ?? true;
  if (withToken && config.token === null) {
    throw new Error(
      "Вход не выполнен: в .env нет MAX_ACCOUNT_TOKEN."
      + " Войти: pnpm max:login на этом же сервере, с телефоном под рукой."
    );
  }

  const client = new MaxAccountClient({
    token: withToken ? config.token : null,
    deviceId: config.deviceId,
    deviceName: config.deviceName,
    appVersion: config.appVersion,
    userAgent: config.userAgent,
    wsUrl: config.wsUrl,
    requestTimeoutMs: config.requestTimeoutMs ?? MAX_ACCOUNT_DEFAULTS.requestTimeoutMs
  });

  await client.connect();

  return { client, config };
}

/** Человеческое название состояния — для журнала и для вывода скриптов. */
export function describeState(state: MaxAccountState): string {
  switch (state) {
    case "connecting":
      return "соединяемся";
    case "authorizing":
      return "входим";
    case "ready":
      return "на связи";
    case "disconnected":
      return "связи нет";
    case "unauthorized":
      return "вход отвергнут: токен просрочен, отозван или аккаунт ограничен";
  }
}
