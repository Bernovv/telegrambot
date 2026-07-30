export type AdminUserImportRowStatus = "NEW" | "INVALID" | "IGNORED";

export interface AdminUserImportNormalizedRow {
  readonly telegramUserId: string | null;
  readonly telegramUsername: string | null;
  readonly phone: string | null;
  readonly externalCrmId: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
}

export interface AdminUserImportRow {
  readonly rowNumber: number;
  readonly status: AdminUserImportRowStatus;
  readonly normalized: AdminUserImportNormalizedRow | null;
  readonly issueCodes: readonly string[];
}

export interface AdminUserImportBatch {
  readonly id: string;
  readonly fileName: string;
  readonly fileChecksum: string;
  readonly byteSize: number;
  readonly delimiter: "," | ";" | "\t";
  readonly status: "preview_ready";
  readonly totalRowCount: number;
  readonly newRowCount: number;
  readonly invalidRowCount: number;
  readonly ignoredRowCount: number;
  readonly previewRows: readonly AdminUserImportRow[];
  readonly createdAt: string;
}

export interface CreateAdminUserImportPreviewRequest {
  readonly fileName: string;
  readonly contentBase64: string;
  readonly reason: string;
}

export interface CreateAdminUserImportPreviewResponse {
  readonly batch: AdminUserImportBatch;
  readonly reusedExisting: boolean;
}

export type AdminUserImportMatchKind =
  | "telegram_id"
  | "verified_phone"
  | "imported_phone"
  | "external_crm_id"
  | "telegram_username";

export type AdminUserImportMatchStatus =
  | "NEW"
  | "EXACT_MATCH_NO_CHANGE"
  | "MERGE_NEW_FIELDS"
  | "POSSIBLE_MATCH"
  | "CONFLICT"
  | "INVALID"
  | "IGNORED";

export type AdminUserImportDecisionAction =
  | "CREATE_NEW_USER"
  | "MERGE_SAFE_FIELDS"
  | "IGNORE_ROW";

export interface AdminUserImportRowDecision {
  readonly id: string;
  readonly analysisId: string;
  readonly rowNumber: number;
  readonly version: number;
  readonly action: AdminUserImportDecisionAction;
  readonly targetUserId: string | null;
  readonly decidedAt: string;
}

export interface AdminUserImportMatchRow {
  readonly rowNumber: number;
  readonly status: AdminUserImportMatchStatus;
  readonly normalized: AdminUserImportNormalizedRow | null;
  readonly matchedUserId: string | null;
  readonly candidateUserIds: readonly string[];
  readonly matchKinds: readonly AdminUserImportMatchKind[];
  readonly issueCodes: readonly string[];
  readonly decision: AdminUserImportRowDecision | null;
}

export interface AdminUserImportMatchAnalysis {
  readonly id: string;
  readonly batchId: string;
  readonly status: "completed";
  readonly totalRowCount: number;
  readonly newRowCount: number;
  readonly exactMatchNoChangeRowCount: number;
  readonly mergeNewFieldsRowCount: number;
  readonly possibleMatchRowCount: number;
  readonly conflictRowCount: number;
  readonly invalidRowCount: number;
  readonly ignoredRowCount: number;
  readonly previewRows: readonly AdminUserImportMatchRow[];
  readonly observedAt: string;
  readonly createdAt: string;
}

export interface AnalyzeAdminUserImportRequest {
  readonly reason: string;
}

export interface AnalyzeAdminUserImportResponse {
  readonly analysis: AdminUserImportMatchAnalysis;
  readonly reusedExisting: boolean;
}

export interface DecideAdminUserImportRowRequest {
  readonly action: AdminUserImportDecisionAction;
  readonly targetUserId: string | null;
  readonly expectedDecisionVersion: number;
  readonly reason: string;
}

export interface DecideAdminUserImportRowResponse {
  readonly decision: AdminUserImportRowDecision;
}

export interface AdminUserImportMatchRowPage {
  readonly rows: readonly AdminUserImportMatchRow[];
  readonly nextAfterRowNumber: number | null;
}
