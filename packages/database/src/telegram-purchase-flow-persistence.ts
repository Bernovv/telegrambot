import type {
  CatalogProductKey,
  EventCatalogRepository,
  PublishedEventCatalog,
  PurchaseDraft,
  PurchaseDraftRepository,
  PurchaseDraftStep,
  PurchaseTicketType
} from "@ticket-platform/application";
import type { SqlConnectionPool } from "./postgres.js";

/**
 * Stores the in-progress "Купить билет" chat draft in the existing `users.metadata` JSONB column
 * (nested under the `telegramPurchaseDraft` key) instead of a new table: it is small, disposable,
 * per-user, single-writer state — not financial or audit data, so it does not need its own
 * append-only table or migration. Once the draft is complete, `TelegramPurchaseFlowService` calls
 * the real `CreateOrderService`, which persists the order through the existing durable tables.
 */
interface DraftRow {
  readonly ticket_type: string | null;
  readonly step: string | null;
  readonly adult_quantity: string | null;
  readonly child_quantity: string | null;
  readonly idempotency_nonce: string | null;
  readonly started_at: string | null;
}

export class PostgresPurchaseDraftRepository implements PurchaseDraftRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  async getDraft(userId: string): Promise<PurchaseDraft | null> {
    const connection = await this.pool.connect();
    try {
      const result = await connection.query<DraftRow>(
        `select
           metadata #>> '{telegramPurchaseDraft,ticketType}' as ticket_type,
           metadata #>> '{telegramPurchaseDraft,step}' as step,
           metadata #>> '{telegramPurchaseDraft,adultQuantity}' as adult_quantity,
           metadata #>> '{telegramPurchaseDraft,childQuantity}' as child_quantity,
           metadata #>> '{telegramPurchaseDraft,idempotencyNonce}' as idempotency_nonce,
           metadata #>> '{telegramPurchaseDraft,startedAt}' as started_at
         from public.users
         where id = $1`,
        [userId]
      );
      const row = result.rows[0];
      return row ? toDraft(row) : null;
    } finally {
      connection.release();
    }
  }

  async setDraft(userId: string, draft: PurchaseDraft): Promise<void> {
    const connection = await this.pool.connect();
    try {
      await connection.query(
        `update public.users
         set metadata = jsonb_set(metadata, '{telegramPurchaseDraft}', $2::jsonb, true),
             updated_at = now()
         where id = $1`,
        [userId, JSON.stringify(draft)]
      );
    } finally {
      connection.release();
    }
  }

  async clearDraft(userId: string): Promise<void> {
    const connection = await this.pool.connect();
    try {
      await connection.query(
        `update public.users
         set metadata = metadata - 'telegramPurchaseDraft',
             updated_at = now()
         where id = $1`,
        [userId]
      );
    } finally {
      connection.release();
    }
  }
}

interface CatalogRow {
  readonly event_id: string;
  readonly currency: string;
  readonly product_id: string;
  readonly product_type: string;
  readonly maximum_quantity_per_order: number;
  readonly offer_url: string | null;
}

const CATALOG_PRODUCT_KEYS: readonly CatalogProductKey[] = [
  "adult_standard",
  "adult_vip",
  "child",
  "family_standard",
  "family_vip"
];

export class PostgresEventCatalogRepository implements EventCatalogRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  async findPublishedCatalog(eventSlug: string): Promise<PublishedEventCatalog | null> {
    const connection = await this.pool.connect();
    try {
      const result = await connection.query<CatalogRow>(
        `select e.id as event_id, p.currency, p.id as product_id, p.product_type,
                p.maximum_quantity_per_order, offer.public_url as offer_url
         from public.events e
         join public.ticket_products p on p.event_id = e.id
         left join public.offer_versions offer
           on offer.id = e.active_offer_version_id
          and offer.is_active = true
         where e.slug = $1
           and e.status = 'published'
           and p.is_active = true`,
        [eventSlug]
      );
      if (result.rows.length === 0) {
        return null;
      }

      const products: Partial<Record<CatalogProductKey, { id: string; maximumQuantityPerOrder: number }>> = {};
      for (const row of result.rows) {
        if (isCatalogProductKey(row.product_type)) {
          products[row.product_type] = {
            id: row.product_id,
            maximumQuantityPerOrder: row.maximum_quantity_per_order
          };
        }
      }

      return {
        eventId: result.rows[0]?.event_id ?? "",
        currency: result.rows[0]?.currency ?? "RUB",
        offerUrl: result.rows[0]?.offer_url ?? null,
        products
      };
    } finally {
      connection.release();
    }
  }
}

export function createTelegramPurchaseFlowPersistence(pool: SqlConnectionPool): {
  readonly purchaseDraftRepository: PurchaseDraftRepository;
  readonly eventCatalogRepository: EventCatalogRepository;
} {
  return {
    purchaseDraftRepository: new PostgresPurchaseDraftRepository(pool),
    eventCatalogRepository: new PostgresEventCatalogRepository(pool)
  };
}

function isCatalogProductKey(value: string): value is CatalogProductKey {
  return (CATALOG_PRODUCT_KEYS as readonly string[]).includes(value);
}

function toDraft(row: DraftRow): PurchaseDraft | null {
  if (!row.ticket_type || !row.step || !row.idempotency_nonce || !row.started_at) {
    return null;
  }

  return {
    ticketType: row.ticket_type as PurchaseTicketType,
    step: row.step as PurchaseDraftStep,
    adultQuantity: row.adult_quantity === null ? null : Number.parseInt(row.adult_quantity, 10),
    childQuantity: row.child_quantity === null ? 0 : Number.parseInt(row.child_quantity, 10),
    idempotencyNonce: row.idempotency_nonce,
    startedAt: row.started_at
  };
}
