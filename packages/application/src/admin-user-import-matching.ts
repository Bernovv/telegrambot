import type {
  AdminRequestActor,
  AdminUserImportMatchAnalysis,
  AdminUserImportMatchKind,
  AdminUserImportMatchRow,
  AdminUserImportNormalizedRow,
  AnalyzeAdminUserImportRequest,
  AnalyzeAdminUserImportResponse
} from "@ticket-platform/contracts";
import {
  buildAdminEventAuditContext,
  type AdminEventAuditContext,
  type AdminEventMutationMetadata
} from "./admin-event-management.js";
import type { IdGenerator } from "./identity.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AdminUserImportMatchSourceRow {
  readonly rowNumber: number;
  readonly stagingStatus: "NEW" | "INVALID" | "IGNORED";
  readonly normalized: AdminUserImportNormalizedRow | null;
  readonly issueCodes: readonly string[];
}

export interface UserImportCandidateProfile {
  readonly userId: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly telegramUserIds: readonly string[];
  readonly telegramUsernames: readonly string[];
  readonly protectedPhones: readonly string[];
  readonly externalCrmIds: readonly string[];
}

export interface AdminUserImportIdentityCandidate {
  readonly rowNumber: number;
  readonly matchKind: AdminUserImportMatchKind;
  readonly profile: UserImportCandidateProfile;
}

export interface AdminUserImportMatchContext {
  readonly rows: readonly AdminUserImportMatchSourceRow[];
  readonly candidates: readonly AdminUserImportIdentityCandidate[];
}

export interface AdminUserImportMatchResultRow {
  readonly rowNumber: number;
  readonly status: AdminUserImportMatchRow["status"];
  readonly matchedUserId: string | null;
  readonly candidateUserIds: readonly string[];
  readonly matchKinds: readonly AdminUserImportMatchKind[];
  readonly issueCodes: readonly string[];
}

export interface AdminUserImportMatchingRepository {
  findByBatchId(batchId: string): Promise<AdminUserImportMatchAnalysis | null>;
  loadContext(batchId: string): Promise<AdminUserImportMatchContext | null>;
  create(input: {
    readonly analysisId: string;
    readonly batchId: string;
    readonly observedAt: Date;
    readonly rows: readonly AdminUserImportMatchResultRow[];
    readonly audit: AdminEventAuditContext;
  }): Promise<
    | { readonly status: "created"; readonly value: AdminUserImportMatchAnalysis }
    | { readonly status: "existing"; readonly value: AdminUserImportMatchAnalysis }
  >;
}

export class AdminUserImportBatchNotFoundError extends Error {
  constructor() {
    super("Administrator user import batch was not found");
    this.name = "AdminUserImportBatchNotFoundError";
  }
}

export class InvalidAdminUserImportAnalysisError extends Error {
  constructor(readonly code: string = "invalid_analysis") {
    super(`Administrator user import analysis is invalid: ${code}`);
    this.name = "InvalidAdminUserImportAnalysisError";
  }
}

export class AnalyzeAdminUserImportService {
  constructor(
    private readonly repository: AdminUserImportMatchingRepository,
    private readonly idGenerator: IdGenerator
  ) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly batchId: string;
    readonly request: AnalyzeAdminUserImportRequest;
    readonly metadata: AdminEventMutationMetadata;
  }): Promise<AnalyzeAdminUserImportResponse> {
    requirePermission(input.actor);
    const batchId = requireUuid(input.batchId);
    const reason = bounded(input.request.reason, 1, 500);
    const existing = await this.repository.findByBatchId(batchId);
    if (existing) {
      return { analysis: existing, reusedExisting: true };
    }
    const context = await this.repository.loadContext(batchId);
    if (!context) {
      throw new AdminUserImportBatchNotFoundError();
    }
    const rows = classifyAdminUserImportRows(context);
    const audit = buildAdminEventAuditContext(
      input.actor,
      reason,
      input.metadata,
      this.idGenerator
    );
    const result = await this.repository.create({
      analysisId: requireUuid(this.idGenerator.newId()),
      batchId,
      observedAt: input.metadata.occurredAt,
      rows,
      audit
    });
    return {
      analysis: result.value,
      reusedExisting: result.status === "existing"
    };
  }
}

export function classifyAdminUserImportRows(
  context: AdminUserImportMatchContext
): readonly AdminUserImportMatchResultRow[] {
  const candidatesByRow = groupCandidates(context.candidates);
  return context.rows.map((row) =>
    classifyRow(row, candidatesByRow.get(row.rowNumber) ?? [])
  );
}

function classifyRow(
  row: AdminUserImportMatchSourceRow,
  candidates: readonly AdminUserImportIdentityCandidate[]
): AdminUserImportMatchResultRow {
  if (row.stagingStatus !== "NEW") {
    return {
      rowNumber: row.rowNumber,
      status: row.stagingStatus,
      matchedUserId: null,
      candidateUserIds: [],
      matchKinds: [],
      issueCodes: row.issueCodes
    };
  }
  if (!row.normalized) {
    throw new InvalidAdminUserImportAnalysisError("missing_normalized_row");
  }
  const grouped = combineCandidateProfiles(candidates);
  const exactUserIds = uniqueSorted(
    candidates
      .filter((candidate) => isExactKind(candidate.matchKind))
      .map((candidate) => candidate.profile.userId)
  );
  const provisionalUserIds = uniqueSorted(
    candidates
      .filter((candidate) => !isExactKind(candidate.matchKind))
      .map((candidate) => candidate.profile.userId)
  );
  const candidateUserIds = uniqueSorted([
    ...exactUserIds,
    ...provisionalUserIds
  ]);
  const matchKinds = uniqueMatchKinds(
    candidates.map((candidate) => candidate.matchKind)
  );
  if (exactUserIds.length > 1) {
    return conflict(
      row.rowNumber,
      candidateUserIds,
      matchKinds,
      ["identity_conflict"]
    );
  }
  const exactUserId = exactUserIds[0];
  if (!exactUserId) {
    if (provisionalUserIds.length === 1) {
      return {
        rowNumber: row.rowNumber,
        status: "POSSIBLE_MATCH",
        matchedUserId: null,
        candidateUserIds,
        matchKinds,
        issueCodes: [
          matchKinds.includes("imported_phone")
            ? "imported_phone_requires_confirmation"
            : "username_requires_confirmation"
        ]
      };
    }
    if (provisionalUserIds.length > 1) {
      return conflict(
        row.rowNumber,
        candidateUserIds,
        matchKinds,
        ["provisional_identity_conflict"]
      );
    }
    return {
      rowNumber: row.rowNumber,
      status: "NEW",
      matchedUserId: null,
      candidateUserIds: [],
      matchKinds: [],
      issueCodes: []
    };
  }
  if (provisionalUserIds.some((userId) => userId !== exactUserId)) {
    return conflict(
      row.rowNumber,
      candidateUserIds,
      matchKinds,
      ["provisional_identity_conflict"]
    );
  }
  const profile = grouped.get(exactUserId);
  if (!profile) {
    throw new InvalidAdminUserImportAnalysisError("candidate_profile_missing");
  }
  const profileIssues = findProfileIssues(row.normalized, profile);
  if (profileIssues.includes("verified_phone_conflict")) {
    return conflict(
      row.rowNumber,
      candidateUserIds,
      matchKinds,
      profileIssues
    );
  }
  return {
    rowNumber: row.rowNumber,
    status: hasNewFields(row.normalized, profile)
      ? "MERGE_NEW_FIELDS"
      : "EXACT_MATCH_NO_CHANGE",
    matchedUserId: exactUserId,
    candidateUserIds,
    matchKinds,
    issueCodes: profileIssues
  };
}

function conflict(
  rowNumber: number,
  candidateUserIds: readonly string[],
  matchKinds: readonly AdminUserImportMatchKind[],
  issueCodes: readonly string[]
): AdminUserImportMatchResultRow {
  return {
    rowNumber,
    status: "CONFLICT",
    matchedUserId: null,
    candidateUserIds,
    matchKinds,
    issueCodes
  };
}

function findProfileIssues(
  row: AdminUserImportNormalizedRow,
  profile: UserImportCandidateProfile
): readonly string[] {
  const issues: string[] = [];
  if (
    row.telegramUsername
    && profile.telegramUsernames.length > 0
    && !profile.telegramUsernames.includes(row.telegramUsername)
  ) {
    issues.push("existing_username_preserved");
  }
  if (
    row.phone
    && profile.protectedPhones.length > 0
    && !profile.protectedPhones.includes(row.phone)
  ) {
    issues.push("verified_phone_conflict");
  }
  if (
    row.firstName
    && profile.firstName
    && row.firstName !== profile.firstName
  ) {
    issues.push("existing_first_name_preserved");
  }
  if (
    row.lastName
    && profile.lastName
    && row.lastName !== profile.lastName
  ) {
    issues.push("existing_last_name_preserved");
  }
  return issues;
}

function hasNewFields(
  row: AdminUserImportNormalizedRow,
  profile: UserImportCandidateProfile
): boolean {
  return Boolean(
    row.telegramUserId
      && !profile.telegramUserIds.includes(row.telegramUserId)
    || row.telegramUsername
      && profile.telegramUsernames.length === 0
    || row.phone
      && profile.protectedPhones.length === 0
    || row.externalCrmId
      && !profile.externalCrmIds.includes(row.externalCrmId)
    || row.firstName
      && !profile.firstName
    || row.lastName
      && !profile.lastName
  );
}

function groupCandidates(
  candidates: readonly AdminUserImportIdentityCandidate[]
): ReadonlyMap<number, readonly AdminUserImportIdentityCandidate[]> {
  const grouped = new Map<number, AdminUserImportIdentityCandidate[]>();
  for (const candidate of candidates) {
    const current = grouped.get(candidate.rowNumber) ?? [];
    current.push(candidate);
    grouped.set(candidate.rowNumber, current);
  }
  return grouped;
}

function combineCandidateProfiles(
  candidates: readonly AdminUserImportIdentityCandidate[]
): ReadonlyMap<string, UserImportCandidateProfile> {
  const grouped = new Map<string, UserImportCandidateProfile>();
  for (const candidate of candidates) {
    const current = grouped.get(candidate.profile.userId);
    grouped.set(
      candidate.profile.userId,
      current
        ? {
            ...current,
            telegramUserIds: uniqueSorted([
              ...current.telegramUserIds,
              ...candidate.profile.telegramUserIds
            ]),
            telegramUsernames: uniqueSorted([
              ...current.telegramUsernames,
              ...candidate.profile.telegramUsernames
            ]),
            protectedPhones: uniqueSorted([
              ...current.protectedPhones,
              ...candidate.profile.protectedPhones
            ]),
            externalCrmIds: uniqueSorted([
              ...current.externalCrmIds,
              ...candidate.profile.externalCrmIds
            ])
          }
        : candidate.profile
    );
  }
  return grouped;
}

function uniqueMatchKinds(
  values: readonly AdminUserImportMatchKind[]
): readonly AdminUserImportMatchKind[] {
  const order: readonly AdminUserImportMatchKind[] = [
    "telegram_id",
    "verified_phone",
    "imported_phone",
    "external_crm_id",
    "telegram_username"
  ];
  const present = new Set(values);
  return order.filter((value) => present.has(value));
}

function isExactKind(kind: AdminUserImportMatchKind): boolean {
  return (
    kind === "telegram_id"
    || kind === "verified_phone"
    || kind === "external_crm_id"
  );
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function bounded(value: string, min: number, max: number): string {
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) {
    throw new InvalidAdminUserImportAnalysisError();
  }
  return normalized;
}

function requireUuid(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new InvalidAdminUserImportAnalysisError("invalid_batch_id");
  }
  return value;
}

function requirePermission(actor: AdminRequestActor): void {
  if (
    actor.permission !== "imports.execute"
    || !UUID_PATTERN.test(actor.adminId)
  ) {
    throw new InvalidAdminUserImportAnalysisError("permission");
  }
}
