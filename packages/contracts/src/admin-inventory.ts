/**
 * Склад компании и потребность на мероприятие.
 *
 * Склад общий: вещи живут в компании, а к мероприятию привязывается только потребность.
 * Только так работает вопрос «что уже куплено в прошлые разы, а что надо купить».
 *
 * Количества строками, а не числами: у нас есть дробные единицы (метры ткани, килограммы),
 * и складывать их плавающей точкой означает получить 2.9999999 вместо трёх.
 */

export const INVENTORY_CONDITIONS = ["new", "good", "worn", "broken"] as const;

export type InventoryCondition = typeof INVENTORY_CONDITIONS[number];

/** Откуда берём: со склада, покупаем или арендуем. */
export const INVENTORY_SOURCES = ["stock", "buy", "rent"] as const;

export type InventorySource = typeof INVENTORY_SOURCES[number];

/** Путь позиции: нужно → заказано → готово → загружено → вернулось. */
export const INVENTORY_NEED_STATUSES = [
  "needed",
  "ordered",
  "ready",
  "loaded",
  "returned"
] as const;

export type InventoryNeedStatus = typeof INVENTORY_NEED_STATUSES[number];

export const INVENTORY_MOVEMENT_KINDS = [
  "purchase",
  "loaded",
  "returned",
  "written_off",
  "audit"
] as const;

export type InventoryMovementKind = typeof INVENTORY_MOVEMENT_KINDS[number];

export interface InventoryComponent {
  readonly itemId: string;
  readonly title: string;
  readonly unit: string;
  readonly quantityPerParent: string;
}

export interface InventoryItem {
  readonly id: string;
  readonly title: string;
  readonly categoryCode: string;
  readonly categoryLabel: string;
  readonly unit: string;
  readonly quantityOwned: string;
  readonly storageLocation: string;
  readonly condition: InventoryCondition;
  readonly note: string;
  readonly isArchived: boolean;
  /** Из чего состоит комплект: палатка тянет спальники и пенки по числу мест. */
  readonly components: readonly InventoryComponent[];
}

export interface EventInventoryNeed {
  readonly id: string;
  readonly itemId: string | null;
  readonly title: string;
  readonly unit: string;
  readonly quantityNeeded: string;
  readonly source: InventorySource;
  readonly status: InventoryNeedStatus;
  readonly note: string;
  /** Сколько этого лежит на складе прямо сейчас; пусто, если позиции там ещё нет. */
  readonly quantityOwned: string | null;
  /**
   * Что потянет за собой комплект. Считается на лету от количества: заказали три
   * трёхместные — девять спальников и девять пенок.
   */
  readonly unfolds: readonly InventoryComponent[];
}

export interface EventInventoryTotals {
  readonly needCount: number;
  readonly fromStock: number;
  readonly toBuy: number;
  readonly toRent: number;
  readonly loaded: number;
  /** Позиции, которых на складе не хватает, а брать собирались оттуда. */
  readonly shortCount: number;
}

export interface EventInventoryView {
  readonly eventId: string;
  readonly eventTitle: string;
  readonly calculatedAt: string;
  readonly totals: EventInventoryTotals;
  readonly needs: readonly EventInventoryNeed[];
  readonly items: readonly InventoryItem[];
  readonly canManage: boolean;
}

export interface CreateInventoryItemRequest {
  readonly title: string;
  readonly categoryCode: string;
  readonly unit?: string;
  readonly quantityOwned?: string;
  readonly storageLocation?: string;
  readonly condition?: InventoryCondition;
  readonly note?: string;
}

export interface SetInventoryComponentRequest {
  readonly parentItemId: string;
  readonly childItemId: string;
  /** Ноль убирает составляющую из комплекта. */
  readonly quantityPerParent: string;
}

export interface CreateEventInventoryNeedRequest {
  readonly itemId?: string;
  readonly title?: string;
  readonly quantityNeeded: string;
  readonly source: InventorySource;
  readonly note?: string;
}

export interface UpdateEventInventoryNeedRequest {
  readonly needId: string;
  readonly quantityNeeded?: string;
  readonly source?: InventorySource;
  readonly status?: InventoryNeedStatus;
  readonly note?: string;
}

export interface RecordInventoryMovementRequest {
  readonly itemId: string;
  readonly kind: InventoryMovementKind;
  readonly quantityDelta: string;
  readonly note?: string;
}
