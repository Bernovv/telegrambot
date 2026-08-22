import type {
  AdminPersonConversations,
  AdminRequestActor
} from "@ticket-platform/contracts";
import type { IdGenerator } from "./identity.js";

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
  | { readonly status: "assigned_to_other"; readonly assignedAdminName: string };

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
