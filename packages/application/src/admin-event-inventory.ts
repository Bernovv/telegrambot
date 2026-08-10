import type {
  AdminRequestActor,
  EventInventoryNeed,
  EventInventoryTotals,
  EventInventoryView,
  InventoryComponent,
  InventoryCondition,
  InventoryItem,
  InventoryMovementKind,
  InventoryNeedStatus,
  InventorySource
} from "@ticket-platform/contracts";
import type { IdGenerator } from "./identity.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Количества строками: дробные единицы есть, а плавающая точка их не складывает точно. */
const QUANTITY_PATTERN = /^\d{1,6}(?:\.\d{1,3})?$/;
const SIGNED_QUANTITY_PATTERN = /^-?\d{1,6}(?:\.\d{1,3})?$/;

/**
 * Склад компании и потребность на мероприятие.
 *
 * Склад общий, к мероприятию привязывается только потребность — иначе вопрос «что уже
 * куплено в прошлые разы» не имеет ответа. Комплект разворачивается на лету: три
 * трёхместные палатки означают девять спальников и девять пенок, и хранить это отдельной
 * строкой не нужно, она разъехалась бы с составом комплекта.
 */

export interface InventoryEventRow {
  readonly id: string;
  readonly title: string;
}

export interface CreateInventoryItemInput {
  readonly itemId: string;
  readonly title: string;
  readonly categoryCode: string;
  readonly unit: string;
  readonly quantityOwned: string;
  readonly storageLocation: string;
  readonly condition: InventoryCondition;
  readonly note: string;
  readonly adminId: string;
}

export interface SetInventoryComponentInput {
  readonly parentItemId: string;
  readonly childItemId: string;
  readonly quantityPerParent: string;
}

export interface CreateInventoryNeedInput {
  readonly needId: string;
  readonly eventId: string;
  readonly itemId: string | null;
  readonly title: string;
  readonly quantityNeeded: string;
  readonly source: InventorySource;
  readonly note: string;
  readonly adminId: string;
}

export interface UpdateInventoryNeedInput {
  readonly eventId: string;
  readonly needId: string;
  readonly changes: {
    readonly quantityNeeded?: string;
    readonly source?: InventorySource;
    readonly status?: InventoryNeedStatus;
    readonly note?: string;
  };
}

export interface RecordMovementInput {
  readonly movementId: string;
  readonly itemId: string;
  readonly eventId: string | null;
  readonly kind: InventoryMovementKind;
  readonly quantityDelta: string;
  readonly note: string;
  readonly adminId: string;
}

export interface AdminEventInventoryRepository {
  findEvent(eventId: string): Promise<InventoryEventRow | null>;
  listItems(): Promise<readonly InventoryItem[]>;
  listNeeds(eventId: string): Promise<readonly StoredInventoryNeed[]>;
  hasPermission(adminId: string, permission: string): Promise<boolean>;
  createItem(input: CreateInventoryItemInput): Promise<boolean>;
  setComponent(input: SetInventoryComponentInput): Promise<boolean>;
  createNeed(input: CreateInventoryNeedInput): Promise<void>;
  updateNeed(input: UpdateInventoryNeedInput): Promise<boolean>;
  recordMovement(input: RecordMovementInput): Promise<boolean>;
}

/** Потребность как она лежит в базе — без развёрнутого комплекта и остатка склада. */
export interface StoredInventoryNeed {
  readonly id: string;
  readonly itemId: string | null;
  readonly title: string;
  readonly quantityNeeded: string;
  readonly source: InventorySource;
  readonly status: InventoryNeedStatus;
  readonly note: string;
}

export interface InventoryClock {
  now(): Date;
}

export class InventoryEventNotFoundError extends Error {
  constructor() {
    super("Event was not found");
    this.name = "InventoryEventNotFoundError";
  }
}

export class InventoryItemNotFoundError extends Error {
  constructor() {
    super("Inventory item was not found");
    this.name = "InventoryItemNotFoundError";
  }
}

export class InventoryNeedNotFoundError extends Error {
  constructor() {
    super("Inventory need was not found");
    this.name = "InventoryNeedNotFoundError";
  }
}

export class InventoryItemAlreadyExistsError extends Error {
  constructor() {
    super("Inventory item with this title already exists");
    this.name = "InventoryItemAlreadyExistsError";
  }
}

export class AdminEventInventoryService {
  constructor(
    private readonly repository: AdminEventInventoryRepository,
    private readonly clock: InventoryClock,
    private readonly idGenerator: IdGenerator
  ) {}

  async summary(input: {
    readonly actor: AdminRequestActor;
    readonly eventId: string;
  }): Promise<EventInventoryView> {
    requirePermission(input.actor, "inventory.read");
    requireUuid(input.eventId);

    const event = await this.repository.findEvent(input.eventId);
    if (!event) {
      throw new InventoryEventNotFoundError();
    }

    const [items, needs, canManage] = await Promise.all([
      this.repository.listItems(),
      this.repository.listNeeds(input.eventId),
      this.repository.hasPermission(input.actor.adminId, "inventory.manage")
    ]);

    return buildInventoryView({
      event,
      items,
      needs,
      canManage,
      calculatedAt: this.clock.now()
    });
  }

  async addItem(input: {
    readonly actor: AdminRequestActor;
    readonly title: string;
    readonly categoryCode: string;
    readonly unit?: string;
    readonly quantityOwned?: string;
    readonly storageLocation?: string;
    readonly condition?: InventoryCondition;
    readonly note?: string;
  }): Promise<void> {
    requirePermission(input.actor, "inventory.manage");

    const title = input.title.trim();
    if (title.length < 1 || title.length > 200) {
      throw new Error("Inventory request is invalid");
    }
    const quantity = input.quantityOwned ?? "0";
    if (!/^\d{1,6}(?:\.\d{1,3})?$/.test(quantity)) {
      throw new Error("Inventory request is invalid");
    }

    const created = await this.repository.createItem({
      itemId: this.idGenerator.newId(),
      title,
      categoryCode: input.categoryCode,
      unit: (input.unit ?? "шт").trim() || "шт",
      quantityOwned: quantity,
      storageLocation: (input.storageLocation ?? "").trim().slice(0, 200),
      condition: input.condition ?? "good",
      note: (input.note ?? "").trim().slice(0, 1000),
      adminId: input.actor.adminId
    });
    if (!created) {
      throw new InventoryItemAlreadyExistsError();
    }
  }

  /**
   * Состав комплекта. Ноль убирает составляющую — так «палатка больше не приезжает с
   * пенками» выражается тем же действием, что и её добавление.
   */
  async setComponent(input: {
    readonly actor: AdminRequestActor;
    readonly parentItemId: string;
    readonly childItemId: string;
    readonly quantityPerParent: string;
  }): Promise<void> {
    requirePermission(input.actor, "inventory.manage");
    requireUuid(input.parentItemId);
    requireUuid(input.childItemId);
    if (input.parentItemId === input.childItemId) {
      throw new Error("Inventory request is invalid");
    }
    if (!QUANTITY_PATTERN.test(input.quantityPerParent)) {
      throw new Error("Inventory request is invalid");
    }

    const saved = await this.repository.setComponent({
      parentItemId: input.parentItemId,
      childItemId: input.childItemId,
      quantityPerParent: input.quantityPerParent
    });
    if (!saved) {
      throw new InventoryItemNotFoundError();
    }
  }

  async addNeed(input: {
    readonly actor: AdminRequestActor;
    readonly eventId: string;
    readonly itemId?: string;
    readonly title?: string;
    readonly quantityNeeded: string;
    readonly source: InventorySource;
    readonly note?: string;
  }): Promise<void> {
    requirePermission(input.actor, "inventory.manage");
    requireUuid(input.eventId);
    if (!QUANTITY_PATTERN.test(input.quantityNeeded) || Number(input.quantityNeeded) <= 0) {
      throw new Error("Inventory request is invalid");
    }

    const title = (input.title ?? "").trim();
    // Либо позиция со склада, либо название того, чего там ещё нет: без одного из двух
    // строка в списке погрузки была бы безымянной.
    if (input.itemId === undefined && title === "") {
      throw new Error("Inventory request is invalid");
    }
    if (input.itemId !== undefined) {
      requireUuid(input.itemId);
    }

    const event = await this.repository.findEvent(input.eventId);
    if (!event) {
      throw new InventoryEventNotFoundError();
    }

    await this.repository.createNeed({
      needId: this.idGenerator.newId(),
      eventId: input.eventId,
      itemId: input.itemId ?? null,
      title: title.slice(0, 200),
      quantityNeeded: input.quantityNeeded,
      source: input.source,
      note: (input.note ?? "").trim().slice(0, 500),
      adminId: input.actor.adminId
    });
  }

  async updateNeed(input: {
    readonly actor: AdminRequestActor;
    readonly eventId: string;
    readonly needId: string;
    readonly changes: UpdateInventoryNeedInput["changes"];
  }): Promise<void> {
    requirePermission(input.actor, "inventory.manage");
    requireUuid(input.eventId);
    requireUuid(input.needId);

    if (input.changes.quantityNeeded !== undefined) {
      if (
        !QUANTITY_PATTERN.test(input.changes.quantityNeeded)
        || Number(input.changes.quantityNeeded) <= 0
      ) {
        throw new Error("Inventory request is invalid");
      }
    }

    const saved = await this.repository.updateNeed({
      eventId: input.eventId,
      needId: input.needId,
      changes: input.changes
    });
    if (!saved) {
      throw new InventoryNeedNotFoundError();
    }
  }

  /**
   * Движение по складу. Только добавляется: пропавшая палатка обязана остаться в истории
   * списанием, а не тихим уменьшением числа.
   */
  async recordMovement(input: {
    readonly actor: AdminRequestActor;
    readonly eventId: string | null;
    readonly itemId: string;
    readonly kind: InventoryMovementKind;
    readonly quantityDelta: string;
    readonly note?: string;
  }): Promise<void> {
    requirePermission(input.actor, "inventory.manage");
    requireUuid(input.itemId);
    if (input.eventId !== null) {
      requireUuid(input.eventId);
    }
    if (
      !SIGNED_QUANTITY_PATTERN.test(input.quantityDelta)
      || Number(input.quantityDelta) === 0
    ) {
      throw new Error("Inventory request is invalid");
    }

    const saved = await this.repository.recordMovement({
      movementId: this.idGenerator.newId(),
      itemId: input.itemId,
      eventId: input.eventId,
      kind: input.kind,
      quantityDelta: input.quantityDelta,
      note: (input.note ?? "").trim().slice(0, 500),
      adminId: input.actor.adminId
    });
    if (!saved) {
      throw new InventoryItemNotFoundError();
    }
  }
}

export interface InventoryViewInput {
  readonly event: InventoryEventRow;
  readonly items: readonly InventoryItem[];
  readonly needs: readonly StoredInventoryNeed[];
  readonly canManage: boolean;
  readonly calculatedAt: Date;
}

export function buildInventoryView(input: InventoryViewInput): EventInventoryView {
  const itemsById = new Map(input.items.map((item) => [item.id, item]));

  const needs: EventInventoryNeed[] = input.needs.map((need) => {
    const item = need.itemId === null ? null : itemsById.get(need.itemId) ?? null;
    return {
      id: need.id,
      itemId: need.itemId,
      // Название позиции со склада берём из склада: переименовали палатку — переименовалась
      // и строка погрузки, а не осталась старой копией.
      title: item?.title ?? need.title,
      unit: item?.unit ?? "шт",
      quantityNeeded: need.quantityNeeded,
      source: need.source,
      status: need.status,
      note: need.note,
      quantityOwned: item?.quantityOwned ?? null,
      unfolds: item ? unfoldKit(item, need.quantityNeeded) : []
    };
  });

  return {
    eventId: input.event.id,
    eventTitle: input.event.title,
    calculatedAt: input.calculatedAt.toISOString(),
    totals: totalsOf(needs),
    needs,
    items: input.items,
    canManage: input.canManage
  };
}

/**
 * Разворачивает комплект: три трёхместные палатки — девять спальников и девять пенок.
 * Считается на лету, а не хранится строкой: иначе состав комплекта и список погрузки
 * разъехались бы при первой же правке комплекта.
 */
function unfoldKit(
  item: InventoryItem,
  quantityNeeded: string
): readonly InventoryComponent[] {
  const multiplier = Number(quantityNeeded);
  return item.components.map((component) => ({
    itemId: component.itemId,
    title: component.title,
    unit: component.unit,
    quantityPerParent: formatQuantity(
      Number(component.quantityPerParent) * multiplier
    )
  }));
}

/** Дробные единицы есть, но хвост из нулей в списке погрузки читать невозможно. */
function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "");
}

function totalsOf(needs: readonly EventInventoryNeed[]): EventInventoryTotals {
  let fromStock = 0;
  let toBuy = 0;
  let toRent = 0;
  let loaded = 0;
  let shortCount = 0;

  for (const need of needs) {
    if (need.source === "stock") {
      fromStock += 1;
      // Взять со склада больше, чем там лежит, нельзя — это надо увидеть до погрузки,
      // а не у машины.
      if (need.quantityOwned !== null
        && Number(need.quantityOwned) < Number(need.quantityNeeded)) {
        shortCount += 1;
      }
    } else if (need.source === "buy") {
      toBuy += 1;
    } else {
      toRent += 1;
    }
    if (need.status === "loaded" || need.status === "returned") {
      loaded += 1;
    }
  }

  return {
    needCount: needs.length,
    fromStock,
    toBuy,
    toRent,
    loaded,
    shortCount
  };
}

function requirePermission(
  actor: AdminRequestActor,
  permission: "inventory.read" | "inventory.manage"
): void {
  if (actor.permission !== permission || !UUID_PATTERN.test(actor.adminId)) {
    throw new Error("Administrator inventory permission is invalid");
  }
}

function requireUuid(value: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new Error("Inventory request is invalid");
  }
}
