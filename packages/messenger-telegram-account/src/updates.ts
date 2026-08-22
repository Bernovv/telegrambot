/// <reference types="@prebuilt-tdlib/types" />
import type {
  AttachmentKind,
  ConversationParticipant,
  IncomingAttachment,
  IncomingConversationMessage
} from "@ticket-platform/messenger-core";
import type {
  file as TdFile,
  message as TdMessage,
  MessageContent as TdMessageContent,
  Update as TdUpdate
} from "tdlib-types";

/**
 * Что аккаунту написали — на языке нашей переписки.
 *
 * Разбор отделён от процесса намеренно: обновления TDLib — это чистые данные, и проверять
 * их правильнее без сети, без базы и без живой сессии. Отсюда две функции: одна решает,
 * наше ли это сообщение, вторая переводит его в реплику.
 *
 * Правило то же, что во всей переписке: **сохранить и не понять — лучше, чем понять и
 * потерять.** Незнакомый вид сообщения не пропускается, а ложится строкой без текста —
 * тело обновления целиком уходит в `payload`, и разобрать его можно будет потом.
 */

/**
 * Сообщение, которое мы записываем, и кто его прислал.
 *
 * `null` — это сообщение нам не подходит, и вот единственные причины, по которым так
 * бывает:
 *
 * - **Не личный чат.** У TDLib личный чат — это чат с положительным номером; группы и
 *   каналы отрицательные. Групповое сообщение в карточке человека — это чужой разговор,
 *   попавший туда по недосмотру.
 * - **Написали не мы кому-то, а мы кому-то.** Исходящее пишется в момент отправки, вместе
 *   с судьбой доставки, — записывать его ещё и здесь значило бы показать менеджеру его
 *   собственный ответ дважды.
 * - **Отправитель — чат, а не человек.** Так приходят сообщения от имени канала; человека
 *   за ними нет, и заводить на них карточку нечего.
 */
export function incomingPrivateMessage(
  update: TdUpdate
): { readonly message: TdMessage; readonly senderUserId: number } | null {
  if (update._ !== "updateNewMessage") {
    return null;
  }
  const message = update.message;
  if (message.is_outgoing || message.chat_id <= 0) {
    return null;
  }
  if (message.sender_id._ !== "messageSenderUser") {
    return null;
  }

  return { message, senderUserId: message.sender_id.user_id };
}

export function toIncomingMessage(
  message: TdMessage,
  sender: ConversationParticipant,
  payload: unknown
): IncomingConversationMessage {
  const content = readContent(message.content);

  return {
    channel: "telegram",
    transport: "account",
    externalChatId: String(message.chat_id),
    sender,
    externalMessageId: String(message.id),
    // Правки в этом заходе не разбираются: у TDLib они приходят отдельным обновлением,
    // которое срабатывает и без правки — например, когда Telegram сам подтягивает к ссылке
    // предпросмотр. Отличать одно от другого нужно с холодной головой, а не заодно.
    editsExternalMessageId: null,
    body: content.body,
    attachments: content.attachments,
    occurredAt: new Date(message.date * 1_000),
    payload
  };
}

/** Имя и ник человека так, как их знает TDLib. */
export function participantOf(user: {
  readonly id: number;
  readonly first_name: string;
  readonly last_name: string;
  readonly usernames?: { readonly active_usernames: readonly string[] } | undefined;
}): ConversationParticipant {
  const displayName = [user.first_name, user.last_name]
    .filter((part) => part !== "")
    .join(" ");

  return {
    externalUserId: String(user.id),
    username: user.usernames?.active_usernames[0] ?? null,
    displayName: displayName === "" ? null : displayName
  };
}

interface ReadContent {
  readonly body: string | null;
  readonly attachments: readonly IncomingAttachment[];
}

function readContent(content: TdMessageContent): ReadContent {
  switch (content._) {
    case "messageText":
      return { body: textOf(content.text.text), attachments: [] };

    case "messagePhoto":
      return {
        body: textOf(content.caption.text),
        // Размеров у фотографии несколько — от превью до оригинала, и последний самый
        // крупный. Берём его: в ленте нужна фотография, а не миниатюра.
        attachments: attachmentOf(
          "photo",
          content.photo.sizes[content.photo.sizes.length - 1]?.photo,
          { fileName: null, mimeType: "image/jpeg" }
        )
      };

    case "messageVoiceNote":
      return {
        body: textOf(content.caption.text),
        attachments: attachmentOf("voice", content.voice_note.voice, {
          fileName: null,
          mimeType: content.voice_note.mime_type
        })
      };

    case "messageVideoNote":
      return {
        body: null,
        attachments: attachmentOf("video", content.video_note.video, {
          fileName: null,
          mimeType: "video/mp4"
        })
      };

    case "messageVideo":
      return {
        body: textOf(content.caption.text),
        attachments: attachmentOf("video", content.video.video, {
          fileName: content.video.file_name,
          mimeType: content.video.mime_type
        })
      };

    case "messageAnimation":
      return {
        body: textOf(content.caption.text),
        attachments: attachmentOf("video", content.animation.animation, {
          fileName: content.animation.file_name,
          mimeType: content.animation.mime_type
        })
      };

    case "messageAudio":
      return {
        body: textOf(content.caption.text),
        attachments: attachmentOf("audio", content.audio.audio, {
          fileName: content.audio.file_name,
          mimeType: content.audio.mime_type
        })
      };

    case "messageDocument":
      return {
        body: textOf(content.caption.text),
        attachments: attachmentOf("document", content.document.document, {
          fileName: content.document.file_name,
          mimeType: content.document.mime_type
        })
      };

    case "messageSticker":
      return {
        // Стикер — это эмодзи, нарисованное картинкой. В ленте от него без текста не
        // остаётся ничего, поэтому эмодзи и есть его текст.
        body: textOf(content.sticker.emoji),
        attachments: attachmentOf("sticker", content.sticker.sticker, {
          fileName: null,
          mimeType: null
        })
      };

    case "messageContact":
      return {
        body: contactBody(content.contact),
        attachments: [{
          kind: "contact",
          fileName: null,
          mimeType: null,
          sizeBytes: null,
          externalFileId: null
        }]
      };

    case "messageLocation":
    case "messageVenue":
      return {
        body: null,
        attachments: [{
          kind: "location",
          fileName: null,
          mimeType: null,
          sizeBytes: null,
          externalFileId: null
        }]
      };

    default:
      // Видов сообщений у Telegram больше сотни, и список растёт без предупреждения.
      // Незнакомый — не повод потерять строку: тело обновления целиком лежит в `payload`,
      // а в карточке видно, что человек что-то прислал.
      return { body: null, attachments: [] };
  }
}

/**
 * Вложение с файлом.
 *
 * Идентификатор файла у TDLib — число, живущее внутри сессии, а не строка Bot API. Поэтому
 * скачать такой файл может только сам аккаунт, и очередь скачивания у него своя.
 */
function attachmentOf(
  kind: AttachmentKind,
  file: TdFile | undefined,
  meta: { readonly fileName: string | null; readonly mimeType: string | null }
): readonly IncomingAttachment[] {
  if (file === undefined) {
    return [];
  }

  return [{
    kind,
    fileName: meta.fileName === "" ? null : meta.fileName,
    mimeType: meta.mimeType === "" ? null : meta.mimeType,
    sizeBytes: file.size > 0 ? file.size : (file.expected_size > 0 ? file.expected_size : null),
    externalFileId: String(file.id)
  }];
}

function contactBody(contact: {
  readonly phone_number: string;
  readonly first_name: string;
  readonly last_name: string;
}): string | null {
  const name = [contact.first_name, contact.last_name]
    .filter((part) => part !== "")
    .join(" ");
  const phone = contact.phone_number === "" ? null : `+${contact.phone_number.replace(/^\+/, "")}`;
  const parts = [name === "" ? null : name, phone].filter((part) => part !== null);

  return parts.length === 0 ? null : parts.join(", ");
}

function textOf(value: string): string | null {
  const text = value.trim();

  return text === "" ? null : text;
}
