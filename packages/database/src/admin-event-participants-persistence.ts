import type {
  AdminEventParticipantsRepository,
  ParticipantOrderItemRow,
  ParticipantsEventRow
} from "@ticket-platform/application";
import type { EventParticipant } from "@ticket-platform/contracts";
import { PostgresAdminAccommodationRepository } from "./admin-accommodation-persistence.js";
import { toBundleComposition } from "./bundle-composition.js";
import type { SqlConnectionPool } from "./postgres.js";

interface ParticipantOrderItemResult {
  readonly order_id: string;
  readonly order_number: string;
  readonly buyer_name: string | null;
  readonly phone: string | null;
  readonly telegram_username: string | null;
  readonly paid_at: string | null;
  readonly total_kopecks: string;
  readonly product_title: string;
  readonly quantity: number;
  readonly bundle_composition: unknown;
  readonly inventory_units_per_item: number;
  readonly includes_sleeping_place: boolean;
}

/**
 * Список участников читает те же таблицы, что и «что везём», и три чтения из четырёх у них
 * общие — поэтому они делегируются репозиторию расселения, а не переписываются заново.
 * Своё здесь только одно: строки заказа вместе с деньгами, телефоном и датой оплаты.
 */
export class PostgresAdminEventParticipantsRepository
  implements AdminEventParticipantsRepository
{
  private readonly accommodation: PostgresAdminAccommodationRepository;

  constructor(private readonly pool: SqlConnectionPool) {
    this.accommodation = new PostgresAdminAccommodationRepository(pool);
  }

  async findEvent(eventId: string): Promise<ParticipantsEventRow | null> {
    const event = await this.accommodation.findEvent(eventId);
    return event ? { id: event.id, title: event.title } : null;
  }

  listParticipants(eventId: string): Promise<readonly EventParticipant[]> {
    return this.accommodation.listParticipants(eventId);
  }

  countExcludedOrders(eventId: string): Promise<number> {
    return this.accommodation.countExcludedOrders(eventId);
  }

  hasPermission(adminId: string, permission: string): Promise<boolean> {
    return this.accommodation.hasPermission(adminId, permission);
  }

  async listPaidOrderItems(
    eventId: string
  ): Promise<readonly ParticipantOrderItemRow[]> {
    const connection = await this.pool.connect();
    try {
      await connection.query(
        "begin transaction isolation level repeatable read read only"
      );
      const result = await connection.query<ParticipantOrderItemResult>(
        `select
           o.id as order_id,
           o.number as order_number,
           -- Имя часто пустое: человек пришёл из Telegram и представился только ником.
           -- Спускаемся по цепочке — имя, ник, телефон, — как в сводке «что везём».
           coalesce(
             nullif(btrim(u.display_name), ''),
             '@' || nullif(identity.username, ''),
             contact.value_normalized
           ) as buyer_name,
           contact.value_normalized as phone,
           identity.username as telegram_username,
           o.paid_at as paid_at,
           o.total_kopecks::text as total_kopecks,
           p.title as product_title,
           i.quantity as quantity,
           p.bundle_composition as bundle_composition,
           p.inventory_units_per_item as inventory_units_per_item,
           p.includes_sleeping_place as includes_sleeping_place
         from public.orders o
         join public.order_items i on i.order_id = o.id
         join public.ticket_products p on p.id = i.product_id
         join public.users u on u.id = o.user_id
         left join lateral (
           select username
           from public.messenger_identities
           where user_id = o.user_id and username is not null
           order by last_seen_at desc, id
           limit 1
         ) identity on true
         left join lateral (
           select value_normalized
           from public.user_contacts
           where user_id = o.user_id and contact_type = 'phone'
           order by is_primary desc, created_at
           limit 1
         ) contact on true
         where o.event_id = $1::uuid
           and o.status = 'paid'
           and o.excluded_at is null
         order by o.paid_at, o.id, i.created_at`,
        [eventId]
      );
      await connection.query("commit");

      return result.rows.map((row) => ({
        orderId: row.order_id,
        orderNumber: row.order_number,
        buyerName: row.buyer_name,
        phone: row.phone,
        telegramUsername: row.telegram_username,
        paidAt: row.paid_at === null ? null : new Date(row.paid_at),
        totalKopecks: row.total_kopecks,
        productTitle: row.product_title,
        quantity: row.quantity,
        bundleComposition: toBundleComposition(row.bundle_composition),
        inventoryUnitsPerItem: row.inventory_units_per_item,
        includesSleepingPlace: row.includes_sleeping_place
      }));
    } catch (error) {
      await connection.query("rollback");
      throw error;
    } finally {
      connection.release();
    }
  }
}

export function createAdminEventParticipantsPersistence(pool: SqlConnectionPool): {
  readonly repository: AdminEventParticipantsRepository;
} {
  return { repository: new PostgresAdminEventParticipantsRepository(pool) };
}
