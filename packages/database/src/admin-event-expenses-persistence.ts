import type {
  AdminEventExpensesRepository,
  CancelExpenseInput,
  CreateExpenseInput,
  CreateVendorInput,
  ExpensesEventRow,
  ExpenseWriteOutcome,
  UpdateExpenseInput
} from "@ticket-platform/application";
import type {
  EventExpense,
  ExpenseCategory,
  ExpenseStatus,
  Vendor,
  VendorKind
} from "@ticket-platform/contracts";
import type { SqlConnection, SqlConnectionPool } from "./postgres.js";

interface ExpenseResult {
  readonly id: string;
  readonly category_code: string;
  readonly category_label: string;
  readonly vendor_id: string | null;
  readonly vendor_name: string | null;
  readonly title: string;
  readonly quantity: string;
  readonly unit: string;
  readonly planned_kopecks: string;
  readonly actual_kopecks: string | null;
  readonly status: string;
  readonly paid_at: string | null;
  readonly payment_method: string | null;
  readonly note: string;
  readonly cancelled_at: string | null;
  readonly cancelled_reason: string | null;
  readonly lock_version: number;
}

interface VendorResult {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly contact_name: string | null;
  readonly phone_e164: string | null;
  readonly telegram: string | null;
  readonly note: string;
  readonly is_archived: boolean;
  readonly expense_count: string;
}

/** Строка до правки — только то, что уходит в аудит, плюс версия для сверки. */
interface ExpenseBeforeResult {
  readonly title: string;
  readonly status: string;
  readonly planned_kopecks: string;
  readonly actual_kopecks: string | null;
  readonly lock_version: number;
}

/** Что вернул `update ... returning`: строка есть и версия совпала. */
interface WriteResult {
  readonly id: string;
  readonly lock_version: number;
}

export class PostgresAdminEventExpensesRepository
  implements AdminEventExpensesRepository
{
  constructor(private readonly pool: SqlConnectionPool) {}

  async findEvent(eventId: string): Promise<ExpensesEventRow | null> {
    return this.read(async (connection) => {
      const result = await connection.query<{
        readonly id: string;
        readonly title: string;
      }>(
        `select id, title from public.events where id = $1::uuid`,
        [eventId]
      );
      const row = result.rows[0];
      return row ? { id: row.id, title: row.title } : null;
    });
  }

  async listExpenses(eventId: string): Promise<readonly EventExpense[]> {
    return this.read(async (connection) => {
      const result = await connection.query<ExpenseResult>(
        `select
           e.id,
           e.category_code,
           c.label as category_label,
           e.vendor_id,
           v.name as vendor_name,
           e.title,
           e.quantity::text as quantity,
           e.unit,
           e.planned_kopecks::text as planned_kopecks,
           e.actual_kopecks::text as actual_kopecks,
           e.status,
           e.paid_at,
           e.payment_method,
           e.note,
           e.cancelled_at,
           e.cancelled_reason,
           e.lock_version
         from public.event_expenses e
         join public.expense_categories c on c.code = e.category_code
         left join public.vendors v on v.id = e.vendor_id
         where e.event_id = $1::uuid
         order by c.position, e.created_at`,
        [eventId]
      );

      return result.rows.map((row) => ({
        id: row.id,
        categoryCode: row.category_code,
        categoryLabel: row.category_label,
        vendorId: row.vendor_id,
        vendorName: row.vendor_name,
        title: row.title,
        quantity: row.quantity,
        unit: row.unit,
        plannedKopecks: row.planned_kopecks,
        actualKopecks: row.actual_kopecks,
        status: toStatus(row.status),
        paidAt: row.paid_at === null ? null : new Date(row.paid_at).toISOString(),
        paymentMethod: row.payment_method,
        note: row.note,
        cancelledAt: row.cancelled_at === null
          ? null
          : new Date(row.cancelled_at).toISOString(),
        cancelledReason: row.cancelled_reason,
        lockVersion: row.lock_version
      }));
    });
  }

  async listCategories(): Promise<readonly ExpenseCategory[]> {
    return this.read(async (connection) => {
      const result = await connection.query<{
        readonly code: string;
        readonly label: string;
        readonly position: number;
      }>(
        `select code, label, position
           from public.expense_categories
          order by position`,
        []
      );
      return result.rows.map((row) => ({
        code: row.code,
        label: row.label,
        position: row.position
      }));
    });
  }

  /**
   * Подрядчики общие для всех мероприятий, поэтому здесь же считается, сколько раз у
   * каждого что-то заказывали: это единственный способ ответить, у кого мы брали палатки
   * в прошлый раз.
   */
  async listVendors(): Promise<readonly Vendor[]> {
    return this.read(async (connection) => {
      const result = await connection.query<VendorResult>(
        `select
           v.id, v.name, v.kind, v.contact_name, v.phone_e164, v.telegram,
           v.note, v.is_archived,
           count(e.id)::text as expense_count
         from public.vendors v
         left join public.event_expenses e on e.vendor_id = v.id
         group by v.id
         order by v.is_archived, lower(btrim(v.name))`,
        []
      );
      return result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        kind: toVendorKind(row.kind),
        contactName: row.contact_name,
        phone: row.phone_e164,
        telegram: row.telegram,
        note: row.note,
        isArchived: row.is_archived,
        expenseCount: Number(row.expense_count)
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

  async createVendor(input: CreateVendorInput): Promise<boolean> {
    return this.write(async (connection) => {
      const result = await connection.query<{ readonly id: string }>(
        `insert into public.vendors (
           id, name, kind, contact_name, phone_e164, telegram, note,
           created_by_admin_id
         ) values (
           $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text, $7::text,
           $8::uuid
         )
         on conflict do nothing
         returning id`,
        [
          input.vendorId,
          input.name,
          input.kind,
          input.contactName,
          input.phone,
          input.telegram,
          input.note,
          input.adminId
        ]
      );
      return result.rows.length > 0;
    });
  }

  async createExpense(input: CreateExpenseInput): Promise<void> {
    await this.write(async (connection) => {
      await connection.query(
        `insert into public.event_expenses (
           id, event_id, category_code, vendor_id, title, quantity, unit,
           planned_kopecks, note, created_by_admin_id
         ) values (
           $1::uuid, $2::uuid, $3::text, $4::uuid, $5::text, $6::numeric, $7::text,
           $8::bigint, $9::text, $10::uuid
         )`,
        [
          input.expenseId,
          input.eventId,
          input.categoryCode,
          input.vendorId,
          input.title,
          input.quantity,
          input.unit,
          input.plannedKopecks,
          input.note,
          input.adminId
        ]
      );
    });
  }

  /**
   * Правка идёт под версией строки: смету двое правят с разных экранов, и «последний
   * выиграл» здесь означает молча стёртую чужую сумму. Что именно поменялось, уходит в
   * аудит — через полгода важно, что стояло изначально.
   */
  async updateExpense(input: UpdateExpenseInput): Promise<ExpenseWriteOutcome> {
    return this.write(async (connection) => {
      const before = await connection.query<ExpenseBeforeResult>(
        `select
           title,
           status,
           planned_kopecks::text as planned_kopecks,
           actual_kopecks::text as actual_kopecks,
           lock_version
         from public.event_expenses
         where id = $1::uuid and event_id = $2::uuid
         for update`,
        [input.expenseId, input.eventId]
      );
      const current = before.rows[0];
      if (!current) {
        return "missing";
      }
      if (current.lock_version !== input.lockVersion) {
        return "conflict";
      }

      const changes = input.changes;
      const result = await connection.query<WriteResult>(
        `update public.event_expenses
            set category_code = coalesce($3::text, category_code),
                vendor_id = case when $4::boolean then $5::uuid else vendor_id end,
                title = coalesce($6::text, title),
                quantity = coalesce($7::numeric, quantity),
                unit = coalesce($8::text, unit),
                planned_kopecks = coalesce($9::bigint, planned_kopecks),
                actual_kopecks = case
                  when $10::boolean then $11::bigint else actual_kopecks end,
                status = coalesce($12::text, status),
                paid_at = case when $13::boolean then $14::timestamptz else paid_at end,
                payment_method = case
                  when $15::boolean then $16::text else payment_method end,
                note = coalesce($17::text, note),
                updated_at = now(),
                lock_version = lock_version + 1
          where id = $1::uuid
            and event_id = $2::uuid
            and lock_version = $18::integer
            and status <> 'cancelled'
        returning id, lock_version`,
        [
          input.expenseId,
          input.eventId,
          changes.categoryCode ?? null,
          changes.vendorId !== undefined,
          changes.vendorId ?? null,
          changes.title ?? null,
          changes.quantity ?? null,
          changes.unit ?? null,
          changes.plannedKopecks ?? null,
          changes.actualKopecks !== undefined,
          changes.actualKopecks ?? null,
          changes.status ?? null,
          changes.paidAt !== undefined,
          changes.paidAt ?? null,
          changes.paymentMethod !== undefined,
          changes.paymentMethod ?? null,
          changes.note ?? null,
          input.lockVersion
        ]
      );
      if (result.rows.length === 0) {
        return "conflict";
      }

      await writeAudit(connection, {
        auditId: input.auditId,
        actorAdminId: input.actorAdminId,
        actorRole: input.actorRole,
        action: "event_expense.updated",
        expenseId: input.expenseId,
        reason: null,
        before: {
          plannedKopecks: current.planned_kopecks,
          actualKopecks: current.actual_kopecks,
          status: current.status,
          title: current.title
        },
        after: changesForAudit(changes)
      });

      return "applied";
    });
  }

  async cancelExpense(input: CancelExpenseInput): Promise<ExpenseWriteOutcome> {
    return this.write(async (connection) => {
      const result = await connection.query<WriteResult>(
        `update public.event_expenses
            set status = 'cancelled',
                cancelled_at = $3::timestamptz,
                cancelled_reason = $4::text,
                updated_at = now(),
                lock_version = lock_version + 1
          where id = $1::uuid
            and event_id = $2::uuid
            and lock_version = $5::integer
            and status <> 'cancelled'
        returning id, lock_version`,
        [
          input.expenseId,
          input.eventId,
          input.cancelledAt,
          input.reason,
          input.lockVersion
        ]
      );
      if (result.rows.length === 0) {
        const exists = await connection.query<{ readonly id: string }>(
          `select id from public.event_expenses
            where id = $1::uuid and event_id = $2::uuid`,
          [input.expenseId, input.eventId]
        );
        return exists.rows.length === 0 ? "missing" : "conflict";
      }

      await writeAudit(connection, {
        auditId: input.auditId,
        actorAdminId: input.actorAdminId,
        actorRole: input.actorRole,
        action: "event_expense.cancelled",
        expenseId: input.expenseId,
        reason: input.reason,
        before: null,
        after: { status: "cancelled" }
      });

      return "applied";
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

async function writeAudit(
  connection: SqlConnection,
  audit: {
    readonly auditId: string;
    readonly actorAdminId: string;
    readonly actorRole: string;
    readonly action: string;
    readonly expenseId: string;
    readonly reason: string | null;
    readonly before: Record<string, unknown> | null;
    readonly after: Record<string, unknown> | null;
  }
): Promise<void> {
  await connection.query(
    `insert into public.audit_log (
       id, actor_admin_id, actor_role, action, target_type, target_id,
       reason, before_masked, after_masked
     ) values (
       $1::uuid, $2::uuid, $3::text, $4::text, 'event_expense', $5::text,
       $6::text, $7::jsonb, $8::jsonb
     )`,
    [
      audit.auditId,
      audit.actorAdminId,
      audit.actorRole,
      audit.action,
      audit.expenseId,
      audit.reason,
      audit.before === null ? null : JSON.stringify(audit.before),
      audit.after === null ? null : JSON.stringify(audit.after)
    ]
  );
}

function changesForAudit(
  changes: UpdateExpenseInput["changes"]
): Record<string, unknown> {
  return {
    ...(changes.plannedKopecks !== undefined
      ? { plannedKopecks: changes.plannedKopecks }
      : {}),
    ...(changes.actualKopecks !== undefined
      ? { actualKopecks: changes.actualKopecks }
      : {}),
    ...(changes.status !== undefined ? { status: changes.status } : {}),
    ...(changes.title !== undefined ? { title: changes.title } : {})
  };
}

function toStatus(value: string): ExpenseStatus {
  return value === "committed" || value === "paid" || value === "cancelled"
    ? value
    : "planned";
}

function toVendorKind(value: string): VendorKind {
  return value === "rent"
    || value === "catering"
    || value === "transport"
    || value === "venue"
    || value === "staff"
    ? value
    : "other";
}

export function createAdminEventExpensesPersistence(pool: SqlConnectionPool): {
  readonly repository: AdminEventExpensesRepository;
} {
  return { repository: new PostgresAdminEventExpensesRepository(pool) };
}
