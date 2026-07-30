import type {
  AdminRequestActor,
  AdminUserImportDecisionAction,
  AdminUserImportMatchKind,
  AdminUserImportMatchStatus,
  AdminUserImportRowDecision,
  DecideAdminUserImportRowRequest,
  DecideAdminUserImportRowResponse
} from "@ticket-platform/contracts";
import {
  buildAdminEventAuditContext,
  type AdminEventAuditContext,
  type AdminEventMutationMetadata
} from "./admin-event-management.js";
import type { IdGenerator } from "./identity.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS: readonly AdminUserImportDecisionAction[] = [
  "CREATE_NEW_USER",
  "MERGE_SAFE_FIELDS",
  "IGNORE_ROW"
];

export interface AdminUserImportDecisionContext {
  readonly analysisId: string;
  readonly batchId: string;
  readonly rowNumber: number;
  readonly matchStatus: AdminUserImportMatchStatus;
  readonly candidateUserIds: readonly string[];
  readonly matchKinds: readonly AdminUserImportMatchKind[];
  readonly currentDecision: AdminUserImportRowDecision | null;
}

export interface AdminUserImportDecisionRepository {
  getContext(
    analysisId: string,
    rowNumber: number
  ): Promise<AdminUserImportDecisionContext | null>;
  append(input: {
    readonly decisionId: string;
    readonly context: AdminUserImportDecisionContext;
    readonly action: AdminUserImportDecisionAction;
    readonly targetUserId: string | null;
    readonly expectedDecisionVersion: number;
    readonly audit: AdminEventAuditContext;
  }): Promise<
    | { readonly status: "created"; readonly value: AdminUserImportRowDecision }
    | { readonly status: "version_conflict" }
    | { readonly status: "not_found" }
  >;
}

export class AdminUserImportDecisionNotFoundError extends Error {
  constructor() {
    super("Administrator user import decision target was not found");
    this.name = "AdminUserImportDecisionNotFoundError";
  }
}

export class AdminUserImportDecisionVersionConflictError extends Error {
  constructor() {
    super("Administrator user import decision version conflict");
    this.name = "AdminUserImportDecisionVersionConflictError";
  }
}

export class InvalidAdminUserImportDecisionError extends Error {
  constructor(readonly code: string = "invalid_decision") {
    super(`Administrator user import decision is invalid: ${code}`);
    this.name = "InvalidAdminUserImportDecisionError";
  }
}

export class DecideAdminUserImportRowService {
  constructor(
    private readonly repository: AdminUserImportDecisionRepository,
    private readonly idGenerator: IdGenerator
  ) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly analysisId: string;
    readonly rowNumber: number;
    readonly request: DecideAdminUserImportRowRequest;
    readonly metadata: AdminEventMutationMetadata;
  }): Promise<DecideAdminUserImportRowResponse> {
    requirePermission(input.actor);
    const analysisId = requireUuid(input.analysisId, "invalid_analysis_id");
    const rowNumber = requireRowNumber(input.rowNumber);
    const reason = bounded(input.request.reason, 1, 500);
    const action = requireAction(input.request.action);
    const targetUserId = input.request.targetUserId === null
      ? null
      : requireUuid(input.request.targetUserId, "invalid_target_user_id");
    const expectedDecisionVersion = requireVersion(
      input.request.expectedDecisionVersion
    );
    const context = await this.repository.getContext(
      analysisId,
      rowNumber
    );
    if (!context) {
      throw new AdminUserImportDecisionNotFoundError();
    }
    validateDecision(
      context,
      action,
      targetUserId,
      expectedDecisionVersion
    );
    const audit = buildAdminEventAuditContext(
      input.actor,
      reason,
      input.metadata,
      this.idGenerator
    );
    const result = await this.repository.append({
      decisionId: requireUuid(
        this.idGenerator.newId(),
        "invalid_decision_id"
      ),
      context,
      action,
      targetUserId,
      expectedDecisionVersion,
      audit
    });
    if (result.status === "not_found") {
      throw new AdminUserImportDecisionNotFoundError();
    }
    if (result.status === "version_conflict") {
      throw new AdminUserImportDecisionVersionConflictError();
    }
    return { decision: result.value };
  }
}

function validateDecision(
  context: AdminUserImportDecisionContext,
  action: AdminUserImportDecisionAction,
  targetUserId: string | null,
  expectedDecisionVersion: number
): void {
  if (
    context.matchStatus !== "POSSIBLE_MATCH"
    && context.matchStatus !== "CONFLICT"
  ) {
    throw new InvalidAdminUserImportDecisionError("row_not_decidable");
  }
  if (
    expectedDecisionVersion
    !== (context.currentDecision?.version ?? 0)
  ) {
    throw new AdminUserImportDecisionVersionConflictError();
  }
  if (action === "MERGE_SAFE_FIELDS") {
    if (
      !targetUserId
      || !context.candidateUserIds.includes(targetUserId)
    ) {
      throw new InvalidAdminUserImportDecisionError(
        "target_must_be_candidate"
      );
    }
    return;
  }
  if (targetUserId) {
    throw new InvalidAdminUserImportDecisionError(
      "target_not_allowed"
    );
  }
  if (
    action === "CREATE_NEW_USER"
    && (
      context.matchStatus !== "POSSIBLE_MATCH"
      || context.matchKinds.includes("imported_phone")
    )
  ) {
    throw new InvalidAdminUserImportDecisionError(
      "create_new_not_safe"
    );
  }
}

function requireAction(value: string): AdminUserImportDecisionAction {
  if (!ACTIONS.includes(value as AdminUserImportDecisionAction)) {
    throw new InvalidAdminUserImportDecisionError("invalid_action");
  }
  return value as AdminUserImportDecisionAction;
}

function requireVersion(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000) {
    throw new InvalidAdminUserImportDecisionError(
      "invalid_decision_version"
    );
  }
  return value;
}

function requireRowNumber(value: number): number {
  if (!Number.isSafeInteger(value) || value < 2 || value > 5_001) {
    throw new InvalidAdminUserImportDecisionError("invalid_row_number");
  }
  return value;
}

function bounded(value: string, min: number, max: number): string {
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) {
    throw new InvalidAdminUserImportDecisionError();
  }
  return normalized;
}

function requireUuid(value: string, code: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new InvalidAdminUserImportDecisionError(code);
  }
  return value;
}

function requirePermission(actor: AdminRequestActor): void {
  if (
    actor.permission !== "imports.execute"
    || !UUID_PATTERN.test(actor.adminId)
  ) {
    throw new InvalidAdminUserImportDecisionError("permission");
  }
}
