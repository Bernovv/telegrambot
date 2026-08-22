import type { TelegramAccountProxy } from "./options.js";

/**
 * Прокси в списке TDLib.
 *
 * Список этот живёт **в папке сессии**, а не в нашем конфиге, и переживает перезапуски. В
 * этом вся сложность: `.env` можно поправить, а TDLib продолжит ходить через то, что ему
 * когда-то добавили. Ровно так 27 июля затёрся адрес Cloudflare-прокси и два часа не
 * доставлялись билеты — только там переменная опустела, а здесь наоборот, старое значение
 * держится само.
 *
 * Поэтому список приводится к `.env` при каждом старте, а не дополняется: что записано в
 * настройках, то и включено, лишнее удаляется. Единственный источник правды — `.env`.
 */
export interface StoredProxy {
  readonly id: number;
  readonly enabled: boolean;
  readonly proxy: TelegramAccountProxy;
}

export interface ProxyStore {
  list(): Promise<readonly StoredProxy[]>;
  add(proxy: TelegramAccountProxy): Promise<number>;
  enable(id: number): Promise<void>;
  disable(): Promise<void>;
  remove(id: number): Promise<void>;
}

export interface ProxyReconciliation {
  /** Что включено в итоге. `null` — прокси выключен, аккаунт идёт напрямую. */
  readonly enabledId: number | null;
  /** Прокси добавлен впервые: раньше такого в списке не было. */
  readonly added: boolean;
  /** Сколько чужих записей выброшено. Больше нуля — значит, адрес недавно меняли. */
  readonly removed: number;
}

export async function reconcileProxy(
  store: ProxyStore,
  wanted: TelegramAccountProxy | null
): Promise<ProxyReconciliation> {
  const stored = await store.list();

  if (wanted === null) {
    await store.disable();
    for (const entry of stored) {
      await store.remove(entry.id);
    }

    return { enabledId: null, added: false, removed: stored.length };
  }

  const match = stored.find((entry) => sameProxy(entry.proxy, wanted));
  let enabledId: number;
  let added = false;

  if (match === undefined) {
    enabledId = await store.add(wanted);
    added = true;
  } else {
    enabledId = match.id;
    if (!match.enabled) {
      await store.enable(match.id);
    }
  }

  let removed = 0;
  for (const entry of stored) {
    if (entry.id !== enabledId) {
      await store.remove(entry.id);
      removed += 1;
    }
  }

  return { enabledId, added, removed };
}

/**
 * Тот же это прокси или другой.
 *
 * Сравниваются и учётные данные: сменившийся пароль на том же адресе — это другой прокси,
 * и запись со старым паролем должна уехать, а не остаться рядом «на всякий случай».
 */
export function sameProxy(
  left: TelegramAccountProxy,
  right: TelegramAccountProxy
): boolean {
  if (left.kind !== right.kind || left.host !== right.host || left.port !== right.port) {
    return false;
  }
  if (left.kind === "socks5" && right.kind === "socks5") {
    return left.username === right.username && left.password === right.password;
  }
  if (left.kind === "mtproto" && right.kind === "mtproto") {
    return left.secret === right.secret;
  }

  return false;
}
