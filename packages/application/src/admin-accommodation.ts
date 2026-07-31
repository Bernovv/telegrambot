import type {
  AccommodationFixedPlan,
  AccommodationPartyView,
  AccommodationProductBreakdown,
  AccommodationSummary,
  AccommodationTentCount,
  AdminRequestActor
} from "@ticket-platform/contracts";
import { planTents, type AccommodationParty } from "@ticket-platform/domain";
import type { IdGenerator } from "./identity.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Размеры палаток, которые у нас есть. Пока список один на все выездные мероприятия —
 * отдельной настройки не заводим, пока их действительно два размера.
 */
export const DEFAULT_TENT_CAPACITIES = [3, 2] as const;

export interface AccommodationBundleRole {
  readonly role: string;
  readonly quantity: number;
}

export interface AccommodationOrderItemRow {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly buyerName: string | null;
  readonly productId: string;
  readonly productTitle: string;
  readonly quantity: number;
  readonly bundleComposition: readonly AccommodationBundleRole[];
  readonly inventoryUnitsPerItem: number;
  readonly includesSleepingPlace: boolean;
}

export interface AccommodationGroupRow {
  readonly groupId: string;
  readonly note: string;
  readonly orderIds: readonly string[];
}

export interface AccommodationEventRow {
  readonly id: string;
  readonly title: string;
  readonly timezone: string;
  readonly startsAt: Date;
  readonly endsAt: Date | null;
}

export interface CreateAccommodationGroupInput {
  readonly groupId: string;
  readonly eventId: string;
  readonly orderIds: readonly string[];
  readonly note: string;
  readonly adminId: string;
}

export interface InsertAccommodationPlanInput {
  readonly planId: string;
  readonly eventId: string;
  readonly adminId: string;
  readonly fixedAt: Date;
  readonly note: string;
  readonly requiredBerths: number;
  readonly totalTents: number;
  readonly snapshot: Record<string, unknown>;
}

export interface AdminAccommodationRepository {
  findEvent(eventId: string): Promise<AccommodationEventRow | null>;
  listPaidOrderItems(eventId: string): Promise<readonly AccommodationOrderItemRow[]>;
  listGroups(eventId: string): Promise<readonly AccommodationGroupRow[]>;
  findLastPlan(eventId: string): Promise<AccommodationFixedPlan | null>;
  hasManagePermission(adminId: string): Promise<boolean>;
  createGroup(input: CreateAccommodationGroupInput): Promise<void>;
  deleteGroup(eventId: string, groupId: string): Promise<void>;
  insertPlan(input: InsertAccommodationPlanInput): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export class AccommodationEventNotFoundError extends Error {
  constructor() {
    super("Event was not found");
    this.name = "AccommodationEventNotFoundError";
  }
}

export class AdminAccommodationService {
  constructor(
    private readonly repository: AdminAccommodationRepository,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator
  ) {}

  async summary(input: {
    readonly actor: AdminRequestActor;
    readonly eventId: string;
  }): Promise<AccommodationSummary> {
    requirePermission(input.actor, "accommodation.read");
    requireUuid(input.eventId);

    const canManage = await this.repository.hasManagePermission(input.actor.adminId);
    return this.load(input.eventId, canManage);
  }

  /**
   * Собирает сводку без проверки прав — её делают вызывающие методы. Отдельно, потому что
   * фиксация плана уже проверила `accommodation.manage`, а `summary` требует
   * `accommodation.read`: в акторе лежит ровно то право, с которым пришёл запрос.
   */
  private async load(
    eventId: string,
    canManage: boolean
  ): Promise<AccommodationSummary> {
    const event = await this.repository.findEvent(eventId);
    if (!event) {
      throw new AccommodationEventNotFoundError();
    }

    const [items, groups, lastPlan] = await Promise.all([
      this.repository.listPaidOrderItems(eventId),
      this.repository.listGroups(eventId),
      this.repository.findLastPlan(eventId)
    ]);

    return buildSummary({
      event,
      items,
      groups,
      lastPlan,
      canManage,
      calculatedAt: this.clock.now()
    });
  }

  async mergeParties(input: {
    readonly actor: AdminRequestActor;
    readonly eventId: string;
    readonly orderIds: readonly string[];
    readonly note: string;
  }): Promise<void> {
    requirePermission(input.actor, "accommodation.manage");
    requireUuid(input.eventId);

    if (input.orderIds.length < 2 || input.orderIds.length > 20) {
      throw new Error("Accommodation merge selection is invalid");
    }
    if (new Set(input.orderIds).size !== input.orderIds.length) {
      throw new Error("Accommodation merge selection is invalid");
    }
    for (const orderId of input.orderIds) {
      requireUuid(orderId);
    }
    if (input.note.length > 500) {
      throw new Error("Accommodation group note is invalid");
    }

    await this.repository.createGroup({
      groupId: this.idGenerator.newId(),
      eventId: input.eventId,
      orderIds: input.orderIds,
      note: input.note,
      adminId: input.actor.adminId
    });
  }

  async splitGroup(input: {
    readonly actor: AdminRequestActor;
    readonly eventId: string;
    readonly groupId: string;
  }): Promise<void> {
    requirePermission(input.actor, "accommodation.manage");
    requireUuid(input.eventId);
    requireUuid(input.groupId);

    await this.repository.deleteGroup(input.eventId, input.groupId);
  }

  async fixPlan(input: {
    readonly actor: AdminRequestActor;
    readonly eventId: string;
    readonly note: string;
  }): Promise<AccommodationSummary> {
    requirePermission(input.actor, "accommodation.manage");
    requireUuid(input.eventId);
    if (input.note.length > 500) {
      throw new Error("Accommodation plan note is invalid");
    }

    const event = await this.repository.findEvent(input.eventId);
    if (!event) {
      throw new AccommodationEventNotFoundError();
    }

    const [items, groups] = await Promise.all([
      this.repository.listPaidOrderItems(input.eventId),
      this.repository.listGroups(input.eventId)
    ]);
    const summary = buildSummary({
      event,
      items,
      groups,
      lastPlan: null,
      canManage: true,
      calculatedAt: this.clock.now()
    });

    await this.repository.insertPlan({
      planId: this.idGenerator.newId(),
      eventId: input.eventId,
      adminId: input.actor.adminId,
      fixedAt: new Date(summary.calculatedAt),
      note: input.note,
      requiredBerths: summary.requiredBerths,
      totalTents: summary.totalTents,
      snapshot: {
        schemaVersion: 1,
        tents: summary.tents,
        headcount: summary.headcount,
        mealsAdult: summary.mealsAdult,
        mealsChild: summary.mealsChild,
        plannedBerths: summary.plannedBerths,
        emptyBerths: summary.emptyBerths,
        parties: summary.parties.map((party) => ({
          key: party.key,
          title: party.title,
          berths: party.berths,
          orderNumbers: party.orderNumbers,
          tents: party.tents
        }))
      }
    });

    return this.load(input.eventId, true);
  }
}

interface SummaryInput {
  readonly event: AccommodationEventRow;
  readonly items: readonly AccommodationOrderItemRow[];
  readonly groups: readonly AccommodationGroupRow[];
  readonly lastPlan: AccommodationFixedPlan | null;
  readonly canManage: boolean;
  readonly calculatedAt: Date;
}

interface OrderTotals {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly buyerName: string | null;
  adults: number;
  children: number;
  berths: number;
  childrenWithoutBerth: number;
}

export function buildSummary(input: SummaryInput): AccommodationSummary {
  const orders = new Map<string, OrderTotals>();
  const products = new Map<string, {
    productId: string;
    title: string;
    ticketsSold: number;
    guests: number;
    adults: number;
    children: number;
    sleepingPlaces: number;
  }>();

  for (const item of input.items) {
    const adultsPerItem = countRole(item.bundleComposition, "adult");
    const childrenPerItem = countRole(item.bundleComposition, "child");
    const berthsPerItem = item.includesSleepingPlace ? item.inventoryUnitsPerItem : 0;

    const order = orders.get(item.orderId) ?? {
      orderId: item.orderId,
      orderNumber: item.orderNumber,
      buyerName: item.buyerName,
      adults: 0,
      children: 0,
      berths: 0,
      childrenWithoutBerth: 0
    };
    order.adults += adultsPerItem * item.quantity;
    order.children += childrenPerItem * item.quantity;
    order.berths += berthsPerItem * item.quantity;
    if (!item.includesSleepingPlace) {
      order.childrenWithoutBerth += childrenPerItem * item.quantity;
    }
    orders.set(item.orderId, order);

    const product = products.get(item.productId) ?? {
      productId: item.productId,
      title: item.productTitle,
      ticketsSold: 0,
      guests: 0,
      adults: 0,
      children: 0,
      sleepingPlaces: 0
    };
    product.ticketsSold += item.quantity;
    product.adults += adultsPerItem * item.quantity;
    product.children += childrenPerItem * item.quantity;
    product.guests += (adultsPerItem + childrenPerItem) * item.quantity;
    product.sleepingPlaces += berthsPerItem * item.quantity;
    products.set(item.productId, product);
  }

  const { parties, partyMeta } = buildParties([...orders.values()], input.groups);
  const plan = planTents(parties, [...DEFAULT_TENT_CAPACITIES]);

  const partyViews = plan.allocations.map((allocation) =>
    toPartyView(allocation.party, allocation.tents, allocation.emptyBerths, partyMeta)
  );
  const singleKeys = new Set(plan.singles.map((party) => party.key));

  let adults = 0;
  let children = 0;
  let childrenWithoutBerth = 0;
  for (const order of orders.values()) {
    adults += order.adults;
    children += order.children;
    // «Ребёнок без места» имеет смысл только там, где кто-то из заказа всё-таки ночует.
    if (order.berths > 0) {
      childrenWithoutBerth += order.childrenWithoutBerth;
    }
  }

  const eventDays = countEventDays(input.event);

  return {
    eventId: input.event.id,
    eventTitle: input.event.title,
    calculatedAt: input.calculatedAt.toISOString(),
    headcount: { guests: adults + children, adults, children },
    eventDays,
    mealsAdult: adults * eventDays,
    mealsChild: children * eventDays,
    products: [...products.values()]
      .map(toProductBreakdown)
      .sort((left, right) => right.guests - left.guests || left.title.localeCompare(right.title)),
    tentCapacities: [...DEFAULT_TENT_CAPACITIES],
    parties: partyViews,
    tents: plan.tents.map(toTentCount),
    totalTents: plan.totalTents,
    requiredBerths: plan.requiredBerths,
    plannedBerths: plan.plannedBerths,
    emptyBerths: plan.emptyBerths,
    singles: partyViews.filter((party) => singleKeys.has(party.key)),
    mergeSuggestion: plan.mergeSuggestion,
    lastPlan: input.lastPlan,
    berthsSinceLastPlan: input.lastPlan
      ? Math.max(0, plan.requiredBerths - input.lastPlan.requiredBerths)
      : 0,
    childrenWithoutBerth,
    canManage: input.canManage
  };
}

interface PartyMeta {
  readonly orderIds: readonly string[];
  readonly groupId: string | null;
  readonly note: string;
}

function buildParties(
  orders: readonly OrderTotals[],
  groups: readonly AccommodationGroupRow[]
): {
  readonly parties: readonly AccommodationParty[];
  readonly partyMeta: ReadonlyMap<string, PartyMeta>;
} {
  const byOrderId = new Map(orders.map((order) => [order.orderId, order]));
  const groupOf = new Map<string, AccommodationGroupRow>();
  for (const group of groups) {
    for (const orderId of group.orderIds) {
      groupOf.set(orderId, group);
    }
  }

  const parties: AccommodationParty[] = [];
  const partyMeta = new Map<string, PartyMeta>();
  const handled = new Set<string>();

  for (const group of groups) {
    const members = group.orderIds
      .map((orderId) => byOrderId.get(orderId))
      .filter((order): order is OrderTotals => order !== undefined);
    // Группа могла пережить возврат: если ночующих заказов в ней не осталось, пропускаем.
    if (members.length === 0) {
      continue;
    }
    for (const member of members) {
      handled.add(member.orderId);
    }

    const berths = members.reduce((sum, member) => sum + member.berths, 0);
    parties.push({
      key: `group:${group.groupId}`,
      berths,
      title: members.map(orderTitle).join(", "),
      orderNumbers: members.map((member) => member.orderNumber),
      merged: true
    });
    partyMeta.set(`group:${group.groupId}`, {
      orderIds: members.map((member) => member.orderId),
      groupId: group.groupId,
      note: group.note
    });
  }

  for (const order of orders) {
    if (handled.has(order.orderId) || groupOf.has(order.orderId)) {
      continue;
    }
    const key = `order:${order.orderId}`;
    parties.push({
      key,
      berths: order.berths,
      title: orderTitle(order),
      orderNumbers: [order.orderNumber],
      merged: false
    });
    partyMeta.set(key, { orderIds: [order.orderId], groupId: null, note: "" });
  }

  // Ночующие сверху, дальше по числу мест: с этим списком работают руками.
  const sorted = [...parties]
    .filter((party) => party.berths > 0)
    .sort((left, right) => right.berths - left.berths || left.key.localeCompare(right.key));

  return { parties: sorted, partyMeta };
}

function toPartyView(
  party: AccommodationParty,
  tents: readonly number[],
  emptyBerths: number,
  partyMeta: ReadonlyMap<string, PartyMeta>
): AccommodationPartyView {
  const meta = partyMeta.get(party.key);
  return {
    key: party.key,
    title: party.title,
    berths: party.berths,
    orderNumbers: party.orderNumbers,
    orderIds: meta?.orderIds ?? [],
    merged: party.merged,
    groupId: meta?.groupId ?? null,
    note: meta?.note ?? "",
    tents,
    emptyBerths
  };
}

function toProductBreakdown(product: {
  productId: string;
  title: string;
  ticketsSold: number;
  guests: number;
  adults: number;
  children: number;
  sleepingPlaces: number;
}): AccommodationProductBreakdown {
  return {
    productId: product.productId,
    title: product.title,
    ticketsSold: product.ticketsSold,
    guests: product.guests,
    adults: product.adults,
    children: product.children,
    sleepingPlaces: product.sleepingPlaces
  };
}

function toTentCount(tent: { capacity: number; count: number }): AccommodationTentCount {
  return { capacity: tent.capacity, count: tent.count };
}

function orderTitle(order: OrderTotals): string {
  return order.buyerName ?? `Заказ ${order.orderNumber}`;
}

function countRole(
  composition: readonly AccommodationBundleRole[],
  role: string
): number {
  let total = 0;
  for (const entry of composition) {
    if (entry.role === role && Number.isSafeInteger(entry.quantity) && entry.quantity > 0) {
      total += entry.quantity;
    }
  }
  return total;
}

/**
 * Сколько дней кормим. Считаем календарные дни в часовом поясе мероприятия: пикник
 * 8 августа 12:00 — 9 августа 20:00 это два дня питания, а не полтора.
 */
function countEventDays(event: AccommodationEventRow): number {
  if (!event.endsAt) {
    return 1;
  }
  const first = calendarDate(event.startsAt, event.timezone);
  const last = calendarDate(event.endsAt, event.timezone);
  const days = Math.round((last - first) / 86_400_000) + 1;
  return days > 0 ? days : 1;
}

function calendarDate(value: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return Date.parse(`${formatter.format(value)}T00:00:00Z`);
}

function requirePermission(
  actor: AdminRequestActor,
  permission: "accommodation.read" | "accommodation.manage"
): void {
  if (actor.permission !== permission || !UUID_PATTERN.test(actor.adminId)) {
    throw new Error("Administrator accommodation permission is invalid");
  }
}

function requireUuid(value: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new Error("Administrator accommodation request is invalid");
  }
}
