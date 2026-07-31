import type {
  AccommodationBundleRole,
  AccommodationEventRow,
  AccommodationGroupRow,
  AccommodationOrderItemRow,
  AdminAccommodationRepository,
  CreateAccommodationGroupInput,
  InsertAccommodationPlanInput
} from "@ticket-platform/application";
import type { AccommodationFixedPlan, AccommodationTentCount } from "@ticket-platform/contracts";
import type { SqlConnection, SqlConnectionPool } from "./postgres.js";

interface EventResult {
  readonly id: string;
  readonly title: string;
  readonly timezone: string;
  readonly starts_at: string;
  readonly ends_at: string | null;
}

interface OrderItemResult {
  readonly order_id: string;
  readonly order_number: string;
  readonly buyer_name: string | null;
  readonly product_id: string;
  readonly product_title: string;
  readonly quantity: number;
  readonly bundle_composition: unknown;
  readonly inventory_units_per_item: number;
  readonly includes_sleeping_place: boolean;
}

interface GroupResult {
  readonly group_id: string;
  readonly note: string;
  readonly order_ids: readonly string[];
}

interface PlanResult {
  readonly id: string;
  readonly fixed_at: string;
  readonly fixed_by_admin_name: string | null;
  readonly note: string;
  readonly required_berths: number;
  readonly total_tents: number;
  readonly snapshot: unknown;
}

export class PostgresAdminAccommodationRepository
  implements AdminAccommodationRepository
{
  constructor(private readonly pool: SqlConnectionPool) {}

  async findEvent(eventId: string): Promise<AccommodationEventRow | null> {
    return this.read(async (connection) => {
      const result = await connection.query<EventResult>(
        `select id, title, timezone, starts_at, ends_at
           from public.events
          where id = $1::uuid`,
        [eventId]
      );
      const row = result.rows[0];
      if (!row) {
        return null;
      }
      return {
        id: row.id,
        title: row.title,
        timezone: row.timezone,
        startsAt: new Date(row.starts_at),
        endsAt: row.ends_at === null ? null : new Date(row.ends_at)
      };
    });
  }

  /**
   * Позиции оплаченных заказов. Билеты, по которым сделали возврат, в расселение не идут:
   * `orders.status = 'paid'` отсекает и возвраты, и брошенные черновики.
   */
  async listPaidOrderItems(
    eventId: string
  ): Promise<readonly AccommodationOrderItemRow[]> {
    return this.read(async (connection) => {
      const result = await connection.query<OrderItemResult>(
        `select
           o.id as order_id,
           o.number as order_number,
           u.display_name as buyer_name,
           p.id as product_id,
           p.title as product_title,
           i.quantity as quantity,
           p.bundle_composition as bundle_composition,
           p.inventory_units_per_item as inventory_units_per_item,
           p.includes_sleeping_place as includes_sleeping_place
         from public.orders o
         join public.order_items i on i.order_id = o.id
         join public.ticket_products p on p.id = i.product_id
         join public.users u on u.id = o.user_id
         where o.event_id = $1::uuid
           and o.status = 'paid'
         order by o.paid_at, o.id, i.created_at`,
        [eventId]
      );

      return result.rows.map((row) => ({
        orderId: row.order_id,
        orderNumber: row.order_number,
        buyerName: row.buyer_name,
        productId: row.product_id,
        productTitle: row.product_title,
        quantity: row.quantity,
        bundleComposition: toBundleComposition(row.bundle_composition),
        inventoryUnitsPerItem: row.inventory_units_per_item,
        includesSleepingPlace: row.includes_sleeping_place
      }));
    });
  }

  async listGroups(eventId: string): Promise<readonly AccommodationGroupRow[]> {
    return this.read(async (connection) => {
      const result = await connection.query<GroupResult>(
        `select
           g.id as group_id,
           g.note as note,
           coalesce(
             array_agg(m.order_id order by m.added_at) filter (where m.order_id is not null),
             '{}'::uuid[]
           ) as order_ids
         from public.accommodation_groups g
         left join public.accommodation_group_orders m on m.group_id = g.id
         where g.event_id = $1::uuid
         group by g.id, g.note, g.created_at
         order by g.created_at`,
        [eventId]
      );

      return result.rows.map((row) => ({
        groupId: row.group_id,
        note: row.note,
        orderIds: [...row.order_ids]
      }));
    });
  }

  async findLastPlan(eventId: string): Promise<AccommodationFixedPlan | null> {
    return this.read(async (connection) => {
      const result = await connection.query<PlanResult>(
        `select
           p.id as id,
           p.fixed_at as fixed_at,
           a.display_name as fixed_by_admin_name,
           p.note as note,
           p.required_berths as required_berths,
           p.total_tents as total_tents,
           p.snapshot as snapshot
         from public.accommodation_plans p
         left join public.admin_accounts a on a.id = p.fixed_by_admin_id
         where p.event_id = $1::uuid
         order by p.fixed_at desc
         limit 1`,
        [eventId]
      );

      const row = result.rows[0];
      if (!row) {
        return null;
      }
      return {
        id: row.id,
        fixedAt: new Date(row.fixed_at).toISOString(),
        fixedByAdminName: row.fixed_by_admin_name,
        note: row.note,
        requiredBerths: row.required_berths,
        totalTents: row.total_tents,
        tents: toTentCounts(row.snapshot)
      };
    });
  }

  async hasManagePermission(adminId: string): Promise<boolean> {
    return this.read(async (connection) => {
      const result = await connection.query<{ readonly granted: boolean }>(
        `select exists (
           select 1
             from public.admin_role_grants g
             join public.admin_role_permissions rp on rp.role_code = g.role_code
            where g.admin_account_id = $1::uuid
              and g.revoked_at is null
              and rp.permission_code = 'accommodation.manage'
         ) as granted`,
        [adminId]
      );
      return result.rows[0]?.granted === true;
    });
  }

  /**
   * Объединяет заказы в одну компанию. Заказ может состоять только в одной группе, поэтому
   * его сначала вынимают из прежней: менеджер пересобирает состав, а не ловит ошибку.
   */
  async createGroup(input: CreateAccommodationGroupInput): Promise<void> {
    await this.write(async (connection) => {
      const orders = await connection.query<{ readonly id: string }>(
        `select id from public.orders
          where id = any($1::uuid[])
            and event_id = $2::uuid
            and status = 'paid'`,
        [[...input.orderIds], input.eventId]
      );
      if (orders.rows.length !== input.orderIds.length) {
        throw new Error("Accommodation merge selection is invalid");
      }

      await connection.query(
        `delete from public.accommodation_group_orders
          where order_id = any($1::uuid[])`,
        [[...input.orderIds]]
      );

      await connection.query(
        `insert into public.accommodation_groups (id, event_id, note, created_by_admin_id)
         values ($1::uuid, $2::uuid, $3::text, $4::uuid)`,
        [input.groupId, input.eventId, input.note, input.adminId]
      );

      await connection.query(
        `insert into public.accommodation_group_orders (group_id, order_id)
         select $1::uuid, unnest($2::uuid[])`,
        [input.groupId, [...input.orderIds]]
      );

      await this.dropEmptyGroups(connection, input.eventId);
    });
  }

  async deleteGroup(eventId: string, groupId: string): Promise<void> {
    await this.write(async (connection) => {
      await connection.query(
        `delete from public.accommodation_groups
          where id = $1::uuid and event_id = $2::uuid`,
        [groupId, eventId]
      );
    });
  }

  async insertPlan(input: InsertAccommodationPlanInput): Promise<void> {
    await this.write(async (connection) => {
      await connection.query(
        `insert into public.accommodation_plans (
           id, event_id, fixed_by_admin_id, fixed_at, note,
           required_berths, total_tents, snapshot
         ) values (
           $1::uuid, $2::uuid, $3::uuid, $4::timestamptz, $5::text,
           $6::integer, $7::integer, $8::jsonb
         )`,
        [
          input.planId,
          input.eventId,
          input.adminId,
          input.fixedAt.toISOString(),
          input.note,
          input.requiredBerths,
          input.totalTents,
          JSON.stringify(input.snapshot)
        ]
      );
    });
  }

  /** Группа, из которой забрали все заказы, больше ничего не значит. */
  private async dropEmptyGroups(
    connection: SqlConnection,
    eventId: string
  ): Promise<void> {
    await connection.query(
      `delete from public.accommodation_groups g
        where g.event_id = $1::uuid
          and not exists (
            select 1 from public.accommodation_group_orders m where m.group_id = g.id
          )`,
      [eventId]
    );
  }

  private async read<T>(work: (connection: SqlConnection) => Promise<T>): Promise<T> {
    const connection = await this.pool.connect();
    try {
      await connection.query(
        "begin transaction isolation level repeatable read read only"
      );
      const result = await work(connection);
      await connection.query("commit");
      return result;
    } catch (error) {
      await connection.query("rollback");
      throw error;
    } finally {
      connection.release();
    }
  }

  private async write<T>(work: (connection: SqlConnection) => Promise<T>): Promise<T> {
    const connection = await this.pool.connect();
    try {
      await connection.query("begin");
      const result = await work(connection);
      await connection.query("commit");
      return result;
    } catch (error) {
      await connection.query("rollback");
      throw error;
    } finally {
      connection.release();
    }
  }
}

export function createAdminAccommodationPersistence(
  pool: SqlConnectionPool
): AdminAccommodationRepository {
  return new PostgresAdminAccommodationRepository(pool);
}

function toBundleComposition(value: unknown): readonly AccommodationBundleRole[] {
  const parsed = typeof value === "string" ? safeParse(value) : value;
  if (!Array.isArray(parsed)) {
    return [];
  }

  const roles: AccommodationBundleRole[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const role = (entry as { role?: unknown }).role;
    const quantity = (entry as { quantity?: unknown }).quantity;
    if (typeof role === "string" && typeof quantity === "number") {
      roles.push({ role, quantity });
    }
  }
  return roles;
}

function toTentCounts(value: unknown): readonly AccommodationTentCount[] {
  const parsed = typeof value === "string" ? safeParse(value) : value;
  if (typeof parsed !== "object" || parsed === null) {
    return [];
  }
  const tents = (parsed as { tents?: unknown }).tents;
  if (!Array.isArray(tents)) {
    return [];
  }

  const counts: AccommodationTentCount[] = [];
  for (const entry of tents) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const capacity = (entry as { capacity?: unknown }).capacity;
    const count = (entry as { count?: unknown }).count;
    if (typeof capacity === "number" && typeof count === "number") {
      counts.push({ capacity, count });
    }
  }
  return counts;
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
