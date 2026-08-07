import type {
  AdminRequestActor,
  EventParticipant,
  EventParticipantRow,
  EventParticipantTotals,
  EventParticipantsView
} from "@ticket-platform/contracts";
import { countRole, type AccommodationBundleRole } from "./admin-accommodation.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Единый список участников мероприятия.
 *
 * Собирается на лету из двух источников и ничего не хранит: оплаченный заказ остаётся
 * единственной правдой о покупателе бота, `event_participants` — о заведённых руками.
 * Складывать их в одну таблицу заманчиво, но тогда пришлось бы держать копию заказа в
 * синхронном состоянии, а расчёт «что везём» — учить не считать одного человека дважды.
 */

export interface ParticipantOrderItemRow {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly buyerName: string | null;
  readonly phone: string | null;
  readonly telegramUsername: string | null;
  readonly paidAt: Date | null;
  readonly totalKopecks: string;
  readonly productTitle: string;
  readonly quantity: number;
  /** Состав тарифа: сколько взрослых и детей даёт одна единица. */
  readonly bundleComposition: readonly AccommodationBundleRole[];
  readonly inventoryUnitsPerItem: number;
  readonly includesSleepingPlace: boolean;
}

export interface ParticipantsEventRow {
  readonly id: string;
  readonly title: string;
}

export interface AdminEventParticipantsRepository {
  findEvent(eventId: string): Promise<ParticipantsEventRow | null>;
  listPaidOrderItems(eventId: string): Promise<readonly ParticipantOrderItemRow[]>;
  listParticipants(eventId: string): Promise<readonly EventParticipant[]>;
  countExcludedOrders(eventId: string): Promise<number>;
  hasPermission(adminId: string, permission: string): Promise<boolean>;
}

export interface ParticipantsClock {
  now(): Date;
}

export class ParticipantsEventNotFoundError extends Error {
  constructor() {
    super("Event was not found");
    this.name = "ParticipantsEventNotFoundError";
  }
}

export class AdminEventParticipantsService {
  constructor(
    private readonly repository: AdminEventParticipantsRepository,
    private readonly clock: ParticipantsClock
  ) {}

  async list(input: {
    readonly actor: AdminRequestActor;
    readonly eventId: string;
  }): Promise<EventParticipantsView> {
    requirePermission(input.actor);
    if (!UUID_PATTERN.test(input.eventId)) {
      throw new Error("Administrator participants request is invalid");
    }

    const event = await this.repository.findEvent(input.eventId);
    if (!event) {
      throw new ParticipantsEventNotFoundError();
    }

    const [items, participants, excludedOrders, canManageParticipants] = await Promise.all([
      this.repository.listPaidOrderItems(input.eventId),
      this.repository.listParticipants(input.eventId),
      this.repository.countExcludedOrders(input.eventId),
      this.repository.hasPermission(input.actor.adminId, "participants.manage")
    ]);

    return buildParticipantsView({
      event,
      items,
      participants,
      excludedOrders,
      canManageParticipants,
      calculatedAt: this.clock.now()
    });
  }
}

export interface ParticipantsViewInput {
  readonly event: ParticipantsEventRow;
  readonly items: readonly ParticipantOrderItemRow[];
  readonly participants: readonly EventParticipant[];
  readonly excludedOrders: number;
  readonly canManageParticipants: boolean;
  readonly calculatedAt: Date;
}

export function buildParticipantsView(
  input: ParticipantsViewInput
): EventParticipantsView {
  const rows = [
    ...buildOrderRows(input.items),
    ...input.participants.map(toManualRow)
  ];

  return {
    eventId: input.event.id,
    eventTitle: input.event.title,
    calculatedAt: input.calculatedAt.toISOString(),
    totals: totalsOf(rows),
    rows,
    excludedOrders: input.excludedOrders,
    canManageParticipants: input.canManageParticipants
  };
}

interface OrderDraft {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly buyerName: string | null;
  readonly phone: string | null;
  readonly telegramUsername: string | null;
  readonly paidAt: Date | null;
  readonly totalKopecks: string;
  readonly titles: string[];
  adults: number;
  children: number;
  berths: number;
}

function buildOrderRows(
  items: readonly ParticipantOrderItemRow[]
): readonly EventParticipantRow[] {
  const orders = new Map<string, OrderDraft>();

  for (const item of items) {
    const draft = orders.get(item.orderId) ?? {
      orderId: item.orderId,
      orderNumber: item.orderNumber,
      buyerName: item.buyerName,
      phone: item.phone,
      telegramUsername: item.telegramUsername,
      paidAt: item.paidAt,
      totalKopecks: item.totalKopecks,
      titles: [],
      adults: 0,
      children: 0,
      berths: 0
    };
    // Один тариф может встретиться в заказе несколькими строками — в подписи он нужен один раз.
    if (!draft.titles.includes(item.productTitle)) {
      draft.titles.push(item.productTitle);
    }
    const berthsPerItem = item.includesSleepingPlace ? item.inventoryUnitsPerItem : 0;
    draft.adults += countRole(item.bundleComposition, "adult") * item.quantity;
    draft.children += countRole(item.bundleComposition, "child") * item.quantity;
    draft.berths += berthsPerItem * item.quantity;
    orders.set(item.orderId, draft);
  }

  return [...orders.values()].map((order) => ({
    key: `order:${order.orderId}`,
    origin: "order" as const,
    orderId: order.orderId,
    orderNumber: order.orderNumber,
    participantId: null,
    channel: "telegram" as const,
    // Имя часто пустое: человек пришёл из Telegram и представился только ником. Номер
    // заказа вместо имени бесполезен, но пустая ячейка хуже — по ней не найти строку.
    displayName: order.buyerName?.trim() || `Заказ ${order.orderNumber}`,
    phone: order.phone,
    telegramUsername: order.telegramUsername,
    ticketTitle: order.titles.join(", "),
    adults: order.adults,
    children: order.children,
    sleepingPlaces: order.berths,
    amountKopecks: order.totalKopecks,
    paidAt: order.paidAt ? order.paidAt.toISOString() : null,
    paymentMethod: null,
    note: "",
    customFields: []
  }));
}

function toManualRow(participant: EventParticipant): EventParticipantRow {
  return {
    key: `manual:${participant.id}`,
    origin: "manual",
    orderId: null,
    orderNumber: null,
    participantId: participant.id,
    channel: participant.source,
    displayName: participant.displayName,
    phone: participant.phone,
    telegramUsername: null,
    ticketTitle: participant.ticketTitle,
    adults: participant.adults,
    children: participant.children,
    sleepingPlaces: participant.sleepingPlaces,
    amountKopecks: participant.amountKopecks,
    paidAt: participant.paidAt,
    paymentMethod: participant.paymentMethod,
    note: participant.note,
    customFields: participant.customFields
  };
}

function totalsOf(rows: readonly EventParticipantRow[]): EventParticipantTotals {
  let adults = 0;
  let children = 0;
  let sleepingPlaces = 0;
  let amount = 0n;
  let fromOrders = 0;
  let fromManual = 0;

  for (const row of rows) {
    adults += row.adults;
    children += row.children;
    sleepingPlaces += row.sleepingPlaces;
    // Суммы приходят строками, потому что копейки за мероприятие в number не помещаются
    // без потери точности при сложении сотен заказов.
    amount += row.amountKopecks ? BigInt(row.amountKopecks) : 0n;
    if (row.origin === "order") {
      fromOrders += row.adults + row.children;
    } else {
      fromManual += row.adults + row.children;
    }
  }

  return {
    people: rows.length,
    guests: adults + children,
    adults,
    children,
    sleepingPlaces,
    amountKopecks: amount.toString(),
    fromOrders,
    fromManual
  };
}

function requirePermission(actor: AdminRequestActor): void {
  if (actor.permission !== "accommodation.read" || !UUID_PATTERN.test(actor.adminId)) {
    throw new Error("Administrator participants permission is invalid");
  }
}
