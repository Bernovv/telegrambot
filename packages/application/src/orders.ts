import { createHash } from "node:crypto";
import type {
  CreateOrderCommand,
  OrderChannel,
  CreateOrderResult,
  WalletApplicationCommand
} from "@ticket-platform/contracts";
import {
  calculatePrice,
  type DomainEvent,
  type MoneyKopecks,
  type PricingRule,
  type PricingSnapshot
} from "@ticket-platform/domain";
import type {
  IdGenerator,
  OutboxWriter,
  UnitOfWork
} from "./identity.js";

export interface OrderSalesEvent {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly timezone: string;
  readonly startsAt: Date;
  readonly endsAt: Date | null;
  readonly salesStartsAt: Date | null;
  readonly salesEndsAt: Date | null;
  readonly status: "draft" | "published" | "sales_paused" | "sold_out" | "finished" | "archived";
  readonly capacity: number;
  readonly phoneRequiredForPurchase: boolean;
  readonly offerRequired: boolean;
  readonly activeOfferVersionId: string | null;
  readonly activeOfferPublicUrl: string | null;
  readonly reservationTtlMinutes: number;
}

export interface OrderSalesProduct {
  readonly id: string;
  readonly code: string;
  readonly productType:
    | "adult_standard"
    | "adult_vip"
    | "child"
    | "family_standard"
    | "family_vip"
    | "custom";
  readonly title: string;
  readonly currency: string;
  readonly bundleComposition: readonly Readonly<Record<string, unknown>>[];
  readonly inventoryUnitsPerItem: number;
  readonly capacity: number | null;
  readonly maximumQuantityPerOrder: number;
  readonly isActive: boolean;
  readonly pricingRules: readonly PricingRule[];
}

export interface OrderSalesContext {
  readonly event: OrderSalesEvent;
  readonly userPhoneStatus: "unknown" | "imported" | "verified" | "rejected";
  readonly products: readonly OrderSalesProduct[];
  readonly walletAvailable: MoneyKopecks;
  readonly reservedEventInventoryUnits: number;
  readonly reservedProductInventoryUnits: Readonly<Record<string, number>>;
}

export interface PersistOrderItemInput {
  readonly id: string;
  readonly productId: string;
  readonly productSnapshot: Readonly<Record<string, unknown>>;
  readonly quantity: number;
  readonly inventoryUnits: number;
  readonly unitPrice: MoneyKopecks;
  readonly lineTotal: MoneyKopecks;
  readonly pricingRuleId: string;
  readonly pricingSnapshot: PricingSnapshot;
}

export interface OrderPricingSnapshot {
  readonly schemaVersion: 1;
  readonly lines: readonly PricingSnapshot[];
}

export interface PersistOrderInput {
  readonly id: string;
  readonly number: string;
  readonly publicTokenHash: string;
  readonly creationIdempotencyKey: string;
  readonly creationRequestHash: string;
  readonly userId: string;
  readonly eventId: string;
  readonly status: "awaiting_offer" | "awaiting_payment";
  readonly currency: string;
  readonly subtotal: MoneyKopecks;
  readonly total: MoneyKopecks;
  readonly walletApplied: MoneyKopecks;
  readonly externalDue: MoneyKopecks;
  readonly eventSnapshot: Readonly<Record<string, unknown>>;
  readonly pricingSnapshot: OrderPricingSnapshot;
  readonly offerVersionId: string | null;
  readonly offerPublicUrl: string | null;
  readonly expiresAt: Date;
  readonly source: string;
  readonly channel: OrderChannel;
  readonly createdAt: Date;
  readonly items: readonly PersistOrderItemInput[];
}

export interface PersistedOrder {
  readonly id: string;
  readonly number: string;
  readonly status: "awaiting_offer" | "awaiting_payment";
  readonly currency: string;
  readonly total: MoneyKopecks;
  readonly walletApplied: MoneyKopecks;
  readonly externalDue: MoneyKopecks;
  readonly expiresAt: Date;
  readonly creationRequestHash: string;
  readonly offerPublicUrl: string | null;
}

export interface PersistOrderResult {
  readonly created: boolean;
  readonly order: PersistedOrder;
}

export interface OrderSalesRepository {
  findByIdempotencyKey(idempotencyKey: string): Promise<PersistedOrder | null>;
  lockAndLoadSalesContext(
    userId: string,
    eventId: string,
    currency: string,
    at: Date
  ): Promise<OrderSalesContext>;
  persistOrder(input: PersistOrderInput): Promise<PersistOrderResult>;
}

export interface OrderReferenceGenerator {
  orderNumber(orderId: string, createdAt: Date): string;
  publicToken(orderId: string): { readonly token: string; readonly sha256: string };
}

export class CreateOrderService {
  constructor(
    private readonly repository: OrderSalesRepository,
    private readonly outboxWriter: OutboxWriter,
    private readonly unitOfWork: UnitOfWork,
    private readonly idGenerator: IdGenerator,
    private readonly referenceGenerator: OrderReferenceGenerator
  ) {}

  execute(command: CreateOrderCommand): Promise<CreateOrderResult> {
    validateCommand(command);
    const requestHash = hashCreationRequest(command);

    return this.unitOfWork.transact(async () => {
      const existing = await this.repository.findByIdempotencyKey(command.idempotencyKey);
      if (existing) {
        assertMatchingRequest(existing, requestHash);
        return this.toResult(existing, false);
      }

      const context = await this.repository.lockAndLoadSalesContext(
        command.userId,
        command.eventId,
        command.currency,
        command.createdAt
      );
      validateSalesContext(context, command.createdAt);

      const pricedItems = priceItems(command, context, this.idGenerator);
      validateCapacity(context, pricedItems);

      const subtotal = pricedItems.reduce((sum, item) => sum + item.lineTotal, 0n);
      const walletApplied = resolveWalletApplication(command.wallet, context.walletAvailable, subtotal);
      const orderId = this.idGenerator.newId();
      const reference = this.referenceGenerator.publicToken(orderId);
      const status = context.event.offerRequired ? "awaiting_offer" : "awaiting_payment";
      const expiresAt = new Date(
        command.createdAt.getTime() + context.event.reservationTtlMinutes * 60_000
      );

      const persisted = await this.repository.persistOrder({
        id: orderId,
        number: this.referenceGenerator.orderNumber(orderId, command.createdAt),
        publicTokenHash: reference.sha256,
        creationIdempotencyKey: command.idempotencyKey,
        creationRequestHash: requestHash,
        userId: command.userId,
        eventId: command.eventId,
        status,
        currency: command.currency,
        subtotal,
        total: subtotal,
        walletApplied,
        externalDue: subtotal - walletApplied,
        eventSnapshot: eventSnapshot(context.event),
        pricingSnapshot: {
          schemaVersion: 1,
          lines: pricedItems.map((item) => item.pricingSnapshot)
        },
        offerVersionId: context.event.activeOfferVersionId,
        offerPublicUrl: context.event.activeOfferPublicUrl,
        expiresAt,
        source: command.source,
        channel: command.channel,
        createdAt: command.createdAt,
        items: pricedItems
      });

      assertMatchingRequest(persisted.order, requestHash);

      if (persisted.created) {
        await this.outboxWriter.append(orderCreatedEvent(
          this.idGenerator.newId(),
          persisted.order,
          command.userId,
          command.eventId,
          command.createdAt
        ));
      }

      return this.toResult(persisted.order, persisted.created);
    });
  }

  private toResult(order: PersistedOrder, created: boolean): CreateOrderResult {
    return {
      orderId: order.id,
      orderNumber: order.number,
      publicToken: this.referenceGenerator.publicToken(order.id).token,
      offerPublicUrl: order.status === "awaiting_offer"
        ? order.offerPublicUrl
        : null,
      status: order.status,
      currency: order.currency,
      totalKopecks: order.total.toString(),
      walletAppliedKopecks: order.walletApplied.toString(),
      externalDueKopecks: order.externalDue.toString(),
      expiresAt: order.expiresAt.toISOString(),
      created
    };
  }

}

function validateCommand(command: CreateOrderCommand): void {
  if (command.items.length === 0) {
    throw new Error("Order must contain at least one item");
  }
  if (!/^[A-Z]{3}$/.test(command.currency)) {
    throw new Error("Order currency must be an ISO 4217 uppercase code");
  }
  if (command.idempotencyKey.length < 8 || command.idempotencyKey.length > 200) {
    throw new Error("Order idempotency key length is invalid");
  }
  if (command.source.length < 1 || command.source.length > 100) {
    throw new Error("Order source length is invalid");
  }

  const productIds = new Set<string>();
  for (const item of command.items) {
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) {
      throw new Error("Order item quantity must be a positive integer");
    }
    if (productIds.has(item.productId)) {
      throw new Error(`Order contains duplicate product ${item.productId}`);
    }
    productIds.add(item.productId);
  }
}

function validateSalesContext(context: OrderSalesContext, at: Date): void {
  const event = context.event;
  if (event.status !== "published") {
    throw new Error(`Event is not available for sale: ${event.status}`);
  }
  if (event.salesStartsAt && at < event.salesStartsAt) {
    throw new Error("Event sales window has not opened");
  }
  if (event.salesEndsAt && at >= event.salesEndsAt) {
    throw new Error("Event sales window has closed");
  }
  if (
    event.phoneRequiredForPurchase
    && context.userPhoneStatus !== "verified"
    && context.userPhoneStatus !== "imported"
  ) {
    throw new Error("Verified or imported phone is required to create an order");
  }
  if (
    event.offerRequired
    && (!event.activeOfferVersionId || !event.activeOfferPublicUrl)
  ) {
    throw new Error("Event requires an active immutable offer version");
  }
  if (!Number.isSafeInteger(event.reservationTtlMinutes) || event.reservationTtlMinutes < 1) {
    throw new Error("Event reservation TTL is invalid");
  }
}

function priceItems(
  command: CreateOrderCommand,
  context: OrderSalesContext,
  idGenerator: IdGenerator
): readonly PersistOrderItemInput[] {
  return command.items.map((line) => {
    const product = context.products.find((candidate) => candidate.id === line.productId);
    if (!product?.isActive) {
      throw new Error(`Product is not available: ${line.productId}`);
    }
    if (product.currency !== command.currency) {
      throw new Error(`Product currency does not match order currency: ${line.productId}`);
    }

    const relatedItems = command.items
      .filter((candidate) => candidate.productId !== line.productId)
      .map((candidate) => {
        const relatedProduct = context.products.find(
          (productCandidate) => productCandidate.id === candidate.productId
        );

        return {
          productType: relatedProduct?.productType ?? "unknown",
          quantity: candidate.quantity
        };
      });
    const price = calculatePrice({
      eventId: command.eventId,
      productId: line.productId,
      quantity: line.quantity,
      relatedItems,
      userId: command.userId,
      timestamp: command.createdAt,
      currency: command.currency,
      maximumQuantity: product.maximumQuantityPerOrder
    }, product.pricingRules);

    return {
      id: idGenerator.newId(),
      productId: product.id,
      productSnapshot: {
        schemaVersion: 1,
        code: product.code,
        productType: product.productType,
        title: product.title,
        bundleComposition: product.bundleComposition,
        inventoryUnitsPerItem: product.inventoryUnitsPerItem
      },
      quantity: line.quantity,
      inventoryUnits: line.quantity * product.inventoryUnitsPerItem,
      unitPrice: price.unitPrice,
      lineTotal: price.lineTotal,
      pricingRuleId: price.appliedRuleId,
      pricingSnapshot: price.snapshot
    };
  });
}

function validateCapacity(
  context: OrderSalesContext,
  items: readonly PersistOrderItemInput[]
): void {
  const requestedEventUnits = items.reduce((sum, item) => sum + item.inventoryUnits, 0);
  if (context.reservedEventInventoryUnits + requestedEventUnits > context.event.capacity) {
    throw new Error("Event capacity is insufficient for the requested order");
  }

  for (const item of items) {
    const product = context.products.find((candidate) => candidate.id === item.productId);
    if (
      product !== undefined
      && product.capacity !== null
      && (context.reservedProductInventoryUnits[product.id] ?? 0) + item.inventoryUnits
        > product.capacity
    ) {
      throw new Error(`Product capacity is insufficient: ${item.productId}`);
    }
  }
}

function resolveWalletApplication(
  request: WalletApplicationCommand,
  available: MoneyKopecks,
  total: MoneyKopecks
): MoneyKopecks {
  if (request.mode === "none") {
    return 0n;
  }
  if (request.mode === "all") {
    return available < total ? available : total;
  }

  if (!/^\d+$/.test(request.amountKopecks)) {
    throw new Error("Wallet amount must be an integer number of kopecks");
  }

  const requested = BigInt(request.amountKopecks);
  if (requested > available || requested > total) {
    throw new Error("Wallet amount exceeds available balance or order total");
  }
  return requested;
}

function eventSnapshot(event: OrderSalesEvent): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: 1,
    id: event.id,
    slug: event.slug,
    title: event.title,
    timezone: event.timezone,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt?.toISOString() ?? null
  };
}

function hashCreationRequest(command: CreateOrderCommand): string {
  const canonical = JSON.stringify({
    userId: command.userId,
    eventId: command.eventId,
    currency: command.currency,
    items: [...command.items]
      .sort((left, right) => left.productId.localeCompare(right.productId))
      .map((item) => ({ productId: item.productId, quantity: item.quantity })),
    wallet: command.wallet,
    source: command.source
  });

  return createHash("sha256").update(canonical).digest("hex");
}

function assertMatchingRequest(order: PersistedOrder, requestHash: string): void {
  if (order.creationRequestHash !== requestHash) {
    throw new Error("Order idempotency key was already used for a different request");
  }
}

function orderCreatedEvent(
  eventId: string,
  order: PersistedOrder,
  userId: string,
  eventSalesId: string,
  occurredAt: Date
): DomainEvent<{
  orderId: string;
  userId: string;
  eventId: string;
  totalKopecks: string;
  walletAppliedKopecks: string;
  externalDueKopecks: string;
}> {
  return {
    eventId,
    aggregateType: "order",
    aggregateId: order.id,
    eventType: "OrderCreated",
    schemaVersion: 1,
    payload: {
      orderId: order.id,
      userId,
      eventId: eventSalesId,
      totalKopecks: order.total.toString(),
      walletAppliedKopecks: order.walletApplied.toString(),
      externalDueKopecks: order.externalDue.toString()
    },
    occurredAt
  };
}
