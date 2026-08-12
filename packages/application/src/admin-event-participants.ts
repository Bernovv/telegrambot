import type {
  AdminRequestActor,
  ImportParticipantRow,
  ImportParticipantsResult,
  EventParticipant,
  EventParticipantFieldDefinition,
  EventParticipantFieldValue,
  EventParticipantRow,
  EventParticipantTotals,
  EventParticipantsView,
  EventQuestionnaireProgress
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

/** Ответ бумажной анкеты, привязанный к заказу покупателя бота. */
export interface OrderFieldValueRow {
  readonly orderId: string;
  readonly value: EventParticipantFieldValue;
}

export interface SaveOrderFieldValueInput {
  readonly eventId: string;
  readonly orderId: string;
  readonly fieldId: string;
  readonly value: string | null;
  readonly adminId: string;
}

export interface CreateImportedParticipantInput {
  readonly participantId: string;
  readonly eventId: string;
  readonly name: string;
  readonly phone: string | null;
  readonly telegram: string | null;
  readonly adults: number;
  readonly children: number;
  readonly sleeping: number;
  readonly amountKopecks: string;
  readonly note: string;
  readonly adminId: string;
}

/** Кто уже есть у мероприятия — чтобы не завести человека вторым. */
export interface ExistingPeople {
  readonly buyerPhones: readonly string[];
  readonly buyerHandles: readonly string[];
  readonly manualPhones: readonly string[];
  readonly manualNames: readonly string[];
}

export interface AdminEventParticipantsRepository {
  findEvent(eventId: string): Promise<ParticipantsEventRow | null>;
  listPaidOrderItems(eventId: string): Promise<readonly ParticipantOrderItemRow[]>;
  listParticipants(eventId: string): Promise<readonly EventParticipant[]>;
  listParticipantFields(
    eventId: string
  ): Promise<readonly EventParticipantFieldDefinition[]>;
  listOrderFieldValues(eventId: string): Promise<readonly OrderFieldValueRow[]>;
  countExcludedOrders(eventId: string): Promise<number>;
  hasPermission(adminId: string, permission: string): Promise<boolean>;
  saveOrderFieldValue(input: SaveOrderFieldValueInput): Promise<boolean>;
  saveParticipantFieldValue(input: {
    readonly eventId: string;
    readonly participantId: string;
    readonly fieldId: string;
    readonly value: string | null;
  }): Promise<boolean>;
  loadExistingPeople(eventId: string): Promise<ExistingPeople>;
  /** Пишет весь список одной транзакцией: половина занесённого хуже, чем ничего. */
  createImportedParticipants(
    inputs: readonly CreateImportedParticipantInput[]
  ): Promise<void>;
}

export class ParticipantAnswerTargetNotFoundError extends Error {
  constructor() {
    super("Questionnaire answer target was not found");
    this.name = "ParticipantAnswerTargetNotFoundError";
  }
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

    const [
      items,
      participants,
      fields,
      orderAnswers,
      excludedOrders,
      canManageParticipants
    ] = await Promise.all([
      this.repository.listPaidOrderItems(input.eventId),
      this.repository.listParticipants(input.eventId),
      this.repository.listParticipantFields(input.eventId),
      this.repository.listOrderFieldValues(input.eventId),
      this.repository.countExcludedOrders(input.eventId),
      this.repository.hasPermission(input.actor.adminId, "participants.manage")
    ]);

    return buildParticipantsView({
      event,
      items,
      participants,
      fields,
      orderAnswers,
      excludedOrders,
      canManageParticipants,
      calculatedAt: this.clock.now()
    });
  }

  /**
   * Один ответ бумажной анкеты. Сохраняется по одному полю, а не формой целиком: анкеты
   * вносят стопкой, и потерять полчаса работы из-за оборвавшегося запроса нельзя.
   */
  async saveAnswer(input: {
    readonly actor: AdminRequestActor;
    readonly eventId: string;
    readonly orderId?: string;
    readonly participantId?: string;
    readonly fieldId: string;
    readonly value: string | null;
  }): Promise<void> {
    if (
      input.actor.permission !== "participants.manage"
      || !UUID_PATTERN.test(input.actor.adminId)
    ) {
      throw new Error("Administrator participants permission is invalid");
    }
    if (!UUID_PATTERN.test(input.eventId) || !UUID_PATTERN.test(input.fieldId)) {
      throw new Error("Administrator participants request is invalid");
    }
    if ((input.orderId === undefined) === (input.participantId === undefined)) {
      throw new Error("Administrator participants request is invalid");
    }
    if (input.value !== null && input.value.length > 500) {
      throw new Error("Administrator participants request is invalid");
    }

    const value = input.value === null || input.value.trim() === ""
      ? null
      : input.value.trim();

    let saved: boolean;
    if (input.orderId !== undefined) {
      if (!UUID_PATTERN.test(input.orderId)) {
        throw new Error("Administrator participants request is invalid");
      }
      saved = await this.repository.saveOrderFieldValue({
        eventId: input.eventId,
        orderId: input.orderId,
        fieldId: input.fieldId,
        value,
        adminId: input.actor.adminId
      });
    } else {
      const participantId = input.participantId as string;
      if (!UUID_PATTERN.test(participantId)) {
        throw new Error("Administrator participants request is invalid");
      }
      saved = await this.repository.saveParticipantFieldValue({
        eventId: input.eventId,
        participantId,
        fieldId: input.fieldId,
        value
      });
    }

    if (!saved) {
      throw new ParticipantAnswerTargetNotFoundError();
    }
  }
}

/**
 * Переносит список из таблицы.
 *
 * Задвоение здесь — главная опасность: часть людей купила через бота и уже лежит
 * оплаченными заказами, и завести их ещё и руками значит удвоить гостей, выручку, палатки
 * и порции. Поэтому сверяемся по телефону и нику, а заодно по тем, кого заводили руками
 * раньше — из этого же следует, что повторный запуск ничего не испортит.
 */
export class ImportParticipantsService {
  constructor(
    private readonly repository: AdminEventParticipantsRepository,
    private readonly idGenerator: ImportIdGenerator
  ) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly eventId: string;
    readonly rows: readonly ImportParticipantRow[];
  }): Promise<ImportParticipantsResult> {
    if (
      input.actor.permission !== "participants.manage"
      || !UUID_PATTERN.test(input.actor.adminId)
    ) {
      throw new Error("Administrator participants permission is invalid");
    }
    if (!UUID_PATTERN.test(input.eventId)) {
      throw new Error("Administrator participants request is invalid");
    }
    if (input.rows.length === 0 || input.rows.length > 500) {
      throw new Error("Administrator participants request is invalid");
    }

    const event = await this.repository.findEvent(input.eventId);
    if (!event) {
      throw new ParticipantsEventNotFoundError();
    }

    for (const row of input.rows) {
      requireImportRow(row);
    }

    const existing = await this.repository.loadExistingPeople(input.eventId);
    const buyerPhones = new Set(existing.buyerPhones);
    const buyerHandles = new Set(existing.buyerHandles.map(lower));
    const manualPhones = new Set(existing.manualPhones);
    const manualNames = new Set(existing.manualNames.map(lower));

    const skipped: { name: string; reason: "bot_buyer" | "already_added" }[] = [];
    const toCreate: CreateImportedParticipantInput[] = [];

    for (const row of input.rows) {
      const phone = (row.phone ?? "").trim();
      const handle = lower((row.telegram ?? "").replace(/^@/, ""));
      const name = row.name.trim();

      if ((phone !== "" && buyerPhones.has(phone)) || (handle !== "" && buyerHandles.has(handle))) {
        skipped.push({ name, reason: "bot_buyer" });
        continue;
      }
      if ((phone !== "" && manualPhones.has(phone)) || manualNames.has(lower(name))) {
        skipped.push({ name, reason: "already_added" });
        continue;
      }
      // Дубль внутри самого файла: два одинаковых имени в одной загрузке.
      manualNames.add(lower(name));
      if (phone !== "") {
        manualPhones.add(phone);
      }

      toCreate.push({
        participantId: this.idGenerator.newId(),
        eventId: input.eventId,
        name,
        phone: phone === "" ? null : phone,
        telegram: (row.telegram ?? "").trim() === "" ? null : (row.telegram ?? "").trim(),
        adults: row.adults,
        children: row.children,
        sleeping: row.sleeping,
        amountKopecks: row.amountKopecks,
        note: (row.note ?? "").trim().slice(0, 500),
        adminId: input.actor.adminId
      });
    }

    if (toCreate.length > 0) {
      await this.repository.createImportedParticipants(toCreate);
    }
    return { added: toCreate.length, skipped };
  }
}

export interface ImportIdGenerator {
  newId(): string;
}

function lower(value: string): string {
  return value.trim().toLowerCase();
}

function requireImportRow(row: ImportParticipantRow): void {
  const name = row.name.trim();
  if (name === "" || name.length > 200) {
    throw new Error("Administrator participants request is invalid");
  }
  for (const value of [row.adults, row.children, row.sleeping]) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 100) {
      throw new Error("Administrator participants request is invalid");
    }
  }
  // То же правило, что в базе: мест не может быть больше, чем людей. Ловим здесь, чтобы
  // ответить понятной ошибкой, а не отказом ограничения посреди вставки.
  if (row.sleeping > row.adults + row.children) {
    throw new Error("Administrator participants request is invalid");
  }
  if (!/^\d{1,15}$/.test(row.amountKopecks)) {
    throw new Error("Administrator participants request is invalid");
  }
  if ((row.phone ?? "") !== "" && !/^\+[1-9][0-9]{7,14}$/.test(row.phone ?? "")) {
    throw new Error("Administrator participants request is invalid");
  }
}

export interface ParticipantsViewInput {
  readonly event: ParticipantsEventRow;
  readonly items: readonly ParticipantOrderItemRow[];
  readonly participants: readonly EventParticipant[];
  readonly fields: readonly EventParticipantFieldDefinition[];
  readonly orderAnswers: readonly OrderFieldValueRow[];
  readonly excludedOrders: number;
  readonly canManageParticipants: boolean;
  readonly calculatedAt: Date;
}

export function buildParticipantsView(
  input: ParticipantsViewInput
): EventParticipantsView {
  const rows = [
    ...buildOrderRows(input.items, input.orderAnswers),
    ...input.participants.map(toManualRow)
  ];

  return {
    eventId: input.event.id,
    eventTitle: input.event.title,
    calculatedAt: input.calculatedAt.toISOString(),
    totals: totalsOf(rows),
    rows,
    excludedOrders: input.excludedOrders,
    fields: input.fields,
    questionnaire: progressOf(rows),
    canManageParticipants: input.canManageParticipants
  };
}

/**
 * Анкета считается внесённой, если у человека есть хотя бы один непустой ответ. Отдельного
 * признака «сдал бумагу, но ещё не внесли» нет намеренно: он потребовал бы ещё одного
 * действия руками на каждого, а на вопрос «кто заполнил» отвечают сами ответы.
 */
function progressOf(
  rows: readonly EventParticipantRow[]
): EventQuestionnaireProgress {
  let answered = 0;
  for (const row of rows) {
    if (row.customFields.some((field) => field.value !== null && field.value !== "")) {
      answered += 1;
    }
  }
  return { people: rows.length, answered };
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
  items: readonly ParticipantOrderItemRow[],
  answers: readonly OrderFieldValueRow[]
): readonly EventParticipantRow[] {
  const orders = new Map<string, OrderDraft>();
  const answersByOrder = new Map<string, EventParticipantFieldValue[]>();
  for (const answer of answers) {
    const list = answersByOrder.get(answer.orderId) ?? [];
    list.push(answer.value);
    answersByOrder.set(answer.orderId, list);
  }

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
    customFields: answersByOrder.get(order.orderId) ?? []
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
