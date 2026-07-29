import type {
  AdminEventAuditContext,
  AdminUserClassificationRepository
} from "@ticket-platform/application";
import type {
  AdminUserCategoryDefinition,
  AdminUserStatusDefinition
} from "@ticket-platform/contracts";
import type {
  SqlConnection,
  SqlConnectionPool
} from "./postgres.js";

interface StatusRow {
  readonly id: string;
  readonly code: string;
  readonly display_name: string;
  readonly color: string;
  readonly description: string | null;
  readonly is_system: boolean;
  readonly exclusivity_group: string | null;
  readonly allowed_transition_codes: readonly string[] | null;
  readonly is_active: boolean;
  readonly lock_version: number;
}

interface CategoryRow {
  readonly id: string;
  readonly code: string;
  readonly display_name: string;
  readonly color: string;
  readonly description: string | null;
  readonly is_system: boolean;
  readonly is_active: boolean;
  readonly lock_version: number;
}

export class PostgresAdminUserClassificationRepository
implements AdminUserClassificationRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  listCatalog(): Promise<{
    readonly statuses: readonly AdminUserStatusDefinition[];
    readonly categories: readonly AdminUserCategoryDefinition[];
  }> {
    return this.read(async (connection) => {
      const statuses = await connection.query<StatusRow>(
        `${STATUS_SELECT}
         order by is_system desc, display_name, code`
      );
      const categories = await connection.query<CategoryRow>(
        `${CATEGORY_SELECT}
         order by is_system desc, display_name, code`
      );
      return {
        statuses: statuses.rows.map(mapStatus),
        categories: categories.rows.map(mapCategory)
      };
    });
  }

  createStatus(
    input: Parameters<AdminUserClassificationRepository["createStatus"]>[0]
  ): Promise<"created" | "code_conflict" | "transition_not_found"> {
    return this.write(async (connection) => {
      await lockCatalogKey(connection, "status", input.status.code);
      const existing = await connection.query(
        "select id from public.user_statuses where code = $1",
        [input.status.code]
      );
      if (existing.rowCount > 0) {
        return "code_conflict";
      }
      if (
        !await transitionsExist(
          connection,
          input.status.allowedTransitionCodes
        )
      ) {
        return "transition_not_found";
      }
      await connection.query(
        `insert into public.user_statuses (
           id, code, display_name, color, description, is_system,
           exclusivity_group, allowed_transition_codes, is_active,
           lock_version, created_at, updated_at
         ) values (
           $1, $2, $3, $4, $5, false,
           $6, $7, true,
           1, $8, $8
         )`,
        [
          input.status.id,
          input.status.code,
          input.status.displayName,
          input.status.color,
          input.status.description,
          input.status.exclusivityGroup,
          input.status.allowedTransitionCodes,
          input.audit.occurredAt
        ]
      );
      await appendAudit(
        connection,
        input.audit,
        "user_status.created",
        "user_status",
        input.status.id,
        null,
        input.status
      );
      return "created";
    });
  }

  updateStatus(
    input: Parameters<AdminUserClassificationRepository["updateStatus"]>[0]
  ): ReturnType<AdminUserClassificationRepository["updateStatus"]> {
    return this.write(async (connection) => {
      await lockCatalogKey(connection, "status", input.statusId);
      const currentResult = await connection.query<StatusRow>(
        `${STATUS_SELECT}
         where id = $1
         for update`,
        [input.statusId]
      );
      const current = currentResult.rows[0];
      if (!current) {
        return { status: "not_found" as const };
      }
      if (current.lock_version !== input.expectedLockVersion) {
        return { status: "version_conflict" as const };
      }
      if (current.is_system && !input.patch.isActive) {
        return { status: "system_deactivation" as const };
      }
      if (
        input.patch.allowedTransitionCodes?.includes(current.code)
        || !await transitionsExist(
          connection,
          input.patch.allowedTransitionCodes
        )
      ) {
        return { status: "transition_not_found" as const };
      }
      const updated = await connection.query<StatusRow>(
        `update public.user_statuses
         set display_name = $2,
             color = $3,
             description = $4,
             exclusivity_group = $5,
             allowed_transition_codes = $6,
             is_active = $7,
             lock_version = lock_version + 1,
             updated_at = $8
         where id = $1
         returning id, code, display_name, color, description, is_system,
                   exclusivity_group, allowed_transition_codes, is_active,
                   lock_version`,
        [
          input.statusId,
          input.patch.displayName,
          input.patch.color,
          input.patch.description,
          input.patch.exclusivityGroup,
          input.patch.allowedTransitionCodes,
          input.patch.isActive,
          input.audit.occurredAt
        ]
      );
      const row = updated.rows[0];
      if (!row) {
        throw new Error(`User status update lost locked row: ${input.statusId}`);
      }
      const value = mapStatus(row);
      await appendAudit(
        connection,
        input.audit,
        "user_status.updated",
        "user_status",
        input.statusId,
        mapStatus(current),
        value
      );
      return { status: "updated" as const, value };
    });
  }

  createCategory(
    input: Parameters<AdminUserClassificationRepository["createCategory"]>[0]
  ): Promise<"created" | "code_conflict"> {
    return this.write(async (connection) => {
      await lockCatalogKey(connection, "category", input.category.code);
      const existing = await connection.query(
        "select id from public.user_categories where code = $1",
        [input.category.code]
      );
      if (existing.rowCount > 0) {
        return "code_conflict";
      }
      await connection.query(
        `insert into public.user_categories (
           id, code, display_name, color, description, is_system,
           is_active, lock_version, created_at, updated_at
         ) values ($1, $2, $3, $4, $5, false, true, 1, $6, $6)`,
        [
          input.category.id,
          input.category.code,
          input.category.displayName,
          input.category.color,
          input.category.description,
          input.audit.occurredAt
        ]
      );
      await appendAudit(
        connection,
        input.audit,
        "user_category.created",
        "user_category",
        input.category.id,
        null,
        input.category
      );
      return "created";
    });
  }

  updateCategory(
    input: Parameters<AdminUserClassificationRepository["updateCategory"]>[0]
  ): ReturnType<AdminUserClassificationRepository["updateCategory"]> {
    return this.write(async (connection) => {
      await lockCatalogKey(connection, "category", input.categoryId);
      const currentResult = await connection.query<CategoryRow>(
        `${CATEGORY_SELECT}
         where id = $1
         for update`,
        [input.categoryId]
      );
      const current = currentResult.rows[0];
      if (!current) {
        return { status: "not_found" as const };
      }
      if (current.lock_version !== input.expectedLockVersion) {
        return { status: "version_conflict" as const };
      }
      if (current.is_system && !input.patch.isActive) {
        return { status: "system_deactivation" as const };
      }
      const updated = await connection.query<CategoryRow>(
        `update public.user_categories
         set display_name = $2,
             color = $3,
             description = $4,
             is_active = $5,
             lock_version = lock_version + 1,
             updated_at = $6
         where id = $1
         returning id, code, display_name, color, description, is_system,
                   is_active, lock_version`,
        [
          input.categoryId,
          input.patch.displayName,
          input.patch.color,
          input.patch.description,
          input.patch.isActive,
          input.audit.occurredAt
        ]
      );
      const row = updated.rows[0];
      if (!row) {
        throw new Error(
          `User category update lost locked row: ${input.categoryId}`
        );
      }
      const value = mapCategory(row);
      await appendAudit(
        connection,
        input.audit,
        "user_category.updated",
        "user_category",
        input.categoryId,
        mapCategory(current),
        value
      );
      return { status: "updated" as const, value };
    });
  }

  private async read<TResult>(
    work: (connection: SqlConnection) => Promise<TResult>
  ): Promise<TResult> {
    const connection = await this.pool.connect();
    try {
      await connection.query(
        "begin transaction isolation level repeatable read read only"
      );
      try {
        const result = await work(connection);
        await connection.query("commit");
        return result;
      } catch (error) {
        await connection.query("rollback");
        throw error;
      }
    } finally {
      connection.release();
    }
  }

  private async write<TResult>(
    work: (connection: SqlConnection) => Promise<TResult>
  ): Promise<TResult> {
    const connection = await this.pool.connect();
    try {
      await connection.query("begin");
      try {
        const result = await work(connection);
        await connection.query("commit");
        return result;
      } catch (error) {
        await connection.query("rollback");
        throw error;
      }
    } finally {
      connection.release();
    }
  }
}

export function createAdminUserClassificationPersistence(
  pool: SqlConnectionPool
): AdminUserClassificationRepository {
  return new PostgresAdminUserClassificationRepository(pool);
}

const STATUS_SELECT = `
  select id, code, display_name, color, description, is_system,
         exclusivity_group, allowed_transition_codes, is_active, lock_version
  from public.user_statuses`;

const CATEGORY_SELECT = `
  select id, code, display_name, color, description, is_system,
         is_active, lock_version
  from public.user_categories`;

function mapStatus(row: StatusRow): AdminUserStatusDefinition {
  return {
    id: row.id,
    code: row.code,
    displayName: row.display_name,
    color: row.color,
    description: row.description,
    isSystem: row.is_system,
    exclusivityGroup: row.exclusivity_group,
    allowedTransitionCodes: row.allowed_transition_codes,
    isActive: row.is_active,
    lockVersion: row.lock_version
  };
}

function mapCategory(row: CategoryRow): AdminUserCategoryDefinition {
  return {
    id: row.id,
    code: row.code,
    displayName: row.display_name,
    color: row.color,
    description: row.description,
    isSystem: row.is_system,
    isActive: row.is_active,
    lockVersion: row.lock_version
  };
}

async function transitionsExist(
  connection: SqlConnection,
  codes: readonly string[] | null
): Promise<boolean> {
  if (codes === null) {
    return true;
  }
  const result = await connection.query<{ readonly count: string }>(
    `select count(*)::text as count
     from public.user_statuses
     where code = any($1::text[]) and is_active = true`,
    [codes]
  );
  return Number(result.rows[0]?.count ?? "-1") === codes.length;
}

function lockCatalogKey(
  connection: SqlConnection,
  kind: "status" | "category",
  key: string
): Promise<unknown> {
  return connection.query(
    "select pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`user-classification-catalog:${kind}:${key}`]
  );
}

function appendAudit(
  connection: SqlConnection,
  audit: AdminEventAuditContext,
  action: string,
  targetType: string,
  targetId: string,
  before: unknown,
  after: unknown
): Promise<unknown> {
  return connection.query(
    `insert into public.audit_log (
       id, actor_admin_id, actor_role, action, target_type, target_id,
       reason, before_masked, after_masked, request_id, ip_address,
       user_agent, created_at
     ) values (
       $1, $2, $3, $4, $5, $6,
       $7, $8::jsonb, $9::jsonb, $10, $11::inet,
       $12, $13
     )`,
    [
      audit.auditId,
      audit.actorAdminId,
      audit.actorRole,
      action,
      targetType,
      targetId,
      audit.reason,
      before === null ? null : JSON.stringify(before),
      after === null ? null : JSON.stringify(after),
      audit.requestId,
      audit.ipAddress,
      audit.userAgent,
      audit.occurredAt
    ]
  );
}
