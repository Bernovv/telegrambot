import {
  ADMIN_PERMISSIONS,
  type AdminPermission
} from "@ticket-platform/contracts";
import type {
  AdminPrincipal,
  AdminPrincipalRepository
} from "@ticket-platform/application";
import type { SqlConnectionPool } from "./postgres.js";

interface AdminPrincipalRow {
  readonly admin_id: string;
  readonly auth_subject: string;
  readonly status: "active" | "suspended";
  readonly role_codes: readonly string[];
  readonly permission_codes: readonly string[];
  readonly requires_mfa: boolean;
  readonly sessions_revoked_before: Date | null;
}

const knownPermissions: ReadonlySet<string> = new Set(ADMIN_PERMISSIONS);

export class PostgresAdminPrincipalRepository implements AdminPrincipalRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  async findByAuthSubject(authSubject: string): Promise<AdminPrincipal | null> {
    const connection = await this.pool.connect();

    try {
      const result = await connection.query<AdminPrincipalRow>(
        `select
           account.id as admin_id,
           account.auth_subject,
           account.status,
           account.sessions_revoked_before,
           coalesce(
             array_agg(distinct grant_row.role_code)
               filter (where grant_row.role_code is not null),
             array[]::text[]
           ) as role_codes,
           coalesce(
             array_agg(distinct permission.permission_code)
               filter (where permission.permission_code is not null),
             array[]::text[]
           ) as permission_codes,
           coalesce(bool_or(role.requires_mfa), false) as requires_mfa
         from public.admin_accounts account
         left join public.admin_role_grants grant_row
           on grant_row.admin_account_id = account.id
          and grant_row.revoked_at is null
         left join public.admin_roles role
           on role.code = grant_row.role_code
         left join public.admin_role_permissions permission
           on permission.role_code = role.code
         where account.auth_subject = $1
         group by account.id
         limit 1`,
        [authSubject]
      );
      const row = result.rows[0];

      return row ? mapPrincipal(row) : null;
    } finally {
      connection.release();
    }
  }
}

function mapPrincipal(row: AdminPrincipalRow): AdminPrincipal {
  return {
    adminId: row.admin_id,
    authSubject: row.auth_subject,
    status: row.status,
    roleCodes: [...row.role_codes].sort(),
    permissions: row.permission_codes
      .filter(isAdminPermission)
      .sort(),
    requiresMfa: row.requires_mfa,
    sessionsRevokedBefore: row.sessions_revoked_before
  };
}

function isAdminPermission(value: string): value is AdminPermission {
  return knownPermissions.has(value);
}
