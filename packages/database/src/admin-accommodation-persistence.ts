import type {
  AccommodationBundleRole,
  AccommodationEventRow,
  AccommodationGroupRow,
  AccommodationOrderItemRow,
  AdminAccommodationRepository,
  CreateAccommodationGroupInput,
  CreateEventParticipantInput,
  CreateParticipantFieldInput,
  DeleteEventParticipantInput,
  SetParticipantFieldValueInput,
  UpdateEventParticipantInput,
  ExcludeOrderInput,
  InsertAccommodationPlanInput
} from "@ticket-platform/application";
import type {
  AccommodationFixedPlan,
  AccommodationTentCount,
  EventParticipant,
  EventParticipantFieldDefinition,
  EventParticipantFieldType,
  EventParticipantFieldValue,
  EventParticipantSource
} from "@ticket-platform/contracts";
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

interface ParticipantResult {
  readonly id: string;
  readonly display_name: string;
  readonly phone_e164: string | null;
  readonly source: string;
  readonly ticket_title: string;
  readonly adults: number;
  readonly children: number;
  readonly sleeping_places: number;
  readonly note: string;
  readonly outreach_contact_id: string | null;
  readonly amount_kopecks: string | null;
  readonly paid_at: string | null;
  readonly payment_method: string | null;
  readonly created_at: string;
}

interface ParticipantFieldRow {
  readonly id: string;
  readonly label: string;
  readonly field_type: string;
  readonly options: unknown;
  readonly event_id: string | null;
}

interface ParticipantFieldValueRow {
  readonly participant_id: string;
  readonly field_definition_id: string;
  readonly label: string;
  readonly field_type: string;
  readonly options: unknown;
  readonly value_text: string | null;
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
           and o.excluded_at is null
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

  async listParticipants(eventId: string): Promise<readonly EventParticipant[]> {
    return this.read(async (connection) => {
      const result = await connection.query<ParticipantResult>(
        `select
           id, display_name, phone_e164, source, ticket_title,
           adults, children, sleeping_places, note, outreach_contact_id,
           amount_kopecks::text, paid_at, payment_method, created_at
         from public.event_participants
         where event_id = $1::uuid
           and deleted_at is null
         order by created_at`,
        [eventId]
      );

      const values = await connection.query<ParticipantFieldValueRow>(
        `select
           v.participant_id,
           v.field_definition_id,
           d.label,
           d.field_type,
           d.options,
           v.value_text
         from public.event_participant_field_values v
         join public.event_participant_field_definitions d
           on d.id = v.field_definition_id
         join public.event_participants p on p.id = v.participant_id
         where p.event_id = $1::uuid
           and p.deleted_at is null
         order by d.position, d.created_at`,
        [eventId]
      );
      const valuesByParticipant = new Map<string, EventParticipantFieldValue[]>();
      for (const row of values.rows) {
        const list = valuesByParticipant.get(row.participant_id) ?? [];
        list.push({
          fieldId: row.field_definition_id,
          label: row.label,
          type: row.field_type as EventParticipantFieldType,
          options: toOptions(row.options),
          value: row.value_text
        });
        valuesByParticipant.set(row.participant_id, list);
      }

      return result.rows.map((row) => ({
        id: row.id,
        displayName: row.display_name,
        phone: row.phone_e164,
        source: row.source as EventParticipantSource,
        ticketTitle: row.ticket_title,
        adults: row.adults,
        children: row.children,
        sleepingPlaces: row.sleeping_places,
        note: row.note,
        outreachContactId: row.outreach_contact_id,
        amountKopecks: row.amount_kopecks,
        paidAt: row.paid_at === null ? null : new Date(row.paid_at).toISOString(),
        paymentMethod: row.payment_method,
        customFields: valuesByParticipant.get(row.id) ?? [],
        createdAt: new Date(row.created_at).toISOString()
      }));
    });
  }

  async countExcludedOrders(eventId: string): Promise<number> {
    return this.read(async (connection) => {
      const result = await connection.query<{ readonly total: string }>(
        `select count(*)::text as total
           from public.orders
          where event_id = $1::uuid
            and excluded_at is not null`,
        [eventId]
      );
      return Number(result.rows[0]?.total ?? "0");
    });
  }

  async createParticipant(input: CreateEventParticipantInput): Promise<void> {
    await this.write(async (connection) => {
      await connection.query(
        `insert into public.event_participants (
           id, event_id, outreach_contact_id, display_name, phone_e164, source,
           ticket_title, adults, children, sleeping_places, note, created_by_admin_id
         ) values (
           $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text,
           $7::text, $8::integer, $9::integer, $10::integer, $11::text, $12::uuid
         )`,
        [
          input.participantId,
          input.eventId,
          input.outreachContactId,
          input.displayName,
          input.phone,
          input.source,
          input.ticketTitle,
          input.adults,
          input.children,
          input.sleepingPlaces,
          input.note,
          input.adminId
        ]
      );
    });
  }

  async listParticipantFields(
    eventId: string
  ): Promise<readonly EventParticipantFieldDefinition[]> {
    return this.read(async (connection) => {
      const result = await connection.query<ParticipantFieldRow>(
        `select id, label, field_type, options, event_id
         from public.event_participant_field_definitions
         where event_id is null or event_id = $1::uuid
         order by position, created_at`,
        [eventId]
      );
      return result.rows.map((row) => ({
        id: row.id,
        label: row.label,
        type: row.field_type as EventParticipantFieldType,
        options: toOptions(row.options),
        global: row.event_id === null
      }));
    });
  }

  async createParticipantField(input: CreateParticipantFieldInput): Promise<void> {
    await this.write(async (connection) => {
      // Позиция — просто «в конец списка», порядок полей менеджер пока не двигает.
      await connection.query(
        `insert into public.event_participant_field_definitions (
           id, event_id, field_key, label, field_type, options, position,
           created_by_admin_id
         )
         select
           $1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::jsonb,
           coalesce(max(position), 0) + 1, $7::uuid
         from public.event_participant_field_definitions
         where event_id is not distinct from $2::uuid`,
        [
          input.fieldId,
          input.eventId,
          input.fieldKey,
          input.label,
          input.type,
          input.options === null ? null : JSON.stringify(input.options),
          input.adminId
        ]
      );
    });
  }

  async deleteParticipantField(fieldId: string): Promise<boolean> {
    return this.write(async (connection) => {
      const result = await connection.query(
        `delete from public.event_participant_field_definitions where id = $1::uuid`,
        [fieldId]
      );
      return result.rowCount > 0;
    });
  }

  async setParticipantFieldValue(
    input: SetParticipantFieldValueInput
  ): Promise<boolean> {
    return this.write(async (connection) => {
      const participant = await connection.query<{ readonly id: string }>(
        `select id from public.event_participants
          where id = $1::uuid and event_id = $2::uuid and deleted_at is null`,
        [input.participantId, input.eventId]
      );
      if (participant.rows.length === 0) {
        return false;
      }

      if (input.value === null) {
        await connection.query(
          `delete from public.event_participant_field_values
            where participant_id = $1::uuid and field_definition_id = $2::uuid`,
          [input.participantId, input.fieldId]
        );
        return true;
      }

      await connection.query(
        `insert into public.event_participant_field_values (
           participant_id, field_definition_id, value_text
         ) values ($1::uuid, $2::uuid, $3::text)
         on conflict (participant_id, field_definition_id) do update
           set value_text = excluded.value_text,
               updated_at = now()`,
        [input.participantId, input.fieldId, input.value]
      );
      return true;
    });
  }

  /**
   * Правка карточки. Каждое поле обновляется только если его прислали: `is not distinct from`
   * здесь не годится — нужно отличать «не менять» от «очистить».
   */
  async updateParticipant(input: UpdateEventParticipantInput): Promise<boolean> {
    return this.write(async (connection) => {
      const changes = input.changes;
      const result = await connection.query(
        `update public.event_participants
            set display_name = coalesce($3::text, display_name),
                phone_e164 = case when $4::boolean then $5::text else phone_e164 end,
                source = coalesce($6::text, source),
                ticket_title = coalesce($7::text, ticket_title),
                adults = coalesce($8::integer, adults),
                children = coalesce($9::integer, children),
                sleeping_places = coalesce($10::integer, sleeping_places),
                note = coalesce($11::text, note),
                amount_kopecks = case when $12::boolean then $13::bigint else amount_kopecks end,
                paid_at = case when $14::boolean then $15::timestamptz else paid_at end,
                payment_method = case when $16::boolean then $17::text else payment_method end,
                updated_at = now()
          where id = $1::uuid
            and event_id = $2::uuid
            and deleted_at is null`,
        [
          input.participantId,
          input.eventId,
          changes.displayName ?? null,
          changes.phone !== undefined,
          changes.phone ?? null,
          changes.source ?? null,
          changes.ticketTitle ?? null,
          changes.adults ?? null,
          changes.children ?? null,
          changes.sleepingPlaces ?? null,
          changes.note ?? null,
          changes.amountKopecks !== undefined,
          changes.amountKopecks ?? null,
          changes.paidAt !== undefined,
          changes.paidAt === undefined || changes.paidAt === null
            ? null
            : changes.paidAt.toISOString(),
          changes.paymentMethod !== undefined,
          changes.paymentMethod ?? null
        ]
      );
      return result.rowCount > 0;
    });
  }

  /** Мягкое удаление: запись остаётся с причиной и автором, из отчётов уходит. */
  async deleteParticipant(input: DeleteEventParticipantInput): Promise<boolean> {
    return this.write(async (connection) => {
      const result = await connection.query(
        `update public.event_participants
            set deleted_at = $1::timestamptz,
                deleted_reason = $2::text,
                deleted_by_admin_id = $3::uuid,
                updated_at = now()
          where id = $4::uuid
            and event_id = $5::uuid
            and deleted_at is null`,
        [
          input.deletedAt.toISOString(),
          input.reason,
          input.adminId,
          input.participantId,
          input.eventId
        ]
      );
      return result.rowCount > 0;
    });
  }

  async excludeOrder(input: ExcludeOrderInput): Promise<boolean> {
    return this.write(async (connection) => {
      const result = await connection.query(
        `update public.orders
            set excluded_at = $1::timestamptz,
                excluded_reason = $2::text,
                excluded_by_admin_id = $3::uuid
          where id = $4::uuid
            and excluded_at is null`,
        [
          input.excludedAt.toISOString(),
          input.reason,
          input.adminId,
          input.orderId
        ]
      );
      return result.rowCount > 0;
    });
  }

  async includeOrder(orderId: string): Promise<boolean> {
    return this.write(async (connection) => {
      const result = await connection.query(
        `update public.orders
            set excluded_at = null,
                excluded_reason = null,
                excluded_by_admin_id = null
          where id = $1::uuid
            and excluded_at is not null`,
        [orderId]
      );
      return result.rowCount > 0;
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

function toOptions(value: unknown): readonly string[] | null {
  const parsed = typeof value === "string" ? safeParse(value) : value;
  if (!Array.isArray(parsed)) {
    return null;
  }
  return parsed.filter((entry): entry is string => typeof entry === "string");
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
