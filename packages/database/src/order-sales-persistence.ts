import type {
  IdGenerator,
  OrderSalesContext,
  OrderSalesProduct,
  OrderSalesRepository,
  PersistedOrder,
  PersistOrderInput,
  PersistOrderResult
} from "@ticket-platform/application";
import type { PricingRule } from "@ticket-platform/domain";
import {
  PostgresOutboxWriter
} from "./telegram-start-persistence.js";
import {
  PostgresUnitOfWork,
  TransactionSession,
  type SqlConnectionPool
} from "./postgres.js";

interface EventContextRow {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly timezone: string;
  readonly starts_at: Date;
  readonly ends_at: Date | null;
  readonly sales_starts_at: Date | null;
  readonly sales_ends_at: Date | null;
  readonly status: OrderSalesContext["event"]["status"];
  readonly capacity: number;
  readonly reservation_ttl_minutes: number;
  readonly phone_required_for_purchase: boolean;
  readonly offer_required: boolean;
  readonly active_offer_version_id: string | null;
  readonly active_offer_public_url: string | null;
  readonly phone_status: OrderSalesContext["userPhoneStatus"];
  readonly wallet_available_kopecks: string;
}

interface ProductPricingRow {
  readonly product_id: string;
  readonly code: string;
  readonly product_type: OrderSalesProduct["productType"];
  readonly title: string;
  readonly currency: string;
  readonly bundle_composition: unknown;
  readonly inventory_units_per_item: number;
  readonly capacity: number | null;
  readonly maximum_quantity_per_order: number;
  readonly is_active: boolean;
  readonly rule_id: string | null;
  readonly rule_currency: string | null;
  readonly unit_price_kopecks: string | null;
  readonly priority: number | null;
  readonly specificity: number | null;
  readonly minimum_quantity: number | null;
  readonly maximum_quantity: number | null;
  readonly valid_from: Date | null;
  readonly valid_until: Date | null;
  readonly explanation: string | null;
}

interface ReservationTotalRow {
  readonly product_id: string;
  readonly inventory_units: string;
}

interface OrderRow {
  readonly id: string;
  readonly number: string;
  readonly status: PersistedOrder["status"];
  readonly currency: string;
  readonly total_kopecks: string;
  readonly wallet_applied_kopecks: string;
  readonly external_due_kopecks: string;
  readonly expires_at: Date;
  readonly creation_request_hash: string;
  readonly offer_public_url: string | null;
}

interface WalletAccountRow {
  readonly id: string;
  readonly cached_available_kopecks: string;
  readonly status: "active" | "blocked" | "closed";
}

interface WalletCreditRow {
  readonly id: string;
  readonly amount_kopecks: string;
  readonly debited_kopecks: string;
  readonly held_kopecks: string;
}

interface MutableProduct {
  readonly product: Omit<OrderSalesProduct, "pricingRules">;
  readonly pricingRules: PricingRule[];
}

export class PostgresOrderSalesRepository implements OrderSalesRepository {
  constructor(
    private readonly session: TransactionSession,
    private readonly idGenerator: IdGenerator
  ) {}

  async findByIdempotencyKey(idempotencyKey: string): Promise<PersistedOrder | null> {
    const result = await this.session.query<OrderRow>(
      `${orderSelect}
       where creation_idempotency_key = $1`,
      [idempotencyKey]
    );

    return result.rows[0] ? toPersistedOrder(result.rows[0]) : null;
  }

  async lockAndLoadSalesContext(
    userId: string,
    eventId: string,
    currency: string,
    at: Date
  ): Promise<OrderSalesContext> {
    await this.session.query(
      "select pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`event-sales:${eventId}`]
    );

    const eventResult = await this.session.query<EventContextRow>(
      `select
         e.id,
         e.slug,
         e.title,
         e.timezone,
         e.starts_at,
         e.ends_at,
         e.sales_starts_at,
         e.sales_ends_at,
         e.status,
         e.capacity,
         e.reservation_ttl_minutes,
         e.phone_required_for_purchase,
         e.offer_required,
         e.active_offer_version_id,
         ov.public_url as active_offer_public_url,
         u.phone_status,
         coalesce(wa.cached_available_kopecks, 0)::text as wallet_available_kopecks
       from public.events e
       join public.users u on u.id = $2
       left join public.offer_versions ov
         on ov.id = e.active_offer_version_id
       left join public.wallet_accounts wa
         on wa.user_id = u.id and wa.currency = $3 and wa.status = 'active'
       where e.id = $1`,
      [eventId, userId, currency]
    );
    const row = eventResult.rows[0];
    if (!row) {
      throw new Error(`Event or user not found while creating order: ${eventId}/${userId}`);
    }

    const productRows = await this.session.query<ProductPricingRow>(
      `select
         p.id as product_id,
         p.code,
         p.product_type,
         p.title,
         p.currency,
         p.bundle_composition,
         p.inventory_units_per_item,
         p.capacity,
         p.maximum_quantity_per_order,
         p.is_active,
         r.id as rule_id,
         r.currency as rule_currency,
         r.unit_price_kopecks::text,
         r.priority,
         r.specificity,
         r.minimum_quantity,
         r.maximum_quantity,
         r.valid_from,
         r.valid_until,
         r.explanation
       from public.ticket_products p
       left join public.pricing_rules r
         on r.product_id = p.id
        and r.is_active = true
        and (r.valid_from is null or r.valid_from <= $3)
        and (r.valid_until is null or r.valid_until > $3)
       where p.event_id = $1
         and p.currency = $2
       order by p.sort_order, p.id, r.priority desc, r.specificity desc, r.id`,
      [eventId, currency, at]
    );
    const reservationRows = await this.session.query<ReservationTotalRow>(
      `select product_id, sum(inventory_units)::text as inventory_units
       from public.inventory_reservations
       where event_id = $1
         and status = 'active'
         and expires_at > $2
       group by product_id`,
      [eventId, at]
    );
    const products = aggregateProducts(productRows.rows);
    const reservedProductInventoryUnits = Object.fromEntries(
      reservationRows.rows.map((reservation) => [
        reservation.product_id,
        safeInteger(reservation.inventory_units, "reserved product inventory")
      ])
    );
    const reservedEventInventoryUnits = Object.values(reservedProductInventoryUnits)
      .reduce((sum, units) => sum + units, 0);

    return {
      event: {
        id: row.id,
        slug: row.slug,
        title: row.title,
        timezone: row.timezone,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        salesStartsAt: row.sales_starts_at,
        salesEndsAt: row.sales_ends_at,
        status: row.status,
        capacity: row.capacity,
        phoneRequiredForPurchase: row.phone_required_for_purchase,
        offerRequired: row.offer_required,
        activeOfferVersionId: row.active_offer_version_id,
        activeOfferPublicUrl: row.active_offer_public_url,
        reservationTtlMinutes: row.reservation_ttl_minutes
      },
      userPhoneStatus: row.phone_status,
      products,
      walletAvailable: BigInt(row.wallet_available_kopecks),
      reservedEventInventoryUnits,
      reservedProductInventoryUnits
    };
  }

  async persistOrder(input: PersistOrderInput): Promise<PersistOrderResult> {
    const inserted = await this.session.query<OrderRow>(
      `insert into public.orders (
         id, number, public_token_hash, creation_idempotency_key, creation_request_hash,
         user_id, event_id, status, currency, subtotal_kopecks, discount_kopecks,
         total_kopecks, wallet_applied_kopecks, external_due_kopecks, tax_kopecks,
         snapshot_schema_version, event_snapshot, pricing_snapshot, offer_version_id,
         expires_at, source, channel, created_at, updated_at
       ) values (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9, $10, 0,
         $11, $12, $13, 0,
         1, $14::jsonb, $15::jsonb, $16,
         $17, $18, $20::text, $19, $19
       )
       on conflict (creation_idempotency_key) do nothing
       returning
         id, number, status, currency, total_kopecks::text,
         wallet_applied_kopecks::text, external_due_kopecks::text,
         expires_at, creation_request_hash`,
      [
        input.id,
        input.number,
        input.publicTokenHash,
        input.creationIdempotencyKey,
        input.creationRequestHash,
        input.userId,
        input.eventId,
        input.status,
        input.currency,
        input.subtotal.toString(),
        input.total.toString(),
        input.walletApplied.toString(),
        input.externalDue.toString(),
        JSON.stringify(input.eventSnapshot),
        JSON.stringify(input.pricingSnapshot),
        input.offerVersionId,
        input.expiresAt,
        input.source,
        input.createdAt,
        input.channel
      ]
    );
    const createdOrder = inserted.rows[0];

    if (!createdOrder) {
      const existing = await this.findByIdempotencyKey(input.creationIdempotencyKey);
      if (!existing) {
        throw new Error("Order insert conflict did not resolve to an existing order");
      }
      return { created: false, order: existing };
    }

    for (const item of input.items) {
      await this.session.query(
        `insert into public.order_items (
           id, order_id, product_id, product_snapshot_schema_version, product_snapshot,
           quantity, inventory_units, unit_price_kopecks, line_total_kopecks,
           discount_kopecks, tax_kopecks, pricing_rule_id, pricing_snapshot,
           metadata_schema_version, metadata, created_at
         ) values (
           $1, $2, $3, 1, $4::jsonb,
           $5, $6, $7, $8,
           0, 0, $9, $10::jsonb,
           1, '{}'::jsonb, $11
         )`,
        [
          item.id,
          input.id,
          item.productId,
          JSON.stringify(item.productSnapshot),
          item.quantity,
          item.inventoryUnits,
          item.unitPrice.toString(),
          item.lineTotal.toString(),
          item.pricingRuleId,
          JSON.stringify(item.pricingSnapshot),
          input.createdAt
        ]
      );
      await this.session.query(
        `insert into public.inventory_reservations (
           id, event_id, product_id, order_id, order_item_id, inventory_units,
           status, expires_at, created_at, updated_at
         ) values ($1, $2, $3, $4, $5, $6, 'active', $7, $8, $8)`,
        [
          this.idGenerator.newId(),
          input.eventId,
          item.productId,
          input.id,
          item.id,
          item.inventoryUnits,
          input.expiresAt,
          input.createdAt
        ]
      );
    }

    if (input.walletApplied > 0n) {
      await this.createWalletHold(input);
    }

    await this.session.query(
      `insert into public.order_status_history (
         id, order_id, from_status, to_status, reason, actor_type,
         idempotency_key, occurred_at, metadata_schema_version, metadata
       ) values ($1, $2, null, $3, 'order_created', 'system', $4, $5, 1, '{}'::jsonb)`,
      [
        this.idGenerator.newId(),
        input.id,
        input.status,
        `order_created:${input.id}`,
        input.createdAt
      ]
    );

    return {
      created: true,
      order: {
        ...toPersistedOrder(createdOrder),
        offerPublicUrl: input.offerPublicUrl
      }
    };
  }

  private async createWalletHold(input: PersistOrderInput): Promise<void> {
    const accountResult = await this.session.query<WalletAccountRow>(
      `select id, cached_available_kopecks::text, status
       from public.wallet_accounts
       where user_id = $1 and currency = $2
       for update`,
      [input.userId, input.currency]
    );
    const account = accountResult.rows[0];
    if (!account || account.status !== "active") {
      throw new Error("Active wallet account is required for the requested wallet amount");
    }
    if (BigInt(account.cached_available_kopecks) < input.walletApplied) {
      throw new Error("Wallet balance changed before the order hold was created");
    }

    const creditResult = await this.session.query<WalletCreditRow>(
      `select
         credit.id,
         credit.amount_kopecks::text,
         coalesce((
           select sum(debit.amount_kopecks)
           from public.wallet_entries debit
           where debit.source_entry_id = credit.id
         ), 0)::text as debited_kopecks,
         coalesce((
           select sum(hold_entry.amount_kopecks)
           from public.wallet_hold_entries hold_entry
           join public.wallet_holds hold on hold.id = hold_entry.wallet_hold_id
           where hold_entry.source_entry_id = credit.id
             and hold.status = 'active'
         ), 0)::text as held_kopecks
       from public.wallet_entries credit
       where credit.wallet_account_id = $1
         and credit.direction = 'credit'
         and (credit.expires_at is null or credit.expires_at > $2)
       order by credit.expires_at nulls last, credit.effective_at, credit.id
       for share`,
      [account.id, input.createdAt]
    );

    let remaining = input.walletApplied;
    const allocations: { readonly sourceEntryId: string; readonly amount: bigint }[] = [];
    for (const credit of creditResult.rows) {
      const available = BigInt(credit.amount_kopecks)
        - BigInt(credit.debited_kopecks)
        - BigInt(credit.held_kopecks);
      const amount = available < remaining ? available : remaining;

      if (amount > 0n) {
        allocations.push({ sourceEntryId: credit.id, amount });
        remaining -= amount;
      }
      if (remaining === 0n) {
        break;
      }
    }
    if (remaining !== 0n) {
      throw new Error("Wallet ledger credits do not cover the cached available balance");
    }

    const transactionId = this.idGenerator.newId();
    const holdId = this.idGenerator.newId();
    await this.session.query(
      `insert into public.wallet_transactions (
         id, wallet_account_id, transaction_type, status, idempotency_key,
         reference_type, reference_id, actor_type, actor_id, reason, created_at, posted_at
       ) values (
         $1, $2, 'ORDER_HOLD', 'posted', $3,
         'order', $4, 'user', $5, 'order_wallet_hold', $6, $6
       )`,
      [
        transactionId,
        account.id,
        `order_hold:${input.id}`,
        input.id,
        input.userId,
        input.createdAt
      ]
    );
    await this.session.query(
      `insert into public.wallet_holds (
         id, wallet_account_id, reference_type, reference_id, amount_kopecks,
         status, idempotency_key, expires_at, created_at, updated_at
       ) values ($1, $2, 'order', $3, $4, 'active', $5, $6, $7, $7)`,
      [
        holdId,
        account.id,
        input.id,
        input.walletApplied.toString(),
        `order_hold:${input.id}`,
        input.expiresAt,
        input.createdAt
      ]
    );

    for (const allocation of allocations) {
      await this.session.query(
        `insert into public.wallet_hold_entries (
           id, wallet_account_id, wallet_hold_id, source_entry_id, amount_kopecks, created_at
         ) values ($1, $2, $3, $4, $5, $6)`,
        [
          this.idGenerator.newId(),
          account.id,
          holdId,
          allocation.sourceEntryId,
          allocation.amount.toString(),
          input.createdAt
        ]
      );
    }

    const updated = await this.session.query(
      `update public.wallet_accounts
       set cached_available_kopecks = cached_available_kopecks - $2,
           cached_held_kopecks = cached_held_kopecks + $2,
           balance_version = balance_version + 1,
           updated_at = $3
       where id = $1
         and cached_available_kopecks >= $2`,
      [account.id, input.walletApplied.toString(), input.createdAt]
    );
    if (updated.rowCount !== 1) {
      throw new Error("Wallet hold failed optimistic balance validation");
    }
  }
}

export function createOrderSalesPersistence(
  pool: SqlConnectionPool,
  idGenerator: IdGenerator
) {
  const session = new TransactionSession();

  return {
    // Сессия отдаётся наружу, чтобы соседние операции над заказом (например, отмена)
    // работали в той же транзакции, а не открывали свою поверх чужой.
    session,
    orderSalesRepository: new PostgresOrderSalesRepository(session, idGenerator),
    outboxWriter: new PostgresOutboxWriter(session),
    unitOfWork: new PostgresUnitOfWork(pool, session)
  } as const;
}

function aggregateProducts(rows: readonly ProductPricingRow[]): readonly OrderSalesProduct[] {
  const products = new Map<string, MutableProduct>();

  for (const row of rows) {
    let aggregate = products.get(row.product_id);
    if (!aggregate) {
      aggregate = {
        product: {
          id: row.product_id,
          code: row.code,
          productType: row.product_type,
          title: row.title,
          currency: row.currency,
          bundleComposition: parseBundleComposition(row.bundle_composition),
          inventoryUnitsPerItem: row.inventory_units_per_item,
          capacity: row.capacity,
          maximumQuantityPerOrder: row.maximum_quantity_per_order,
          isActive: row.is_active
        },
        pricingRules: []
      };
      products.set(row.product_id, aggregate);
    }

    const pricingRule = toPricingRule(row);
    if (pricingRule) {
      aggregate.pricingRules.push(pricingRule);
    }
  }

  return [...products.values()].map((aggregate) => ({
    ...aggregate.product,
    pricingRules: aggregate.pricingRules
  }));
}

function toPricingRule(row: ProductPricingRow): PricingRule | null {
  if (
    row.rule_id === null
    || row.rule_currency === null
    || row.unit_price_kopecks === null
    || row.priority === null
    || row.specificity === null
    || row.minimum_quantity === null
    || row.explanation === null
  ) {
    return null;
  }

  return {
    id: row.rule_id,
    productId: row.product_id,
    currency: row.rule_currency,
    unitPrice: BigInt(row.unit_price_kopecks),
    priority: row.priority,
    specificity: row.specificity,
    minimumQuantity: row.minimum_quantity,
    maximumQuantity: row.maximum_quantity,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    explanation: row.explanation
  };
}

function parseBundleComposition(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (
    !Array.isArray(parsed)
    || parsed.some((item) => typeof item !== "object" || item === null || Array.isArray(item))
  ) {
    throw new Error("Ticket product bundle composition is invalid");
  }

  return parsed as readonly Readonly<Record<string, unknown>>[];
}

function toPersistedOrder(row: OrderRow): PersistedOrder {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    currency: row.currency,
    total: BigInt(row.total_kopecks),
    walletApplied: BigInt(row.wallet_applied_kopecks),
    externalDue: BigInt(row.external_due_kopecks),
    expiresAt: row.expires_at,
    creationRequestHash: row.creation_request_hash,
    offerPublicUrl: row.offer_public_url ?? null
  };
}

function safeInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label} is outside the safe integer range`);
  }
  return parsed;
}

const orderSelect = `select
  orders.id,
  orders.number,
  orders.status,
  orders.currency,
  orders.total_kopecks::text,
  orders.wallet_applied_kopecks::text,
  orders.external_due_kopecks::text,
  orders.expires_at,
  orders.creation_request_hash,
  offer_versions.public_url as offer_public_url
from public.orders orders
left join public.offer_versions
  on offer_versions.id = orders.offer_version_id`;
