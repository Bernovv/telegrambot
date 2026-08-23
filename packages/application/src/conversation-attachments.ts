import type { ConversationChannel } from "@ticket-platform/domain";
import type { AttachmentKind } from "./conversations.js";

/**
 * Вложения переписки: файл переезжает к нам.
 *
 * Решение владельца от 23.08.2026 — **храним у себя, пока вечно**, и смотрим, сколько
 * уходит места. Причина в плане названа прямо: Telegram отдаёт файл по идентификатору не
 * вечно, MAX — тем более, и через год половина вложений превратилась бы в битые ссылки.
 * Голосовое или фотография — сотни килобайт; при нашем потоке это единицы гигабайт в год.
 *
 * Скачивание — отдельный проход, а не часть приёма. Приём отвечает мессенджеру, и всё, что
 * он делает до ответа, — это время, в течение которого чужая сторона ждёт и решает
 * повторить. Тянуть в этот момент файл из чужой сети значит менять целость переписки на
 * скорость ответа.
 */

/** Строка очереди скачивания: что забирать и откуда. */
export interface PendingAttachment {
  readonly id: string;
  readonly channel: ConversationChannel;
  readonly kind: AttachmentKind;
  readonly fileName: string | null;
  readonly mimeType: string | null;
  /** Идентификатор файла у мессенджера. Пусто — забирать нечего. */
  readonly externalFileId: string | null;
  /**
   * Обновление целиком, как его прислал мессенджер, — то самое, что записано при приёме.
   *
   * Нужно оно одному каналу, зато нужно по-настоящему. У Telegram и MAX файл забирается по
   * идентификатору, и его хватает. У WhatsApp файл зашифрован ключом самого сообщения: без
   * ключа, пути и контрольных сумм скачать его нельзя, а вместе они не помещаются ни в один
   * идентификатор. Хранить их отдельной колонкой не нужно — они уже лежат в `payload`
   * реплики, ровно для этого он и сохраняется целиком.
   */
  readonly payload: unknown;
  readonly attempts: number;
}

export interface StoredAttachment {
  readonly storagePath: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface AttachmentDownloadRepository {
  /**
   * Берёт из очереди то, что пора забирать. Отложенные повторы пропускаются: моргнувшая
   * сеть не должна крутиться в проходе каждые полминуты.
   */
  claimPending(input: {
    readonly batchSize: number;
    readonly at: Date;
  }): Promise<readonly PendingAttachment[]>;
  markStored(input: {
    readonly attachmentId: string;
    readonly stored: StoredAttachment;
    readonly at: Date;
  }): Promise<void>;
  /**
   * Откладывает повтор или ставит крест. Разницу решает служба, а не база: потолок
   * попыток — настройка, и меняют её, глядя на то, как часто моргает сеть.
   */
  markAttemptFailed(input: {
    readonly attachmentId: string;
    readonly reason: string;
    readonly at: Date;
    readonly retryAt: Date | null;
  }): Promise<void>;
}

/** Файл у мессенджера: где он лежит и как его забрать. */
export interface AttachmentSource {
  /**
   * Возвращает содержимое файла. `null` — этот канал такой файл забрать не умеет: у MAX
   * часть вложений приезжает без ссылки, и делать вид, что мы их скачали, нельзя.
   */
  download(attachment: PendingAttachment): Promise<AttachmentBytes | null>;
}

export interface AttachmentBytes {
  readonly bytes: Uint8Array;
  /** Имя файла у мессенджера, если он его сообщил. */
  readonly fileName: string | null;
}

/** Куда файл ложится у нас. */
export interface AttachmentStorage {
  save(input: {
    readonly attachmentId: string;
    readonly bytes: Uint8Array;
    readonly fileName: string | null;
    readonly mimeType: string | null;
  }): Promise<StoredAttachment>;
}

export interface DownloadAttachmentsOptions {
  /**
   * Сколько раз пробовать, прежде чем оставить файл человеку. Пять попыток с растущей
   * паузой — это около часа: столько живёт обычная сетевая неприятность.
   */
  readonly maxAttempts: number;
  /** Первая пауза перед повтором. Дальше удваивается. */
  readonly retryDelayMs: number;
  /** Больше этого не скачиваем: диск наш, а прислать могут что угодно. */
  readonly maxBytes: number;
}

export const DEFAULT_ATTACHMENT_DOWNLOAD_OPTIONS: DownloadAttachmentsOptions = {
  maxAttempts: 5,
  retryDelayMs: 60_000,
  maxBytes: 50 * 1_024 * 1_024
};

export interface DownloadAttachmentsResult {
  readonly claimed: number;
  readonly stored: number;
  readonly retried: number;
  readonly failed: number;
}

/**
 * Проход скачивания.
 *
 * Каждое вложение — само по себе: неудача одного не роняет остальные и не отменяет уже
 * скачанное. Файл, который забрать нечем или которого канал не отдаёт, честно становится
 * неудачей с причиной, а не тихо пропадает: по такой строке видно, что забирать руками,
 * пока файл ещё жив у мессенджера.
 */
export class DownloadConversationAttachmentsBatchService {
  constructor(
    private readonly repository: AttachmentDownloadRepository,
    private readonly sources: Partial<Record<ConversationChannel, AttachmentSource>>,
    private readonly storage: AttachmentStorage,
    private readonly options: DownloadAttachmentsOptions = DEFAULT_ATTACHMENT_DOWNLOAD_OPTIONS
  ) {}

  async execute(input: {
    readonly at: Date;
    readonly batchSize: number;
  }): Promise<DownloadAttachmentsResult> {
    const pending = await this.repository.claimPending({
      batchSize: input.batchSize,
      at: input.at
    });

    let stored = 0;
    let retried = 0;
    let failed = 0;

    for (const attachment of pending) {
      const outcome = await this.handle(attachment, input.at);
      if (outcome === "stored") {
        stored += 1;
      } else if (outcome === "retry") {
        retried += 1;
      } else {
        failed += 1;
      }
    }

    return { claimed: pending.length, stored, retried, failed };
  }

  private async handle(
    attachment: PendingAttachment,
    at: Date
  ): Promise<"stored" | "retry" | "failed"> {
    const source = this.sources[attachment.channel];
    if (!source) {
      // Канал без загрузчика — это не сбой сети, а наша ненастроенность. Повторять
      // бессмысленно: пока не появится загрузчик, будет ровно то же самое.
      return this.giveUp(attachment, "нет загрузчика для канала", at);
    }
    if (attachment.externalFileId === null) {
      return this.giveUp(attachment, "мессенджер не дал идентификатор файла", at);
    }

    try {
      const file = await source.download(attachment);
      if (file === null) {
        return this.giveUp(attachment, "канал не отдаёт этот файл", at);
      }
      if (file.bytes.byteLength > this.options.maxBytes) {
        return this.giveUp(
          attachment,
          `файл больше предела: ${String(file.bytes.byteLength)} байт`,
          at
        );
      }
      const saved = await this.storage.save({
        attachmentId: attachment.id,
        bytes: file.bytes,
        fileName: file.fileName ?? attachment.fileName,
        mimeType: attachment.mimeType
      });
      await this.repository.markStored({ attachmentId: attachment.id, stored: saved, at });
      return "stored";
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const attempts = attachment.attempts + 1;
      if (attempts >= this.options.maxAttempts) {
        return this.giveUp(attachment, reason, at);
      }
      // Пауза удваивается с каждой попыткой: если у мессенджера неприятность, ломиться в
      // него с прежней частотой — верный способ получить временную блокировку бота.
      const delayMs = this.options.retryDelayMs * 2 ** attachment.attempts;
      await this.repository.markAttemptFailed({
        attachmentId: attachment.id,
        reason,
        at,
        retryAt: new Date(at.getTime() + delayMs)
      });
      return "retry";
    }
  }

  private async giveUp(
    attachment: PendingAttachment,
    reason: string,
    at: Date
  ): Promise<"failed"> {
    await this.repository.markAttemptFailed({
      attachmentId: attachment.id,
      reason: reason.slice(0, 500),
      at,
      retryAt: null
    });
    return "failed";
  }
}

/**
 * Куда лечь файлу внутри папки вложений.
 *
 * Общая для двух мест сразу: воркер кладёт сюда входящие, api — то, что менеджер отправляет
 * из панели. Раскладка одна, потому что папка одна, и разъехаться она не должна: посчитать
 * «сколько ушло за август» можно только пока все файлы лежат по одному правилу.
 *
 * Имя файла — идентификатор вложения, а не то, как файл назвал отправитель. Присланное имя
 * бывает каким угодно, включая путь наружу из папки; из него берётся только расширение.
 */
export function attachmentRelativePath(
  attachmentId: string,
  file: { readonly fileName: string | null; readonly mimeType: string | null },
  at: Date
): string {
  const year = String(at.getUTCFullYear());
  const month = String(at.getUTCMonth() + 1).padStart(2, "0");
  return `${year}/${month}/${attachmentId}${attachmentExtension(file)}`;
}

/** Расширение из имени файла, а если его нет — из типа содержимого. */
export function attachmentExtension(file: {
  readonly fileName: string | null;
  readonly mimeType: string | null;
}): string {
  const fromName = /\.([A-Za-z0-9]{1,8})$/.exec(file.fileName ?? "");
  if (fromName?.[1]) {
    return `.${fromName[1].toLowerCase()}`;
  }
  switch (file.mimeType) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "audio/ogg":
      return ".ogg";
    case "video/mp4":
      return ".mp4";
    case "application/pdf":
      return ".pdf";
    default:
      // Без расширения файл всё равно откроется — по содержимому. Придумывать его наугад
      // хуже: `.bin` у голосового сообщения только собьёт с толку.
      return "";
  }
}

/** Что можно отправить из панели. Шире этого списка мессенджеры всё равно не примут. */
export function attachmentKindForMime(mimeType: string): AttachmentKind {
  if (mimeType.startsWith("image/")) {
    return "photo";
  }
  if (mimeType.startsWith("video/")) {
    return "video";
  }
  if (mimeType.startsWith("audio/")) {
    return "audio";
  }
  return "document";
}
