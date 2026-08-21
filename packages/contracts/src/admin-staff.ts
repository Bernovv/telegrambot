/**
 * Команда кабинета: кто здесь работает и в каком качестве.
 *
 * Не путать с командой мероприятия (`admin-organizers`): там доли от прибыли конкретного
 * пикника, здесь — доступ к панели. Один и тот же человек бывает и там, и там, и это
 * разные вещи: организатор получает процент, а роль определяет, что он видит.
 *
 * Ролей три, потому что работы три. Руководитель отвечает за всё и видит всё. Менеджер
 * обзванивает, ведёт базу, задачи и мероприятия, но не двигает деньги. Наставник проводит
 * личные встречи, и у него есть то, чего нет у остальных, — календарь.
 */

export const STAFF_ROLES = ["head", "manager", "mentor"] as const;

export type StaffRole = typeof STAFF_ROLES[number];

export interface StaffMember {
  readonly adminId: string;
  readonly displayName: string;
  readonly email: string | null;
  /** `suspended` — вход закрыт, но история его действий никуда не делась. */
  readonly status: "active" | "suspended";
  readonly roles: readonly StaffRole[];
  /**
   * Прежние технические роли (`super_admin`, `sales_manager` и подобные). Их не выдают и
   * не снимают отсюда, но показать надо: иначе непонятно, почему человек без единой роли
   * из трёх всё равно всё видит.
   */
  readonly legacyRoleCodes: readonly string[];
  /** Свободных окошек впереди. Только у наставника, у остальных ноль. */
  readonly freeSlots: number;
  readonly bookedSlots: number;
}

export interface StaffView {
  readonly members: readonly StaffMember[];
  /** Смотрящий может выдавать и снимать роли. Иначе страница только показывает. */
  readonly canManageRoles: boolean;
  /** Смотрящий может править календари наставников. */
  readonly canManageSlots: boolean;
  /** Смотрящий может записывать клиентов в окошки. */
  readonly canBookSlots: boolean;
  /** Его собственный идентификатор: свой календарь наставник открывает первым. */
  readonly viewerAdminId: string;
}

export interface SetStaffRoleRequest {
  readonly adminId: string;
  readonly role: StaffRole;
  /** `true` — выдать роль, `false` — снять. */
  readonly granted: boolean;
}

/**
 * Окошко личной встречи.
 *
 * Свободное — то, у которого нет клиента. Занятое хранит, кого записали и кто записал:
 * «встреча в четверг» без ответа на вопрос «кто её назначил» разбирается потом звонком
 * наставнику.
 */
export interface MentorSlot {
  readonly id: string;
  readonly mentorAdminId: string;
  readonly mentorName: string;
  readonly startsAt: string;
  readonly durationMinutes: number;
  readonly contactId: string | null;
  readonly contactName: string | null;
  readonly contactPhone: string | null;
  readonly bookedByName: string | null;
  readonly bookedAt: string | null;
  readonly note: string | null;
}

export interface CreateMentorSlotRequest {
  readonly mentorAdminId: string;
  readonly startsAt: string;
  readonly durationMinutes?: number;
  readonly note?: string;
}

/**
 * Пачка окошек одним махом: календарь на неделю руками — это тридцать одинаковых форм.
 * Дни недели считаются в часовом поясе воронки, а время задаётся часом и минутой.
 */
export interface CreateMentorSlotsRequest {
  readonly mentorAdminId: string;
  /** Первый день, `YYYY-MM-DD`. */
  readonly fromDate: string;
  readonly toDate: string;
  /** Дни недели: 1 — понедельник, 7 — воскресенье. */
  readonly weekdays: readonly number[];
  /** Часы начала окошек в эти дни, по местному времени. */
  readonly hours: readonly number[];
  readonly durationMinutes?: number;
}

export interface CreateMentorSlotsResult {
  readonly created: number;
  /** Окошки, которые уже были заведены на это время: пропущены, а не задвоены. */
  readonly skipped: number;
}

export interface BookMentorSlotRequest {
  readonly slotId: string;
  readonly contactId: string;
  readonly note?: string;
}

export type BookMentorSlotOutcome =
  | { readonly status: "booked"; readonly slot: MentorSlot }
  | { readonly status: "not_found" }
  /** Окошко успели занять, пока менеджер выбирал. Список надо перечитать. */
  | { readonly status: "already_booked" };

export interface MentorSlotFilters {
  readonly mentorAdminId?: string;
  /** Только свободные впереди: именно этот список видит менеджер в карточке клиента. */
  readonly onlyFree?: boolean;
  readonly from?: string;
  readonly to?: string;
}
