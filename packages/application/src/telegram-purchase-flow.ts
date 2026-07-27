import type { CreateOrderCommand, CreateOrderResult } from "@ticket-platform/contracts";
import type { IdGenerator } from "./identity.js";
import type { TelegramUserResolver } from "./phone.js";

/**
 * Phase 2 of docs bots plan (Roadmap_объединение_ботов.docx): lets a Telegram user compose a
 * ticket purchase directly in the chat (BOT_FLOWS.md sections "Купить билет" / "Все включено /
 * Стандартный" / "Семейный"), then hands off to the *existing* order-creation, offer-acceptance,
 * and payment machinery unchanged. This module only decides what to ask the user next and, once
 * the draft is complete, calls the same `CreateOrderService` the authenticated HTTP API uses.
 *
 * Wallet application (spending a bonus balance from chat) is intentionally out of scope here —
 * every order is created with `{ mode: "none" }` — see Roadmap Phase 3.
 */

export type PurchaseTicketType = "adult_standard" | "adult_vip" | "family_standard" | "family_vip";

export type PurchaseDraftStep = "awaiting_quantity" | "awaiting_child_quantity";

export interface PurchaseDraft {
  readonly ticketType: PurchaseTicketType;
  readonly step: PurchaseDraftStep;
  readonly adultQuantity: number | null;
  readonly childQuantity: number;
  /** Minted once per purchase attempt; becomes the order's idempotency key so retries are safe. */
  readonly idempotencyNonce: string;
  readonly startedAt: string;
}

export interface PurchaseDraftRepository {
  getDraft(userId: string): Promise<PurchaseDraft | null>;
  setDraft(userId: string, draft: PurchaseDraft): Promise<void>;
  clearDraft(userId: string): Promise<void>;
}

export interface CatalogProduct {
  readonly id: string;
  readonly maximumQuantityPerOrder: number;
}

export type CatalogProductKey = PurchaseTicketType | "child";

export interface PublishedEventCatalog {
  readonly eventId: string;
  readonly currency: string;
  readonly products: Readonly<Partial<Record<CatalogProductKey, CatalogProduct>>>;
}

export interface EventCatalogRepository {
  findPublishedCatalog(eventSlug: string): Promise<PublishedEventCatalog | null>;
}

export interface OrderCreationPort {
  execute(command: CreateOrderCommand): Promise<CreateOrderResult>;
}

export type PurchaseFlowResult =
  | { readonly kind: "ask_quantity"; readonly ticketLabel: string }
  | { readonly kind: "invalid_quantity" }
  | { readonly kind: "interim_summary"; readonly ticketLabel: string; readonly adultQuantity: number }
  | { readonly kind: "ask_child_quantity" }
  | { readonly kind: "invalid_child_quantity" }
  | {
      readonly kind: "order_created";
      readonly ticketLabel: string;
      readonly adultQuantity: number;
      readonly childQuantity: number;
      readonly orderNumber: string;
      readonly publicToken: string;
      readonly totalKopecks: string;
      readonly walletAppliedKopecks: string;
      readonly externalDueKopecks: string;
    }
  | { readonly kind: "catalog_unavailable" }
  | { readonly kind: "no_active_draft" };

const MIN_QUANTITY = 1;
const MAX_QUANTITY = 50;
const MIN_CHILD_QUANTITY = 0;
const MAX_CHILD_QUANTITY = 50;

export class TelegramPurchaseFlowService {
  constructor(
    private readonly draftRepository: PurchaseDraftRepository,
    private readonly catalogRepository: EventCatalogRepository,
    private readonly orderCreation: OrderCreationPort,
    private readonly telegramUserResolver: TelegramUserResolver,
    private readonly idGenerator: IdGenerator,
    private readonly eventSlug: string
  ) {}

  /** "Все включено" / "Стандартный" ask a quantity; family tariffs are a fixed 2 взрослых + ребёнок bundle. */
  async selectTicketType(
    externalUserId: string,
    ticketType: PurchaseTicketType,
    now: Date
  ): Promise<PurchaseFlowResult> {
    const userId = await this.telegramUserResolver.resolveUserId(externalUserId);
    const draft: PurchaseDraft = {
      ticketType,
      step: "awaiting_quantity",
      adultQuantity: null,
      childQuantity: 0,
      idempotencyNonce: this.idGenerator.newId(),
      startedAt: now.toISOString()
    };

    if (isFamilyTicket(ticketType)) {
      return this.createOrderForDraft(userId, { ...draft, adultQuantity: 1 }, now);
    }

    await this.draftRepository.setDraft(userId, draft);
    return { kind: "ask_quantity", ticketLabel: ticketLabel(ticketType) };
  }

  async handleQuantityText(externalUserId: string, text: string, now: Date): Promise<PurchaseFlowResult> {
    const userId = await this.telegramUserResolver.resolveUserId(externalUserId);
    const draft = await this.draftRepository.getDraft(userId);
    if (!draft || draft.step !== "awaiting_quantity") {
      return { kind: "no_active_draft" };
    }

    const quantity = parseBoundedInt(text, MIN_QUANTITY, MAX_QUANTITY);
    if (quantity === null) {
      return { kind: "invalid_quantity" };
    }

    const updated: PurchaseDraft = { ...draft, adultQuantity: quantity, step: "awaiting_child_quantity" };
    await this.draftRepository.setDraft(userId, updated);
    void now;
    return { kind: "interim_summary", ticketLabel: ticketLabel(draft.ticketType), adultQuantity: quantity };
  }

  async promptChildQuantity(externalUserId: string): Promise<PurchaseFlowResult> {
    const userId = await this.telegramUserResolver.resolveUserId(externalUserId);
    const draft = await this.draftRepository.getDraft(userId);
    if (!draft || draft.step !== "awaiting_child_quantity" || draft.adultQuantity === null) {
      return { kind: "no_active_draft" };
    }
    return { kind: "ask_child_quantity" };
  }

  async skipChildTicket(externalUserId: string, now: Date): Promise<PurchaseFlowResult> {
    const userId = await this.telegramUserResolver.resolveUserId(externalUserId);
    const draft = await this.draftRepository.getDraft(userId);
    if (!draft || draft.adultQuantity === null) {
      return { kind: "no_active_draft" };
    }
    return this.createOrderForDraft(userId, draft, now);
  }

  async handleChildQuantityText(
    externalUserId: string,
    text: string,
    now: Date
  ): Promise<PurchaseFlowResult> {
    const userId = await this.telegramUserResolver.resolveUserId(externalUserId);
    const draft = await this.draftRepository.getDraft(userId);
    if (!draft || draft.step !== "awaiting_child_quantity" || draft.adultQuantity === null) {
      return { kind: "no_active_draft" };
    }

    const quantity = parseBoundedInt(text, MIN_CHILD_QUANTITY, MAX_CHILD_QUANTITY);
    if (quantity === null) {
      return { kind: "invalid_child_quantity" };
    }

    return this.createOrderForDraft(userId, { ...draft, childQuantity: quantity }, now);
  }

  private async createOrderForDraft(
    userId: string,
    draft: PurchaseDraft,
    now: Date
  ): Promise<PurchaseFlowResult> {
    const catalog = await this.catalogRepository.findPublishedCatalog(this.eventSlug);
    const mainProduct = catalog?.products[draft.ticketType];
    if (!catalog || !mainProduct) {
      return { kind: "catalog_unavailable" };
    }

    const family = isFamilyTicket(draft.ticketType);
    const items: { readonly productId: string; readonly quantity: number }[] = family
      ? [{ productId: mainProduct.id, quantity: 1 }]
      : [{ productId: mainProduct.id, quantity: draft.adultQuantity ?? MIN_QUANTITY }];

    if (!family && draft.childQuantity > 0) {
      const childProduct = catalog.products.child;
      if (!childProduct) {
        return { kind: "catalog_unavailable" };
      }
      items.push({ productId: childProduct.id, quantity: draft.childQuantity });
    }

    const result = await this.orderCreation.execute({
      idempotencyKey: `telegram_purchase:${draft.idempotencyNonce}`,
      userId,
      eventId: catalog.eventId,
      currency: catalog.currency,
      items,
      wallet: { mode: "none" },
      source: "telegram_chat",
      createdAt: now
    });

    await this.draftRepository.clearDraft(userId);

    return {
      kind: "order_created",
      ticketLabel: ticketLabel(draft.ticketType),
      adultQuantity: family ? 2 : (draft.adultQuantity ?? MIN_QUANTITY),
      childQuantity: family ? 1 : draft.childQuantity,
      orderNumber: result.orderNumber,
      publicToken: result.publicToken,
      totalKopecks: result.totalKopecks,
      walletAppliedKopecks: result.walletAppliedKopecks,
      externalDueKopecks: result.externalDueKopecks
    };
  }
}

function isFamilyTicket(ticketType: PurchaseTicketType): boolean {
  return ticketType === "family_standard" || ticketType === "family_vip";
}

function ticketLabel(ticketType: PurchaseTicketType): string {
  switch (ticketType) {
    case "adult_standard":
      return "Стандарт";
    case "adult_vip":
      return "Все включено";
    case "family_standard":
      return "Семейный Стандарт";
    case "family_vip":
      return "Семейный Все включено";
  }
}

function parseBoundedInt(text: string, min: number, max: number): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,9}$/.test(trimmed)) {
    return null;
  }
  const value = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    return null;
  }
  return value;
}
