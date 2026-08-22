import type {
  AttachmentKind,
  ConversationRecorder,
  IncomingAttachment
} from "@ticket-platform/messenger-core";
import type { MaxUpdate } from "./updates.js";

/**
 * Запись переписки в MAX.
 *
 * Отличие от Telegram одно, и оно в приёме. Там middleware ловит любое сообщение, включая
 * типы, которых мы не ждали; здесь ловить приходится по имени типа обновления, потому что
 * своей цепочки middleware у MAX нет — есть наш собственный разбор.
 *
 * Отсюда правило: **неизвестный тип обновления, в котором есть сообщение, тоже пишется.**
 * Список типов у MAX пополняется без предупреждения, и «мы такого не ждали» не может быть
 * причиной потерять то, что человек написал.
 */

/** Типы обновлений, которые несут правку уже сказанного, а не новую реплику. */
const EDIT_UPDATE_TYPES = new Set(["message_edited", "message_updated"]);

export async function recordIncomingMaxUpdate(
  recorder: ConversationRecorder,
  update: MaxUpdate
): Promise<void> {
  const message = update.message;
  const sender = message?.sender ?? update.user;
  if (!message || !sender || sender.user_id === undefined) {
    return;
  }

  const externalUserId = String(sender.user_id);
  // Чат: MAX кладёт его то в само обновление, то в получателя сообщения. У бота он совпадает
  // с человеком, и последнее, на что можно опереться, — идентификатор отправителя.
  const chatId = update.chat_id
    ?? message.recipient?.chat_id
    ?? message.recipient?.user_id
    ?? externalUserId;

  const isEdit = EDIT_UPDATE_TYPES.has(update.update_type ?? "");
  const externalMessageId = message.body?.mid ?? null;

  await recorder.recordIncoming({
    channel: "max",
    transport: "bot",
    externalChatId: String(chatId),
    sender: {
      externalUserId,
      username: sender.username ?? null,
      displayName: sender.name ?? null
    },
    externalMessageId,
    editsExternalMessageId: isEdit ? externalMessageId : null,
    body: message.body?.text ?? null,
    attachments: attachmentsOf(message.body?.attachments),
    occurredAt: update.timestamp === undefined ? new Date() : new Date(update.timestamp),
    payload: update
  });
}

export async function recordOutgoingMaxMessage(
  recorder: ConversationRecorder,
  input: {
    readonly externalUserId: string;
    readonly text: string;
    readonly providerMessageId: string | null;
  }
): Promise<void> {
  await recorder.recordOutgoing({
    channel: "max",
    transport: "bot",
    externalChatId: input.externalUserId,
    recipient: { externalUserId: input.externalUserId, username: null, displayName: null },
    authorKind: "bot",
    authorAdminId: null,
    body: input.text,
    externalMessageId: input.providerMessageId === "" ? null : input.providerMessageId,
    deliveryStatus: "sent",
    failureReason: null,
    occurredAt: new Date()
  });
}

/**
 * Вложения MAX. Словарь их типов шире нашего и меняется, поэтому незнакомое пишется как
 * `other`: чем именно оно было, видно в сохранённом теле обновления.
 */
function attachmentsOf(
  attachments: readonly {
    readonly type?: string;
    readonly payload?: Readonly<Record<string, unknown>>;
  }[] | undefined
): readonly IncomingAttachment[] {
  if (!attachments) {
    return [];
  }
  return attachments
    // Клавиатура — это наша же кнопка, вернувшаяся в обновлении, а не то, что прислал
    // человек. В переписке ей делать нечего.
    .filter((attachment) => attachment.type !== "inline_keyboard")
    .map((attachment) => ({
      kind: kindOf(attachment.type),
      fileName: text(attachment.payload?.["filename"]) ?? text(attachment.payload?.["name"]),
      mimeType: null,
      sizeBytes: number(attachment.payload?.["size"]),
      externalFileId: text(attachment.payload?.["token"])
        ?? text(attachment.payload?.["file_id"])
        ?? text(attachment.payload?.["url"])
    }));
}

function kindOf(type: string | undefined): AttachmentKind {
  switch (type) {
    case "image":
    case "photo":
      return "photo";
    case "video":
      return "video";
    case "audio":
      return "audio";
    case "voice":
      return "voice";
    case "file":
    case "document":
      return "document";
    case "sticker":
      return "sticker";
    case "contact":
      return "contact";
    case "location":
      return "location";
    default:
      return "other";
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
