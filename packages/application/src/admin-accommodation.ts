import type {
  AccommodationFixedPlan,
  AccommodationPartyView,
  AccommodationProductBreakdown,
  AccommodationSummary,
  AccommodationTentCount,
  AdminRequestActor,
  EventParticipant,
  EventParticipantFieldDefinition,
  EventParticipantFieldType,
  EventParticipantSource
} from "@ticket-platform/contracts";
import {
  normalizeContactInput,
  planTents,
  type AccommodationParty
} from "@ticket-platform/domain";
import type { IdGenerator } from "./identity.js";
import type { PhoneNormalizer } from "./phone.js";

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

export interface CreateEventParticipantInput {
  readonly participantId: string;
  readonly eventId: string;
  readonly displayName: string;
  readonly phone: string | null;
  readonly source: EventParticipantSource;
  readonly ticketTitle: string;
  readonly adults: number;
  readonly children: number;
  readonly sleepingPlaces: number;
  readonly note: string;
  readonly outreachContactId: string | null;
  /**
   * Идентификатор про запас: под него заведут человека в общей базе, если по телефону там
   * никого не найдётся. Приходит сверху, а не рождается в слое базы, чтобы идентификаторы
   * оставались предсказуемыми в тестах.
   */
  readonly contactSeedId: string;
  readonly adminId: string;
}

export interface UpdateEventParticipantInput {
  readonly eventId: string;
  readonly participantId: string;
  readonly changes: {
    readonly displayName?: string;
    readonly phone?: string | null;
    readonly source?: EventParticipantSource;
    readonly ticketTitle?: string;
    readonly adults?: number;
    readonly children?: number;
    readonly sleepingPlaces?: number;
    readonly note?: string;
    readonly amountKopecks?: string | null;
    readonly paidAt?: Date | null;
    readonly paymentMethod?: string | null;
  };
}

export interface CreateParticipantFieldInput {
  readonly fieldId: string;
  readonly eventId: string | null;
  readonly fieldKey: string;
  readonly label: string;
  readonly type: EventParticipantFieldType;
  readonly options: readonly string[] | null;
  readonly adminId: string;
}

export interface SetParticipantFieldValueInput {
  readonly eventId: string;
  readonly participantId: string;
  readonly fieldId: string;
  readonly value: string | null;
}

export interface DeleteEventParticipantInput {
  readonly eventId: string;
  readonly participantId: string;
  readonly reason: string;
  readonly adminId: string;
  readonly deletedAt: Date;
}

export interface SetPrivateTentInput {
  readonly eventId: string;
  readonly orderId: string;
  /** `false` снимает пометку: человек передумал и готов к подселению. */
  readonly wanted: boolean;
  readonly note: string;
  readonly adminId: string;
}

export interface ExcludeOrderInput {
  readonly orderId: string;
  readonly reason: string;
  readonly adminId: string;
  readonly excludedAt: Date;
}

export interface AdminAccommodationRepository {
  findEvent(eventId: string): Promise<AccommodationEventRow | null>;
  listPaidOrderItems(eventId: string): Promise<readonly AccommodationOrderItemRow[]>;
  listParticipants(eventId: string): Promise<readonly EventParticipant[]>;
  countExcludedOrders(eventId: string): Promise<number>;
  listGroups(eventId: string): Promise<readonly AccommodationGroupRow[]>;
  listPrivateTentOrderIds(eventId: string): Promise<readonly string[]>;
  setPrivateTent(input: SetPrivateTentInput): Promise<boolean>;
  findLastPlan(eventId: string): Promise<AccommodationFixedPlan | null>;
  hasPermission(adminId: string, permission: string): Promise<boolean>;
  createGroup(input: CreateAccommodationGroupInput): Promise<void>;
  deleteGroup(eventId: string, groupId: string): Promise<void>;
  insertPlan(input: InsertAccommodationPlanInput): Promise<void>;
  createParticipant(input: CreateEventParticipantInput): Promise<void>;
  updateParticipant(input: UpdateEventParticipantInput): Promise<boolean>;
  deleteParticipant(input: DeleteEventParticipantInput): Promise<boolean>;
  listParticipantFields(
    eventId: string
  ): Promise<readonly EventParticipantFieldDefinition[]>;
  createParticipantField(input: CreateParticipantFieldInput): Promise<void>;
  deleteParticipantField(fieldId: string): Promise<boolean>;
  setParticipantFieldValue(input: SetParticipantFieldValueInput): Promise<boolean>;
  excludeOrder(input: ExcludeOrderInput): Promise<boolean>;
  includeOrder(orderId: string): Promise<boolean>;
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

export class EventParticipantNotFoundError extends Error {
  constructor() {
    super("Event participant was not found");
    this.name = "EventParticipantNotFoundError";
  }
}

export class OrderNotFoundError extends Error {
  constructor() {
    super("Order was not found");
    this.name = "OrderNotFoundError";
  }
}

export class AdminAccommodationService {
  constructor(
    private readonly repository: AdminAccommodationRepository,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
    /**
     * Разбор телефона участника. Раньше форма требовала строго «+7…», и набранное человеком
     * «8 999 123-45-67» отлетало четырёхсотой ошибкой — при том, что тот же номер загрузка
     * файла принимала спокойно. Одно правило на оба пути.
     */
    private readonly phoneNormalizer: PhoneNormalizer
  ) {}

  /** Пусто — телефона нет. Не разобрался — говорим об этом сразу, как в остальных формах. */
  private normalizeParticipantPhone(raw: string | null): string | null {
    if (raw === null || raw.trim() === "") {
      return null;
    }
    const { identity, rejections } = normalizeContactInput(
      { phone: raw },
      {
        parsePhone: (candidate) => {
          try {
            return this.phoneNormalizer.normalize(candidate);
          } catch {
            return null;
          }
        }
      }
    );
    if (rejections.some((rejection) => rejection.field === "phone")) {
      throw new Error("Event participant phone is invalid");
    }
    return identity.phoneE164;
  }

  async summary(input: {
    readonly actor: AdminRequestActor;
    readonly eventId: string;
  }): Promise<AccommodationSummary> {
    requirePermission(input.actor, "accommodation.read");
    requireUuid(input.eventId);

    const [canManage, canManageParticipants] = await Promise.all([
      this.repository.hasPermission(input.actor.adminId, "accommodation.manage"),
      this.repository.hasPermission(input.actor.adminId, "participants.manage")
    ]);
    return this.load(input.eventId, canManage, canManageParticipants);
  }

  async addParticipant(input: {
    readonly actor: AdminRequestActor;
    readonly eventId: string;
    readonly participant: {
      readonly displayName: string;
      readonly phone: string | null;
      readonly source: EventParticipantSource;
      readonly ticketTitle: string;
      readonly adults: number;
      readonly children: number;
      readonly sleepingPlaces: number;
      readonly note: string;
      readonly outreachContactId: string | null;
    };
  }): Promise<void> {
    requirePermission(input.actor, "participants.manage");
    requireUuid(input.eventId);

    const { adults, children, sleepingPlaces } = input.participant;
    if (
      !Number.isSafeInteger(adults) || adults < 0
      || !Number.isSafeInteger(children) || children < 0
      || adults + children < 1
      || !Number.isSafeInteger(sleepingPlaces)
      || sleepingPlaces < 0
      || sleepingPlaces > adults + children
    ) {
      throw new Error("Event participant headcount is invalid");
    }
    if (input.participant.displayName.trim().length === 0) {
      throw new Error("Event participant name is invalid");
    }
    if (input.participant.outreachContactId !== null) {
      requireUuid(input.participant.outreachContactId);
    }

    await this.repository.createParticipant({
      participantId: this.idGenerator.newId(),
      contactSeedId: this.idGenerator.newId(),
      eventId: input.eventId,
      adminId: input.actor.adminId,
      ...input.participant,
      phone: this.normalizeParticipantPhone(input.participant.phone),
      displayName: input.participant.displayName.trim()
    });
  }

  async updateParticipant(input: {
    readonly actor: AdminRequestActor;
    readonly eventId: string;
    readonly participantId: string;
    readonly changes: UpdateEventParticipantInput["changes"];
  }): Promise<void> {
    requirePermission(input.actor, "participants.manage");
    requireUuid(input.eventId);
    requireUuid(input.participantId);

    const changes = input.changes;
    if (Object.keys(changes).length === 0) {
      throw new Error("Event participant update is empty");
    }
    if (changes.displayName !== undefined && changes.displayName.trim() === "") {
      throw new Error("Event participant name is invalid");
    }
    // Головы и места правятся по отдельности, поэтому проверяем итог: сначала читаем
    // текущего участника, накладываем правки и только потом сверяем «мест не больше людей».
    if (
      changes.adults !== undefined
      || changes.children !== undefined
      || changes.sleepingPlaces !== undefined
    ) {
      const current = (await this.repository.listParticipants(input.eventId))
        .find((participant) => participant.id === input.participantId);
      if (!current) {
        throw new EventParticipantNotFoundError();
      }
      const adults = changes.adults ?? current.adults;
      const children = changes.children ?? current.children;
      const sleepingPlaces = changes.sleepingPlaces ?? current.sleepingPlaces;
      if (
        !Number.isSafeInteger(adults) || adults < 0
        || !Number.isSafeInteger(children) || children < 0
        || adults + children < 1
        || !Number.isSafeInteger(sleepingPlaces)
        || sleepingPlaces < 0
        || sleepingPlaces > adults + children
      ) {
        throw new Error("Event participant headcount is invalid");
      }
    }
    if (changes.amountKopecks !== undefined && changes.amountKopecks !== null) {
      if (!/^\d{1,15}$/.test(changes.amountKopecks)) {
        throw new Error("Event participant amount is invalid");
      }
    }

    const updated = await this.repository.updateParticipant({
      eventId: input.eventId,
      participantId: input.participantId,
      changes: {
        ...changes,
        // Ключа нет — телефон не трогают. Есть — разбираем тем же правилом, что и при
        // заведении: исправлять номер и получать отказ на «8 999…» было бы странно.
        ...(changes.phone === undefined
          ? {}
          : { phone: this.normalizeParticipantPhone(changes.phone) })
      }
    });
    if (!updated) {
      throw new EventParticipantNotFoundError();
    }
  }

  async addParticipantField(input: {
    readonly actor: AdminRequestActor;
    readonly eventId: string;
    readonly label: string;
    readonly type: EventParticipantFieldType;
    readonly options: readonly string[] | null;
    readonly scope: "event" | "global";
  }): Promise<void> {
    requirePermission(input.actor, "participants.manage");
    requireUuid(input.eventId);

    const label = input.label.trim();
    if (label.length < 1 || label.length > 80) {
      throw new Error("Event participant field label is invalid");
    }
    if (input.type === "select") {
      const options = (input.options ?? [])
        .map((option) => option.trim())
        .filter((option) => option !== "");
      if (options.length === 0 || options.length > 50) {
        throw new Error("Event participant field options are invalid");
      }
    } else if (input.options !== null && input.options.length > 0) {
      throw new Error("Event participant field options are invalid");
    }

    await this.repository.createParticipantField({
      fieldId: this.idGenerator.newId(),
      eventId: input.scope === "global" ? null : input.eventId,
      fieldKey: fieldKeyFor(label, this.idGenerator),
      label,
      type: input.type,
      options: input.type === "select"
        ? (input.options ?? []).map((option) => option.trim()).filter(Boolean)
        : null,
      adminId: input.actor.adminId
    });
  }

  async removeParticipantField(input: {
    readonly actor: AdminRequestActor;
    readonly fieldId: string;
  }): Promise<void> {
    requirePermission(input.actor, "participants.manage");
    requireUuid(input.fieldId);

    const removed = await this.repository.deleteParticipantField(input.fieldId);
    if (!removed) {
      throw new Error("Event participant field was not found");
    }
  }

  async setParticipantFieldValue(input: {
    readonly actor: AdminRequestActor;
    readonly eventId: string;
    readonly participantId: string;
    readonly fieldId: string;
    readonly value: string | null;
  }): Promise<void> {
    requirePermission(input.actor, "participants.manage");
    requireUuid(input.eventId);
    requireUuid(input.participantId);
    requireUuid(input.fieldId);
    if (input.value !== null && input.value.length > 500) {
      throw new Error("Event participant field value is invalid");
    }

    const saved = await this.repository.setParticipantFieldValue({
      eventId: input.eventId,
      participantId: input.participantId,
      fieldId: input.fieldId,
      value: input.value === null || input.value.trim() === ""
        ? null
        : input.value.trim()
    });
    if (!saved) {
      throw new EventParticipantNotFoundError();
    }
  }

  async removeParticipant(input: {
    readonly actor: AdminRequestActor;
    readonly eventId: string;
    readonly participantId: string;
    readonly reason: string;
  }): Promise<void> {
    requirePermission(input.actor, "participants.manage");
    requireUuid(input.eventId);
    requireUuid(input.participantId);
    requireReason(input.reason);

    const removed = await this.repository.deleteParticipant({
      eventId: input.eventId,
      participantId: input.participantId,
      reason: input.reason.trim(),
      adminId: input.actor.adminId,
      deletedAt: this.clock.now()
    });
    if (!removed) {
      throw new EventParticipantNotFoundError();
    }
  }

  /**
   * Помечает заказ тестовым. Ничего не удаляет: заказ, билеты и платёжные записи остаются
   * на месте, но перестают попадать в отчёты и в списки участников.
   */
  async excludeOrder(input: {
    readonly actor: AdminRequestActor;
    readonly orderId: string;
    readonly reason: string;
  }): Promise<void> {
    requirePermission(input.actor, "orders.exclude");
    requireUuid(input.orderId);
    requireReason(input.reason);

    const excluded = await this.repository.excludeOrder({
      orderId: input.orderId,
      reason: input.reason.trim(),
      adminId: input.actor.adminId,
      excludedAt: this.clock.now()
    });
    if (!excluded) {
      throw new OrderNotFoundError();
    }
  }

  async includeOrder(input: {
    readonly actor: AdminRequestActor;
    readonly orderId: string;
  }): Promise<void> {
    requirePermission(input.actor, "orders.exclude");
    requireUuid(input.orderId);

    const included = await this.repository.includeOrder(input.orderId);
    if (!included) {
      throw new OrderNotFoundError();
    }
  }

  /**
   * Собирает сводку без проверки прав — её делают вызывающие методы. Отдельно, потому что
   * фиксация плана уже проверила `accommodation.manage`, а `summary` требует
   * `accommodation.read`: в акторе лежит ровно то право, с которым пришёл запрос.
   */
  private async load(
    eventId: string,
    canManage: boolean,
    canManageParticipants: boolean
  ): Promise<AccommodationSummary> {
    const event = await this.repository.findEvent(eventId);
    if (!event) {
      throw new AccommodationEventNotFoundError();
    }

    const [
      items,
      participants,
      participantFields,
      excludedOrders,
      groups,
      privateTentOrderIds,
      lastPlan
    ] = await Promise.all([
      this.repository.listPaidOrderItems(eventId),
      this.repository.listParticipants(eventId),
      this.repository.listParticipantFields(eventId),
      this.repository.countExcludedOrders(eventId),
      this.repository.listGroups(eventId),
      this.repository.listPrivateTentOrderIds(eventId),
      this.repository.findLastPlan(eventId)
    ]);

    return buildSummary({
      event,
      items,
      participants,
      participantFields,
      excludedOrders,
      groups,
      privateTentOrderIds,
      lastPlan,
      canManage,
      canManageParticipants,
      calculatedAt: this.clock.now()
    });
  }

  /**
   * «Живут одни». Пометка на заказ: компания собирается заново при каждом расчёте, а
   * заказ живёт. Помеченные уходят из списка одиночек и из подсказки про объединение —
   * предлагать подселение тому, кто уже попросил отдельную палатку, незачем.
   */
  async setPrivateTent(input: {
    readonly actor: AdminRequestActor;
    readonly eventId: string;
    readonly orderId: string;
    readonly wanted: boolean;
    readonly note?: string;
  }): Promise<void> {
    requirePermission(input.actor, "accommodation.manage");
    requireUuid(input.eventId);
    requireUuid(input.orderId);

    const saved = await this.repository.setPrivateTent({
      eventId: input.eventId,
      orderId: input.orderId,
      wanted: input.wanted,
      note: (input.note ?? "").trim().slice(0, 500),
      adminId: input.actor.adminId
    });
    if (!saved) {
      throw new OrderNotFoundError();
    }
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

    const [
      items,
      participants,
      participantFields,
      excludedOrders,
      groups,
      privateTentOrderIds
    ] = await Promise.all([
      this.repository.listPaidOrderItems(input.eventId),
      this.repository.listParticipants(input.eventId),
      this.repository.listParticipantFields(input.eventId),
      this.repository.countExcludedOrders(input.eventId),
      this.repository.listGroups(input.eventId),
      this.repository.listPrivateTentOrderIds(input.eventId)
    ]);
    const summary = buildSummary({
      event,
      items,
      participants,
      participantFields,
      excludedOrders,
      groups,
      privateTentOrderIds,
      lastPlan: null,
      canManage: true,
      canManageParticipants: true,
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

    return this.load(input.eventId, true, true);
  }
}

interface SummaryInput {
  readonly event: AccommodationEventRow;
  readonly items: readonly AccommodationOrderItemRow[];
  readonly participants: readonly EventParticipant[];
  readonly participantFields: readonly EventParticipantFieldDefinition[];
  readonly excludedOrders: number;
  readonly groups: readonly AccommodationGroupRow[];
  /** Заказы, для которых уже решено: живут отдельно, о подселении не спрашиваем. */
  readonly privateTentOrderIds: readonly string[];
  readonly lastPlan: AccommodationFixedPlan | null;
  readonly canManage: boolean;
  readonly canManageParticipants: boolean;
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

  // Участник, заведённый руками, — такая же компания, как заказ: он приехал сам по себе и
  // ни с кем не объединён, пока этого не сделали вручную.
  const productsFromParticipants = new Map<string, {
    productId: string;
    title: string;
    ticketsSold: number;
    guests: number;
    adults: number;
    children: number;
    sleepingPlaces: number;
  }>();
  for (const participant of input.participants) {
    const title = participant.ticketTitle.trim() === ""
      ? "Без тарифа"
      : participant.ticketTitle.trim();
    const key = `manual:${title}`;
    const product = productsFromParticipants.get(key) ?? {
      productId: key,
      title,
      ticketsSold: 0,
      guests: 0,
      adults: 0,
      children: 0,
      sleepingPlaces: 0
    };
    product.ticketsSold += 1;
    product.adults += participant.adults;
    product.children += participant.children;
    product.guests += participant.adults + participant.children;
    product.sleepingPlaces += participant.sleepingPlaces;
    productsFromParticipants.set(key, product);
  }

  const { parties, partyMeta } = buildParties(
    [...orders.values()],
    input.groups,
    input.participants,
    new Set(input.privateTentOrderIds)
  );
  const plan = planTents(parties, [...DEFAULT_TENT_CAPACITIES]);

  const partyViews = plan.allocations.map((allocation) =>
    toPartyView(allocation.party, allocation.tents, allocation.emptyBerths, partyMeta)
  );
  const singleKeys = new Set(plan.singles.map((party) => party.key));

  let adults = 0;
  let children = 0;
  let childrenWithoutBerth = 0;
  let guestsFromOrders = 0;
  for (const order of orders.values()) {
    adults += order.adults;
    children += order.children;
    guestsFromOrders += order.adults + order.children;
    // «Ребёнок без места» имеет смысл только там, где кто-то из заказа всё-таки ночует.
    if (order.berths > 0) {
      childrenWithoutBerth += order.childrenWithoutBerth;
    }
  }

  let guestsFromParticipants = 0;
  for (const participant of input.participants) {
    adults += participant.adults;
    children += participant.children;
    guestsFromParticipants += participant.adults + participant.children;
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
    products: [
      ...[...products.values()].map((product) => toProductBreakdown(product, false)),
      ...[...productsFromParticipants.values()]
        .map((product) => toProductBreakdown(product, true))
    ].sort((left, right) =>
      Number(left.manual) - Number(right.manual)
      || right.guests - left.guests
      || left.title.localeCompare(right.title)),
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
    guestsFromOrders,
    guestsFromParticipants,
    excludedOrders: input.excludedOrders,
    participants: input.participants,
    participantFields: input.participantFields,
    canManage: input.canManage,
    canManageParticipants: input.canManageParticipants
  };
}

interface PartyMeta {
  readonly orderIds: readonly string[];
  readonly groupId: string | null;
  readonly note: string;
}

function buildParties(
  orders: readonly OrderTotals[],
  groups: readonly AccommodationGroupRow[],
  participants: readonly EventParticipant[],
  privateTentOrderIds: ReadonlySet<string>
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
      merged: true,
      // Объединённая вручную компания уже не одиночка, спрашивать о подселении нечего.
      privateTent: false
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
      merged: false,
      privateTent: privateTentOrderIds.has(order.orderId)
    });
    partyMeta.set(key, { orderIds: [order.orderId], groupId: null, note: "" });
  }

  for (const participant of participants) {
    const key = `participant:${participant.id}`;
    parties.push({
      key,
      berths: participant.sleepingPlaces,
      title: participant.displayName,
      orderNumbers: [sourceLabel(participant.source)],
      merged: false,
      // У заведённого руками заказа нет, помечать нечего: спальные места ему проставляют
      // руками и там же решают, сколько их.
      privateTent: false
    });
    partyMeta.set(key, { orderIds: [], groupId: null, note: participant.note });
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
    emptyBerths,
    privateTent: party.privateTent
  };
}

function toProductBreakdown(
  product: {
    productId: string;
    title: string;
    ticketsSold: number;
    guests: number;
    adults: number;
    children: number;
    sleepingPlaces: number;
  },
  manual: boolean
): AccommodationProductBreakdown {
  return {
    productId: product.productId,
    title: product.title,
    ticketsSold: product.ticketsSold,
    guests: product.guests,
    adults: product.adults,
    children: product.children,
    sleepingPlaces: product.sleepingPlaces,
    manual
  };
}

export function sourceLabel(source: EventParticipantSource): string {
  switch (source) {
    case "max":
      return "MAX";
    case "site":
      return "Сайт";
    case "direct":
      return "Напрямую";
    default:
      return "Другое";
  }
}

function toTentCount(tent: { capacity: number; count: number }): AccommodationTentCount {
  return { capacity: tent.capacity, count: tent.count };
}

/**
 * Номер заказа в качестве имени бесполезен: он длинный и ни о чём не говорит тому, кто
 * расселяет людей. Сам номер всё равно виден в соседней колонке.
 */
function orderTitle(order: OrderTotals): string {
  const name = order.buyerName?.trim();
  return name === undefined || name === "" ? "Без имени" : name;
}

export function countRole(
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
  permission:
    | "accommodation.read"
    | "accommodation.manage"
    | "participants.manage"
    | "orders.exclude"
): void {
  if (actor.permission !== permission || !UUID_PATTERN.test(actor.adminId)) {
    throw new Error("Administrator accommodation permission is invalid");
  }
}

/**
 * Исключение заказа и удаление участника меняют цифры, по которым потом грузят машину,
 * поэтому причина обязательна — через полгода никто не вспомнит, почему тут минус три места.
 */
function requireReason(reason: string): void {
  const trimmed = reason.trim();
  if (trimmed.length < 3 || trimmed.length > 500) {
    throw new Error("Accommodation change reason is invalid");
  }
}

/**
 * Ключ поля нужен только базе: в интерфейсе человек видит подпись. Русские подписи в
 * `[a-z0-9_]` не переводятся, поэтому берём кусок нового идентификатора — коллизий не будет.
 */
function fieldKeyFor(label: string, idGenerator: IdGenerator): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  const suffix = idGenerator.newId().replace(/-/g, "").slice(0, 8);
  return slug === "" ? `field_${suffix}` : `${slug}_${suffix}`;
}

function requireUuid(value: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new Error("Administrator accommodation request is invalid");
  }
}
