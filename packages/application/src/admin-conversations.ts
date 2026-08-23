import type {
  AdminInboxFilter,
  AdminInboxPage,
  AdminPersonConversations,
  AdminRequestActor,
  ConversationLinkResult
} from "@ticket-platform/contracts";
import type { IdGenerator } from "./identity.js";
import type { PhoneNormalizer } from "./phone.js";
import {
  attachmentKindForMime,
  type AttachmentStorage,
  type StoredAttachment
} from "./conversation-attachments.js";
import type { AttachmentKind } from "./conversations.js";

/**
 * Переписка для панели.
 *
 * Право своё — `conversations.read`, а не `outreach.read`. Разница не формальная: карточка
 * человека это стадия, телефон и история касаний, а переписка — содержание личных
 * разговоров. День, когда её захочется открыть не всем, кто ведёт базу, наступает раньше,
 * чем кажется, и разделять права задним числом дороже, чем завести их сразу.
 */

export interface PersonConversationsQuery {
  readonly contactId: string;
  /** Сколько реплик отдать. Панель просит страницами, лента длинная. */
  readonly limit: number;
  /** Реплики старше этого времени. Пусто — с начала, то есть самые свежие. */
  readonly before: Date | null;
  /** Поиск по тексту. Пусто — вся лента. */
  readonly search: string | null;
}

export interface AdminConversationsRepository {
  getPersonConversations(query: PersonConversationsQuery): Promise<AdminPersonConversations>;
}

/** Предел страницы. Больше двухсот реплик за раз панель всё равно не покажет осмысленно. */
const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;

export class AdminConversationsService {
  constructor(private readonly repository: AdminConversationsRepository) {}

  /**
   * Метод `async` намеренно: проверки прав и идентификатора бросают, и у метода, который
   * возвращает промис, бросок обязан быть отказом промиса. Синхронный бросок из такого
   * метода проходит мимо `.catch()` у вызывающего — ловушка, которую замечают в проде.
   */
  async getPersonConversations(input: {
    readonly actor: AdminRequestActor;
    readonly contactId: string;
    readonly limit?: number | undefined;
    readonly before?: Date | null | undefined;
    readonly search?: string | null | undefined;
  }): Promise<AdminPersonConversations> {
    requirePermission(input.actor, "conversations.read");
    if (!UUID_PATTERN.test(input.contactId)) {
      throw new Error("Administrator conversations contact id is invalid");
    }

    const search = (input.search ?? "").trim();
    return await this.repository.getPersonConversations({
      contactId: input.contactId,
      limit: pageSize(input.limit),
      before: input.before ?? null,
      // Пустой поиск — это отсутствие поиска, а не поиск пустой строки: иначе первый же
      // очищенный фильтр отдал бы всю ленту как «найденное» и сбил бы счётчик.
      search: search === "" ? null : search
    });
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requirePermission(
  actor: AdminRequestActor,
  permission: "conversations.read" | "conversations.write"
): void {
  if (actor.permission !== permission || !UUID_PATTERN.test(actor.adminId)) {
    throw new Error("Administrator conversations permission is invalid");
  }
}

function pageSize(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.max(Math.trunc(requested), 1), MAX_PAGE_SIZE);
}

/**
 * Ответ менеджера.
 *
 * Уходит очередью, а не прямым вызовом из панели, и причины перечислены в миграции
 * `20260823180000`: чужая сеть моргает, антиспам считает скорость, а два одновременных
 * ответа приходят человеку в случайном порядке.
 *
 * Очередь — это сами реплики со статусом `queued`. Ответ появляется в ленте сразу, ещё до
 * отправки: менеджер видит своё сообщение там же, где всё остальное, и меняется у него
 * только судьба доставки.
 */

/** Предел текста. У Telegram 4096, у MAX 4000; берём меньший, чтобы правило было одно. */
const REPLY_TEXT_LIMIT = 4_000;

export type QueueReplyResult =
  | { readonly status: "queued"; readonly messageId: string }
  | { readonly status: "not_found" }
  /** Диалог взят другим менеджером. Перехват — отдельное осознанное действие. */
  | { readonly status: "assigned_to_other"; readonly assignedAdminName: string }
  /** В эту ветку отвечать нельзя — и это правило, а не поломка. Причина внутри. */
  | { readonly status: "read_only"; readonly reason: string };


export interface QueueReplyInput {
  readonly conversationId: string;
  readonly messageId: string;
  readonly authorAdminId: string;
  readonly body: string;
  readonly occurredAt: Date;
  /** Отвечать в чужой диалог, отобрав его себе. Только по явному согласию менеджера. */
  readonly takeOver: boolean;
}

export interface ConversationReplyRepository {
  queueReply(input: QueueReplyInput): Promise<QueueReplyResult>;
}

export class SendConversationReplyService {
  constructor(
    private readonly repository: ConversationReplyRepository,
    private readonly ids: IdGenerator
  ) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly conversationId: string;
    readonly text: string;
    readonly takeOver?: boolean | undefined;
    readonly now: Date;
  }): Promise<QueueReplyResult> {
    requirePermission(input.actor, "conversations.write");
    if (!UUID_PATTERN.test(input.conversationId)) {
      throw new Error("Administrator conversations conversation id is invalid");
    }

    const body = input.text.trim();
    if (body === "" || body.length > REPLY_TEXT_LIMIT) {
      // Предел проверяем до очереди: отправка, которая заведомо не пройдёт, иначе легла бы
      // в ленту ответом и три часа притворялась, что вот-вот дойдёт.
      throw new Error("Administrator conversations reply text is invalid");
    }

    return await this.repository.queueReply({
      conversationId: input.conversationId,
      messageId: this.ids.newId(),
      authorAdminId: input.actor.adminId,
      body,
      occurredAt: input.now,
      takeOver: input.takeOver ?? false
    });
  }
}

/**
 * Открыть вложение.
 *
 * Панель просит файл по идентификатору вложения, а не по пути. Разница не косметическая:
 * ручка, принимающая путь, — это способ прочитать с диска что угодно, подобрав его. Путь
 * известен только базе, и берётся он оттуда.
 */
export interface StoredAttachmentFile {
  readonly attachmentId: string;
  /** Путь внутри папки вложений: `2026/08/<id>.ogg`. Полный собирает тот, кто читает диск. */
  readonly storagePath: string;
  readonly fileName: string | null;
  readonly mimeType: string | null;
  readonly sizeBytes: number | null;
}

export interface AttachmentFileRepository {
  /** `null` — вложения нет либо файл ещё не у нас: отдавать нечего. */
  findStored(attachmentId: string): Promise<StoredAttachmentFile | null>;
}

export class OpenConversationAttachmentService {
  constructor(private readonly repository: AttachmentFileRepository) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly attachmentId: string;
  }): Promise<StoredAttachmentFile | null> {
    requirePermission(input.actor, "conversations.read");
    if (!UUID_PATTERN.test(input.attachmentId)) {
      throw new Error("Administrator conversations attachment id is invalid");
    }
    return await this.repository.findStored(input.attachmentId);
  }
}

/**
 * Отправка файла из панели.
 *
 * Менеджер до сих пор мог ответить только текстом, и на первой же просьбе «пришлите
 * программу файлом» разговор пришлось бы уводить в мессенджер — ровно туда, откуда мы его
 * забираем.
 *
 * Файл сначала ложится к нам и только потом встаёт в очередь. Порядок важен: реплика,
 * попавшая в очередь раньше файла, отправилась бы в пустоту, а очередь честно доложила бы
 * об успехе. И у отправленного файла ровно та же судьба, что у принятого, — он лежит в той
 * же папке и виден в ленте так же.
 */

/** Предел на файл. Больше не пропустит ни прокси панели, ни общий предел тела запроса. */
export const REPLY_FILE_LIMIT_BYTES = 5 * 1_024 * 1_024;

export interface QueueFileReplyInput {
  readonly conversationId: string;
  readonly messageId: string;
  readonly attachmentId: string;
  readonly authorAdminId: string;
  /** Подпись к файлу. Пусто — отправляем файл без текста. */
  readonly caption: string | null;
  readonly kind: AttachmentKind;
  readonly fileName: string;
  readonly mimeType: string;
  readonly stored: StoredAttachment;
  readonly occurredAt: Date;
  readonly takeOver: boolean;
}

export interface ConversationFileReplyRepository {
  queueFileReply(input: QueueFileReplyInput): Promise<QueueReplyResult>;
}

export class SendConversationFileService {
  constructor(
    private readonly repository: ConversationFileReplyRepository,
    private readonly storage: AttachmentStorage,
    private readonly ids: IdGenerator
  ) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly conversationId: string;
    readonly fileName: string;
    readonly mimeType: string;
    readonly bytes: Uint8Array;
    readonly caption?: string | undefined;
    readonly takeOver?: boolean | undefined;
    readonly now: Date;
  }): Promise<QueueReplyResult> {
    requirePermission(input.actor, "conversations.write");
    if (!UUID_PATTERN.test(input.conversationId)) {
      throw new Error("Administrator conversations conversation id is invalid");
    }
    const fileName = input.fileName.trim();
    if (fileName === "" || fileName.length > 200) {
      throw new Error("Administrator conversations file name is invalid");
    }
    if (!/^[-\w.+]+\/[-\w.+]+$/.test(input.mimeType) || input.mimeType.length > 200) {
      throw new Error("Administrator conversations file type is invalid");
    }
    if (input.bytes.byteLength < 1 || input.bytes.byteLength > REPLY_FILE_LIMIT_BYTES) {
      throw new Error("Administrator conversations file size is invalid");
    }

    const caption = (input.caption ?? "").trim();
    if (caption.length > REPLY_TEXT_LIMIT) {
      throw new Error("Administrator conversations reply text is invalid");
    }

    const attachmentId = this.ids.newId();
    // Файл кладём до очереди: реплика, вставшая в очередь раньше файла, ушла бы в пустоту.
    const stored = await this.storage.save({
      attachmentId,
      bytes: input.bytes,
      fileName,
      mimeType: input.mimeType
    });

    return await this.repository.queueFileReply({
      conversationId: input.conversationId,
      messageId: this.ids.newId(),
      attachmentId,
      authorAdminId: input.actor.adminId,
      caption: caption === "" ? null : caption,
      kind: attachmentKindForMime(input.mimeType),
      fileName,
      mimeType: input.mimeType,
      stored,
      occurredAt: input.now,
      takeOver: input.takeOver ?? false
    });
  }
}

/**
 * Список диалогов — «Переписки».
 *
 * Тот же материал, что в карточке человека, собранный с другой стороны: не «что у нас с
 * этим человеком», а «кому мы ещё не ответили». Ради второго вопроса открывать карточки по
 * одной нельзя, поэтому у списка свой запрос и свои отборы.
 *
 * Непрочитанное считается **для того, кто спрашивает**: за одним аккаунтом компании стоит
 * несколько менеджеров, и открытый одним диалог не должен гаснуть у остальных.
 */

export interface InboxQuery {
  /** Чьё непрочитанное считаем и чьи диалоги показываем в отборе «мои». */
  readonly adminId: string;
  readonly filter: AdminInboxFilter;
  readonly search: string | null;
  readonly limit: number;
  /**
   * Курсор — время последней реплики, а не номер страницы. Список живой: пока менеджер
   * листает, кто-то пишет, и вторая страница по номеру вернула бы уже увиденное.
   */
  readonly before: Date | null;
}

export interface ConversationMessagesQuery {
  readonly conversationId: string;
  readonly limit: number;
  readonly before: Date | null;
  readonly search: string | null;
}

export interface MarkConversationReadInput {
  readonly conversationId: string;
  readonly adminId: string;
  readonly readAt: Date;
}

/**
 * Привязка диалога к человеку.
 *
 * Два пути, и оба нужны. **По карточке** — менеджер узнал собеседника и выбрал его в базе.
 * **По телефону** — человек назвал номер в разговоре; тогда карточка либо уже есть (и
 * диалог уезжает в неё), либо заводится.
 *
 * Третьего пути — «завести карточку с одним именем» — нет, и не по лени: `outreach_contacts`
 * требует хотя бы один опознаватель, телефон или ник. Карточка с одним именем не прошла бы
 * проверку в базе, и правильно: найти человека в базе по имени «Сергей» невозможно.
 */
export interface LinkConversationInput {
  readonly conversationId: string;
  /** Куда привязать. Пусто — заводим по телефону. */
  readonly contactId: string | null;
  readonly phoneE164: string | null;
  readonly displayName: string | null;
  /** Идентификатор на случай, если карточку придётся завести. Заранее — как везде у нас. */
  readonly newContactId: string;
  readonly adminId: string;
  readonly now: Date;
}

export interface AdminInboxRepository {
  listInbox(query: InboxQuery): Promise<AdminInboxPage>;
  /** Лента одного диалога. Нужна там, где карточки нет и спросить переписку не за кого. */
  getConversation(query: ConversationMessagesQuery): Promise<AdminPersonConversations | null>;
  markRead(input: MarkConversationReadInput): Promise<boolean>;
}

export interface ConversationLinkRepository {
  linkConversation(input: LinkConversationInput): Promise<ConversationLinkResult>;
}

export class AdminInboxService {
  constructor(private readonly repository: AdminInboxRepository) {}

  async listInbox(input: {
    readonly actor: AdminRequestActor;
    readonly filter?: AdminInboxFilter | undefined;
    readonly search?: string | null | undefined;
    readonly limit?: number | undefined;
    readonly before?: Date | null | undefined;
  }): Promise<AdminInboxPage> {
    requirePermission(input.actor, "conversations.read");
    const search = (input.search ?? "").trim();
    return await this.repository.listInbox({
      adminId: input.actor.adminId,
      filter: input.filter ?? "all",
      search: search === "" ? null : search,
      limit: pageSize(input.limit),
      before: input.before ?? null
    });
  }

  async getConversation(input: {
    readonly actor: AdminRequestActor;
    readonly conversationId: string;
    readonly limit?: number | undefined;
    readonly before?: Date | null | undefined;
    readonly search?: string | null | undefined;
  }): Promise<AdminPersonConversations | null> {
    requirePermission(input.actor, "conversations.read");
    if (!UUID_PATTERN.test(input.conversationId)) {
      throw new Error("Administrator conversations conversation id is invalid");
    }
    const search = (input.search ?? "").trim();
    return await this.repository.getConversation({
      conversationId: input.conversationId,
      limit: pageSize(input.limit),
      before: input.before ?? null,
      search: search === "" ? null : search
    });
  }

  /**
   * «Я это прочитал».
   *
   * Право — на чтение, а не на запись, хотя строка в базе меняется. Отметка описывает не
   * разговор, а самого менеджера: тот, кому переписку показывают, обязан иметь возможность
   * погасить у себя кружок, даже если отвечать ему не разрешено.
   */
  async markRead(input: {
    readonly actor: AdminRequestActor;
    readonly conversationId: string;
    readonly now: Date;
  }): Promise<{ readonly marked: boolean }> {
    requirePermission(input.actor, "conversations.read");
    if (!UUID_PATTERN.test(input.conversationId)) {
      throw new Error("Administrator conversations conversation id is invalid");
    }
    return {
      marked: await this.repository.markRead({
        conversationId: input.conversationId,
        adminId: input.actor.adminId,
        readAt: input.now
      })
    };
  }
}

export class LinkConversationService {
  constructor(
    private readonly repository: ConversationLinkRepository,
    private readonly phoneNormalizer: PhoneNormalizer,
    private readonly ids: IdGenerator
  ) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly conversationId: string;
    readonly contactId?: string | null | undefined;
    readonly phone?: string | null | undefined;
    readonly displayName?: string | null | undefined;
    readonly now: Date;
  }): Promise<ConversationLinkResult> {
    requirePermission(input.actor, "conversations.write");
    if (!UUID_PATTERN.test(input.conversationId)) {
      throw new Error("Administrator conversations conversation id is invalid");
    }

    const contactId = (input.contactId ?? "").trim();
    const rawPhone = (input.phone ?? "").trim();
    // Ровно одно из двух. И то и другое сразу — это два разных намерения в одном запросе,
    // и молча выбрать одно из них значит однажды привязать диалог не туда.
    if ((contactId === "") === (rawPhone === "")) {
      throw new Error("Administrator conversations link target is invalid");
    }
    if (contactId !== "" && !UUID_PATTERN.test(contactId)) {
      throw new Error("Administrator conversations contact id is invalid");
    }

    const displayName = (input.displayName ?? "").trim();
    if (displayName.length > 200) {
      throw new Error("Administrator conversations display name is invalid");
    }

    return await this.repository.linkConversation({
      conversationId: input.conversationId,
      contactId: contactId === "" ? null : contactId,
      // Нормализуем здесь, а не в базе: телефон в карточке обязан быть в одном виде, иначе
      // тот же человек заводится второй раз с номером через восьмёрку.
      phoneE164: rawPhone === "" ? null : normalizePhone(this.phoneNormalizer, rawPhone),
      displayName: displayName === "" ? null : displayName,
      newContactId: this.ids.newId(),
      adminId: input.actor.adminId,
      now: input.now
    });
  }
}

/**
 * Телефон, введённый руками.
 *
 * Нормализатор бросает своей ошибкой, а она для api — «что-то сломалось», то есть 500 и
 * запись в журнал. Менеджер, опечатавшийся в номере, должен получить внятный отказ, а не
 * пятисотку: переводим на общий язык этого модуля, который ручка уже понимает как 400.
 */
function normalizePhone(normalizer: PhoneNormalizer, rawPhone: string): string {
  try {
    return normalizer.normalize(rawPhone);
  } catch {
    throw new Error("Administrator conversations phone is invalid");
  }
}
