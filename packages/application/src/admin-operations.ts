import type { AdminRequestActor } from "@ticket-platform/contracts";

export type AdminOrderStatus =
  | "draft"
  | "awaiting_offer"
  | "awaiting_payment"
  | "payment_processing"
  | "paid"
  | "cancelled"
  | "expired"
  | "partially_refunded"
  | "refunded";

export interface AdminPageCursor {
  readonly occurredAt: Date;
  readonly id: string;
}

export interface AdminUserSummary {
  readonly id: string;
  readonly displayName: string | null;
  readonly telegramUsername: string | null;
  readonly phoneMasked: string | null;
  readonly phoneStatus: string;
  readonly isBlocked: boolean;
  readonly registeredAt: string;
  readonly lastSeenAt: string | null;
  readonly orderCount: number;
  readonly paidOrderCount: number;
  readonly walletAvailableKopecks: string;
  readonly walletHeldKopecks: string;
}

export interface AdminOrderSummary {
  readonly id: string;
  readonly number: string;
  readonly status: AdminOrderStatus;
  readonly userId: string;
  readonly userDisplayName: string | null;
  readonly eventId: string;
  readonly eventTitle: string;
  readonly totalKopecks: string;
  readonly walletAppliedKopecks: string;
  readonly externalDueKopecks: string;
  readonly currency: string;
  readonly ticketCount: number;
  readonly createdAt: string;
  readonly paidAt: string | null;
}

export interface CursorPage<TItem> {
  readonly items: readonly TItem[];
  readonly nextCursor: string | null;
}

export interface AdminUserDetail extends AdminUserSummary {
  readonly identities: readonly {
    readonly channel: string;
    readonly externalUserId: string;
    readonly username: string | null;
    readonly firstSeenAt: string;
    readonly lastSeenAt: string;
    readonly isBotBlocked: boolean;
  }[];
  readonly contacts: readonly {
    readonly type: string;
    readonly valueMasked: string;
    readonly verificationStatus: string;
    readonly isPrimary: boolean;
  }[];
  readonly walletAccounts: readonly {
    readonly currency: string;
    readonly availableKopecks: string;
    readonly heldKopecks: string;
    readonly status: string;
    readonly version: string;
  }[];
  readonly recentOrders: readonly AdminOrderSummary[];
}

export interface AdminOrderDetail extends AdminOrderSummary {
  readonly expiresAt: string;
  readonly source: string;
  readonly lockVersion: number;
  readonly items: readonly {
    readonly id: string;
    readonly title: string;
    readonly quantity: number;
    readonly unitPriceKopecks: string;
    readonly lineTotalKopecks: string;
  }[];
  readonly paymentAttempts: readonly {
    readonly id: string;
    readonly provider: string;
    readonly status: string;
    readonly amountKopecks: string;
    readonly currency: string;
    readonly providerStatus: string | null;
    readonly createdAt: string;
    readonly confirmedAt: string | null;
  }[];
  readonly tickets: readonly {
    readonly id: string;
    readonly number: string;
    readonly status: string;
    readonly issuedAt: string;
    readonly checkedInAt: string | null;
    readonly revokedAt: string | null;
  }[];
  readonly history: readonly {
    readonly fromStatus: string | null;
    readonly toStatus: string;
    readonly reason: string;
    readonly actorType: string;
    readonly occurredAt: string;
  }[];
}

export interface AdminOperationsRepository {
  listUsers(input: {
    readonly search: string | null;
    readonly blocked: boolean | null;
    readonly cursor: AdminPageCursor | null;
    readonly limit: number;
  }): Promise<readonly AdminUserSummary[]>;
  getUser(userId: string): Promise<AdminUserDetail | null>;
  listOrders(input: {
    readonly search: string | null;
    readonly status: AdminOrderStatus | null;
    readonly userId: string | null;
    readonly eventId: string | null;
    readonly cursor: AdminPageCursor | null;
    readonly limit: number;
  }): Promise<readonly AdminOrderSummary[]>;
  getOrder(orderId: string): Promise<AdminOrderDetail | null>;
}

export class ListAdminUsersService {
  constructor(private readonly repository: AdminOperationsRepository) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly search?: string;
    readonly blocked?: boolean;
    readonly cursor?: string;
    readonly limit?: number;
  }): Promise<CursorPage<AdminUserSummary>> {
    requirePermission(input.actor, "users.read");
    const limit = parseLimit(input.limit);
    const rows = await this.repository.listUsers({
      search: parseSearch(input.search),
      blocked: input.blocked ?? null,
      cursor: decodeCursor(input.cursor),
      limit: limit + 1
    });
    return page(rows, limit, (item) => ({
      occurredAt: new Date(item.registeredAt),
      id: item.id
    }));
  }
}

export class GetAdminUserService {
  constructor(private readonly repository: AdminOperationsRepository) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly userId: string;
  }): Promise<AdminUserDetail | null> {
    requirePermission(input.actor, "users.read");
    requireUuid(input.userId, "Administrator user lookup is invalid");
    return this.repository.getUser(input.userId);
  }
}

export class ListAdminOrdersService {
  constructor(private readonly repository: AdminOperationsRepository) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly search?: string;
    readonly status?: string;
    readonly userId?: string;
    readonly eventId?: string;
    readonly cursor?: string;
    readonly limit?: number;
  }): Promise<CursorPage<AdminOrderSummary>> {
    requirePermission(input.actor, "orders.read");
    const limit = parseLimit(input.limit);
    const rows = await this.repository.listOrders({
      search: parseSearch(input.search),
      status: parseOrderStatus(input.status),
      userId: parseOptionalUuid(input.userId),
      eventId: parseOptionalUuid(input.eventId),
      cursor: decodeCursor(input.cursor),
      limit: limit + 1
    });
    return page(rows, limit, (item) => ({
      occurredAt: new Date(item.createdAt),
      id: item.id
    }));
  }
}

export class GetAdminOrderService {
  constructor(private readonly repository: AdminOperationsRepository) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly orderId: string;
  }): Promise<AdminOrderDetail | null> {
    requirePermission(input.actor, "orders.read");
    requireUuid(input.orderId, "Administrator order lookup is invalid");
    return this.repository.getOrder(input.orderId);
  }
}

function page<TItem>(
  rows: readonly TItem[],
  limit: number,
  cursorFor: (item: TItem) => AdminPageCursor
): CursorPage<TItem> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last
      ? encodeCursor(cursorFor(last))
      : null
  };
}

function encodeCursor(cursor: AdminPageCursor): string {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      at: cursor.occurredAt.toISOString(),
      id: cursor.id
    }),
    "utf8"
  ).toString("base64url");
}

function decodeCursor(value: string | undefined): AdminPageCursor | null {
  if (!value) {
    return null;
  }
  if (!/^[A-Za-z0-9_-]{20,300}$/.test(value)) {
    throw new Error("Administrator page cursor is invalid");
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8")
    ) as { readonly v?: unknown; readonly at?: unknown; readonly id?: unknown };
    const occurredAt = new Date(String(parsed.at));
    if (
      parsed.v !== 1
      || typeof parsed.at !== "string"
      || typeof parsed.id !== "string"
      || Number.isNaN(occurredAt.getTime())
    ) {
      throw new Error("invalid");
    }
    requireUuid(parsed.id, "invalid");
    return { occurredAt, id: parsed.id };
  } catch {
    throw new Error("Administrator page cursor is invalid");
  }
}

function parseLimit(value: number | undefined): number {
  const limit = value ?? 25;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Administrator page limit is invalid");
  }
  return limit;
}

function parseSearch(value: string | undefined): string | null {
  if (value === undefined || value.trim() === "") {
    return null;
  }
  const search = value.trim();
  if (search.length < 2 || search.length > 100) {
    throw new Error("Administrator search is invalid");
  }
  return search;
}

function parseOrderStatus(value: string | undefined): AdminOrderStatus | null {
  if (value === undefined || value === "") {
    return null;
  }
  if (!ORDER_STATUSES.includes(value as AdminOrderStatus)) {
    throw new Error("Administrator order status is invalid");
  }
  return value as AdminOrderStatus;
}

function parseOptionalUuid(value: string | undefined): string | null {
  if (value === undefined || value === "") {
    return null;
  }
  requireUuid(value, "Administrator UUID filter is invalid");
  return value;
}

function requirePermission(
  actor: AdminRequestActor,
  permission: "users.read" | "orders.read"
): void {
  if (actor.permission !== permission || !UUID_PATTERN.test(actor.adminId)) {
    throw new Error("Administrator read permission is invalid");
  }
}

function requireUuid(value: string, message: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new Error(message);
  }
}

const ORDER_STATUSES: readonly AdminOrderStatus[] = [
  "draft",
  "awaiting_offer",
  "awaiting_payment",
  "payment_processing",
  "paid",
  "cancelled",
  "expired",
  "partially_refunded",
  "refunded"
];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
