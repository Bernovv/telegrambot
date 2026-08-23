import type { ConversationChannel } from "@ticket-platform/domain";
import type { AttachmentKind } from "./conversations.js";

/**
 * Проход отправки ответов менеджера.
 *
 * Очередь — это реплики со статусом `queued`. Проход берёт их пачкой, отправляет по одной и
 * помечает судьбу каждой.
 *
 * **По одной и с паузой** — не из бережливости. Десяток ответов, ушедших в одну секунду,
 * для антиспама Telegram выглядит как рассылка, а для человека — как стена сообщений,
 * пришедших вперемешку. Порядок здесь тоже не роскошь: реплики отправляются в том порядке,
 * в каком их написали, иначе разговор в чате читается задом наперёд.
 *
 * **Неудача — это повтор, а не потеря.** Прокси до Telegram моргает, и однажды это уже
 * стоило двух часов недоставленных билетов. Реплика возвращается в очередь с растущей
 * паузой и становится `failed` только когда попытки кончились: тогда её видно в ленте
 * красным, и менеджер знает, что человек ответа не получил.
 */

export interface QueuedReply {
  readonly messageId: string;
  readonly channel: ConversationChannel;
  /** Чат у мессенджера: у бота совпадает с идентификатором человека. */
  readonly externalChatId: string;
  readonly body: string;
  readonly attempts: number;
  /** Файл, если менеджер отправил его вместе с текстом. Текст тогда идёт подписью. */
  readonly attachment: QueuedReplyAttachment | null;
}

export interface QueuedReplyAttachment {
  readonly attachmentId: string;
  readonly kind: AttachmentKind;
  readonly storagePath: string;
  readonly fileName: string | null;
  readonly mimeType: string | null;
}

/** Читает файл из папки вложений. Диск знает только тот, кто отправляет. */
export interface AttachmentReader {
  read(storagePath: string): Promise<Uint8Array>;
}

export interface ConversationReplyQueueRepository {
  claimQueued(input: {
    readonly batchSize: number;
    readonly at: Date;
  }): Promise<readonly QueuedReply[]>;
  markSent(input: {
    readonly messageId: string;
    readonly providerMessageId: string | null;
    readonly at: Date;
  }): Promise<void>;
  markAttemptFailed(input: {
    readonly messageId: string;
    readonly reason: string;
    readonly at: Date;
    readonly retryAt: Date | null;
  }): Promise<void>;
}

/** Отправитель канала. Тот же порт, что у уведомлений: очередь у каналов общая. */
export interface ConversationReplySender {
  sendText(
    recipientId: string,
    text: string
  ): Promise<{ readonly providerMessageId: string }>;
  /**
   * Отправка файла. Метод необязательный: у MAX картинку отправить можно, а документ —
   * нет, и притворяться обратным нельзя. Канал без него честно откажет с причиной, и
   * менеджер увидит это в ленте, а не будет ждать доставки, которой не будет.
   */
  sendFile?(input: {
    readonly recipientId: string;
    readonly bytes: Uint8Array;
    readonly fileName: string;
    readonly mimeType: string | null;
    readonly kind: AttachmentKind;
    readonly caption: string;
  }): Promise<{ readonly providerMessageId: string }>;
  /**
   * Что канал умеет отправлять. У MAX это только картинки: документов их Bot API не берёт.
   * Спрашиваем заранее, чтобы отказать сразу — а не после пяти попыток и часа ожидания.
   */
  supportsFileKind?(kind: AttachmentKind): boolean;
}

export interface SendRepliesOptions {
  /** Сколько раз пробовать. Пять с удвоением паузы — около часа. */
  readonly maxAttempts: number;
  readonly retryDelayMs: number;
  /** Пауза между двумя отправками подряд. */
  readonly pauseBetweenMs: number;
}

export const DEFAULT_REPLY_SEND_OPTIONS: SendRepliesOptions = {
  maxAttempts: 5,
  retryDelayMs: 60_000,
  pauseBetweenMs: 1_000
};

export interface SendRepliesResult {
  readonly claimed: number;
  readonly sent: number;
  readonly retried: number;
  readonly failed: number;
}

export class SendConversationRepliesBatchService {
  constructor(
    private readonly repository: ConversationReplyQueueRepository,
    private readonly senders: Partial<Record<ConversationChannel, ConversationReplySender>>,
    private readonly options: SendRepliesOptions = DEFAULT_REPLY_SEND_OPTIONS,
    /** Пауза вынесена наружу ради тестов: ждать по-настоящему им незачем. */
    private readonly pause: (ms: number) => Promise<void> = defaultPause,
    /** Чтение файла с диска. Без него отправлять можно только текст. */
    private readonly files: AttachmentReader | null = null
  ) {}

  async execute(input: {
    readonly at: Date;
    readonly batchSize: number;
  }): Promise<SendRepliesResult> {
    const queued = await this.repository.claimQueued({
      batchSize: input.batchSize,
      at: input.at
    });

    let sent = 0;
    let retried = 0;
    let failed = 0;

    for (const [index, reply] of queued.entries()) {
      if (index > 0 && this.options.pauseBetweenMs > 0) {
        await this.pause(this.options.pauseBetweenMs);
      }
      const outcome = await this.send(reply, input.at);
      if (outcome === "sent") {
        sent += 1;
      } else if (outcome === "retry") {
        retried += 1;
      } else {
        failed += 1;
      }
    }

    return { claimed: queued.length, sent, retried, failed };
  }

  private async send(
    reply: QueuedReply,
    at: Date
  ): Promise<"sent" | "retry" | "failed"> {
    const sender = this.senders[reply.channel];
    if (!sender) {
      // Канал выключен в этом окружении. Это не сбой сети: повтор даст ровно то же, и
      // держать ответ в очереди значит обещать доставку, которой не будет.
      return this.giveUp(reply, "канал отключён — отправить нечем", at);
    }

    try {
      const result = reply.attachment === null
        ? await sender.sendText(reply.externalChatId, reply.body)
        : await this.sendFile(sender, reply, reply.attachment);
      await this.repository.markSent({
        messageId: reply.messageId,
        providerMessageId: result.providerMessageId === ""
          ? null
          : result.providerMessageId,
        at
      });
      return "sent";
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      // Отказ, который не исправится повтором: канал не умеет отправлять файлы, отправка
      // не настроена. Держать такое в очереди значит обещать доставку, которой не будет.
      if (error instanceof PermanentReplyFailure) {
        return this.giveUp(reply, reason, at);
      }
      const attempts = reply.attempts + 1;
      if (attempts >= this.options.maxAttempts) {
        return this.giveUp(reply, reason, at);
      }
      await this.repository.markAttemptFailed({
        messageId: reply.messageId,
        reason,
        at,
        retryAt: new Date(at.getTime() + this.options.retryDelayMs * 2 ** reply.attempts)
      });
      return "retry";
    }
  }

  /**
   * Файл читается с диска в момент отправки, а не хранится в очереди.
   *
   * Иначе мегабайтная картинка лежала бы в памяти воркера всё время ожидания — и столько
   * раз, сколько ответов в пачке.
   */
  private async sendFile(
    sender: ConversationReplySender,
    reply: QueuedReply,
    attachment: QueuedReplyAttachment
  ): Promise<{ readonly providerMessageId: string }> {
    if (!sender.sendFile) {
      throw new PermanentReplyFailure("канал не умеет отправлять файлы");
    }
    if (!this.files) {
      throw new PermanentReplyFailure("отправка файлов не настроена");
    }
    if (sender.supportsFileKind && !sender.supportsFileKind(attachment.kind)) {
      throw new PermanentReplyFailure(
        `канал не принимает такие файлы: ${attachment.kind}`
      );
    }
    const bytes = await this.files.read(attachment.storagePath);
    return await sender.sendFile({
      recipientId: reply.externalChatId,
      bytes,
      fileName: attachment.fileName ?? `${attachment.attachmentId}`,
      mimeType: attachment.mimeType,
      kind: attachment.kind,
      caption: reply.body
    });
  }

  private async giveUp(
    reply: QueuedReply,
    reason: string,
    at: Date
  ): Promise<"failed"> {
    await this.repository.markAttemptFailed({
      messageId: reply.messageId,
      reason: reason.slice(0, 500),
      at,
      retryAt: null
    });
    return "failed";
  }
}

/** Отказ, который повторять бессмысленно. */
export class PermanentReplyFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentReplyFailure";
  }
}

function defaultPause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
