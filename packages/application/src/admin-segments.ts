import type {
  AdminRequestActor,
  AdminSegmentBooleanOperator,
  AdminSegmentClassificationCondition,
  AdminSegmentConditionGroup,
  AdminSegmentExpression,
  AdminSegmentPreview,
  PreviewAdminSegmentRequest
} from "@ticket-platform/contracts";

const CODE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AdminSegmentPreviewRepository {
  findUnavailableClassificationCodes(input: {
    readonly statusCodes: readonly string[];
    readonly categoryCodes: readonly string[];
  }): Promise<{
    readonly statusCodes: readonly string[];
    readonly categoryCodes: readonly string[];
  }>;
  preview(input: {
    readonly operator: AdminSegmentBooleanOperator;
    readonly groups: readonly AdminSegmentConditionGroup[];
    readonly sampleLimit: number;
  }): Promise<AdminSegmentPreview>;
}

export class InvalidAdminSegmentPreviewError extends Error {
  constructor() {
    super("Administrator segment preview is invalid");
    this.name = "InvalidAdminSegmentPreviewError";
  }
}

export class AdminSegmentClassificationUnavailableError extends Error {
  constructor(
    readonly statusCodes: readonly string[],
    readonly categoryCodes: readonly string[]
  ) {
    super("Administrator segment classification is unavailable");
    this.name = "AdminSegmentClassificationUnavailableError";
  }
}

export class PreviewAdminSegmentService {
  constructor(private readonly repository: AdminSegmentPreviewRepository) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly request: PreviewAdminSegmentRequest;
  }): Promise<AdminSegmentPreview> {
    requirePermission(input.actor);
    const expression = normalizeAdminSegmentExpression(input.request);
    const request = {
      ...expression,
      sampleLimit: parseSampleLimit(input.request.sampleLimit)
    };
    const { statusCodes, categoryCodes } =
      collectAdminSegmentClassificationCodes(expression);
    const unavailable =
      await this.repository.findUnavailableClassificationCodes({
        statusCodes,
        categoryCodes
      });
    if (
      unavailable.statusCodes.length > 0
      || unavailable.categoryCodes.length > 0
    ) {
      throw new AdminSegmentClassificationUnavailableError(
        unavailable.statusCodes,
        unavailable.categoryCodes
      );
    }
    return this.repository.preview(request);
  }
}

export function normalizeAdminSegmentExpression(
  request: AdminSegmentExpression
): AdminSegmentExpression {
  if (
    !["and", "or"].includes(request.operator)
    || request.groups.length < 1
    || request.groups.length > 8
  ) {
    throw new InvalidAdminSegmentPreviewError();
  }
  return {
    operator: request.operator,
    groups: request.groups.map(parseGroup)
  };
}

export function collectAdminSegmentClassificationCodes(
  expression: AdminSegmentExpression
): {
  readonly statusCodes: readonly string[];
  readonly categoryCodes: readonly string[];
} {
  return {
    statusCodes: uniqueCodes(expression.groups, "status"),
    categoryCodes: uniqueCodes(expression.groups, "category")
  };
}

function parseGroup(group: AdminSegmentConditionGroup): AdminSegmentConditionGroup {
  if (
    !["and", "or"].includes(group.operator)
    || group.conditions.length < 1
    || group.conditions.length > 8
  ) {
    throw new InvalidAdminSegmentPreviewError();
  }
  return {
    operator: group.operator,
    conditions: group.conditions.map(parseCondition)
  };
}

function parseCondition(
  condition: AdminSegmentClassificationCondition
): AdminSegmentClassificationCondition {
  const codes = [...new Set(condition.codes.map((code) => code.trim()))].sort();
  if (
    !["status", "category"].includes(condition.kind)
    || !["any", "all", "none"].includes(condition.mode)
    || codes.length < 1
    || codes.length > 20
    || codes.some((code) => !CODE_PATTERN.test(code))
  ) {
    throw new InvalidAdminSegmentPreviewError();
  }
  return { kind: condition.kind, mode: condition.mode, codes };
}

function uniqueCodes(
  groups: readonly AdminSegmentConditionGroup[],
  kind: "status" | "category"
): readonly string[] {
  return [...new Set(
    groups.flatMap((group) =>
      group.conditions
        .filter((condition) => condition.kind === kind)
        .flatMap((condition) => condition.codes)
    )
  )].sort();
}

function requirePermission(actor: AdminRequestActor): void {
  if (
    actor.permission !== "users.read"
    || !UUID_PATTERN.test(actor.adminId)
  ) {
    throw new InvalidAdminSegmentPreviewError();
  }
}

function parseSampleLimit(value: number | undefined): number {
  const sampleLimit = value ?? 20;
  if (
    !Number.isSafeInteger(sampleLimit)
    || sampleLimit < 1
    || sampleLimit > 50
  ) {
    throw new InvalidAdminSegmentPreviewError();
  }
  return sampleLimit;
}
