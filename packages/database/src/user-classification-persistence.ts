import type {
  ActiveUserCategoryAssignment,
  ActiveUserStatusAssignment,
  UserCategoryDefinition,
  UserClassificationAuditWriter,
  UserClassificationRepository,
  UserClassificationSnapshot,
  UserStatusDefinition
} from "@ticket-platform/application";
import type { TransactionSession } from "./postgres.js";

interface StatusRow {
  readonly id: string;
  readonly code: string;
  readonly display_name: string;
  readonly color: string;
  readonly exclusivity_group: string | null;
  readonly allowed_transition_codes: readonly string[] | null;
  readonly is_active: boolean;
}

interface CategoryRow {
  readonly id: string;
  readonly code: string;
  readonly display_name: string;
  readonly color: string;
  readonly is_active: boolean;
}

interface ActiveStatusRow {
  readonly id: string;
  readonly status_id: string;
  readonly status_code: string;
  readonly exclusivity_group: string | null;
  readonly allowed_transition_codes: readonly string[] | null;
}

interface ActiveCategoryRow {
  readonly id: string;
  readonly category_id: string;
  readonly category_code: string;
}

export class PostgresUserClassificationRepository
implements UserClassificationRepository {
  constructor(private readonly session: TransactionSession) {}

  async lockUser(userId: string): Promise<boolean> {
    await this.session.query(
      "select pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`user-classification:${userId}`]
    );
    const result = await this.session.query(
      "select id from public.users where id = $1 for update",
      [userId]
    );
    return result.rowCount === 1;
  }

  async findStatusByCode(code: string): Promise<UserStatusDefinition | null> {
    const result = await this.session.query<StatusRow>(
      `select id, code, display_name, color, exclusivity_group,
              allowed_transition_codes, is_active
       from public.user_statuses
       where code = $1`,
      [code]
    );
    return result.rows[0] ? mapStatus(result.rows[0]) : null;
  }

  async findCategoryByCode(
    code: string
  ): Promise<UserCategoryDefinition | null> {
    const result = await this.session.query<CategoryRow>(
      `select id, code, display_name, color, is_active
       from public.user_categories
       where code = $1`,
      [code]
    );
    return result.rows[0] ? mapCategory(result.rows[0]) : null;
  }

  async findActiveStatus(
    userId: string,
    statusId: string
  ): Promise<ActiveUserStatusAssignment | null> {
    const result = await this.session.query<ActiveStatusRow>(
      `${ACTIVE_STATUS_SELECT}
       where assignment.user_id = $1
         and assignment.status_id = $2
         and assignment.removed_at is null
       for update`,
      [userId, statusId]
    );
    return result.rows[0] ? mapActiveStatus(result.rows[0]) : null;
  }

  async findActiveStatusInGroup(
    userId: string,
    exclusivityGroup: string
  ): Promise<ActiveUserStatusAssignment | null> {
    const result = await this.session.query<ActiveStatusRow>(
      `${ACTIVE_STATUS_SELECT}
       where assignment.user_id = $1
         and assignment.exclusivity_group = $2
         and assignment.removed_at is null
       for update`,
      [userId, exclusivityGroup]
    );
    return result.rows[0] ? mapActiveStatus(result.rows[0]) : null;
  }

  async closeStatusAssignment(
    input: Parameters<
      UserClassificationRepository["closeStatusAssignment"]
    >[0]
  ): Promise<void> {
    const result = await this.session.query(
      `update public.user_status_assignments
       set removed_at = $2,
           removal_source_type = $3,
           removal_source_reference = $4,
           removal_reason = $5
       where id = $1 and removed_at is null`,
      [
        input.assignmentId,
        input.removedAt,
        input.source,
        input.sourceReference,
        input.reason.trim()
      ]
    );
    if (result.rowCount !== 1) {
      throw new Error(
        `Active user status assignment was not closed: ${input.assignmentId}`
      );
    }
  }

  async createStatusAssignment(
    input: Parameters<
      UserClassificationRepository["createStatusAssignment"]
    >[0]
  ): Promise<void> {
    await this.session.query(
      `insert into public.user_status_assignments (
         id, user_id, status_id, status_code, status_display_name,
         status_color, exclusivity_group, source_type, source_reference,
         actor_admin_id, reason, assigned_at, created_at
       ) values (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9,
         $10, $11, $12, $12
       )`,
      [
        input.assignmentId,
        input.userId,
        input.status.id,
        input.status.code,
        input.status.displayName,
        input.status.color,
        input.status.exclusivityGroup,
        input.source,
        input.sourceReference,
        input.actorAdminId,
        input.reason,
        input.assignedAt
      ]
    );
  }

  async findActiveCategory(
    userId: string,
    categoryId: string
  ): Promise<ActiveUserCategoryAssignment | null> {
    const result = await this.session.query<ActiveCategoryRow>(
      `select id, category_id, category_code
       from public.user_category_assignments
       where user_id = $1
         and category_id = $2
         and removed_at is null
       for update`,
      [userId, categoryId]
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          categoryId: row.category_id,
          code: row.category_code
        }
      : null;
  }

  async createCategoryAssignment(
    input: Parameters<
      UserClassificationRepository["createCategoryAssignment"]
    >[0]
  ): Promise<void> {
    await this.session.query(
      `insert into public.user_category_assignments (
         id, user_id, category_id, category_code, category_display_name,
         category_color, source_type, source_reference, actor_admin_id,
         reason, assigned_at, created_at
       ) values (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9,
         $10, $11, $11
       )`,
      [
        input.assignmentId,
        input.userId,
        input.category.id,
        input.category.code,
        input.category.displayName,
        input.category.color,
        input.source,
        input.sourceReference,
        input.actorAdminId,
        input.reason,
        input.assignedAt
      ]
    );
  }

  async closeCategoryAssignment(
    input: Parameters<
      UserClassificationRepository["closeCategoryAssignment"]
    >[0]
  ): Promise<void> {
    const result = await this.session.query(
      `update public.user_category_assignments
       set removed_at = $2,
           removal_source_type = $3,
           removal_source_reference = $4,
           removal_reason = $5
       where id = $1 and removed_at is null`,
      [
        input.assignmentId,
        input.removedAt,
        input.source,
        input.sourceReference,
        input.reason.trim()
      ]
    );
    if (result.rowCount !== 1) {
      throw new Error(
        `Active user category assignment was not closed: ${input.assignmentId}`
      );
    }
  }

  async getActiveSnapshot(userId: string): Promise<UserClassificationSnapshot> {
    const statuses = await this.session.query<{ readonly code: string }>(
      `select status_code as code
       from public.user_status_assignments
       where user_id = $1 and removed_at is null
       order by status_code`,
      [userId]
    );
    const categories = await this.session.query<{ readonly code: string }>(
      `select category_code as code
       from public.user_category_assignments
       where user_id = $1 and removed_at is null
       order by category_code`,
      [userId]
    );
    return {
      statusCodes: statuses.rows.map((row) => row.code),
      categoryCodes: categories.rows.map((row) => row.code)
    };
  }
}

export class PostgresUserClassificationAuditWriter
implements UserClassificationAuditWriter {
  constructor(private readonly session: TransactionSession) {}

  async append(
    input: Parameters<UserClassificationAuditWriter["append"]>[0]
  ): Promise<void> {
    await this.session.query(
      `insert into public.audit_log (
         id, actor_admin_id, actor_role, action, target_type, target_id,
         reason, before_masked, after_masked, request_id, ip_address,
         user_agent, created_at
       ) values (
         $1, $2, $3, $4, 'user', $5,
         $6, $7::jsonb, $8::jsonb, $9, $10::inet,
         $11, $12
       )`,
      [
        input.audit.auditId,
        input.actorAdminId,
        input.audit.actorRole,
        input.action,
        input.userId,
        input.reason,
        JSON.stringify(input.before),
        JSON.stringify(input.after),
        input.audit.requestId,
        input.audit.ipAddress,
        input.audit.userAgent,
        input.occurredAt
      ]
    );
  }
}

const ACTIVE_STATUS_SELECT = `
  select assignment.id, assignment.status_id, assignment.status_code,
         assignment.exclusivity_group, status.allowed_transition_codes
  from public.user_status_assignments assignment
  join public.user_statuses status on status.id = assignment.status_id`;

function mapStatus(row: StatusRow): UserStatusDefinition {
  return {
    id: row.id,
    code: row.code,
    displayName: row.display_name,
    color: row.color,
    exclusivityGroup: row.exclusivity_group,
    allowedTransitionCodes: row.allowed_transition_codes,
    isActive: row.is_active
  };
}

function mapCategory(row: CategoryRow): UserCategoryDefinition {
  return {
    id: row.id,
    code: row.code,
    displayName: row.display_name,
    color: row.color,
    isActive: row.is_active
  };
}

function mapActiveStatus(row: ActiveStatusRow): ActiveUserStatusAssignment {
  return {
    id: row.id,
    statusId: row.status_id,
    code: row.status_code,
    exclusivityGroup: row.exclusivity_group,
    allowedTransitionCodes: row.allowed_transition_codes
  };
}
