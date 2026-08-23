import type {
  AttachmentKind,
  ConversationParticipant,
  IncomingAttachment,
  IncomingConversationMessage
} from "@ticket-platform/messenger-core";
import { MaxOpcode, type MaxInboundFrame } from "./protocol.js";

/**
 * Что аккаунту написали — на языке нашей переписки.
 *
 * Разбор отделён от соединения намеренно: кадры MAX — это чистые данные, и проверять их
 * правильнее без сети и без живой сессии.
 *
 * Правило то же, что во всей переписке: **сохранить и не понять — лучше, чем понять и
 * потерять.** Незнакомое вложение не пропускается, а ложится строкой без файла — кадр
 * целиком уходит в `payload`, и разобрать его можно будет потом.
 */

/** Сообщение MAX в том виде, в каком нам нужны его поля. */
export interface MaxAccountMessage {
  readonly id?: unknown;
  readonly sender?: unknown;
  readonly text?: unknown;
  readonly time?: unknown;
  readonly type?: unknown;
  readonly attaches?: unknown;
}

export interface IncomingMaxMessage {
  readonly message: MaxAccountMessage;
  readonly chatId: string;
  readonly senderUserId: string;
}

/**
 * Наше ли это сообщение и от кого.
 *
 * Отбор идёт только по коду операции. По типу кадра — намеренно нет: ответы на наши вызовы
 * отсеиваются раньше, в клиенте, а как именно MAX помечает свои же уведомления, мы знать не
 * можем — их протокол не документирован. Лишнее условие здесь способно только молча съесть
 * сообщение клиента, и один раз уже съело.
 *
 * `null` — кадр нам не подходит, и причины ровно три:
 *
 * - **Кадр не про новое сообщение.** Событий у MAX больше сотни: набор текста, реакции,
 *   присутствие. В переписке им делать нечего.
 * - **Написали мы, а не нам.** Исходящее пишется в момент отправки, вместе с судьбой
 *   доставки; записать его ещё и здесь значило бы показать менеджеру свой ответ дважды.
 * - **Отправителя нет.** Так приходят служебные сообщения чата — человека за ними нет,
 *   и заводить на них карточку нечего.
 *
 * Личный это чат или группа, здесь не решается: тип чата в кадре не приезжает, за ним
 * нужен отдельный вызов. Этим занимается `MaxChatDirectory`.
 */
export function incomingMessage(
  frame: MaxInboundFrame,
  selfUserId: string
): IncomingMaxMessage | null {
  if (frame.opcode !== MaxOpcode.notifyMessage) {
    return null;
  }
  const payload = frame.payload ?? {};
  const message = payload["message"];
  if (!isRecord(message)) {
    return null;
  }
  const senderUserId = idOf(message["sender"]);
  if (senderUserId === null || senderUserId === selfUserId) {
    return null;
  }
  const chatId = idOf(payload["chatId"]) ?? idOf(message["chatId"]);
  if (chatId === null) {
    return null;
  }

  return { message, chatId, senderUserId };
}

export function toIncomingMessage(
  input: IncomingMaxMessage,
  sender: ConversationParticipant,
  payload: unknown
): IncomingConversationMessage {
  const message = input.message;
  const messageId = idOf(message["id"]);

  return {
    channel: "max",
    transport: "account",
    externalChatId: input.chatId,
    sender,
    externalMessageId: messageId,
    // Правка приходит тем же кодом операции, но со статусом `EDITED`. Отличать её от
    // новой реплики по одному этому полю рано: их веб-клиент ставит тот же статус и когда
    // сам подтягивает предпросмотр ссылки. Разбираться с этим нужно с холодной головой.
    editsExternalMessageId: null,
    body: textOf(message["text"]),
    attachments: attachmentsOf(message["attaches"], input.chatId, messageId),
    occurredAt: timeOf(message["time"]),
    payload
  };
}

/**
 * Имя и ник человека так, как их знает MAX.
 *
 * Ник у них не поле, а хвост ссылки на профиль: `max.ru/ivanov`. Берём его оттуда — по
 * нему карточка человека склеивается с той, что завёл бот, а без него остаётся числовой
 * идентификатор, и склейка ложится на телефон.
 */
export function participantOf(user: Readonly<Record<string, unknown>>): ConversationParticipant {
  const names = user["names"];
  const first = Array.isArray(names) && isRecord(names[0]) ? names[0] : null;
  const displayName = first === null
    ? null
    : [first["name"], joinName(first["firstName"], first["lastName"])]
      .find((part) => typeof part === "string" && part !== "");

  return {
    externalUserId: idOf(user["id"]) ?? "",
    username: usernameOf(user["link"]),
    displayName: typeof displayName === "string" ? displayName : null
  };
}

function usernameOf(link: unknown): string | null {
  if (typeof link !== "string" || link === "") {
    return null;
  }
  const tail = link.replace(/^https?:\/\/[^/]+\//, "").replace(/^@/, "").trim();

  return /^[A-Za-z0-9_.]{2,64}$/.test(tail) ? tail : null;
}

function joinName(first: unknown, last: unknown): string {
  return [first, last]
    .filter((part): part is string => typeof part === "string" && part !== "")
    .join(" ");
}

/**
 * Вложения.
 *
 * У MAX три разных способа отдать файл, и это не наша прихоть:
 *
 * - **картинка** приезжает со ссылкой прямо в кадре — её и записываем;
 * - **голосовое и аудио** тоже бывают со ссылкой, но не всегда;
 * - **файл** ссылки не имеет вовсе: за ней нужен отдельный вызов, и он требует не только
 *   номера файла, но и чата с сообщением.
 *
 * Поэтому для файла мы кладём в опознаватель все три числа сразу, строкой
 * `max-file:чат:сообщение:файл`. Загрузчик разберёт её обратно и спросит ссылку сам.
 * Альтернатива — тащить чат и сообщение через всю очередь скачивания, общую с Telegram,
 * ради одного канала.
 */
function attachmentsOf(
  attaches: unknown,
  chatId: string,
  messageId: string | null
): readonly IncomingAttachment[] {
  if (!Array.isArray(attaches)) {
    return [];
  }

  return attaches
    .filter(isRecord)
    // Клавиатура — наша же кнопка, вернувшаяся в кадре, а не то, что прислал человек.
    .filter((attach) => attach["_type"] !== "INLINE_KEYBOARD" && attach["_type"] !== "CONTROL")
    .map((attach) => {
      const kind = kindOf(attach["_type"]);
      const fileName = textOf(attach["name"]) ?? textOf(attach["fileName"]);

      return {
        kind,
        fileName,
        mimeType: null,
        sizeBytes: numberOf(attach["size"]),
        externalFileId: fileReferenceOf(attach, chatId, messageId)
      };
    });
}

function fileReferenceOf(
  attach: Readonly<Record<string, unknown>>,
  chatId: string,
  messageId: string | null
): string | null {
  const url = textOf(attach["url"]) ?? textOf(attach["baseUrl"]);
  if (url !== null && /^https?:\/\//.test(url)) {
    return url;
  }
  const fileId = idOf(attach["fileId"]);
  if (fileId !== null && messageId !== null) {
    return `max-file:${chatId}:${messageId}:${fileId}`;
  }

  // Токен — это то, чем в MAX отправляют, а не скачивают. Кладём его, чтобы вложение не
  // осталось совсем безымянным: скачать по нему не выйдет, и служба честно скажет об этом.
  return textOf(attach["token"]);
}

function kindOf(type: unknown): AttachmentKind {
  switch (type) {
    case "PHOTO":
      return "photo";
    case "VIDEO":
      return "video";
    case "AUDIO":
      return "voice";
    case "FILE":
      return "document";
    case "STICKER":
      return "sticker";
    case "CONTACT":
      return "contact";
    case "SHARE":
      return "other";
    default:
      // Список у них пополняется без предупреждения, и «мы такого не ждали» не может быть
      // причиной потерять то, что человек прислал.
      return "other";
  }
}

/** Время у MAX в миллисекундах. Ноль и мусор — это «сейчас», а не 1970 год. */
function timeOf(value: unknown): Date {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return new Date(value);
  }

  return new Date();
}

function idOf(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string" && value.trim() !== "") {
    return value.trim();
  }

  return null;
}

function textOf(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim();

  return text === "" ? null : text;
}

function numberOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
