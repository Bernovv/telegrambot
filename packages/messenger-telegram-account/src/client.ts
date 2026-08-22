/// <reference types="@prebuilt-tdlib/types" />
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Client } from "tdl";
import type { proxy as TdProxy, proxy$Input as TdProxyInput, Update as TdUpdate } from "tdlib-types";
import * as tdl from "tdl";
import { getTdjson } from "prebuilt-tdlib";
import type { TelegramAccountClientOptions, TelegramAccountProxy } from "./options.js";
import type { ProxyStore, StoredProxy } from "./proxy.js";

/**
 * Клиент TDLib для аккаунта компании.
 *
 * TDLib, а не библиотека попроще, — сознательно: аккаунт будет держать многолетнюю историю
 * переписки, и разбор больших диалогов у TDLib свой, на C++, а не на нашем событийном цикле.
 * Платим за это тем, что сессия — каталог на диске, а не строка в `.env`.
 *
 * **Экземпляр должен быть один.** Две копии на одной сессии Telegram считает двумя
 * устройствами и начинает рвать соединение по кругу — снаружи это выглядит как «канал
 * моргает», а причина в том, что кто-то оставил запущенным скрипт входа.
 */

let tdjsonConfigured = false;

/** Библиотека грузится один раз на процесс: повторный `configure` TDLib не переживает. */
function configureTdjson(): void {
  if (tdjsonConfigured) {
    return;
  }
  // 1 — только ошибки. Выше начинается поток отладки, в котором тонет всё остальное.
  tdl.configure({ tdjson: getTdjson(), verbosityLevel: 1 });
  tdjsonConfigured = true;
}

export interface TelegramAccountSessionPaths {
  readonly databaseDirectory: string;
  readonly filesDirectory: string;
}

export function sessionPaths(sessionDirectory: string): TelegramAccountSessionPaths {
  return {
    databaseDirectory: join(sessionDirectory, "db"),
    filesDirectory: join(sessionDirectory, "files")
  };
}

export async function createTelegramAccountClient(
  options: TelegramAccountClientOptions
): Promise<Client> {
  configureTdjson();
  const paths = sessionPaths(options.sessionDirectory);
  await mkdir(paths.databaseDirectory, { recursive: true });
  await mkdir(paths.filesDirectory, { recursive: true });

  return tdl.createClient({
    apiId: options.apiId,
    apiHash: options.apiHash,
    databaseDirectory: paths.databaseDirectory,
    filesDirectory: paths.filesDirectory,
    databaseEncryptionKey: options.databaseEncryptionKey,
    // `skipOldUpdates` намеренно оставлен выключенным. Он выбрасывает обновления, пришедшие
    // пока процесс лежал, — для бота это разумная защита от лавины, а для переписки это
    // потерянные сообщения клиентов за время простоя. Здесь дороже помнить.
    tdlibParameters: {
      use_message_database: true,
      use_secret_chats: false,
      system_language_code: "ru",
      device_model: options.deviceModel,
      application_version: options.applicationVersion,
      system_version: "Linux"
    }
  });
}

/** Список прокси TDLib как хранилище: логика сверки живёт в `proxy.ts` и его не знает. */
export class TdlibProxyStore implements ProxyStore {
  constructor(private readonly client: Pick<Client, "invoke">) {}

  async list(): Promise<readonly StoredProxy[]> {
    const added = await this.client.invoke({ _: "getProxies" });

    return added.proxies.flatMap((entry) => {
      const proxy = fromTdlibProxy(entry.proxy);

      // HTTP-прокси в списке возможен, но мы его не заводим и не умеем сравнивать. Пропуск
      // здесь означает, что сверка сочтёт его лишним и удалит, — так и надо: в `.env` его
      // нет, значит, он остался от чужой настройки.
      return proxy === null
        ? []
        : [{ id: entry.id, enabled: entry.is_enabled, proxy }];
    });
  }

  async add(proxy: TelegramAccountProxy): Promise<number> {
    const added = await this.client.invoke({
      _: "addProxy",
      proxy: toTdlibProxy(proxy),
      enable: true,
      comment: "biz-day CRM"
    });

    return added.id;
  }

  async enable(id: number): Promise<void> {
    await this.client.invoke({ _: "enableProxy", proxy_id: id });
  }

  async disable(): Promise<void> {
    await this.client.invoke({ _: "disableProxy" });
  }

  async remove(id: number): Promise<void> {
    await this.client.invoke({ _: "removeProxy", proxy_id: id });
  }
}

function toTdlibProxy(proxy: TelegramAccountProxy): TdProxyInput {
  return {
    _: "proxy",
    server: proxy.host,
    port: proxy.port,
    type: proxy.kind === "socks5"
      ? {
          _: "proxyTypeSocks5",
          username: proxy.username ?? "",
          password: proxy.password ?? ""
        }
      : { _: "proxyTypeMtproto", secret: proxy.secret }
  };
}

function fromTdlibProxy(proxy: TdProxy): TelegramAccountProxy | null {
  if (proxy.type._ === "proxyTypeSocks5") {
    return {
      kind: "socks5",
      host: proxy.server,
      port: proxy.port,
      username: proxy.type.username === "" ? null : proxy.type.username,
      password: proxy.type.password === "" ? null : proxy.type.password
    };
  }
  if (proxy.type._ === "proxyTypeMtproto") {
    return {
      kind: "mtproto",
      host: proxy.server,
      port: proxy.port,
      secret: proxy.type.secret
    };
  }

  return null;
}

/**
 * Состояние соединения — единственный честный ответ на вопрос «прокси живой?».
 *
 * Ошибки прокси TDLib наружу не отдаёт: он бесконечно и молча пытается соединиться заново.
 * Поэтому «включили и пошли дальше» тут не работает — надо дождаться `ready`, а не дождаться
 * значит сказать об этом вслух.
 */
export type ConnectionState =
  | "waitingForNetwork"
  | "connectingToProxy"
  | "connecting"
  | "updating"
  | "ready";

export async function waitForConnection(
  client: Client,
  timeoutMs: number
): Promise<ConnectionState | null> {
  return await new Promise<ConnectionState | null>((resolve) => {
    let last: ConnectionState | null = null;
    const finish = (state: ConnectionState | null): void => {
      clearTimeout(timer);
      client.off("update", listener);
      resolve(state);
    };
    const listener = (update: TdUpdate): void => {
      if (update._ !== "updateConnectionState") {
        return;
      }
      const state = connectionStateOf(update.state._);
      if (state === null) {
        return;
      }
      last = state;
      if (state === "ready") {
        finish(state);
      }
    };
    const timer = setTimeout(() => {
      finish(last);
    }, timeoutMs);

    client.on("update", listener);
  });
}

function connectionStateOf(name: string): ConnectionState | null {
  switch (name) {
    case "connectionStateWaitingForNetwork":
      return "waitingForNetwork";
    case "connectionStateConnectingToProxy":
      return "connectingToProxy";
    case "connectionStateConnecting":
      return "connecting";
    case "connectionStateUpdating":
      return "updating";
    case "connectionStateReady":
      return "ready";
    default:
      return null;
  }
}

export interface TelegramAccountIdentity {
  readonly userId: string;
  /** Как его вернул Telegram — без плюса. */
  readonly phone: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly username: string | null;
}

export async function readAccountIdentity(
  client: Pick<Client, "invoke">
): Promise<TelegramAccountIdentity> {
  const me = await client.invoke({ _: "getMe" });

  return {
    userId: String(me.id),
    phone: me.phone_number,
    firstName: me.first_name,
    lastName: me.last_name,
    username: me.usernames?.active_usernames[0] ?? null
  };
}

export async function readAuthorizationState(
  client: Pick<Client, "invoke">
): Promise<string> {
  const state = await client.invoke({ _: "getAuthorizationState" });

  return state._;
}
