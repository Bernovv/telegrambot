import { MaxOpcode } from "./protocol.js";
import type { MaxInboundFrame } from "./protocol.js";

/**
 * Справочник: кто это написал и что за чат.
 *
 * У Bot API человек приходит вместе с сообщением — с именем и ником. Здесь в кадре только
 * число, а карточка человека без имени заводится безымянной. Поэтому имя приходится
 * спрашивать, и спрашивать по-хорошему один раз: их антифрод считает частоту вызовов, а
 * один и тот же клиент за день пишет десятки раз.
 *
 * Отсюда кэш. Он живёт в памяти процесса и умирает вместе с ним — это осознанно: имя,
 * прочитанное вчера, могло измениться, а перезапуск у нас редкий.
 */

/** Потолок кэша. Дальше вытесняется самое старое: процесс живёт месяцами. */
const CACHE_LIMIT = 5_000;

export type MaxChatKind = "dialog" | "group" | "channel" | "unknown";

export interface MaxAccountInvoker {
  invoke(
    opcode: number,
    payload: Readonly<Record<string, unknown>>
  ): Promise<MaxInboundFrame>;
}

export class MaxChatDirectory {
  private readonly chats = new Map<string, MaxChatKind>();
  private readonly users = new Map<string, Readonly<Record<string, unknown>>>();

  constructor(private readonly client: MaxAccountInvoker) {}

  /**
   * Личный это чат или нет.
   *
   * Спрашивать обязательно: групповое сообщение, попавшее в карточку человека, — это чужой
   * разговор в его переписке. Неизвестный тип считаем **не** личным: лучше не записать
   * сообщение из группы, чем записать группу в карточку клиента.
   */
  async isDialog(chatId: string): Promise<boolean> {
    return await this.chatKind(chatId) === "dialog";
  }

  async chatKind(chatId: string): Promise<MaxChatKind> {
    const known = this.chats.get(chatId);
    if (known !== undefined) {
      return known;
    }

    const frame = await this.client.invoke(MaxOpcode.chatInfo, {
      chatIds: [numberOf(chatId)]
    });
    const chat = firstOf(frame, "chats") ?? recordOf(frame.payload?.["chat"]);
    const kind = kindOf(chat?.["type"]);
    remember(this.chats, chatId, kind);

    return kind;
  }

  /** Имя и ник человека. Пустая запись означает, что MAX о нём ничего не сказал. */
  async user(userId: string): Promise<Readonly<Record<string, unknown>>> {
    const known = this.users.get(userId);
    if (known !== undefined) {
      return known;
    }

    const frame = await this.client.invoke(MaxOpcode.contactInfo, {
      contactIds: [numberOf(userId)]
    });
    const user = firstOf(frame, "contacts") ?? recordOf(frame.payload?.["contact"]) ?? {
      id: userId
    };
    remember(this.users, userId, user);

    return user;
  }

  /**
   * Найти человека по номеру телефона.
   *
   * То самое, чего бот не умеет вовсе. Пока используется в проверке канала — сверить, что
   * идентификатор человека у аккаунта тот же, что у бота, — а дальше на этом же вызове
   * встанет «написать первым» из панели.
   */
  async findByPhone(phone: string): Promise<Readonly<Record<string, unknown>> | null> {
    const frame = await this.client.invoke(MaxOpcode.contactInfoByPhone, {
      phone: phone.replace(/^\+/, "")
    });

    return recordOf(frame.payload?.["contact"]) ?? firstOf(frame, "contacts");
  }
}

function kindOf(type: unknown): MaxChatKind {
  switch (type) {
    case "DIALOG":
      return "dialog";
    case "CHAT":
      return "group";
    case "CHANNEL":
      return "channel";
    default:
      return "unknown";
  }
}

function remember<T>(cache: Map<string, T>, key: string, value: T): void {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (!oldest.done) {
      cache.delete(oldest.value);
    }
  }
  cache.set(key, value);
}

function firstOf(
  frame: MaxInboundFrame,
  key: string
): Readonly<Record<string, unknown>> | null {
  const list = frame.payload?.[key];

  return Array.isArray(list) ? recordOf(list[0]) : null;
}

function recordOf(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : null;
}

function numberOf(value: string): number | string {
  const parsed = Number(value);

  return Number.isSafeInteger(parsed) ? parsed : value;
}
