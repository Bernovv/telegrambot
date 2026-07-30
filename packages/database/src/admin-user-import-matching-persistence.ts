import {
  ADMIN_USER_IMPORT_LIMITS,
  type AdminEventAuditContext,
  type AdminUserImportIdentityCandidate,
  type AdminUserImportMatchContext,
  type AdminUserImportMatchingRepository,
  type AdminUserImportMatchResultRow,
  type AdminUserImportMatchSourceRow,
  type AdminUserImportRowsRepository
} from "@ticket-platform/application";
import type {
  AdminUserImportMatchAnalysis,
  AdminUserImportMatchKind,
  AdminUserImportMatchRowPage,
  AdminUserImportMatchRow,
  AdminUserImportMatchStatus,
  AdminUserImportNormalizedRow,
  AdminUserImportRowDecision
} from "@ticket-platform/contracts";
import type { SqlConnection, SqlConnectionPool } from "./postgres.js";

interface AnalysisRow {
  readonly id: string;
  readonly batch_id: string;
  readonly status: string;
  readonly total_row_count: number;
  readonly new_row_count: number;
  readonly exact_no_change_row_count: number;
  readonly merge_new_fields_row_count: number;
  readonly possible_match_row_count: number;
  readonly conflict_row_count: number;
  readonly invalid_row_count: number;
  readonly ignored_row_count: number;
  readonly observed_at: Date;
  readonly created_at: Date;
}

interface SourceRow {
  readonly row_number: number;
  readonly status: string;
  readonly normalized_data: unknown;
  readonly issue_codes: readonly string[];
}

interface CandidateRow {
  readonly row_number: number;
  readonly match_kind: string;
  readonly user_id: string;
  readonly first_name: string | null;
  readonly last_name: string | null;
  readonly telegram_user_ids: readonly string[];
  readonly telegram_usernames: readonly string[];
  readonly protected_phones: readonly string[];
  readonly external_crm_ids: readonly string[];
}

interface MatchResultRow extends SourceRow {
  readonly analysis_id: string;
  readonly matched_user_id: string | null;
  readonly candidate_user_ids: readonly string[];
  readonly match_kinds: readonly string[];
  readonly decision_id: string | null;
  readonly decision_version: number | null;
  readonly decision_action: string | null;
  readonly decision_target_user_id: string | null;
  readonly decision_created_at: Date | null;
}

export class PostgresAdminUserImportMatchingRepository
implements AdminUserImportMatchingRepository, AdminUserImportRowsRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  findByBatchId(
    batchId: string
  ): Promise<AdminUserImportMatchAnalysis | null> {
    return this.read(async (connection) => {
      const result = await connection.query<AnalysisRow>(
        `${ANALYSIS_SELECT}
         where batch_id = $1`,
        [batchId]
      );
      return result.rows[0]
        ? readAnalysis(connection, result.rows[0])
        : null;
    });
  }

  loadContext(
    batchId: string
  ): Promise<AdminUserImportMatchContext | null> {
    return this.read(async (connection) => {
      const batch = await connection.query<{ readonly id: string }>(
        `select id
         from public.user_import_batches
         where id = $1`,
        [batchId]
      );
      if (!batch.rows[0]) {
        return null;
      }
      const sourceRows = await connection.query<SourceRow>(
        `select row_number, status, normalized_data, issue_codes
         from public.user_import_rows
         where batch_id = $1
         order by row_number`,
        [batchId]
      );
      const candidates = await connection.query<CandidateRow>(
        MATCH_CANDIDATES_QUERY,
        [batchId]
      );
      return {
        rows: sourceRows.rows.map(mapSourceRow),
        candidates: candidates.rows.map(mapCandidate)
      };
    });
  }

  listRows(input: {
    readonly analysisId: string;
    readonly afterRowNumber: number;
    readonly limit: number;
  }): Promise<AdminUserImportMatchRowPage | null> {
    return this.read(async (connection) => {
      const analysis = await connection.query<{ readonly id: string }>(
        `select id
         from public.user_import_match_analyses
         where id = $1`,
        [input.analysisId]
      );
      if (!analysis.rows[0]) {
        return null;
      }
      const result = await connection.query<MatchResultRow>(
        `${MATCH_RESULT_SELECT}
         where result.analysis_id = $1
           and result.row_number > $2
         order by result.row_number
         limit $3`,
        [
          input.analysisId,
          input.afterRowNumber,
          input.limit + 1
        ]
      );
      const pageRows = result.rows.slice(0, input.limit);
      return {
        rows: pageRows.map(mapMatchResult),
        nextAfterRowNumber: result.rows.length > input.limit
          ? pageRows.at(-1)?.row_number ?? null
          : null
      };
    });
  }

  create(input: Parameters<
    AdminUserImportMatchingRepository["create"]
  >[0]) {
    return this.write(async (connection) => {
      const counts = countRows(input.rows);
      const inserted = await connection.query<{ readonly id: string }>(
        `insert into public.user_import_match_analyses (
           id, batch_id, status, total_row_count, new_row_count,
           exact_no_change_row_count, merge_new_fields_row_count,
           possible_match_row_count, conflict_row_count,
           invalid_row_count, ignored_row_count, observed_at,
           created_by_admin_id, reason, created_at
         ) values (
           $1, $2, 'completed', $3, $4,
           $5, $6,
           $7, $8,
           $9, $10, $11,
           $12, $13, $14
         )
         on conflict (batch_id) do nothing
         returning id`,
        [
          input.analysisId,
          input.batchId,
          counts.total,
          counts.newRows,
          counts.exactNoChangeRows,
          counts.mergeNewFieldsRows,
          counts.possibleMatchRows,
          counts.conflictRows,
          counts.invalidRows,
          counts.ignoredRows,
          input.observedAt,
          input.audit.actorAdminId,
          input.audit.reason,
          input.audit.occurredAt
        ]
      );
      if (!inserted.rows[0]) {
        return {
          status: "existing" as const,
          value: await readAnalysisByBatchId(connection, input.batchId)
        };
      }
      await connection.query(
        `insert into public.user_import_match_results (
           analysis_id, batch_id, row_number, status, matched_user_id,
           candidate_user_ids, match_kinds, issue_codes, created_at
         )
         select $1, $2, rows.row_number, rows.status,
                rows.matched_user_id, rows.candidate_user_ids,
                rows.match_kinds, rows.issue_codes, $4
         from jsonb_to_recordset($3::jsonb) as rows (
           row_number integer,
           status text,
           matched_user_id uuid,
           candidate_user_ids uuid[],
           match_kinds text[],
           issue_codes text[]
         )`,
        [
          input.analysisId,
          input.batchId,
          JSON.stringify(input.rows.map(toStoredResult)),
          input.audit.occurredAt
        ]
      );
      await appendAudit(
        connection,
        input.audit,
        input.analysisId,
        input.batchId,
        counts
      );
      return {
        status: "created" as const,
        value: await readAnalysisById(connection, input.analysisId)
      };
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

export function createAdminUserImportMatchingPersistence(
  pool: SqlConnectionPool
): AdminUserImportMatchingRepository & AdminUserImportRowsRepository {
  return new PostgresAdminUserImportMatchingRepository(pool);
}

const ANALYSIS_SELECT = `
  select id, batch_id, status, total_row_count, new_row_count,
         exact_no_change_row_count, merge_new_fields_row_count,
         possible_match_row_count, conflict_row_count,
         invalid_row_count, ignored_row_count, observed_at, created_at
  from public.user_import_match_analyses`;

const MATCH_CANDIDATES_QUERY = `
  with import_rows as (
    select row_number, normalized_data
    from public.user_import_rows
    where batch_id = $1
      and status = 'NEW'
  ),
  matched as (
    select distinct source.row_number, match.user_id, match.match_kind
    from import_rows source
    cross join lateral (
      select identity.user_id, 'telegram_id'::text as match_kind
      from public.messenger_identities identity
      where identity.channel = 'telegram'
        and identity.external_user_id =
          source.normalized_data ->> 'telegramUserId'
      union all
      select contact.user_id, 'verified_phone'::text
      from public.user_contacts contact
      where contact.contact_type = 'phone'
        and contact.verification_status = 'verified'
        and contact.value_normalized =
          source.normalized_data ->> 'phone'
      union all
      select contact.user_id, 'imported_phone'::text
      from public.user_contacts contact
      where contact.contact_type = 'phone'
        and contact.verification_status = 'imported'
        and contact.value_normalized =
          source.normalized_data ->> 'phone'
      union all
      select external_identity.user_id, 'external_crm_id'::text
      from public.user_external_identities external_identity
      where external_identity.source_system = 'crm'
        and external_identity.external_user_id =
          source.normalized_data ->> 'externalCrmId'
      union all
      select identity.user_id, 'telegram_username'::text
      from public.messenger_identities identity
      where identity.channel = 'telegram'
        and identity.username_normalized =
          source.normalized_data ->> 'telegramUsername'
    ) match
  )
  select matched.row_number, matched.match_kind, users.id as user_id,
         users.first_name, users.last_name,
         array(
           select distinct identity.external_user_id
           from public.messenger_identities identity
           where identity.user_id = users.id
             and identity.channel = 'telegram'
           order by identity.external_user_id
         ) as telegram_user_ids,
         array(
           select distinct identity.username_normalized
           from public.messenger_identities identity
           where identity.user_id = users.id
             and identity.channel = 'telegram'
             and identity.username_normalized is not null
           order by identity.username_normalized
         ) as telegram_usernames,
         array(
           select distinct contact.value_normalized
           from public.user_contacts contact
           where contact.user_id = users.id
             and contact.contact_type = 'phone'
             and contact.verification_status in ('imported', 'verified')
           order by contact.value_normalized
         ) as protected_phones,
         array(
           select distinct external_identity.external_user_id
           from public.user_external_identities external_identity
           where external_identity.user_id = users.id
             and external_identity.source_system = 'crm'
           order by external_identity.external_user_id
         ) as external_crm_ids
  from matched
  join public.users users on users.id = matched.user_id
  where users.is_deleted = false
  order by matched.row_number, matched.match_kind, users.id`;

async function readAnalysisByBatchId(
  connection: SqlConnection,
  batchId: string
): Promise<AdminUserImportMatchAnalysis> {
  const result = await connection.query<AnalysisRow>(
    `${ANALYSIS_SELECT}
     where batch_id = $1`,
    [batchId]
  );
  return requireAnalysis(connection, result.rows[0]);
}

async function readAnalysisById(
  connection: SqlConnection,
  analysisId: string
): Promise<AdminUserImportMatchAnalysis> {
  const result = await connection.query<AnalysisRow>(
    `${ANALYSIS_SELECT}
     where id = $1`,
    [analysisId]
  );
  return requireAnalysis(connection, result.rows[0]);
}

function requireAnalysis(
  connection: SqlConnection,
  row: AnalysisRow | undefined
): Promise<AdminUserImportMatchAnalysis> {
  if (!row) {
    throw new Error("User import match analysis was not readable");
  }
  return readAnalysis(connection, row);
}

async function readAnalysis(
  connection: SqlConnection,
  row: AnalysisRow
): Promise<AdminUserImportMatchAnalysis> {
  const results = await connection.query<MatchResultRow>(
    `${MATCH_RESULT_SELECT}
     where result.analysis_id = $1
     order by result.row_number
     limit $2`,
    [row.id, ADMIN_USER_IMPORT_LIMITS.previewRows]
  );
  return {
    id: requireUuid(row.id),
    batchId: requireUuid(row.batch_id),
    status: readAnalysisStatus(row.status),
    totalRowCount: row.total_row_count,
    newRowCount: row.new_row_count,
    exactMatchNoChangeRowCount: row.exact_no_change_row_count,
    mergeNewFieldsRowCount: row.merge_new_fields_row_count,
    possibleMatchRowCount: row.possible_match_row_count,
    conflictRowCount: row.conflict_row_count,
    invalidRowCount: row.invalid_row_count,
    ignoredRowCount: row.ignored_row_count,
    previewRows: results.rows.map(mapMatchResult),
    observedAt: row.observed_at.toISOString(),
    createdAt: row.created_at.toISOString()
  };
}

const MATCH_RESULT_SELECT = `
  select result.analysis_id, result.row_number, result.status,
         result.matched_user_id,
         result.candidate_user_ids, result.match_kinds,
         result.issue_codes, staging.normalized_data,
         decision.id as decision_id,
         decision.decision_version,
         decision.action as decision_action,
         decision.target_user_id as decision_target_user_id,
         decision.created_at as decision_created_at
  from public.user_import_match_results result
  join public.user_import_rows staging
    on staging.batch_id = result.batch_id
   and staging.row_number = result.row_number
  left join lateral (
    select current.id, current.decision_version, current.action,
           current.target_user_id, current.created_at
    from public.user_import_row_decisions current
    where current.analysis_id = result.analysis_id
      and current.row_number = result.row_number
    order by current.decision_version desc
    limit 1
  ) decision on true`;

function mapSourceRow(row: SourceRow): AdminUserImportMatchSourceRow {
  const stagingStatus = readStagingStatus(row.status);
  return {
    rowNumber: row.row_number,
    stagingStatus,
    normalized: stagingStatus === "INVALID"
      ? null
      : readNormalized(row.normalized_data),
    issueCodes: row.issue_codes.map(readIssueCode)
  };
}

function mapCandidate(
  row: CandidateRow
): AdminUserImportIdentityCandidate {
  return {
    rowNumber: row.row_number,
    matchKind: readMatchKind(row.match_kind),
    profile: {
      userId: requireUuid(row.user_id),
      firstName: optionalString(row.first_name, 100),
      lastName: optionalString(row.last_name, 100),
      telegramUserIds: row.telegram_user_ids.map((value) =>
        requiredString(value, 20)
      ),
      telegramUsernames: row.telegram_usernames.map((value) =>
        requiredString(value, 32)
      ),
      protectedPhones: row.protected_phones.map((value) =>
        requiredString(value, 20)
      ),
      externalCrmIds: row.external_crm_ids.map((value) =>
        requiredString(value, 100)
      )
    }
  };
}

function mapMatchResult(row: MatchResultRow): AdminUserImportMatchRow {
  const status = readMatchStatus(row.status);
  return {
    rowNumber: row.row_number,
    status,
    normalized: status === "INVALID"
      ? null
      : readNormalized(row.normalized_data),
    matchedUserId: row.matched_user_id
      ? requireUuid(row.matched_user_id)
      : null,
    candidateUserIds: row.candidate_user_ids.map(requireUuid),
    matchKinds: row.match_kinds.map(readMatchKind),
    issueCodes: row.issue_codes.map(readIssueCode),
    decision: readDecision(row)
  };
}

function readDecision(row: MatchResultRow): AdminUserImportRowDecision | null {
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
  if (
    row.decision_action !== "CREATE_NEW_USER"
    && row.decision_action !== "MERGE_SAFE_FIELDS"
    && row.decision_action !== "IGNORE_ROW"
  ) {
    throw new Error("User import decision action is invalid");
  }
  return {
    id: requireUuid(row.decision_id),
    analysisId: requireUuid(row.analysis_id),
    rowNumber: row.row_number,
    version: requirePositiveInteger(row.decision_version),
    action: row.decision_action,
    targetUserId: row.decision_target_user_id
      ? requireUuid(row.decision_target_user_id)
      : null,
    decidedAt: row.decision_created_at.toISOString()
  };
}

function requirePositiveInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000) {
    throw new Error("User import decision version is invalid");
  }
  return value;
}

function readNormalized(value: unknown): AdminUserImportNormalizedRow {
  const parsed = typeof value === "string"
    ? JSON.parse(value) as unknown
    : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("User import normalized data is invalid");
  }
  const record = parsed as Readonly<Record<string, unknown>>;
  return {
    telegramUserId: optionalString(record.telegramUserId, 20),
    telegramUsername: optionalString(record.telegramUsername, 32),
    phone: optionalString(record.phone, 20),
    externalCrmId: optionalString(record.externalCrmId, 100),
    firstName: optionalString(record.firstName, 100),
    lastName: optionalString(record.lastName, 100)
  };
}

function optionalString(value: unknown, maxLength: number): string | null {
  if (value === null) {
    return null;
  }
  return requiredString(value, maxLength);
}

function requiredString(value: unknown, maxLength: number): string {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > maxLength
  ) {
    throw new Error("User import match value is invalid");
  }
  return value;
}

function readStagingStatus(
  value: string
): AdminUserImportMatchSourceRow["stagingStatus"] {
  if (value !== "NEW" && value !== "INVALID" && value !== "IGNORED") {
    throw new Error("User import staging status is invalid");
  }
  return value;
}

function readAnalysisStatus(value: string): "completed" {
  if (value !== "completed") {
    throw new Error("User import analysis status is invalid");
  }
  return value;
}

function readMatchStatus(value: string): AdminUserImportMatchStatus {
  const statuses: readonly AdminUserImportMatchStatus[] = [
    "NEW",
    "EXACT_MATCH_NO_CHANGE",
    "MERGE_NEW_FIELDS",
    "POSSIBLE_MATCH",
    "CONFLICT",
    "INVALID",
    "IGNORED"
  ];
  if (!statuses.includes(value as AdminUserImportMatchStatus)) {
    throw new Error("User import match status is invalid");
  }
  return value as AdminUserImportMatchStatus;
}

function readMatchKind(value: string): AdminUserImportMatchKind {
  const kinds: readonly AdminUserImportMatchKind[] = [
    "telegram_id",
    "verified_phone",
    "imported_phone",
    "external_crm_id",
    "telegram_username"
  ];
  if (!kinds.includes(value as AdminUserImportMatchKind)) {
    throw new Error("User import match kind is invalid");
  }
  return value as AdminUserImportMatchKind;
}

function readIssueCode(value: string): string {
  if (!/^[a-z][a-z0-9_]{1,99}$/.test(value)) {
    throw new Error("User import match issue code is invalid");
  }
  return value;
}

function requireUuid(value: string): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value)
  ) {
    throw new Error("User import match UUID is invalid");
  }
  return value;
}

function toStoredResult(row: AdminUserImportMatchResultRow) {
  return {
    row_number: row.rowNumber,
    status: row.status,
    matched_user_id: row.matchedUserId,
    candidate_user_ids: row.candidateUserIds,
    match_kinds: row.matchKinds,
    issue_codes: row.issueCodes
  };
}

function countRows(rows: readonly AdminUserImportMatchResultRow[]) {
  return {
    total: rows.length,
    newRows: countStatus(rows, "NEW"),
    exactNoChangeRows: countStatus(rows, "EXACT_MATCH_NO_CHANGE"),
    mergeNewFieldsRows: countStatus(rows, "MERGE_NEW_FIELDS"),
    possibleMatchRows: countStatus(rows, "POSSIBLE_MATCH"),
    conflictRows: countStatus(rows, "CONFLICT"),
    invalidRows: countStatus(rows, "INVALID"),
    ignoredRows: countStatus(rows, "IGNORED")
  };
}

function countStatus(
  rows: readonly AdminUserImportMatchResultRow[],
  status: AdminUserImportMatchStatus
): number {
  return rows.filter((row) => row.status === status).length;
}

function appendAudit(
  connection: SqlConnection,
  audit: AdminEventAuditContext,
  analysisId: string,
  batchId: string,
  counts: ReturnType<typeof countRows>
): Promise<unknown> {
  return connection.query(
    `insert into public.audit_log (
       id, actor_admin_id, actor_role, action, target_type, target_id,
       reason, before_masked, after_masked, request_id,
       ip_address, user_agent, created_at
     ) values (
       $1, $2, $3, 'import.match_analyzed', 'user_import_batch', $4,
       $5, null, $6::jsonb, $7,
       $8::inet, $9, $10
     )`,
    [
      audit.auditId,
      audit.actorAdminId,
      audit.actorRole,
      batchId,
      audit.reason,
      JSON.stringify({
        analysisId,
        totalRowCount: counts.total,
        newRowCount: counts.newRows,
        exactMatchNoChangeRowCount: counts.exactNoChangeRows,
        mergeNewFieldsRowCount: counts.mergeNewFieldsRows,
        possibleMatchRowCount: counts.possibleMatchRows,
        conflictRowCount: counts.conflictRows,
        invalidRowCount: counts.invalidRows,
        ignoredRowCount: counts.ignoredRows
      }),
      audit.requestId,
      audit.ipAddress,
      audit.userAgent,
      audit.occurredAt
    ]
  );
}
