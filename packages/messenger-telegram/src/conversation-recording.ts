import type { AttachmentSource } from "@ticket-platform/application";
import type {
  AttachmentKind,
  ConversationRecorder,
  IncomingAttachment
} from "@ticket-platform/messenger-core";
import type { Bot } from "grammy";

/**
 * Запись переписки в Telegram.
 *
 * Два хука, и оба намеренно стоят там, где мимо них не пройти.
 *
 * **Входящее** пишется middleware до всех обработчиков. Сегодня бот разбирает три вида
 * сообщений — команду, контакт и текст, — а всё остальное проходит мимо и не оставляет
 * следа: голосовое, фотография, документ, пересланное сообщение. Middleware ловит их все,
 * включая те, которых мы не ждали, и отдаёт дальше по цепочке нетронутыми.
 *
 * **Исходящее** пишется преобразователем запросов к api Telegram, а не в местах отправки.
 * Мест этих двадцать, и двадцать первое, добавленное через месяц, о записи бы не знало.
 * Преобразователь стоит между ботом и сетью: через него проходит всё, что бот говорит,
 * и вернувшийся идентификатор сообщения тоже виден только здесь.
 */

interface TelegramUser {
  readonly id: number;
  readonly username?: string;
  readonly first_name?: string;
  readonly last_name?: string;
}

interface TelegramMessageLike {
  readonly message_id?: number;
  readonly date?: number;
  readonly edit_date?: number;
  readonly chat?: { readonly id: number; readonly type?: string };
  readonly from?: TelegramUser;
  readonly text?: string;
  readonly caption?: string;
  readonly photo?: readonly { readonly file_id?: string; readonly file_size?: number }[];
  readonly voice?: TelegramFile & { readonly duration?: number };
  readonly audio?: TelegramFile;
  readonly video?: TelegramFile;
  readonly video_note?: TelegramFile;
  readonly document?: TelegramFile;
  readonly sticker?: TelegramFile;
  readonly contact?: { readonly phone_number?: string };
  readonly location?: unknown;
}

interface TelegramFile {
  readonly file_id?: string;
  readonly file_name?: string;
  readonly mime_type?: string;
  readonly file_size?: number;
}

export interface TelegramUpdateLike {
  readonly message?: TelegramMessageLike;
  readonly edited_message?: TelegramMessageLike;
}

/**
 * Пишет входящее сообщение, если в обновлении оно есть.
 *
 * Личные чаты и только они: бот работает один на один, а групповое сообщение в ленте
 * карточки — это чужой разговор, попавший туда по недосмотру.
 */
export async function recordIncomingUpdate(
  recorder: ConversationRecorder,
  update: TelegramUpdateLike
): Promise<void> {
  const edited = update.edited_message;
  const message = edited ?? update.message;
  if (!message || !message.from || !message.chat) {
    return;
  }
  if (message.chat.type !== undefined && message.chat.type !== "private") {
    return;
  }

  const externalMessageId = message.message_id === undefined
    ? null
    : String(message.message_id);
  // Время правки, а не исходной отправки: две правки подряд иначе неотличимы друг от друга,
  // и вторая молча потерялась бы на уникальном индексе.
  const seconds = edited ? (message.edit_date ?? message.date) : message.date;

  await recorder.recordIncoming({
    channel: "telegram",
    transport: "bot",
    externalChatId: String(message.chat.id),
    sender: {
      externalUserId: String(message.from.id),
      username: message.from.username ?? null,
      displayName: [message.from.first_name, message.from.last_name]
        .filter((part) => part !== undefined && part !== "")
        .join(" ") || null
    },
    externalMessageId,
    editsExternalMessageId: edited ? externalMessageId : null,
    body: message.text ?? message.caption ?? null,
    attachments: attachmentsOf(message),
    occurredAt: seconds === undefined ? new Date() : new Date(seconds * 1_000),
    payload: update
  });
}

/**
 * Ставит запись исходящего на все обращения к api.
 *
 * Пишем только то, что действительно ушло: преобразователь вызывает Telegram и записывает
 * после ответа. Отправка, которая не удалась, в ленту не попадает — иначе в карточке
 * оказалось бы сказанное, чего человек не получал.
 */
export function recordOutgoingMessages(bot: Bot, recorder: ConversationRecorder): void {
  bot.api.config.use(async (prev, method, payload, signal) => {
    const result = await prev(method, payload, signal);
    const text = outgoingText(method, payload);
    const chatId = outgoingChatId(payload);
    if (text === null || chatId === null) {
      return result;
    }
    await recorder.recordOutgoing({
      channel: "telegram",
      transport: "bot",
      externalChatId: chatId,
      // Имени и ника у исходящего нет: мы знаем только чат. Карточку ответ бота всё равно
      // не заводит, а к уже заведённой диалог привязан.
      recipient: { externalUserId: chatId, username: null, displayName: null },
      authorKind: "bot",
      authorAdminId: null,
      body: text,
      externalMessageId: sentMessageId(result),
      deliveryStatus: "sent",
      failureReason: null,
      occurredAt: new Date()
    });
    return result;
  });
}

/** Методы, у которых есть текст для человека. Остальное — служебные вызовы. */
function outgoingText(method: string, payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const fields = payload as { readonly text?: unknown; readonly caption?: unknown };
  if (method === "sendMessage" && typeof fields.text === "string") {
    return fields.text;
  }
  if (method.startsWith("send") && typeof fields.caption === "string") {
    return fields.caption;
  }
  // Картинка без подписи — тоже сказанное: билет уходит именно так, и в ленте он обязан
  // быть виден, пусть и одной строкой.
  if (method === "sendPhoto" || method === "sendDocument") {
    return method === "sendPhoto" ? "[изображение]" : "[документ]";
  }
  return null;
}

function outgoingChatId(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const chatId = (payload as { readonly chat_id?: unknown }).chat_id;
  if (typeof chatId === "number") {
    return String(chatId);
  }
  // Канал по имени (`@channel`) — не разговор с человеком, и в переписку он не идёт.
  return typeof chatId === "string" && /^-?\d+$/.test(chatId) ? chatId : null;
}

function sentMessageId(result: unknown): string | null {
  if (typeof result !== "object" || result === null) {
    return null;
  }
  const ok = result as { readonly ok?: unknown; readonly result?: unknown };
  const message = ok.result;
  if (typeof message !== "object" || message === null) {
    return null;
  }
  const id = (message as { readonly message_id?: unknown }).message_id;
  return typeof id === "number" ? String(id) : null;
}

function attachmentsOf(message: TelegramMessageLike): readonly IncomingAttachment[] {
  const attachments: IncomingAttachment[] = [];

  // У фотографии Telegram присылает лестницу размеров одного и того же снимка. Берём
  // последний: он самый крупный, а хранить пять копий одного кадра незачем.
  const photo = message.photo?.[message.photo.length - 1];
  if (photo?.file_id) {
    attachments.push({
      kind: "photo",
      fileName: null,
      mimeType: "image/jpeg",
      sizeBytes: photo.file_size ?? null,
      externalFileId: photo.file_id
    });
  }

  const files: readonly [AttachmentKind, TelegramFile | undefined][] = [
    ["voice", message.voice],
    ["audio", message.audio],
    ["video", message.video],
    ["video", message.video_note],
    ["document", message.document],
    ["sticker", message.sticker]
  ];
  for (const [kind, file] of files) {
    if (file?.file_id) {
      attachments.push(attachment(kind, file));
    }
  }

  if (message.contact) {
    attachments.push(attachment("contact", {}));
  }
  if (message.location) {
    attachments.push(attachment("location", {}));
  }

  return attachments;
}

function attachment(kind: AttachmentKind, file: TelegramFile): IncomingAttachment {
  return {
    kind,
    fileName: file.file_name ?? null,
    mimeType: file.mime_type ?? null,
    sizeBytes: file.file_size ?? null,
    externalFileId: file.file_id ?? null
  };
}

/**
 * Забирает файл у Telegram.
 *
 * Два шага, и второй — тот, о который спотыкаются: `getFile` отдаёт не файл, а путь, и
 * скачивается он с другого адреса — `<апи>/file/bot<токен>/<путь>`. С этого сервера оба
 * адреса идут через тот же прокси, что и всё остальное: напрямую Telegram отсюда
 * недоступен, и загрузчик обязан ходить туда же, куда ходит бот.
 *
 * Путь живёт около часа. Это и есть причина, по которой файлы переезжают к нам, а не
 * хранятся ссылкой: через час ссылка мертва, а через год мёртв и сам идентификатор.
 */
export function createTelegramAttachmentSource(
  token: string,
  options: { readonly apiRoot?: string; readonly timeoutMs?: number } = {}
): AttachmentSource {
  const apiRoot = (options.apiRoot ?? "https://api.telegram.org").replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? 30_000;

  return {
    async download(attachment) {
      if (attachment.externalFileId === null) {
        return null;
      }
      const described = await request<{
        readonly ok?: boolean;
        readonly result?: { readonly file_path?: string; readonly file_size?: number };
      }>(
        `${apiRoot}/bot${token}/getFile?file_id=${encodeURIComponent(attachment.externalFileId)}`,
        timeoutMs
      );
      const filePath = described.result?.file_path;
      if (typeof filePath !== "string" || filePath === "") {
        // Telegram ответил, но пути не дал: файла у него больше нет. Повторять нечего.
        return null;
      }

      const response = await fetchWithTimeout(
        `${apiRoot}/file/bot${token}/${filePath}`,
        timeoutMs
      );
      if (!response.ok) {
        throw new Error(`Telegram отдал файл с кодом ${String(response.status)}`);
      }
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        // Имя из пути: у голосовых и фотографий своего имени нет, а расширение оттуда
        // берётся правильное.
        fileName: filePath.split("/").pop() ?? null
      };
    }
  };
}

async function request<T>(url: string, timeoutMs: number): Promise<T> {
  const response = await fetchWithTimeout(url, timeoutMs);
  if (!response.ok) {
    throw new Error(`Telegram ответил кодом ${String(response.status)}`);
  }
  return await response.json() as T;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
