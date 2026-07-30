import type {
  AdminEventAuditContext,
  AdminUserImportDecisionContext,
  AdminUserImportDecisionRepository
} from "@ticket-platform/application";
import type {
  AdminUserImportDecisionAction,
  AdminUserImportMatchKind,
  AdminUserImportMatchStatus,
  AdminUserImportRowDecision
} from "@ticket-platform/contracts";
import type { SqlConnection, SqlConnectionPool } from "./postgres.js";

interface DecisionContextRow {
  readonly analysis_id: string;
  readonly batch_id: string;
  readonly row_number: number;
  readonly match_status: string;
  readonly candidate_user_ids: readonly string[];
  readonly match_kinds: readonly string[];
  readonly decision_id: string | null;
  readonly decision_version: number | null;
  readonly decision_action: string | null;
  readonly decision_target_user_id: string | null;
  readonly decision_created_at: Date | null;
}

interface DecisionRow {
  readonly id: string;
  readonly analysis_id: string;
  readonly row_number: number;
  readonly decision_version: number;
  readonly action: string;
  readonly target_user_id: string | null;
  readonly created_at: Date;
}

export class PostgresAdminUserImportDecisionRepository
implements AdminUserImportDecisionRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  getContext(
    analysisId: string,
    rowNumber: number
  ): Promise<AdminUserImportDecisionContext | null> {
    return this.read(async (connection) => {
      const result = await connection.query<DecisionContextRow>(
        DECISION_CONTEXT_QUERY,
        [analysisId, rowNumber]
      );
      return result.rows[0] ? mapContext(result.rows[0]) : null;
    });
  }

  append(input: Parameters<
    AdminUserImportDecisionRepository["append"]
  >[0]) {
    return this.write(async (connection) => {
      const locked = await connection.query<{ readonly row_number: number }>(
        `select result.row_number
         from public.user_import_match_analyses analysis
         join public.user_import_match_results result
           on result.analysis_id = analysis.id
         where analysis.id = $1
           and result.row_number = $2
         for update of result`,
        [input.context.analysisId, input.context.rowNumber]
      );
      if (!locked.rows[0]) {
        return { status: "not_found" as const };
      }
      const refreshed = await connection.query<DecisionContextRow>(
        DECISION_CONTEXT_QUERY,
        [input.context.analysisId, input.context.rowNumber]
      );
      const row = refreshed.rows[0];
      if (!row) {
        throw new Error("Locked user import decision context disappeared");
      }
      const current = mapContext(row);
      const currentVersion = current.currentDecision?.version ?? 0;
      if (currentVersion !== input.expectedDecisionVersion) {
        return { status: "version_conflict" as const };
      }
      assertPersistable(
        current,
        input.action,
        input.targetUserId
      );
      const inserted = await connection.query<DecisionRow>(
        `insert into public.user_import_row_decisions (
           id, analysis_id, batch_id, row_number, decision_version,
           action, target_user_id, supersedes_decision_id,
           decided_by_admin_id, reason, created_at
         ) values (
           $1, $2, $3, $4, $5,
           $6, $7, $8,
           $9, $10, $11
         )
         returning id, analysis_id, row_number, decision_version,
                   action, target_user_id, created_at`,
        [
          input.decisionId,
          current.analysisId,
          current.batchId,
          current.rowNumber,
          currentVersion + 1,
          input.action,
          input.targetUserId,
          current.currentDecision?.id ?? null,
          input.audit.actorAdminId,
          input.audit.reason,
          input.audit.occurredAt
        ]
      );
      const decision = mapDecision(
        requireDecisionRow(inserted.rows[0])
      );
      await appendAudit(
        connection,
        input.audit,
        current,
        decision
      );
      return { status: "created" as const, value: decision };
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

export function createAdminUserImportDecisionPersistence(
  pool: SqlConnectionPool
): AdminUserImportDecisionRepository {
  return new PostgresAdminUserImportDecisionRepository(pool);
}

const DECISION_CONTEXT_QUERY = `
  select analysis.id as analysis_id, analysis.batch_id,
         result.row_number, result.status as match_status,
         result.candidate_user_ids, result.match_kinds,
         decision.id as decision_id,
         decision.decision_version,
         decision.action as decision_action,
         decision.target_user_id as decision_target_user_id,
         decision.created_at as decision_created_at
  from public.user_import_match_analyses analysis
  join public.user_import_match_results result
    on result.analysis_id = analysis.id
  left join lateral (
    select current.id, current.decision_version, current.action,
           current.target_user_id, current.created_at
    from public.user_import_row_decisions current
    where current.analysis_id = result.analysis_id
      and current.row_number = result.row_number
    order by current.decision_version desc
    limit 1
  ) decision on true
  where analysis.id = $1
    and result.row_number = $2`;

function mapContext(row: DecisionContextRow): AdminUserImportDecisionContext {
  return {
    analysisId: requireUuid(row.analysis_id),
    batchId: requireUuid(row.batch_id),
    rowNumber: requireRowNumber(row.row_number),
    matchStatus: readMatchStatus(row.match_status),
    candidateUserIds: row.candidate_user_ids.map(requireUuid),
    matchKinds: row.match_kinds.map(readMatchKind),
    currentDecision: mapOptionalDecision(row)
  };
}

function mapOptionalDecision(
  row: DecisionContextRow
): AdminUserImportRowDecision | null {
  if (
    row.decision_id === null
    && row.decision_version === null
    && row.decision_action === null
    && row.decision_target_user_id === null
    && row.decision_created_at === null
  ) {
    return null;
  }
  if (
    !row.decision_id
    || row.decision_version === null
    || !row.decision_action
    || !row.decision_created_at
  ) {
    throw new Error("User import decision projection is incomplete");
  }
  return {
    id: requireUuid(row.decision_id),
    analysisId: requireUuid(row.analysis_id),
    rowNumber: requireRowNumber(row.row_number),
    version: requireVersion(row.decision_version),
    action: readAction(row.decision_action),
    targetUserId: row.decision_target_user_id
      ? requireUuid(row.decision_target_user_id)
      : null,
    decidedAt: row.decision_created_at.toISOString()
  };
}

function mapDecision(row: DecisionRow): AdminUserImportRowDecision {
  return {
    id: requireUuid(row.id),
    analysisId: requireUuid(row.analysis_id),
    rowNumber: requireRowNumber(row.row_number),
    version: requireVersion(row.decision_version),
    action: readAction(row.action),
    targetUserId: row.target_user_id
      ? requireUuid(row.target_user_id)
      : null,
    decidedAt: row.created_at.toISOString()
  };
}

function assertPersistable(
  context: AdminUserImportDecisionContext,
  action: AdminUserImportDecisionAction,
  targetUserId: string | null
): void {
  if (
    context.matchStatus !== "POSSIBLE_MATCH"
    && context.matchStatus !== "CONFLICT"
  ) {
    throw new Error("User import row cannot receive a decision");
  }
  if (
    action === "MERGE_SAFE_FIELDS"
    && (
      !targetUserId
      || !context.candidateUserIds.includes(targetUserId)
    )
  ) {
    throw new Error("User import merge target is not a candidate");
  }
  if (
    action === "CREATE_NEW_USER"
    && (
      targetUserId !== null
      || context.matchStatus !== "POSSIBLE_MATCH"
      || context.matchKinds.includes("imported_phone")
    )
  ) {
    throw new Error("User import create-new decision is unsafe");
  }
  if (action === "IGNORE_ROW" && targetUserId !== null) {
    throw new Error("User import ignore decision has a target");
  }
}

function appendAudit(
  connection: SqlConnection,
  audit: AdminEventAuditContext,
  context: AdminUserImportDecisionContext,
  decision: AdminUserImportRowDecision
): Promise<unknown> {
  return connection.query(
    `insert into public.audit_log (
       id, actor_admin_id, actor_role, action, target_type, target_id,
       reason, before_masked, after_masked, request_id,
       ip_address, user_agent, created_at
     ) values (
       $1, $2, $3, 'import.row_decided', 'user_import_row', $4,
       $5, $6::jsonb, $7::jsonb, $8,
       $9::inet, $10, $11
     )`,
    [
      audit.auditId,
      audit.actorAdminId,
      audit.actorRole,
      `${context.analysisId}:${context.rowNumber}`,
      audit.reason,
      JSON.stringify(decisionSnapshot(context.currentDecision)),
      JSON.stringify(decisionSnapshot(decision)),
      audit.requestId,
      audit.ipAddress,
      audit.userAgent,
      audit.occurredAt
    ]
  );
}

function decisionSnapshot(
  decision: AdminUserImportRowDecision | null
): unknown {
  return decision
    ? {
        decisionId: decision.id,
        version: decision.version,
        action: decision.action,
        targetUserId: decision.targetUserId
      }
    : null;
}

function requireDecisionRow(row: DecisionRow | undefined): DecisionRow {
  if (!row) {
    throw new Error("User import decision insert returned no row");
  }
  return row;
}

function readAction(value: string): AdminUserImportDecisionAction {
  if (
    value !== "CREATE_NEW_USER"
    && value !== "MERGE_SAFE_FIELDS"
    && value !== "IGNORE_ROW"
  ) {
    throw new Error("User import decision action is invalid");
  }
  return value;
}

function readMatchStatus(value: string): AdminUserImportMatchStatus {
  const values: readonly AdminUserImportMatchStatus[] = [
    "NEW",
    "EXACT_MATCH_NO_CHANGE",
    "MERGE_NEW_FIELDS",
    "POSSIBLE_MATCH",
    "CONFLICT",
    "INVALID",
    "IGNORED"
  ];
  if (!values.includes(value as AdminUserImportMatchStatus)) {
    throw new Error("User import match status is invalid");
  }
  return value as AdminUserImportMatchStatus;
}

function readMatchKind(value: string): AdminUserImportMatchKind {
  const values: readonly AdminUserImportMatchKind[] = [
    "telegram_id",
    "verified_phone",
    "imported_phone",
    "external_crm_id",
    "telegram_username"
  ];
  if (!values.includes(value as AdminUserImportMatchKind)) {
    throw new Error("User import match kind is invalid");
  }
  return value as AdminUserImportMatchKind;
}

function requireUuid(value: string): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value)
  ) {
    throw new Error("User import decision UUID is invalid");
  }
  return value;
}

function requireRowNumber(value: number): number {
  if (!Number.isSafeInteger(value) || value < 2 || value > 5_001) {
    throw new Error("User import decision row number is invalid");
  }
  return value;
}

function requireVersion(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000) {
    throw new Error("User import decision version is invalid");
  }
  return value;
}
