import type {
  AdminEventTeamRepository,
  CreateOrganizerInput,
  EventMoneyRow,
  StoredOrganizer,
  TeamEventRow,
  UpdateOrganizerInput
} from "@ticket-platform/application";
import type { SqlConnection, SqlConnectionPool } from "./postgres.js";

interface MoneyResult {
  readonly revenue_from_orders: string;
  readonly revenue_from_manual: string;
  readonly expenses: string;
  readonly expenses_without_actual: string;
}

interface OrganizerResult {
  readonly id: string;
  readonly person_name: string;
  readonly role_label: string;
  readonly share_percent: string;
  readonly responsibilities: string;
  readonly note: string;
}

export class PostgresAdminEventTeamRepository implements AdminEventTeamRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  async findEvent(eventId: string): Promise<TeamEventRow | null> {
    return this.read(async (connection) => {
      const result = await connection.query<{
        readonly id: string;
        readonly title: string;
      }>(`select id, title from public.events where id = $1::uuid`, [eventId]);
      const row = result.rows[0];
      return row ? { id: row.id, title: row.title } : null;
    });
  }

  /**
   * Деньги мероприятия одним снимком.
   *
   * Выручка и расход читаются в одной транзакции: если между двумя запросами пройдёт
   * оплата, прибыль окажется посчитанной по разным моментам времени, и доли разойдутся с
   * тем, что показывают «Участники» и «Расходы».
   *
   * Отменённые расходы и заказы, помеченные тестовыми, не в счёт — по тем же правилам,
   * что на своих вкладках.
   */
  async loadMoney(eventId: string): Promise<EventMoneyRow> {
    return this.read(async (connection) => {
      const result = await connection.query<MoneyResult>(
        `select
           coalesce((
             select sum(o.total_kopecks)
               from public.orders o
              where o.event_id = $1::uuid
                and o.status = 'paid'
                and o.excluded_at is null
           ), 0)::text as revenue_from_orders,
           coalesce((
             select sum(p.amount_kopecks)
               from public.event_participants p
              where p.event_id = $1::uuid
                and p.deleted_at is null
           ), 0)::text as revenue_from_manual,
           coalesce((
             select sum(e.actual_kopecks)
               from public.event_expenses e
              where e.event_id = $1::uuid
                and e.status <> 'cancelled'
                and e.actual_kopecks is not null
           ), 0)::text as expenses,
           coalesce((
             select count(*)
               from public.event_expenses e
              where e.event_id = $1::uuid
                and e.status <> 'cancelled'
                and e.actual_kopecks is null
           ), 0)::text as expenses_without_actual`,
        [eventId]
      );
      const row = result.rows[0];
      return {
        revenueFromOrdersKopecks: row?.revenue_from_orders ?? "0",
        revenueFromManualKopecks: row?.revenue_from_manual ?? "0",
        expensesKopecks: row?.expenses ?? "0",
        expensesWithoutActual: Number(row?.expenses_without_actual ?? "0")
      };
    });
  }

  async listOrganizers(eventId: string): Promise<readonly StoredOrganizer[]> {
    return this.read(async (connection) => {
      const result = await connection.query<OrganizerResult>(
        `select id, person_name, role_label, share_percent::text as share_percent,
                responsibilities, note
           from public.event_organizers
          where event_id = $1::uuid
          order by share_percent desc, lower(btrim(person_name))`,
        [eventId]
      );
      return result.rows.map((row) => ({
        id: row.id,
        personName: row.person_name,
        roleLabel: row.role_label,
        sharePercent: row.share_percent,
        responsibilities: row.responsibilities,
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

  async createOrganizer(input: CreateOrganizerInput): Promise<boolean> {
    return this.write(async (connection) => {
      const result = await connection.query<{ readonly id: string }>(
        `insert into public.event_organizers (
           id, event_id, person_name, role_label, share_percent,
           responsibilities, note, created_by_admin_id
         ) values (
           $1::uuid, $2::uuid, $3::text, $4::text, $5::numeric,
           $6::text, $7::text, $8::uuid
         )
         on conflict do nothing
         returning id`,
        [
          input.organizerId,
          input.eventId,
          input.personName,
          input.roleLabel,
          input.sharePercent,
          input.responsibilities,
          input.note,
          input.adminId
        ]
      );
      return result.rows.length > 0;
    });
  }

  async updateOrganizer(input: UpdateOrganizerInput): Promise<boolean> {
    return this.write(async (connection) => {
      const changes = input.changes;
      const result = await connection.query<{ readonly id: string }>(
        `update public.event_organizers
            set person_name = coalesce($3::text, person_name),
                role_label = coalesce($4::text, role_label),
                share_percent = coalesce($5::numeric, share_percent),
                responsibilities = coalesce($6::text, responsibilities),
                note = coalesce($7::text, note),
                updated_at = now()
          where id = $1::uuid and event_id = $2::uuid
        returning id`,
        [
          input.organizerId,
          input.eventId,
          changes.personName ?? null,
          changes.roleLabel ?? null,
          changes.sharePercent ?? null,
          changes.responsibilities ?? null,
          changes.note ?? null
        ]
      );
      return result.rows.length > 0;
    });
  }

  async removeOrganizer(eventId: string, organizerId: string): Promise<boolean> {
    return this.write(async (connection) => {
      const result = await connection.query<{ readonly id: string }>(
        `delete from public.event_organizers
          where id = $1::uuid and event_id = $2::uuid
        returning id`,
        [organizerId, eventId]
      );
      return result.rows.length > 0;
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

export function createAdminEventTeamPersistence(pool: SqlConnectionPool): {
  readonly repository: AdminEventTeamRepository;
} {
  return { repository: new PostgresAdminEventTeamRepository(pool) };
}
