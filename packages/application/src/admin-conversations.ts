import type {
  AdminPersonConversations,
  AdminRequestActor
} from "@ticket-platform/contracts";

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
