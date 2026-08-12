import { randomUUID } from "node:crypto";
import type {
  AdminEventParticipantsRepository,
  CreateImportedParticipantInput,
  ExistingPeople,
  OrderFieldValueRow,
  ParticipantOrderItemRow,
  ParticipantsEventRow,
  SaveOrderFieldValueInput
} from "@ticket-platform/application";
import type {
  EventParticipant,
  EventParticipantFieldDefinition,
  EventParticipantFieldType
} from "@ticket-platform/contracts";
import { PostgresAdminAccommodationRepository } from "./admin-accommodation-persistence.js";
import { toBundleComposition } from "./bundle-composition.js";
import type { SqlConnectionPool } from "./postgres.js";

interface OrderFieldValueResult {
  readonly order_id: string;
  readonly field_definition_id: string;
  readonly label: string;
  readonly field_type: string;
  readonly options: unknown;
  readonly value_text: string | null;
}

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

  listParticipantFields(
    eventId: string
  ): Promise<readonly EventParticipantFieldDefinition[]> {
    return this.accommodation.listParticipantFields(eventId);
  }

  saveParticipantFieldValue(input: {
    readonly eventId: string;
    readonly participantId: string;
    readonly fieldId: string;
    readonly value: string | null;
  }): Promise<boolean> {
    return this.accommodation.setParticipantFieldValue(input);
  }

  countExcludedOrders(eventId: string): Promise<number> {
    return this.accommodation.countExcludedOrders(eventId);
  }

  hasPermission(adminId: string, permission: string): Promise<boolean> {
    return this.accommodation.hasPermission(adminId, permission);
  }

  /**
   * Ответы бумажных анкет покупателей. Заказ фильтруется по мероприятию: определения полей
   * бывают общими для всех мероприятий, и без этого условия в список приехали бы ответы с
   * прошлогоднего пикника.
   */
  async listOrderFieldValues(
    eventId: string
  ): Promise<readonly OrderFieldValueRow[]> {
    const connection = await this.pool.connect();
    try {
      await connection.query(
        "begin transaction isolation level repeatable read read only"
      );
      const result = await connection.query<OrderFieldValueResult>(
        `select
           v.order_id,
           v.field_definition_id,
           d.label,
           d.field_type,
           d.options,
           v.value_text
         from public.event_order_field_values v
         join public.event_participant_field_definitions d
           on d.id = v.field_definition_id
         join public.orders o on o.id = v.order_id
         where o.event_id = $1::uuid
         order by d.position, d.created_at`,
        [eventId]
      );
      await connection.query("commit");

      return result.rows.map((row) => ({
        orderId: row.order_id,
        value: {
          fieldId: row.field_definition_id,
          label: row.label,
          type: toFieldType(row.field_type),
          options: toOptions(row.options),
          value: row.value_text
        }
      }));
    } catch (error) {
      await connection.query("rollback");
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Стёртый ответ удаляется строкой, а не пишется пустым: пустая строка и «не отвечали» —
   * разные вещи только на словах, а счётчик «внесено N из M» их различать не должен.
   */
  async saveOrderFieldValue(input: SaveOrderFieldValueInput): Promise<boolean> {
    const connection = await this.pool.connect();
    try {
      await connection.query("begin");
      const order = await connection.query<{ readonly id: string }>(
        `select id from public.orders
          where id = $1::uuid and event_id = $2::uuid and status = 'paid'`,
        [input.orderId, input.eventId]
      );
      if (order.rows.length === 0) {
        await connection.query("rollback");
        return false;
      }

      if (input.value === null) {
        await connection.query(
          `delete from public.event_order_field_values
            where order_id = $1::uuid and field_definition_id = $2::uuid`,
          [input.orderId, input.fieldId]
        );
      } else {
        await connection.query(
          `insert into public.event_order_field_values (
             order_id, field_definition_id, value_text, updated_by_admin_id
           ) values ($1::uuid, $2::uuid, $3::text, $4::uuid)
           on conflict (order_id, field_definition_id) do update
             set value_text = excluded.value_text,
                 updated_by_admin_id = excluded.updated_by_admin_id,
                 updated_at = now()`,
          [input.orderId, input.fieldId, input.value, input.adminId]
        );
      }

      await connection.query("commit");
      return true;
    } catch (error) {
      await connection.query("rollback");
      throw error;
    } finally {
      connection.release();
    }
  }

  /** Кто уже есть у мероприятия: покупатели бота и заведённые руками. */
  async loadExistingPeople(eventId: string): Promise<ExistingPeople> {
    const connection = await this.pool.connect();
    try {
      await connection.query(
        "begin transaction isolation level repeatable read read only"
      );
      const buyers = await connection.query<{
        readonly phone: string | null;
        readonly username: string | null;
      }>(
        `select
           contact.value_normalized as phone,
           identity.username as username
         from public.orders o
         left join lateral (
           select value_normalized from public.user_contacts
            where user_id = o.user_id and contact_type = 'phone'
            order by is_primary desc, created_at limit 1
         ) contact on true
         left join lateral (
           select username from public.messenger_identities
            where user_id = o.user_id and username is not null
            order by last_seen_at desc, id limit 1
         ) identity on true
         where o.event_id = $1::uuid
           and o.status = 'paid'
           and o.excluded_at is null`,
        [eventId]
      );
      const manual = await connection.query<{
        readonly display_name: string;
        readonly phone_e164: string | null;
      }>(
        `select display_name, phone_e164
           from public.event_participants
          where event_id = $1::uuid and deleted_at is null`,
        [eventId]
      );
      await connection.query("commit");

      const text = (value: string | null): value is string => value !== null;
      return {
        buyerPhones: buyers.rows.map((row) => row.phone).filter(text),
        buyerHandles: buyers.rows.map((row) => row.username).filter(text),
        manualPhones: manual.rows.map((row) => row.phone_e164).filter(text),
        manualNames: manual.rows.map((row) => row.display_name)
      };
    } catch (error) {
      await connection.query("rollback");
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Весь список одной транзакцией: наполовину занесённый список хуже, чем не занесённый
   * вовсе — по нему уже нельзя понять, где остановились.
   */
  async createImportedParticipants(
    inputs: readonly CreateImportedParticipantInput[]
  ): Promise<void> {
    const connection = await this.pool.connect();
    try {
      await connection.query("begin");
      for (const input of inputs) {
        await connection.query(
          `insert into public.event_participants (
             id, event_id, display_name, phone_e164, source, ticket_title,
             adults, children, sleeping_places, note, amount_kopecks,
             created_by_admin_id
           ) values (
             $1::uuid, $2::uuid, $3::text, $4::text, 'direct', '',
             $5::integer, $6::integer, $7::integer, $8::text, $9::bigint,
             $10::uuid
           )`,
          [
            input.participantId === "" ? randomUUID() : input.participantId,
            input.eventId,
            input.name,
            input.phone,
            input.adults,
            input.children,
            input.sleeping,
            [input.note, input.telegram ?? ""]
              .filter((part) => part !== "")
              .join("; ")
              .slice(0, 500),
            input.amountKopecks,
            input.adminId
          ]
        );
      }
      await connection.query("commit");
    } catch (error) {
      await connection.query("rollback");
      throw error;
    } finally {
      connection.release();
    }
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

function toFieldType(value: string): EventParticipantFieldType {
  return value === "number" || value === "date" || value === "select"
    ? value
    : "text";
}

function toOptions(value: unknown): readonly string[] | null {
  const parsed = typeof value === "string" ? safeParse(value) : value;
  if (!Array.isArray(parsed)) {
    return null;
  }
  return parsed.filter((entry): entry is string => typeof entry === "string");
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function createAdminEventParticipantsPersistence(pool: SqlConnectionPool): {
  readonly repository: AdminEventParticipantsRepository;
} {
  return { repository: new PostgresAdminEventParticipantsRepository(pool) };
}
