import {
  buildExpensesView,
  buildInventoryView,
  buildParticipantsView,
  buildTeamView,
  type AdminEventOverviewRepository,
  type OverviewEventRow
} from "@ticket-platform/application";
import type {
  EventExpensesView,
  EventInventoryView,
  EventParticipantsView,
  EventTeamView
} from "@ticket-platform/contracts";
import { PostgresAdminEventExpensesRepository } from "./admin-event-expenses-persistence.js";
import { PostgresAdminEventInventoryRepository } from "./admin-event-inventory-persistence.js";
import { PostgresAdminEventParticipantsRepository } from "./admin-event-participants-persistence.js";
import { PostgresAdminEventTeamRepository } from "./admin-event-team-persistence.js";
import type { SqlConnection, SqlConnectionPool } from "./postgres.js";

interface OverviewEventResult {
  readonly id: string;
  readonly title: string;
  readonly capacity: number;
  readonly occupied_units: string;
  readonly offer_required: boolean;
  readonly is_free: boolean;
  readonly has_active_offer: boolean;
  readonly priced_product_count: string;
}

/**
 * Обзор собирается из тех же репозиториев и тех же чистых сборок, что и сами вкладки.
 *
 * Свои запросы здесь были бы вторым определением одних и тех же чисел, и первое же
 * расхождение в правилах отбора (отменённый расход, тестовый заказ) развело бы обзор со
 * вкладкой. Своё тут только одно — состояние мероприятия для чек-листа.
 */
export class PostgresAdminEventOverviewRepository
  implements AdminEventOverviewRepository
{
  private readonly participants: PostgresAdminEventParticipantsRepository;
  private readonly expenses: PostgresAdminEventExpensesRepository;
  private readonly inventory: PostgresAdminEventInventoryRepository;
  private readonly team: PostgresAdminEventTeamRepository;

  constructor(private readonly pool: SqlConnectionPool) {
    this.participants = new PostgresAdminEventParticipantsRepository(pool);
    this.expenses = new PostgresAdminEventExpensesRepository(pool);
    this.inventory = new PostgresAdminEventInventoryRepository(pool);
    this.team = new PostgresAdminEventTeamRepository(pool);
  }

  async findEvent(eventId: string): Promise<OverviewEventRow | null> {
    return this.read(async (connection) => {
      const result = await connection.query<OverviewEventResult>(
        `select
           e.id,
           e.title,
           e.capacity,
           -- Занято = активные брони плюс выкупленное, ровно как в списке мероприятий:
           -- отдельной колонки на продукте нет, это сумма по резервированиям.
           coalesce((
             select sum(r.inventory_units)
               from public.inventory_reservations r
               join public.ticket_products p on p.id = r.product_id
              where p.event_id = e.id
                and (
                  (r.status = 'active' and r.expires_at > now())
                  or r.status = 'consumed'
                )
           ), 0)::text as occupied_units,
           e.offer_required,
           e.is_free,
           (e.active_offer_version_id is not null) as has_active_offer,
           coalesce((
             select count(distinct p.id)
               from public.ticket_products p
               join public.pricing_rules r on r.product_id = p.id
              where p.event_id = e.id
                and p.is_active
                and r.is_active
           ), 0)::text as priced_product_count
         from public.events e
         where e.id = $1::uuid`,
        [eventId]
      );
      const row = result.rows[0];
      if (!row) {
        return null;
      }
      return {
        id: row.id,
        title: row.title,
        capacity: row.capacity,
        occupiedUnits: Number(row.occupied_units),
        offerRequired: row.offer_required,
        isFree: row.is_free,
        hasActiveOffer: row.has_active_offer,
        pricedProductCount: Number(row.priced_product_count)
      };
    });
  }

  async loadParticipants(eventId: string): Promise<EventParticipantsView> {
    const [
      event,
      items,
      participants,
      fields,
      orderAnswers,
      attendance,
      excludedOrders
    ] = await Promise.all([
      this.participants.findEvent(eventId),
      this.participants.listPaidOrderItems(eventId),
      this.participants.listParticipants(eventId),
      this.participants.listParticipantFields(eventId),
      this.participants.listOrderFieldValues(eventId),
      this.participants.listAttendance(eventId),
      this.participants.countExcludedOrders(eventId)
    ]);

    return buildParticipantsView({
      event: event ?? { id: eventId, title: "" },
      items,
      participants,
      fields,
      orderAnswers,
      attendance,
      excludedOrders,
      // Обзор ничего не правит, поэтому и права на правку в нём не спрашиваются.
      canManageParticipants: false,
      calculatedAt: new Date()
    });
  }

  async loadExpenses(eventId: string): Promise<EventExpensesView> {
    const [event, expenses, categories] = await Promise.all([
      this.expenses.findEvent(eventId),
      this.expenses.listExpenses(eventId),
      this.expenses.listCategories()
    ]);

    return buildExpensesView({
      event: event ?? { id: eventId, title: "" },
      expenses,
      categories,
      vendors: [],
      canManage: false,
      calculatedAt: new Date()
    });
  }

  async loadInventory(eventId: string): Promise<EventInventoryView> {
    const [event, items, needs] = await Promise.all([
      this.inventory.findEvent(eventId),
      this.inventory.listItems(),
      this.inventory.listNeeds(eventId)
    ]);

    return buildInventoryView({
      event: event ?? { id: eventId, title: "" },
      items,
      needs,
      canManage: false,
      calculatedAt: new Date()
    });
  }

  async loadTeam(eventId: string): Promise<EventTeamView> {
    const [event, money, organizers] = await Promise.all([
      this.team.findEvent(eventId),
      this.team.loadMoney(eventId),
      this.team.listOrganizers(eventId)
    ]);

    return buildTeamView({
      event: event ?? { id: eventId, title: "" },
      money,
      organizers,
      canManage: false,
      calculatedAt: new Date()
    });
  }

  async hasFixedTentPlan(eventId: string): Promise<boolean> {
    return this.read(async (connection) => {
      const result = await connection.query<{ readonly fixed: boolean }>(
        `select exists (
           select 1 from public.accommodation_plans where event_id = $1::uuid
         ) as fixed`,
        [eventId]
      );
      return result.rows[0]?.fixed === true;
    });
  }

  hasPermission(adminId: string, permission: string): Promise<boolean> {
    return this.team.hasPermission(adminId, permission);
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
}

export function createAdminEventOverviewPersistence(pool: SqlConnectionPool): {
  readonly repository: AdminEventOverviewRepository;
} {
  return { repository: new PostgresAdminEventOverviewRepository(pool) };
}
