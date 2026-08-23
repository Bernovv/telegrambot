import type {
  AttachmentKind,
  ConversationParticipant,
  IncomingAttachment,
  IncomingConversationMessage
} from "@ticket-platform/messenger-core";

/**
 * Что аккаунту написали — на языке нашей переписки.
 *
 * Разбор отделён от соединения по той же причине, что и в MAX: сообщение — это чистые
 * данные, и проверять его правильнее без сети и без живой сессии. Здесь это важнее вдвойне,
 * потому что структура у WhatsApp глубокая: содержимое бывает завёрнуто в «исчезающее», в
 * «просмотр один раз», в «документ с подписью», и каждый такой конверт — ещё один уровень.
 *
 * Правило то же, что во всей переписке: **сохранить и не понять — лучше, чем понять и
 * потерять.** Незнакомый тип вложения не пропускается, а ложится строкой без файла; само
 * сообщение целиком уходит в `payload`, и разобрать его можно будет потом.
 */

export interface WhatsAppMessageKey {
  readonly id?: string | null;
  readonly remoteJid?: string | null;
  readonly fromMe?: boolean | null;
  readonly participant?: string | null;
  /** Настоящий номер отправителя, когда адрес чата — скрытый идентификатор. */
  readonly senderPn?: string | null;
  readonly participantPn?: string | null;
}

/** Сообщение WhatsApp в том виде, в каком нам нужны его поля. */
export interface WhatsAppMessage {
  readonly key?: WhatsAppMessageKey | null;
  readonly message?: Readonly<Record<string, unknown>> | null;
  readonly messageTimestamp?: unknown;
  /** Как человек подписан у себя в приложении. Другого имени WhatsApp не даёт. */
  readonly pushName?: string | null;
}

export interface IncomingWhatsAppMessage {
  readonly chatJid: string;
  readonly sender: ConversationParticipant;
  readonly messageId: string | null;
  /** Идентификатор реплики, которую человек переписал. */
  readonly editsMessageId: string | null;
  readonly body: string | null;
  readonly attachments: readonly IncomingAttachment[];
  readonly occurredAt: Date;
}

/**
 * Наше ли это сообщение и от кого.
 *
 * `null` — сообщение в переписку не идёт, и причин четыре:
 *
 * - **Написали мы, а не нам.** Исходящее пишется в момент отправки, вместе с судьбой
 *   доставки; записать его ещё и здесь значило бы показать менеджеру свой ответ дважды.
 *   Сюда же попадает всё, что менеджер отправит с самого телефона: связанное устройство
 *   видит и это.
 * - **Это не личный чат.** Группы, каналы и «статусы» — чужой разговор, и в карточке
 *   человека ему нечего делать.
 * - **В сообщении нет содержания.** Реакции, отметки о прочтении, служебные обновления
 *   ключей шифрования приходят тем же событием. Записать их значит засыпать ленту пустыми
 *   строками.
 * - **Сообщение удалили.** Удаление у нас не удаляет ничего: сказанное остаётся. Но и
 *   новой строкой «человек удалил сообщение» лента не наполняется.
 */
export function incomingMessage(message: WhatsAppMessage): IncomingWhatsAppMessage | null {
  const key = message.key ?? null;
  const chatJid = textOf(key?.remoteJid);
  if (key === null || chatJid === null || key.fromMe === true) {
    return null;
  }
  if (!isDialogJid(chatJid)) {
    return null;
  }

  const content = unwrap(message.message ?? null);
  if (content === null) {
    return null;
  }

  const edited = editedContent(content);
  const body = textFrom(edited?.content ?? content);
  const attachments = attachmentsOf(edited?.content ?? content, textOf(key.id));
  if (body === null && attachments.length === 0) {
    return null;
  }

  return {
    chatJid,
    sender: participantOf(message),
    messageId: textOf(key.id),
    editsMessageId: edited?.originalId ?? null,
    body,
    attachments,
    occurredAt: timeOf(message.messageTimestamp)
  };
}

export function toIncomingMessage(
  input: IncomingWhatsAppMessage,
  payload: unknown
): IncomingConversationMessage {
  return {
    channel: "whatsapp",
    transport: "account",
    externalChatId: input.chatJid,
    sender: input.sender,
    externalMessageId: input.messageId,
    editsExternalMessageId: input.editsMessageId,
    body: input.body,
    attachments: input.attachments,
    occurredAt: input.occurredAt,
    payload
  };
}

/**
 * Кто написал.
 *
 * Опознаватель здесь — номер телефона, и это лучшее, что есть в трёх наших каналах: по нему
 * разговор сам склеивается с заявкой с сайта и с карточкой из импорта.
 *
 * Но номер бывает скрыт. WhatsApp выдаёт таким людям адрес другого вида — «скрытый
 * идентификатор», те же цифры, но не телефон. Настоящий номер тогда приезжает отдельным
 * полем, а если и его нет — мы честно говорим, что номера не знаем, приписывая `lid:`.
 * Принять скрытый идентификатор за телефон значит завести карточку с номером, по которому
 * никто не живёт, и однажды приклеить к ней постороннего.
 */
export function participantOf(message: WhatsAppMessage): ConversationParticipant {
  const key = message.key ?? null;
  const phone = phoneOf(key?.senderPn)
    ?? phoneOf(key?.participantPn)
    ?? phoneOf(key?.remoteJid)
    ?? phoneOf(key?.participant);
  const displayName = textOf(message.pushName);

  return {
    externalUserId: phone ?? `lid:${userPart(textOf(key?.remoteJid) ?? "")}`,
    // Ника у WhatsApp нет вовсе: людей там знают по номеру.
    username: null,
    displayName
  };
}

/** Адрес чата по номеру телефона — то, чем открывают разговор первыми. */
export function jidOfPhone(phone: string): string {
  return `${phone.replace(/[^0-9]/g, "")}@s.whatsapp.net`;
}

/**
 * Личный ли это чат.
 *
 * Групповые (`@g.us`), каналы (`@newsletter`) и «статусы» (`status@broadcast`) отсеиваются
 * здесь же: в отличие от MAX, тип чата виден прямо в адресе, и отдельный вызов не нужен.
 */
export function isDialogJid(jid: string): boolean {
  return jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid");
}

/**
 * Снимает конверты.
 *
 * Их четыре, и все они означают одно: настоящее сообщение лежит уровнем ниже. «Исчезающее»
 * — включён таймер удаления в чате; «просмотр один раз» — фото, которое человек разрешил
 * открыть однажды (у нас оно всё равно останется, и это осознанно: переписка — документ);
 * «документ с подписью» — файл, к которому дописали текст.
 */
function unwrap(
  content: Readonly<Record<string, unknown>> | null
): Readonly<Record<string, unknown>> | null {
  if (content === null) {
    return null;
  }
  for (const wrapper of [
    "ephemeralMessage",
    "viewOnceMessage",
    "viewOnceMessageV2",
    "viewOnceMessageV2Extension",
    "documentWithCaptionMessage"
  ]) {
    const inner = content[wrapper];
    if (isRecord(inner) && isRecord(inner["message"])) {
      return unwrap(inner["message"]);
    }
  }

  return content;
}

/**
 * Правка: человек переписал сказанное.
 *
 * Приходит она не обновлением старой строки, а отдельным сообщением служебного вида, внутри
 * которого лежит новый текст и ключ исходного. Нам это подходит буквально: в базе правка —
 * тоже новая строка со ссылкой на старую, а не переписанная старая.
 */
function editedContent(
  content: Readonly<Record<string, unknown>>
): { readonly content: Readonly<Record<string, unknown>>; readonly originalId: string } | null {
  const protocolMessage = content["protocolMessage"];
  if (!isRecord(protocolMessage)) {
    return null;
  }
  const edited = protocolMessage["editedMessage"];
  const key = protocolMessage["key"];
  const originalId = isRecord(key) ? textOf(key["id"]) : null;
  if (!isRecord(edited) || originalId === null) {
    return null;
  }

  return { content: unwrap(edited) ?? edited, originalId };
}

function textFrom(content: Readonly<Record<string, unknown>>): string | null {
  const plain = textOf(content["conversation"]);
  if (plain !== null) {
    return plain;
  }
  const extended = content["extendedTextMessage"];
  if (isRecord(extended)) {
    return textOf(extended["text"]);
  }

  // Подпись под файлом — это тоже сказанное, и в ленте она обязана быть текстом реплики.
  for (const field of ["imageMessage", "videoMessage", "documentMessage"]) {
    const media = content[field];
    if (isRecord(media)) {
      return textOf(media["caption"]);
    }
  }

  return null;
}

/**
 * Вложение.
 *
 * Файл у WhatsApp лежит на их складе зашифрованным, и скачать его можно только вместе с
 * ключом, который приехал внутри этого же сообщения. Отдельного «идентификатора файла», по
 * которому его забрал бы кто угодно, там нет и быть не может — в этом смысл сквозного
 * шифрования.
 *
 * Поэтому опознаватель здесь — номер самого сообщения (`wa:<id>`), а ключи забирает
 * загрузчик из `payload` реплики, где сообщение лежит целиком. Медиа в сообщении не больше
 * одного, так что номера достаточно.
 */
function attachmentsOf(
  content: Readonly<Record<string, unknown>>,
  messageId: string | null
): readonly IncomingAttachment[] {
  const media = MEDIA_FIELDS
    .map((field) => ({ field, value: content[field.name] }))
    .find((candidate): candidate is { field: MediaField; value: Record<string, unknown> } =>
      isRecord(candidate.value));
  if (media === undefined) {
    return [];
  }

  const value = media.value;
  const fileName = textOf(value["fileName"]) ?? textOf(value["title"]);

  return [{
    kind: kindOf(media.field, value),
    fileName,
    mimeType: textOf(value["mimetype"]),
    sizeBytes: numberOf(value["fileLength"]),
    // Контакт и геопозиция файлами не являются: скачивать там нечего, и опознавателя у них
    // нет. Строка в ленте всё равно остаётся — человек это прислал, и это видно.
    externalFileId: media.field.downloadable && messageId !== null ? `wa:${messageId}` : null
  }];
}

interface MediaField {
  readonly name: string;
  readonly kind: AttachmentKind;
  /** Есть ли за этим настоящий файл на их складе. У контакта и геопозиции — нет. */
  readonly downloadable: boolean;
}

const MEDIA_FIELDS: readonly MediaField[] = [
  { name: "imageMessage", kind: "photo", downloadable: true },
  { name: "videoMessage", kind: "video", downloadable: true },
  { name: "audioMessage", kind: "audio", downloadable: true },
  { name: "documentMessage", kind: "document", downloadable: true },
  { name: "stickerMessage", kind: "sticker", downloadable: true },
  { name: "ptvMessage", kind: "video", downloadable: true },
  { name: "contactMessage", kind: "contact", downloadable: false },
  { name: "contactsArrayMessage", kind: "contact", downloadable: false },
  { name: "locationMessage", kind: "location", downloadable: false },
  { name: "liveLocationMessage", kind: "location", downloadable: false }
];

/**
 * Голосовое от простого аудио отличается одним полем, и различать их обязательно: голосовое
 * в ленте слушают, а присланную песню — нет.
 */
function kindOf(field: MediaField, value: Readonly<Record<string, unknown>>): AttachmentKind {
  if (field.name === "audioMessage" && value["ptt"] === true) {
    return "voice";
  }

  return field.kind;
}

function phoneOf(jid: unknown): string | null {
  const text = textOf(jid);
  if (text === null || !text.endsWith("@s.whatsapp.net")) {
    return null;
  }
  const digits = userPart(text);

  return /^[1-9][0-9]{7,14}$/.test(digits) ? digits : null;
}

/** Часть адреса до собачки, без номера устройства: `79001234567:12@…` — то же лицо. */
function userPart(jid: string): string {
  return jid.split("@")[0]?.split(":")[0] ?? "";
}

/**
 * Время сообщения.
 *
 * Приезжает оно секундами, а не миллисекундами, и не всегда числом: протобуф отдаёт большие
 * целые объектом. Ноль и мусор — это «сейчас»: реплика с датой 1970 года улетела бы в конец
 * ленты и потерялась, а её как раз только что написали.
 */
function timeOf(value: unknown): Date {
  const seconds = numberOf(value);

  return seconds === null || seconds <= 0 ? new Date() : new Date(seconds * 1000);
}

function numberOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    return Number(value);
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (isRecord(value)) {
    const low = value["low"];
    const high = value["high"];
    if (typeof low === "number" && typeof high === "number") {
      // Протобуф отдаёт 64-битные числа парой половин. Верхняя у наших величин — размера
      // файла и времени в секундах — всегда ноль, но собрать надо честно.
      return high * 2 ** 32 + (low >>> 0);
    }
  }

  return null;
}

function textOf(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();

  return trimmed === "" ? null : trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
