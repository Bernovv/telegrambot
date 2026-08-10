import type {
  AdminEventInventoryRepository,
  CreateInventoryItemInput,
  CreateInventoryNeedInput,
  InventoryEventRow,
  RecordMovementInput,
  SetInventoryComponentInput,
  StoredInventoryNeed,
  UpdateInventoryNeedInput
} from "@ticket-platform/application";
import type {
  InventoryCondition,
  InventoryItem,
  InventoryNeedStatus,
  InventorySource
} from "@ticket-platform/contracts";
import type { SqlConnection, SqlConnectionPool } from "./postgres.js";

interface ItemResult {
  readonly id: string;
  readonly title: string;
  readonly category_code: string;
  readonly category_label: string;
  readonly unit: string;
  readonly quantity_owned: string;
  readonly storage_location: string;
  readonly condition: string;
  readonly note: string;
  readonly is_archived: boolean;
}

interface ComponentResult {
  readonly parent_item_id: string;
  readonly child_item_id: string;
  readonly title: string;
  readonly unit: string;
  readonly quantity_per_parent: string;
}

interface NeedResult {
  readonly id: string;
  readonly item_id: string | null;
  readonly title: string;
  readonly quantity_needed: string;
  readonly source: string;
  readonly status: string;
  readonly note: string;
}

export class PostgresAdminEventInventoryRepository
  implements AdminEventInventoryRepository
{
  constructor(private readonly pool: SqlConnectionPool) {}

  async findEvent(eventId: string): Promise<InventoryEventRow | null> {
    return this.read(async (connection) => {
      const result = await connection.query<{
        readonly id: string;
        readonly title: string;
      }>(`select id, title from public.events where id = $1::uuid`, [eventId]);
      const row = result.rows[0];
      return row ? { id: row.id, title: row.title } : null;
    });
  }

  async listItems(): Promise<readonly InventoryItem[]> {
    return this.read(async (connection) => {
      const items = await connection.query<ItemResult>(
        `select
           i.id, i.title, i.category_code, c.label as category_label,
           i.unit, i.quantity_owned::text as quantity_owned,
           i.storage_location, i.condition, i.note, i.is_archived
         from public.inventory_items i
         join public.expense_categories c on c.code = i.category_code
         order by i.is_archived, c.position, lower(btrim(i.title))`,
        []
      );
      const components = await connection.query<ComponentResult>(
        `select
           k.parent_item_id,
           k.child_item_id,
           child.title,
           child.unit,
           k.quantity_per_parent::text as quantity_per_parent
         from public.inventory_item_components k
         join public.inventory_items child on child.id = k.child_item_id
         order by lower(btrim(child.title))`,
        []
      );

      const byParent = new Map<string, ComponentResult[]>();
      for (const row of components.rows) {
        const list = byParent.get(row.parent_item_id) ?? [];
        list.push(row);
        byParent.set(row.parent_item_id, list);
      }

      return items.rows.map((row) => ({
        id: row.id,
        title: row.title,
        categoryCode: row.category_code,
        categoryLabel: row.category_label,
        unit: row.unit,
        quantityOwned: row.quantity_owned,
        storageLocation: row.storage_location,
        condition: toCondition(row.condition),
        note: row.note,
        isArchived: row.is_archived,
        components: (byParent.get(row.id) ?? []).map((component) => ({
          itemId: component.child_item_id,
          title: component.title,
          unit: component.unit,
          quantityPerParent: component.quantity_per_parent
        }))
      }));
    });
  }

  async listNeeds(eventId: string): Promise<readonly StoredInventoryNeed[]> {
    return this.read(async (connection) => {
      const result = await connection.query<NeedResult>(
        `select
           id, item_id, title, quantity_needed::text as quantity_needed,
           source, status, note
         from public.event_inventory_needs
         where event_id = $1::uuid
         order by created_at`,
        [eventId]
      );
      return result.rows.map((row) => ({
        id: row.id,
        itemId: row.item_id,
        title: row.title,
        quantityNeeded: row.quantity_needed,
        source: toSource(row.source),
        status: toStatus(row.status),
        note: row.note
      }));
    });
  }

  async hasPermission(adminId: string, permission: string): Promise<boolean> {
    return this.read(async (connection) => {
      const result = await connection.query<{ readonly granted: boolean }>(
        `select exists (
           select 1
             from public.admin_role_grants g
             join public.admin_role_permissions rp on rp.role_code = g.role_code
            where g.admin_account_id = $1::uuid
              and g.revoked_at is null
              and rp.permission_code = $2::text
         ) as granted`,
        [adminId, permission]
      );
      return result.rows[0]?.granted === true;
    });
  }

  /**
   * Новая позиция заводится вместе с движением «закупка», если на ней сразу указан
   * остаток: иначе число на складе появилось бы из ниоткуда, без строки в истории.
   */
  async createItem(input: CreateInventoryItemInput): Promise<boolean> {
    return this.write(async (connection) => {
      const created = await connection.query<{ readonly id: string }>(
        `insert into public.inventory_items (
           id, title, category_code, unit, quantity_owned, storage_location,
           condition, note, created_by_admin_id
         ) values (
           $1::uuid, $2::text, $3::text, $4::text, $5::numeric, $6::text,
           $7::text, $8::text, $9::uuid
         )
         on conflict do nothing
         returning id`,
        [
          input.itemId,
          input.title,
          input.categoryCode,
          input.unit,
          input.quantityOwned,
          input.storageLocation,
          input.condition,
          input.note,
          input.adminId
        ]
      );
      if (created.rows.length === 0) {
        return false;
      }

      if (Number(input.quantityOwned) > 0) {
        await connection.query(
          `insert into public.inventory_movements (
             id, item_id, kind, quantity_delta, note, admin_id
           ) values (
             gen_random_uuid(), $1::uuid, 'audit', $2::numeric,
             'Остаток при заведении карточки', $3::uuid
           )`,
          [input.itemId, input.quantityOwned, input.adminId]
        );
      }
      return true;
    });
  }

  async setComponent(input: SetInventoryComponentInput): Promise<boolean> {
    return this.write(async (connection) => {
      const items = await connection.query<{ readonly id: string }>(
        `select id from public.inventory_items where id in ($1::uuid, $2::uuid)`,
        [input.parentItemId, input.childItemId]
      );
      if (items.rows.length < 2) {
        return false;
      }

      if (Number(input.quantityPerParent) === 0) {
        await connection.query(
          `delete from public.inventory_item_components
            where parent_item_id = $1::uuid and child_item_id = $2::uuid`,
          [input.parentItemId, input.childItemId]
        );
        return true;
      }

      await connection.query(
        `insert into public.inventory_item_components (
           parent_item_id, child_item_id, quantity_per_parent
         ) values ($1::uuid, $2::uuid, $3::numeric)
         on conflict (parent_item_id, child_item_id) do update
           set quantity_per_parent = excluded.quantity_per_parent`,
        [input.parentItemId, input.childItemId, input.quantityPerParent]
      );
      return true;
    });
  }

  async createNeed(input: CreateInventoryNeedInput): Promise<void> {
    await this.write(async (connection) => {
      await connection.query(
        `insert into public.event_inventory_needs (
           id, event_id, item_id, title, quantity_needed, source, note,
           created_by_admin_id
         ) values (
           $1::uuid, $2::uuid, $3::uuid,
           coalesce(nullif($4::text, ''), (
             select title from public.inventory_items where id = $3::uuid
           )),
           $5::numeric, $6::text, $7::text, $8::uuid
         )`,
        [
          input.needId,
          input.eventId,
          input.itemId,
          input.title,
          input.quantityNeeded,
          input.source,
          input.note,
          input.adminId
        ]
      );
    });
  }

  async updateNeed(input: UpdateInventoryNeedInput): Promise<boolean> {
    return this.write(async (connection) => {
      const changes = input.changes;
      const result = await connection.query<{ readonly id: string }>(
        `update public.event_inventory_needs
            set quantity_needed = coalesce($3::numeric, quantity_needed),
                source = coalesce($4::text, source),
                status = coalesce($5::text, status),
                note = coalesce($6::text, note),
                updated_at = now()
          where id = $1::uuid and event_id = $2::uuid
        returning id`,
        [
          input.needId,
          input.eventId,
          changes.quantityNeeded ?? null,
          changes.source ?? null,
          changes.status ?? null,
          changes.note ?? null
        ]
      );
      return result.rows.length > 0;
    });
  }

  /**
   * Движение и остаток пишутся в одной транзакции: остаток — это сумма движений, и
   * разойтись они не должны даже на секунду.
   */
  async recordMovement(input: RecordMovementInput): Promise<boolean> {
    return this.write(async (connection) => {
      const updated = await connection.query<{ readonly id: string }>(
        `update public.inventory_items
            set quantity_owned = greatest(0, quantity_owned + $2::numeric),
                updated_at = now()
          where id = $1::uuid
        returning id`,
        [input.itemId, input.quantityDelta]
      );
      if (updated.rows.length === 0) {
        return false;
      }

      await connection.query(
        `insert into public.inventory_movements (
           id, item_id, event_id, kind, quantity_delta, note, admin_id
         ) values (
           $1::uuid, $2::uuid, $3::uuid, $4::text, $5::numeric, $6::text, $7::uuid
         )`,
        [
          input.movementId,
          input.itemId,
          input.eventId,
          input.kind,
          input.quantityDelta,
          input.note,
          input.adminId
        ]
      );
      return true;
    });
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

function toCondition(value: string): InventoryCondition {
  return value === "new" || value === "worn" || value === "broken" ? value : "good";
}

function toSource(value: string): InventorySource {
  return value === "buy" || value === "rent" ? value : "stock";
}

function toStatus(value: string): InventoryNeedStatus {
  return value === "ordered"
    || value === "ready"
    || value === "loaded"
    || value === "returned"
    ? value
    : "needed";
}

export function createAdminEventInventoryPersistence(pool: SqlConnectionPool): {
  readonly repository: AdminEventInventoryRepository;
} {
  return { repository: new PostgresAdminEventInventoryRepository(pool) };
}
