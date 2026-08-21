import type {
  AdminStaffRepository,
  StoredMentorSlot,
  StoredStaffMember
} from "@ticket-platform/application";
import type { SqlConnection, SqlConnectionPool } from "./postgres.js";

interface MemberRow {
  readonly admin_id: string;
  readonly display_name: string;
  readonly email_normalized: string | null;
  readonly status: "active" | "suspended";
  readonly role_codes: readonly string[];
  readonly free_slots: string;
  readonly booked_slots: string;
}

interface SlotRow {
  readonly id: string;
  readonly mentor_admin_id: string;
  readonly mentor_name: string;
  readonly starts_at: Date | string;
  readonly duration_minutes: number;
  readonly contact_id: string | null;
  readonly contact_name: string | null;
  readonly contact_phone: string | null;
  readonly booked_by_name: string | null;
  readonly booked_at: Date | string | null;
  readonly note: string | null;
}

/**
 * Команда кабинета и календари наставников.
 *
 * Роли лежат там же, где лежали всегда, — в выданных грантах: отдельной таблицы «команда»
 * нет и быть не должно, иначе появилось бы два ответа на вопрос, что человеку доступно.
 * Страница «Команда» — это тот же список грантов, показанный по-человечески.
 */
export class PostgresAdminStaffRepository implements AdminStaffRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  async listMembers(): Promise<readonly StoredStaffMember[]> {
    return this.read(async (connection) => {
      const result = await connection.query<MemberRow>(
        `select account.id as admin_id,
                coalesce(
                  account.display_name, account.email_normalized, 'Без имени'
                ) as display_name,
                account.email_normalized,
                account.status,
                coalesce(
                  array_remove(array_agg(distinct grant_row.role_code), null),
                  '{}'
                ) as role_codes,
                (
                  select count(*)
                    from public.mentor_slots slot
                   where slot.mentor_admin_id = account.id
                     and slot.cancelled_at is null
                     and slot.contact_id is null
                     and slot.starts_at > now()
                ) as free_slots,
                (
                  select count(*)
                    from public.mentor_slots slot
                   where slot.mentor_admin_id = account.id
                     and slot.cancelled_at is null
                     and slot.contact_id is not null
                     and slot.starts_at > now()
                ) as booked_slots
           from public.admin_accounts account
           left join public.admin_role_grants grant_row
             on grant_row.admin_account_id = account.id
            and grant_row.revoked_at is null
          group by account.id
          order by display_name`
      );
      return result.rows.map((row) => ({
        adminId: row.admin_id,
        displayName: row.display_name,
        email: row.email_normalized,
        status: row.status,
        roleCodes: row.role_codes,
        freeSlots: Number(row.free_slots),
        bookedSlots: Number(row.booked_slots)
      }));
    });
  }

  async hasPermission(adminId: string, permission: string): Promise<boolean> {
    return this.read(async (connection) => {
      const result = await connection.query<{ readonly granted: boolean }>(
        `select exists (
           select 1
             from public.admin_role_grants grant_row
             join public.admin_role_permissions role_permission
               on role_permission.role_code = grant_row.role_code
            where grant_row.admin_account_id = $1::uuid
              and grant_row.revoked_at is null
              and role_permission.permission_code = $2::text
         ) as granted`,
        [adminId, permission]
      );
      return result.rows[0]?.granted === true;
    });
  }

  async grantRole(
    input: Parameters<AdminStaffRepository["grantRole"]>[0]
  ): Promise<boolean> {
    return this.write(async (connection) => {
      const result = await connection.query<{ readonly id: string }>(
        `insert into public.admin_role_grants (
           id, admin_account_id, role_code, granted_by_admin_id, granted_at, reason
         ) values (
           $1::uuid, $2::uuid, $3::text, $4::uuid, $5::timestamptz,
           'Выдано на странице «Команда»'
         )
         on conflict do nothing
         returning id`,
        [
          input.grantId,
          input.adminId,
          input.roleCode,
          input.grantedByAdminId,
          input.now
        ]
      );
      return result.rows.length > 0;
    });
  }

  /**
   * Снимает роль.
   *
   * Строка не удаляется: по журналу грантов видно, кто и когда открыл доступ и кто его
   * закрыл, а удалённая строка отвечает на это молчанием.
   */
  async revokeRole(
    input: Parameters<AdminStaffRepository["revokeRole"]>[0]
  ): Promise<boolean> {
    return this.write(async (connection) => {
      const result = await connection.query<{ readonly id: string }>(
        `update public.admin_role_grants
            set revoked_at = $3::timestamptz,
                revoked_by_admin_id = $4::uuid
          where admin_account_id = $1::uuid
            and role_code = $2::text
            and revoked_at is null
        returning id`,
        [input.adminId, input.roleCode, input.now, input.revokedByAdminId]
      );
      return result.rows.length > 0;
    });
  }

  async listSlots(
    filters: Parameters<AdminStaffRepository["listSlots"]>[0]
  ): Promise<readonly StoredMentorSlot[]> {
    return this.read(async (connection) => {
      const result = await connection.query<SlotRow>(
        `select slot.id, slot.mentor_admin_id,
                coalesce(
                  mentor.display_name, mentor.email_normalized, 'Наставник'
                ) as mentor_name,
                slot.starts_at, slot.duration_minutes,
                slot.contact_id, contact.display_name as contact_name,
                contact.phone_e164 as contact_phone,
                coalesce(booker.display_name, booker.email_normalized) as booked_by_name,
                slot.booked_at, slot.note
           from public.mentor_slots slot
           join public.admin_accounts mentor on mentor.id = slot.mentor_admin_id
           left join public.outreach_contacts contact on contact.id = slot.contact_id
           left join public.admin_accounts booker on booker.id = slot.booked_by_admin_id
          where slot.cancelled_at is null
            and slot.starts_at >= $1::timestamptz
            and slot.starts_at < $2::timestamptz
            and ($3::uuid is null or slot.mentor_admin_id = $3::uuid)
            and (not $4::boolean or slot.contact_id is null)
          order by slot.starts_at, mentor_name
          limit 500`,
        [
          filters.from,
          filters.to,
          filters.mentorAdminId ?? null,
          filters.onlyFree
        ]
      );
      return result.rows.map(mapSlot);
    });
  }

  /**
   * Заводит окошки пачкой.
   *
   * `on conflict do nothing` опирается на уникальность «наставник плюс время»: повтор
   * пропускается, а не отменяет всю пачку — расписание на месяц не должно ломаться из-за
   * одного часа, заведённого на прошлой неделе.
   */
  async createSlots(
    input: Parameters<AdminStaffRepository["createSlots"]>[0]
  ): Promise<number> {
    return this.write(async (connection) => {
      let created = 0;
      for (const slot of input.slots) {
        const result = await connection.query(
          `insert into public.mentor_slots (
             id, mentor_admin_id, starts_at, duration_minutes, note,
             created_by_admin_id, created_at, updated_at
           ) values (
             $1::uuid, $2::uuid, $3::timestamptz, $4::smallint, $5::text,
             $6::uuid, $7::timestamptz, $7::timestamptz
           )
           on conflict do nothing`,
          [
            slot.id,
            slot.mentorAdminId,
            slot.startsAt,
            slot.durationMinutes,
            slot.note,
            input.createdByAdminId,
            input.now
          ]
        );
        created += result.rowCount ?? 0;
      }
      return created;
    });
  }

  async cancelSlot(
    input: Parameters<AdminStaffRepository["cancelSlot"]>[0]
  ): Promise<boolean> {
    return this.write(async (connection) => {
      const result = await connection.query<{ readonly id: string }>(
        `update public.mentor_slots
            set cancelled_at = $2::timestamptz,
                cancelled_by_admin_id = $3::uuid,
                updated_at = $2::timestamptz
          where id = $1::uuid
            and cancelled_at is null
        returning id`,
        [input.slotId, input.now, input.cancelledByAdminId]
      );
      return result.rows.length > 0;
    });
  }

  /**
   * Записывает клиента в окошко и ставит ему дату личной встречи.
   *
   * Условие `contact_id is null` в запросе — это и есть защита от двух менеджеров,
   * выбравших один час: второму строка не достанется, и он увидит «окошко успели занять»,
   * а не молча перезапишет первого.
   */
  async bookSlot(
    input: Parameters<AdminStaffRepository["bookSlot"]>[0]
  ): Promise<"booked" | "already_booked" | "not_found"> {
    return this.write(async (connection) => {
      const booked = await connection.query<{ readonly id: string }>(
        `update public.mentor_slots
            set contact_id = $2::uuid,
                booked_by_admin_id = $3::uuid,
                booked_at = $4::timestamptz,
                note = coalesce($5::text, note),
                updated_at = $4::timestamptz
          where id = $1::uuid
            and cancelled_at is null
            and contact_id is null
        returning id`,
        [input.slotId, input.contactId, input.bookedByAdminId, input.now, input.note]
      );
      if (booked.rows.length === 0) {
        const existing = await connection.query<{ readonly contact_id: string | null }>(
          `select contact_id from public.mentor_slots
            where id = $1::uuid and cancelled_at is null`,
          [input.slotId]
        );
        return existing.rows.length === 0 ? "not_found" : "already_booked";
      }
      await connection.query(
        `update public.outreach_contacts
            set next_meeting_at = (
                  select starts_at from public.mentor_slots where id = $1::uuid
                ),
                updated_at = $3::timestamptz
          where id = $2::uuid`,
        [input.slotId, input.contactId, input.now]
      );
      return "booked";
    });
  }

  /**
   * Освобождает окошко.
   *
   * Дата встречи в карточке снимается только тогда, когда она указывает на это самое
   * окошко: у человека может быть назначена другая встреча, и стирать её отменой этой —
   * значит потерять её вовсе.
   */
  async releaseSlot(
    input: Parameters<AdminStaffRepository["releaseSlot"]>[0]
  ): Promise<boolean> {
    return this.write(async (connection) => {
      const current = await connection.query<{
        readonly contact_id: string | null;
        readonly starts_at: Date | string;
      }>(
        `select contact_id, starts_at
           from public.mentor_slots
          where id = $1::uuid and cancelled_at is null
          for update`,
        [input.slotId]
      );
      const slot = current.rows[0];
      if (!slot || slot.contact_id === null) {
        return false;
      }
      await connection.query(
        `update public.mentor_slots
            set contact_id = null,
                booked_by_admin_id = null,
                booked_at = null,
                updated_at = $2::timestamptz
          where id = $1::uuid`,
        [input.slotId, input.now]
      );
      await connection.query(
        `update public.outreach_contacts
            set next_meeting_at = null,
                updated_at = $3::timestamptz
          where id = $1::uuid
            and next_meeting_at = $2::timestamptz`,
        [slot.contact_id, slot.starts_at, input.now]
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

function mapSlot(row: SlotRow): StoredMentorSlot {
  return {
    id: row.id,
    mentorAdminId: row.mentor_admin_id,
    mentorName: row.mentor_name,
    startsAt: new Date(row.starts_at),
    durationMinutes: row.duration_minutes,
    contactId: row.contact_id,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    bookedByName: row.booked_by_name,
    bookedAt: row.booked_at === null ? null : new Date(row.booked_at),
    note: row.note
  };
}

export function createAdminStaffPersistence(pool: SqlConnectionPool): {
  readonly repository: AdminStaffRepository;
} {
  return { repository: new PostgresAdminStaffRepository(pool) };
}
