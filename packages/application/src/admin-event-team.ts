import type {
  AdminRequestActor,
  EventOrganizer,
  EventProfit,
  EventTeamView
} from "@ticket-platform/contracts";
import type { IdGenerator } from "./identity.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Проценты с двумя знаками: доли вида 33.33 нужны, «треть» словами — нет. */
const PERCENT_PATTERN = /^\d{1,3}(?:\.\d{1,2})?$/;

/**
 * Команда мероприятия и доли от прибыли.
 *
 * Прибыль считается на лету по тем же данным, что показывают «Участники» и «Расходы»:
 * выручка минус фактические расходы. Хранить её отдельно нельзя — три экрана начали бы
 * показывать три разные цифры при первой же правке сметы.
 */

export interface TeamEventRow {
  readonly id: string;
  readonly title: string;
}

/** Деньги мероприятия, как их видит база. Копейки строками — суммы большие. */
export interface EventMoneyRow {
  readonly revenueFromOrdersKopecks: string;
  readonly revenueFromManualKopecks: string;
  readonly expensesKopecks: string;
  /** Строк расхода без факта: пока их больше нуля, прибыль завышена. */
  readonly expensesWithoutActual: number;
}

export interface StoredOrganizer {
  readonly id: string;
  readonly personName: string;
  readonly roleLabel: string;
  readonly sharePercent: string;
  readonly responsibilities: string;
  readonly note: string;
}

export interface CreateOrganizerInput {
  readonly organizerId: string;
  readonly eventId: string;
  readonly personName: string;
  readonly roleLabel: string;
  readonly sharePercent: string;
  readonly responsibilities: string;
  readonly note: string;
  readonly adminId: string;
}

export interface UpdateOrganizerInput {
  readonly eventId: string;
  readonly organizerId: string;
  readonly changes: {
    readonly personName?: string;
    readonly roleLabel?: string;
    readonly sharePercent?: string;
    readonly responsibilities?: string;
    readonly note?: string;
  };
}

export interface AdminEventTeamRepository {
  findEvent(eventId: string): Promise<TeamEventRow | null>;
  loadMoney(eventId: string): Promise<EventMoneyRow>;
  listOrganizers(eventId: string): Promise<readonly StoredOrganizer[]>;
  hasPermission(adminId: string, permission: string): Promise<boolean>;
  createOrganizer(input: CreateOrganizerInput): Promise<boolean>;
  updateOrganizer(input: UpdateOrganizerInput): Promise<boolean>;
  removeOrganizer(eventId: string, organizerId: string): Promise<boolean>;
}

export interface TeamClock {
  now(): Date;
}

export class TeamEventNotFoundError extends Error {
  constructor() {
    super("Event was not found");
    this.name = "TeamEventNotFoundError";
  }
}

export class OrganizerNotFoundError extends Error {
  constructor() {
    super("Event organizer was not found");
    this.name = "OrganizerNotFoundError";
  }
}

export class OrganizerAlreadyExistsError extends Error {
  constructor() {
    super("Event organizer with this name already exists");
    this.name = "OrganizerAlreadyExistsError";
  }
}

export class SharesExceedHundredError extends Error {
  constructor() {
    super("Event organizer shares exceed one hundred percent");
    this.name = "SharesExceedHundredError";
  }
}

export class AdminEventTeamService {
  constructor(
    private readonly repository: AdminEventTeamRepository,
    private readonly clock: TeamClock,
    private readonly idGenerator: IdGenerator
  ) {}

  async summary(input: {
    readonly actor: AdminRequestActor;
    readonly eventId: string;
  }): Promise<EventTeamView> {
    requirePermission(input.actor, "event_finance.read");
    requireUuid(input.eventId);

    const event = await this.repository.findEvent(input.eventId);
    if (!event) {
      throw new TeamEventNotFoundError();
    }

    const [money, organizers, canManage] = await Promise.all([
      this.repository.loadMoney(input.eventId),
      this.repository.listOrganizers(input.eventId),
      this.repository.hasPermission(input.actor.adminId, "event_finance.manage")
    ]);

    return buildTeamView({
      event,
      money,
      organizers,
      canManage,
      calculatedAt: this.clock.now()
    });
  }

  async addOrganizer(input: {
    readonly actor: AdminRequestActor;
    readonly eventId: string;
    readonly personName: string;
    readonly roleLabel?: string;
    readonly sharePercent: string;
    readonly responsibilities?: string;
    readonly note?: string;
  }): Promise<void> {
    requirePermission(input.actor, "event_finance.manage");
    requireUuid(input.eventId);

    const personName = input.personName.trim();
    if (personName.length < 1 || personName.length > 200) {
      throw new Error("Event organizer request is invalid");
    }
    requirePercent(input.sharePercent);

    const event = await this.repository.findEvent(input.eventId);
    if (!event) {
      throw new TeamEventNotFoundError();
    }
    await this.requireRoomForShare(input.eventId, null, input.sharePercent);

    const created = await this.repository.createOrganizer({
      organizerId: this.idGenerator.newId(),
      eventId: input.eventId,
      personName,
      roleLabel: (input.roleLabel ?? "").trim().slice(0, 80),
      sharePercent: input.sharePercent,
      responsibilities: (input.responsibilities ?? "").trim().slice(0, 1000),
      note: (input.note ?? "").trim().slice(0, 1000),
      adminId: input.actor.adminId
    });
    if (!created) {
      throw new OrganizerAlreadyExistsError();
    }
  }

  async updateOrganizer(input: {
    readonly actor: AdminRequestActor;
    readonly eventId: string;
    readonly organizerId: string;
    readonly changes: UpdateOrganizerInput["changes"];
  }): Promise<void> {
    requirePermission(input.actor, "event_finance.manage");
    requireUuid(input.eventId);
    requireUuid(input.organizerId);

    if (input.changes.personName !== undefined) {
      const personName = input.changes.personName.trim();
      if (personName.length < 1 || personName.length > 200) {
        throw new Error("Event organizer request is invalid");
      }
    }
    if (input.changes.sharePercent !== undefined) {
      requirePercent(input.changes.sharePercent);
      await this.requireRoomForShare(
        input.eventId,
        input.organizerId,
        input.changes.sharePercent
      );
    }

    const saved = await this.repository.updateOrganizer({
      eventId: input.eventId,
      organizerId: input.organizerId,
      changes: input.changes
    });
    if (!saved) {
      throw new OrganizerNotFoundError();
    }
  }

  async removeOrganizer(input: {
    readonly actor: AdminRequestActor;
    readonly eventId: string;
    readonly organizerId: string;
  }): Promise<void> {
    requirePermission(input.actor, "event_finance.manage");
    requireUuid(input.eventId);
    requireUuid(input.organizerId);

    const removed = await this.repository.removeOrganizer(
      input.eventId,
      input.organizerId
    );
    if (!removed) {
      throw new OrganizerNotFoundError();
    }
  }

  /**
   * Сумма долей выше ста означала бы, что раздали больше, чем заработали. Проверяем перед
   * записью, а не ограничением в базе: пока состав правят, промежуточные состояния бывают
   * любыми, и блокировать порядок ввода незачем — блокировать нужно результат.
   */
  private async requireRoomForShare(
    eventId: string,
    exceptOrganizerId: string | null,
    sharePercent: string
  ): Promise<void> {
    const organizers = await this.repository.listOrganizers(eventId);
    const others = organizers
      .filter((organizer) => organizer.id !== exceptOrganizerId)
      .reduce((sum, organizer) => sum + percentToHundredths(organizer.sharePercent), 0);

    if (others + percentToHundredths(sharePercent) > 10_000) {
      throw new SharesExceedHundredError();
    }
  }
}

export interface TeamViewInput {
  readonly event: TeamEventRow;
  readonly money: EventMoneyRow;
  readonly organizers: readonly StoredOrganizer[];
  readonly canManage: boolean;
  readonly calculatedAt: Date;
}

export function buildTeamView(input: TeamViewInput): EventTeamView {
  const fromOrders = BigInt(input.money.revenueFromOrdersKopecks);
  const fromManual = BigInt(input.money.revenueFromManualKopecks);
  const revenue = fromOrders + fromManual;
  const expenses = BigInt(input.money.expensesKopecks);
  const profit = revenue - expenses;

  const profitView: EventProfit = {
    revenueKopecks: revenue.toString(),
    revenueFromOrdersKopecks: fromOrders.toString(),
    revenueFromManualKopecks: fromManual.toString(),
    expensesKopecks: expenses.toString(),
    profitKopecks: profit.toString(),
    preliminary: input.money.expensesWithoutActual > 0,
    expensesWithoutActual: input.money.expensesWithoutActual
  };

  let allocatedHundredths = 0;
  const organizers: EventOrganizer[] = input.organizers.map((organizer) => {
    const hundredths = percentToHundredths(organizer.sharePercent);
    allocatedHundredths += hundredths;
    return {
      id: organizer.id,
      personName: organizer.personName,
      roleLabel: organizer.roleLabel,
      sharePercent: organizer.sharePercent,
      responsibilities: organizer.responsibilities,
      note: organizer.note,
      shareKopecks: shareOf(profit, hundredths).toString()
    };
  });

  const unallocated = profit - organizers.reduce(
    (sum, organizer) => sum + BigInt(organizer.shareKopecks),
    0n
  );

  return {
    eventId: input.event.id,
    eventTitle: input.event.title,
    calculatedAt: input.calculatedAt.toISOString(),
    profit: profitView,
    organizers,
    allocatedPercent: hundredthsToPercent(allocatedHundredths),
    unallocatedKopecks: unallocated.toString(),
    canManage: input.canManage
  };
}

/**
 * Доля в копейках. Считается в целых числах через сотые доли процента: 33.33% от
 * миллиона рублей в плавающей точке даёт хвост, который потом никак не сходится в сумме.
 * Округление всегда вниз по модулю — остаток виден отдельной строкой «не распределено»,
 * а не растворяется в чьей-то доле.
 */
function shareOf(profit: bigint, hundredths: number): bigint {
  if (hundredths === 0) {
    return 0n;
  }
  const negative = profit < 0n;
  const absolute = negative ? -profit : profit;
  const share = (absolute * BigInt(hundredths)) / 10_000n;
  return negative ? -share : share;
}

function percentToHundredths(value: string): number {
  return Math.round(Number(value) * 100);
}

function hundredthsToPercent(value: number): string {
  const whole = Math.trunc(value / 100);
  const fraction = value % 100;
  return fraction === 0
    ? String(whole)
    : `${whole}.${String(fraction).padStart(2, "0").replace(/0$/, "")}`;
}

function requirePermission(
  actor: AdminRequestActor,
  permission: "event_finance.read" | "event_finance.manage"
): void {
  if (actor.permission !== permission || !UUID_PATTERN.test(actor.adminId)) {
    throw new Error("Administrator event finance permission is invalid");
  }
}

function requirePercent(value: string): void {
  if (!PERCENT_PATTERN.test(value) || Number(value) > 100) {
    throw new Error("Event organizer request is invalid");
  }
}

function requireUuid(value: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new Error("Event organizer request is invalid");
  }
}
