import type {
  BootstrapAdminRecord,
  FirstAdminBootstrapRepository
} from "@ticket-platform/application";
import type { SqlConnectionPool } from "./postgres.js";

export class PostgresFirstAdminBootstrapRepository implements FirstAdminBootstrapRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  async tryBootstrap(record: BootstrapAdminRecord): Promise<boolean> {
    const connection = await this.pool.connect();

    try {
      await connection.query("begin");

      try {
        await connection.query(
          "select pg_advisory_xact_lock(hashtextextended('first-admin-bootstrap', 0))"
        );
        const existing = await connection.query<{ readonly exists: boolean }>(
          "select exists(select 1 from public.admin_accounts) as exists"
        );

        if (existing.rows[0]?.exists === true) {
          await connection.query("commit");
          return false;
        }

        await connection.query(
          `insert into public.admin_accounts (
             id,
             auth_subject,
             email_normalized,
             display_name,
             status,
             created_at,
             updated_at
           ) values ($1, $2, $3, $4, 'active', $5, $5)`,
          [
            record.adminId,
            record.authSubject,
            record.emailNormalized,
            record.displayName,
            record.occurredAt
          ]
        );
        await connection.query(
          `insert into public.admin_role_grants (
             id,
             admin_account_id,
             role_code,
             granted_by_admin_id,
             granted_at,
             reason
           ) values ($1, $2, 'super_admin', $2, $3, $4)`,
          [
            record.roleGrantId,
            record.adminId,
            record.occurredAt,
            record.reason
          ]
        );
        // Идентификаторы подставляются дважды намеренно: `id` и `actor_admin_id` — uuid, а
        // `request_id` и `target_id` — text. На одном параметре Postgres пытается вывести
        // для него единый тип и отказывается ещё на разборе запроса, поэтому uuid-колонки и
        // текстовые получают отдельные параметры.
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
           ) values (
             $1,
             $2,
             'super_admin',
             'admin.bootstrap',
             'admin_account',
             $3,
             $4,
             $5::jsonb,
             $6,
             $7
           )`,
          [
            record.auditId,
            record.adminId,
            record.adminId,
            record.reason,
            JSON.stringify({ status: "active", roleCodes: ["super_admin"] }),
            record.auditId,
            record.occurredAt
          ]
        );
        await connection.query("commit");
        return true;
      } catch (error) {
        await connection.query("rollback");
        throw error;
      }
    } finally {
      connection.release();
    }
  }
}
