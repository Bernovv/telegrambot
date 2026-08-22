import type { ScenarioPresentationModel } from "@ticket-platform/contracts";
import type { MessengerChannel } from "@ticket-platform/domain";
import type { IdGenerator } from "./identity.js";
import type {
  BroadcastMessage,
  NotificationSender,
  TicketPng
} from "./notification-delivery.js";

/**
 * Переписка: всё сказанное сохраняется до того, как мы решим, что с этим делать.
 *
 * Сегодня входящий текст живёт ровно столько, сколько его разбирает сценарий. Не подошёл ни
 * под один шаг — исчез. «А с ребёнком можно?», спрошенное не в тот момент, не оставляет
 * следа; менеджер об этом вопросе не узнаёт никогда, а человек считает, что спросил.
 *
 * Здесь линия реза та же, что у Звонобота, и по той же причине: **сохранить и не понять —
 * лучше, чем понять и потерять**. Запись идёт первой, до всякого разбора, и сохраняет тело
 * обновления целиком. Что с этим делать — решают потом и могут решить заново.
 *
 * Второе правило важнее первого: **запись переписки не имеет права сорвать разговор**. Если
 * база недоступна или строка не легла, человек всё равно должен получить ответ бота. Поэтому
 * методы службы не бросают исключений вообще — они сообщают о неудаче в отведённое место и
 * возвращают `null`. Молчащий бот хуже, чем потерянная строка в журнале.
 */

/** Чьими руками идёт разговор: наш бот или аккаунт компании (фаза 2). */
export type ConversationTransport = "bot" | "account";

/**
 * Чьи строки процесс забирает из общих очередей — отправки и скачивания вложений.
 *
 * Очереди общие на весь проект, а забирают из них разные процессы: воркер отправляет от
 * имени ботов, аккаунт Telegram — от своего имени, аккаунт MAX — от своего. Транспорта для
 * отбора мало: аккаунтов больше одного, и без канала процесс Telegram унёс бы ответ,
 * написанный в MAX, а отправить его ему нечем — реплика умерла бы с пометкой «канал
 * отключён», хотя канал работает.
 *
 * Отсюда правило: **процесс объявляет и транспорт, и каналы, за которые отвечает.**
 * Перечислять каналы явно, а не выводить из списка отправителей: выключенный канал должен
 * честно отказать с причиной, а не оставить ответ висеть в очереди навсегда.
 */
export interface ConversationQueueScope {
  readonly transport: ConversationTransport;
  readonly channels: readonly MessengerChannel[];
}

/** Кто написал реплику. `bot` — сценарий, `manager` — живой человек из панели. */
export type MessageAuthorKind = "client" | "manager" | "bot";

export type MessageDeliveryStatus =
  | "received"
  | "queued"
  | "sent"
  | "delivered"
  | "failed";

export type AttachmentKind =
  | "photo"
  | "video"
  | "voice"
  | "audio"
  | "document"
  | "sticker"
  | "contact"
  | "location"
  | "other";

/** Вложение так, как о нём сообщил мессенджер. Сам файл скачивается отдельным проходом. */
export interface IncomingAttachment {
  readonly kind: AttachmentKind;
  readonly fileName: string | null;
  readonly mimeType: string | null;
  readonly sizeBytes: number | null;
  /** Идентификатор файла у мессенджера: по нему его потом и заберут. */
  readonly externalFileId: string | null;
}

/** Кто говорит — в том виде, в каком его назвал мессенджер. */
export interface ConversationParticipant {
  readonly externalUserId: string;
  readonly username: string | null;
  readonly displayName: string | null;
}

export interface IncomingConversationMessage {
  readonly channel: MessengerChannel;
  readonly transport: ConversationTransport;
  /** Чат у мессенджера. У бота совпадает с идентификатором человека. */
  readonly externalChatId: string;
  readonly sender: ConversationParticipant;
  readonly externalMessageId: string | null;
  /**
   * Идентификатор реплики, которую человек переписал. Правка приходит как новое обновление
   * с тем же идентификатором сообщения, и её место — рядом с исходной строкой, а не вместо
   * неё: в чате человек видит новое, а у нас остаётся и то, что он написал сначала.
   */
  readonly editsExternalMessageId: string | null;
  readonly body: string | null;
  readonly attachments: readonly IncomingAttachment[];
  readonly occurredAt: Date;
  /** Обновление целиком, как прислал мессенджер. */
  readonly payload: unknown;
}

export interface OutgoingConversationMessage {
  readonly channel: MessengerChannel;
  readonly transport: ConversationTransport;
  readonly externalChatId: string;
  /** Кому пишем. Нужен, чтобы завести диалог, если его ещё не было. */
  readonly recipient: ConversationParticipant;
  readonly authorKind: Exclude<MessageAuthorKind, "client">;
  /** Кто из менеджеров. У реплики бота пусто. */
  readonly authorAdminId: string | null;
  readonly body: string | null;
  readonly externalMessageId: string | null;
  readonly deliveryStatus: Exclude<MessageDeliveryStatus, "received">;
  readonly failureReason: string | null;
  readonly occurredAt: Date;
}

/** Что легло в базу. По идентификаторам потом дописывают судьбу отправки и вложения. */
export interface RecordedConversationMessage {
  readonly conversationId: string;
  readonly messageId: string;
  /** `false` — такую реплику уже записали: повтор вебхука это норма, а не ошибка. */
  readonly stored: boolean;
}

export interface RecordIncomingMessageInput extends IncomingConversationMessage {
  /** Идентификаторы готовятся заранее: их выдаёт приложение, а не база. */
  readonly conversationId: string;
  readonly messageId: string;
  readonly contactId: string;
  readonly attachmentIds: readonly string[];
  /**
   * Идентификатор задачи «ответить», если её придётся завести. Выдаётся заранее вместе с
   * остальными: понадобится она или нет, решает база — там видно, есть ли уже открытая.
   */
  readonly taskId: string;
}

export interface RecordOutgoingMessageInput extends OutgoingConversationMessage {
  readonly conversationId: string;
  readonly messageId: string;
  readonly contactId: string;
}

export interface ConversationRepository {
  recordIncoming(input: RecordIncomingMessageInput): Promise<RecordedConversationMessage>;
  recordOutgoing(input: RecordOutgoingMessageInput): Promise<RecordedConversationMessage>;
}

/** Куда уходит неудача записи. Логгер сюда не тянем: у приложения нет такой зависимости. */
export type ConversationLogFailureSink = (
  error: unknown,
  context: {
    readonly channel: MessengerChannel;
    readonly direction: "inbound" | "outbound";
    readonly externalChatId: string;
  }
) => void;

/**
 * Служба записи. Тонкая намеренно: всё, что она добавляет, — заранее выданные
 * идентификаторы и обещание не бросить исключение в лицо разговору.
 */
export class ConversationLog {
  constructor(
    private readonly repository: ConversationRepository,
    private readonly ids: IdGenerator,
    private readonly onFailure: ConversationLogFailureSink = () => undefined
  ) {}

  async recordIncoming(
    message: IncomingConversationMessage
  ): Promise<RecordedConversationMessage | null> {
    try {
      return await this.repository.recordIncoming({
        ...message,
        conversationId: this.ids.newId(),
        messageId: this.ids.newId(),
        contactId: this.ids.newId(),
        attachmentIds: message.attachments.map(() => this.ids.newId()),
        taskId: this.ids.newId()
      });
    } catch (error) {
      this.onFailure(error, {
        channel: message.channel,
        direction: "inbound",
        externalChatId: message.externalChatId
      });
      return null;
    }
  }

  async recordOutgoing(
    message: OutgoingConversationMessage
  ): Promise<RecordedConversationMessage | null> {
    try {
      return await this.repository.recordOutgoing({
        ...message,
        conversationId: this.ids.newId(),
        messageId: this.ids.newId(),
        contactId: this.ids.newId()
      });
    } catch (error) {
      this.onFailure(error, {
        channel: message.channel,
        direction: "outbound",
        externalChatId: message.externalChatId
      });
      return null;
    }
  }
}

/** Откуда человек попал в базу — видно в карточке и в отборе по источнику. */
export const CONVERSATION_CONTACT_SOURCE = "Написал в мессенджер";

/**
 * Опознаватель для карточки, заводимой по входящему сообщению.
 *
 * Ник предпочтительнее числа: с ним карточку узнаёт человек, а не только запрос. Числовой
 * идентификатор — последнее, что остаётся, и он лучше, чем ничего: без единого опознавателя
 * карточка не заводится вовсе, и диалог остаётся ни к кому не привязанным.
 *
 * В Telegram числовой идентификатор в карточку не пишем: колонка там называется «ник», её
 * читают глазами и по ней ищут, а число в ней — мусор, который никому ничего не скажет.
 * Такой диалог подождёт: ник или телефон появятся, и он привяжется вместе со всей историей.
 */
export function conversationContactIdentifier(
  channel: MessengerChannel,
  participant: ConversationParticipant
): { readonly telegramUsername: string | null; readonly maxIdentifier: string | null } {
  const username = (participant.username ?? "").trim().replace(/^@/, "");
  if (channel === "telegram") {
    return { telegramUsername: username === "" ? null : username, maxIdentifier: null };
  }
  return {
    telegramUsername: null,
    maxIdentifier: username === "" ? participant.externalUserId : username
  };
}

/**
 * Запись того, что уходит из воркера.
 *
 * Билеты, напоминания, продолжения сценария и рассылки идут не из бота, а из очереди
 * доставки, и до сих пор в переписку не попадали вовсе: у воркера свой отправитель, мимо
 * которого стоят все хуки канала. В ленте это выглядело как разговор, где наша половина
 * реплик пропущена, — а именно там уходит главное, билет.
 *
 * Обёртка на общий порт отправки, а не на каждый канал: `NotificationSender` один и тот же
 * у Telegram и MAX, и второй копии этой логики быть не должно.
 */
export class RecordingNotificationSender implements NotificationSender {
  constructor(
    private readonly sender: NotificationSender,
    private readonly channel: MessengerChannel,
    private readonly log: ConversationLog,
    /**
     * Чаты, которые в переписку не идут. Это чаты организаторов: «продали билет» —
     * служебное сообщение самим себе, и заводить на него диалог с человеком значит
     * засыпать список неопознанных разговоров собственными уведомлениями.
     */
    private readonly skipRecipients: readonly string[] = []
  ) {}

  async sendText(recipientId: string, text: string) {
    const sent = await this.sender.sendText(recipientId, text);
    await this.record(recipientId, text, sent.providerMessageId);
    return sent;
  }

  async sendBroadcastMessage(recipientId: string, message: BroadcastMessage) {
    const sent = await this.sender.sendBroadcastMessage(recipientId, message);
    await this.record(recipientId, message.text, sent.providerMessageId);
    return sent;
  }

  async sendImage(
    recipientId: string,
    image: TicketPng,
    fileName: string,
    caption: string
  ) {
    const sent = await this.sender.sendImage(recipientId, image, fileName, caption);
    // Билет — это картинка с подписью. В ленте от него остаётся подпись: сам QR-код там
    // не нужен, а «отправили билет такой-то» — нужно.
    await this.record(recipientId, caption, sent.providerMessageId);
    return sent;
  }

  async sendScenarioPresentation(
    recipientId: string,
    sessionId: string,
    presentation: ScenarioPresentationModel
  ) {
    const sent = await this.sender.sendScenarioPresentation(
      recipientId,
      sessionId,
      presentation
    );
    await this.record(recipientId, presentation.text, sent.providerMessageId);
    return sent;
  }

  /** Пишем только то, что действительно ушло: неудачная отправка бросает до этой строки. */
  private async record(
    recipientId: string,
    body: string,
    providerMessageId: string
  ): Promise<void> {
    if (this.skipRecipients.includes(recipientId)) {
      return;
    }
    await this.log.recordOutgoing({
      channel: this.channel,
      transport: "bot",
      externalChatId: recipientId,
      recipient: { externalUserId: recipientId, username: null, displayName: null },
      authorKind: "bot",
      authorAdminId: null,
      body,
      externalMessageId: providerMessageId === "" ? null : providerMessageId,
      deliveryStatus: "sent",
      failureReason: null,
      occurredAt: new Date()
    });
  }
}
