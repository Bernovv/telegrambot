import type {
  AdminRoleGrantRepository,
  GrantAdminRoleOutcome,
  GrantAdminRoleRecord
} from "@ticket-platform/application";
import type { SqlConnectionPool } from "./postgres.js";

export class PostgresAdminRoleGrantRepository implements AdminRoleGrantRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  async grant(record: GrantAdminRoleRecord): Promise<GrantAdminRoleOutcome> {
    const connection = await this.pool.connect();

    try {
      await connection.query("begin");

      try {
        const role = await connection.query<{ readonly code: string }>(
          "select code from public.admin_roles where code = $1",
          [record.roleCode]
        );
        if (!role.rows[0]) {
          await connection.query("rollback");
          return { status: "unknown_role" };
        }

        let grantedByAdminId: string | null = null;
        if (record.grantedByAuthSubject !== null) {
          const granting = await connection.query<{ readonly id: string }>(
            "select id from public.admin_accounts where auth_subject = $1",
            [record.grantedByAuthSubject]
          );
          const found = granting.rows[0];
          if (!found) {
            await connection.query("rollback");
            return { status: "unknown_granting_admin" };
          }
          grantedByAdminId = found.id;
        }

        // Учётная запись может уже существовать: роль выдают и второй раз, добавляя её к
        // имеющейся. Имя и почту при этом освежаем, если их передали, — но не стираем
        // прежние пустым значением.
        const account = await connection.query<{ readonly id: string }>(
          `insert into public.admin_accounts (
             id,
             auth_subject,
             email_normalized,
             display_name,
             status,
             created_at,
             updated_at
           ) values ($1, $2, $3, $4, 'active', $5, $5)
           on conflict (auth_subject) do update
             set email_normalized =
                   coalesce(excluded.email_normalized, admin_accounts.email_normalized),
                 display_name =
                   coalesce(excluded.display_name, admin_accounts.display_name),
                 updated_at = excluded.updated_at
           returning id`,
          [
            record.adminId,
            record.authSubject,
            record.emailNormalized,
            record.displayName,
            record.occurredAt
          ]
        );
        const adminId = account.rows[0]?.id ?? record.adminId;

        // Действующая выдача той же роли одна — так устроен уникальный индекс. Повтор не
        // ошибка: чаще всего это второй запуск команды, и отвечать на него падением значит
        // заставлять человека выяснять, что же в итоге произошло.
        const granted = await connection.query(
          `insert into public.admin_role_grants (
             id,
             admin_account_id,
             role_code,
             granted_by_admin_id,
             granted_at,
             reason
           ) values ($1, $2, $3, $4, $5, $6)
           on conflict do nothing`,
          [
            record.roleGrantId,
            adminId,
            record.roleCode,
            grantedByAdminId,
            record.occurredAt,
            record.reason
          ]
        );
        if (granted.rowCount === 0) {
          await connection.query("commit");
          return { status: "already_granted", adminId };
        }

        // Идентификаторы подставляются дважды намеренно: `id` и `actor_admin_id` — uuid, а
        // `request_id` и `target_id` — text. На одном параметре Postgres пытается вывести
        // для него единый тип и отказывается ещё на разборе запроса.
        await connection.query(
          `insert into public.audit_log (
             id,
             actor_admin_id,
             actor_role,
             action,
             target_type,
             target_id,
             reason,
             after_masked,
             request_id,
             created_at
           ) values ($1, $2, $3, 'admin.role_granted', 'admin_account', $4, $5, $6::jsonb, $7, $8)`,
          [
            record.auditId,
            grantedByAdminId,
            record.roleCode,
            adminId,
            record.reason,
            JSON.stringify({ status: "active", roleCode: record.roleCode }),
            record.auditId,
            record.occurredAt
          ]
        );

        await connection.query("commit");
        return { status: "granted", adminId };
      } catch (error) {
        await connection.query("rollback");
        throw error;
      }
    } finally {
      connection.release();
    }
  }
}
