import type {
  AdminRequestActor,
  MentorSlot,
  MentorSlotFilters,
  StaffMember,
  StaffRole,
  StaffView
} from "@ticket-platform/contracts";
import { STAFF_ROLES } from "@ticket-platform/contracts";
import { atLocalHour } from "./call-window.js";
import type { IdGenerator } from "./identity.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Часовой пояс команды.
 *
 * Окошки заводят на «четверг в пятнадцать ноль-ноль», а не на момент времени в UTC, и
 * четверг этот — московский: и наставники, и менеджеры живут в одном поясе. Настройкой
 * это станет тогда, когда появится команда в другом городе; до тех пор настройка, которую
 * некому менять, — это лишняя строка в двух формах и лишний способ ошибиться.
 */
export const TEAM_TIME_ZONE = "Europe/Moscow";

/** Окошко, каким его хранит база. Имена приезжают из соседних таблиц. */
export interface StoredMentorSlot {
  readonly id: string;
  readonly mentorAdminId: string;
  readonly mentorName: string;
  readonly startsAt: Date;
  readonly durationMinutes: number;
  readonly contactId: string | null;
  readonly contactName: string | null;
  readonly contactPhone: string | null;
  readonly bookedByName: string | null;
  readonly bookedAt: Date | null;
  readonly note: string | null;
}

export interface StoredStaffMember {
  readonly adminId: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly status: "active" | "suspended";
  readonly roleCodes: readonly string[];
  readonly freeSlots: number;
  readonly bookedSlots: number;
}

export interface AdminStaffRepository {
  listMembers(): Promise<readonly StoredStaffMember[]>;
  hasPermission(adminId: string, permission: string): Promise<boolean>;
  /** Выдаёт роль. `false` — она уже выдана: повторная выдача ничего не меняет. */
  grantRole(input: {
    readonly grantId: string;
    readonly adminId: string;
    readonly roleCode: string;
    readonly grantedByAdminId: string;
    readonly now: Date;
  }): Promise<boolean>;
  revokeRole(input: {
    readonly adminId: string;
    readonly roleCode: string;
    readonly revokedByAdminId: string;
    readonly now: Date;
  }): Promise<boolean>;
  listSlots(filters: {
    readonly mentorAdminId?: string;
    readonly onlyFree: boolean;
    readonly from: Date;
    readonly to: Date;
  }): Promise<readonly StoredMentorSlot[]>;
  createSlots(input: {
    readonly slots: readonly {
      readonly id: string;
      readonly mentorAdminId: string;
      readonly startsAt: Date;
      readonly durationMinutes: number;
      readonly note: string | null;
    }[];
    readonly createdByAdminId: string;
    readonly now: Date;
  }): Promise<number>;
  cancelSlot(input: {
    readonly slotId: string;
    readonly cancelledByAdminId: string;
    readonly now: Date;
  }): Promise<boolean>;
  /**
   * Записывает клиента в свободное окошко и ставит ему дату личной встречи.
   *
   * Одной транзакцией: занятое окошко без встречи в карточке — это встреча, о которой
   * знает только наставник, а встреча в карточке без окошка — время, которое кто-то
   * займёт следующим.
   */
  bookSlot(input: {
    readonly slotId: string;
    readonly contactId: string;
    readonly bookedByAdminId: string;
    readonly note: string | null;
    readonly now: Date;
  }): Promise<"booked" | "already_booked" | "not_found">;
  releaseSlot(input: {
    readonly slotId: string;
    readonly releasedByAdminId: string;
    readonly now: Date;
  }): Promise<boolean>;
}

export interface StaffClock {
  now(): Date;
}

/**
 * Команда кабинета: роли и календари наставников.
 *
 * Роли выдаёт руководитель, календарь ведёт сам наставник, записывает в окошко менеджер.
 * Разрешений поэтому четыре, а не одно: «видеть команду» есть у всех троих, «менять
 * роли» — только у руководителя, «править календарь» — у него и у наставника, «записать
 * клиента» — у него и у менеджера.
 */
export class AdminStaffService {
  constructor(
    private readonly repository: AdminStaffRepository,
    private readonly clock: StaffClock,
    private readonly idGenerator: IdGenerator
  ) {}

  async view(input: {
    readonly actor: AdminRequestActor;
  }): Promise<StaffView> {
    requirePermission(input.actor, "team.read");
    const [members, canManageRoles, canManageSlots, canBookSlots] =
      await Promise.all([
        this.repository.listMembers(),
        this.repository.hasPermission(input.actor.adminId, "team.manage"),
        this.repository.hasPermission(input.actor.adminId, "mentor_slots.manage"),
        this.repository.hasPermission(input.actor.adminId, "mentor_slots.book")
      ]);
    return {
      members: members.map(toStaffMember),
      canManageRoles,
      canManageSlots,
      canBookSlots,
      viewerAdminId: input.actor.adminId
    };
  }

  /**
   * Выдать или снять роль.
   *
   * Снять последнюю роль руководителя нельзя: кабинет остался бы без того, кто может
   * выдавать роли, и чинилось бы это только руками в базе.
   */
  async setRole(input: {
    readonly actor: AdminRequestActor;
    readonly adminId: string;
    readonly role: StaffRole;
    readonly granted: boolean;
  }): Promise<{ readonly changed: boolean }> {
    requirePermission(input.actor, "team.manage");
    requireUuid(input.adminId);
    if (!STAFF_ROLES.includes(input.role)) {
      throw new Error("Staff role is unknown");
    }
    const now = this.clock.now();
    if (input.granted) {
      return {
        changed: await this.repository.grantRole({
          grantId: this.idGenerator.newId(),
          adminId: input.adminId,
          roleCode: input.role,
          grantedByAdminId: input.actor.adminId,
          now
        })
      };
    }
    if (input.role === "head" && await this.isLastHead(input.adminId)) {
      throw new LastHeadError();
    }
    return {
      changed: await this.repository.revokeRole({
        adminId: input.adminId,
        roleCode: input.role,
        revokedByAdminId: input.actor.adminId,
        now
      })
    };
  }

  async listSlots(input: {
    readonly actor: AdminRequestActor;
    readonly filters: MentorSlotFilters;
  }): Promise<readonly MentorSlot[]> {
    requirePermission(input.actor, "team.read");
    const now = this.clock.now();
    const from = parseInstant(input.filters.from) ?? startOfHour(now);
    const to = parseInstant(input.filters.to) ?? addDays(from, 60);
    if (to.getTime() <= from.getTime()) {
      throw new Error("Mentor slot range is invalid");
    }
    if (input.filters.mentorAdminId !== undefined) {
      requireUuid(input.filters.mentorAdminId);
    }
    const slots = await this.repository.listSlots({
      ...(input.filters.mentorAdminId === undefined
        ? {}
        : { mentorAdminId: input.filters.mentorAdminId }),
      onlyFree: input.filters.onlyFree === true,
      from,
      to
    });
    return slots.map(toMentorSlot);
  }

  /**
   * Завести окошки.
   *
   * Пачкой, потому что календарь на месяц руками — это тридцать одинаковых форм. Занятое
   * время не задваивается: повтор пропускается, а не отменяет всю пачку — иначе одно
   * пересечение с прошлой неделей стоило бы всего расписания.
   */
  async createSlots(input: {
    readonly actor: AdminRequestActor;
    readonly mentorAdminId: string;
    readonly fromDate: string;
    readonly toDate: string;
    readonly weekdays: readonly number[];
    readonly hours: readonly number[];
    readonly durationMinutes?: number | undefined;
  }): Promise<{ readonly created: number; readonly skipped: number }> {
    requirePermission(input.actor, "mentor_slots.manage");
    requireUuid(input.mentorAdminId);
    const duration = input.durationMinutes ?? 60;
    if (!Number.isInteger(duration) || duration < 15 || duration > 480) {
      throw new Error("Mentor slot duration is invalid");
    }
    if (input.weekdays.length === 0 || input.hours.length === 0) {
      throw new Error("Mentor slot schedule is empty");
    }
    if (input.weekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) {
      throw new Error("Mentor slot weekday is invalid");
    }
    if (input.hours.some((hour) => !Number.isInteger(hour) || hour < 0 || hour > 23)) {
      throw new Error("Mentor slot hour is invalid");
    }
    const days = expandDays(input.fromDate, input.toDate, input.weekdays);
    const starts = days.flatMap((day) =>
      [...input.hours]
        .sort((left, right) => left - right)
        .map((hour) => atLocalHour(day, TEAM_TIME_ZONE, hour, 0))
        .filter((instant): instant is Date => instant !== null));
    if (starts.length === 0) {
      return { created: 0, skipped: 0 };
    }
    if (starts.length > 500) {
      throw new Error("Mentor slot batch is too large");
    }
    const created = await this.repository.createSlots({
      slots: starts.map((startsAt) => ({
        id: this.idGenerator.newId(),
        mentorAdminId: input.mentorAdminId,
        startsAt,
        durationMinutes: duration,
        note: null
      })),
      createdByAdminId: input.actor.adminId,
      now: this.clock.now()
    });
    return { created, skipped: starts.length - created };
  }

  async cancelSlot(input: {
    readonly actor: AdminRequestActor;
    readonly slotId: string;
  }): Promise<{ readonly cancelled: boolean }> {
    requirePermission(input.actor, "mentor_slots.manage");
    requireUuid(input.slotId);
    return {
      cancelled: await this.repository.cancelSlot({
        slotId: input.slotId,
        cancelledByAdminId: input.actor.adminId,
        now: this.clock.now()
      })
    };
  }

  async bookSlot(input: {
    readonly actor: AdminRequestActor;
    readonly slotId: string;
    readonly contactId: string;
    readonly note?: string | undefined;
  }): Promise<"booked" | "already_booked" | "not_found"> {
    requirePermission(input.actor, "mentor_slots.book");
    requireUuid(input.slotId);
    requireUuid(input.contactId);
    const note = input.note?.trim() ?? "";
    if (note.length > 500) {
      throw new Error("Mentor slot note is too long");
    }
    return this.repository.bookSlot({
      slotId: input.slotId,
      contactId: input.contactId,
      bookedByAdminId: input.actor.adminId,
      note: note.length === 0 ? null : note,
      now: this.clock.now()
    });
  }

  /** Освободить окошко: встреча отменилась, время снова можно предложить. */
  async releaseSlot(input: {
    readonly actor: AdminRequestActor;
    readonly slotId: string;
  }): Promise<{ readonly released: boolean }> {
    requirePermission(input.actor, "mentor_slots.book");
    requireUuid(input.slotId);
    return {
      released: await this.repository.releaseSlot({
        slotId: input.slotId,
        releasedByAdminId: input.actor.adminId,
        now: this.clock.now()
      })
    };
  }

  private async isLastHead(adminId: string): Promise<boolean> {
    const members = await this.repository.listMembers();
    const heads = members.filter((member) =>
      member.status === "active" && member.roleCodes.includes("head"));
    return heads.length === 1 && heads[0]?.adminId === adminId;
  }
}

export class LastHeadError extends Error {
  constructor() {
    super("The last head cannot lose the role");
    this.name = "LastHeadError";
  }
}

function toStaffMember(member: StoredStaffMember): StaffMember {
  return {
    adminId: member.adminId,
    displayName: member.displayName,
    email: member.email,
    status: member.status,
    roles: STAFF_ROLES.filter((role) => member.roleCodes.includes(role)),
    legacyRoleCodes: member.roleCodes.filter((code) =>
      !STAFF_ROLES.includes(code as StaffRole)),
    freeSlots: member.freeSlots,
    bookedSlots: member.bookedSlots
  };
}

function toMentorSlot(slot: StoredMentorSlot): MentorSlot {
  return {
    id: slot.id,
    mentorAdminId: slot.mentorAdminId,
    mentorName: slot.mentorName,
    startsAt: slot.startsAt.toISOString(),
    durationMinutes: slot.durationMinutes,
    contactId: slot.contactId,
    contactName: slot.contactName,
    contactPhone: slot.contactPhone,
    bookedByName: slot.bookedByName,
    bookedAt: slot.bookedAt ? slot.bookedAt.toISOString() : null,
    note: slot.note
  };
}

/**
 * Дни расписания.
 *
 * Считаются от полудня UTC: местная дата в московском поясе от такого момента не зависит
 * ни от перевода часов, ни от знака смещения, а нужен здесь именно день, а не время.
 */
function expandDays(
  fromDate: string,
  toDate: string,
  weekdays: readonly number[]
): readonly Date[] {
  const from = parseDate(fromDate);
  const to = parseDate(toDate);
  if (to.getTime() < from.getTime()) {
    throw new Error("Mentor slot range is invalid");
  }
  if (to.getTime() - from.getTime() > 400 * 86_400_000) {
    throw new Error("Mentor slot range is too long");
  }
  const days: Date[] = [];
  for (
    let day = from;
    day.getTime() <= to.getTime();
    day = new Date(day.getTime() + 86_400_000)
  ) {
    // getUTCDay: 0 — воскресенье. В расписании неделя начинается с понедельника, как её и
    // называют вслух.
    const weekday = day.getUTCDay() === 0 ? 7 : day.getUTCDay();
    if (weekdays.includes(weekday)) {
      days.push(day);
    }
  }
  return days;
}

function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Mentor slot date is invalid");
  }
  const parsed = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Mentor slot date is invalid");
  }
  return parsed;
}

function parseInstant(value: string | undefined): Date | null {
  if (value === undefined) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Mentor slot range is invalid");
  }
  return parsed;
}

function startOfHour(now: Date): Date {
  const start = new Date(now.getTime());
  start.setUTCMinutes(0, 0, 0);
  return start;
}

function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 86_400_000);
}

function requirePermission(
  actor: AdminRequestActor,
  permission:
    | "team.read"
    | "team.manage"
    | "mentor_slots.manage"
    | "mentor_slots.book"
): void {
  if (actor.permission !== permission || !UUID_PATTERN.test(actor.adminId)) {
    throw new Error("Administrator team permission is invalid");
  }
}

function requireUuid(value: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new Error("Administrator team request is invalid");
  }
}
