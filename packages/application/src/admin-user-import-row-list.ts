import type {
  AdminRequestActor,
  AdminUserImportMatchRowPage
} from "@ticket-platform/contracts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AdminUserImportRowsRepository {
  listRows(input: {
    readonly analysisId: string;
    readonly afterRowNumber: number;
    readonly limit: number;
  }): Promise<AdminUserImportMatchRowPage | null>;
}

export class AdminUserImportRowsNotFoundError extends Error {
  constructor() {
    super("Administrator user import analysis rows were not found");
    this.name = "AdminUserImportRowsNotFoundError";
  }
}

export class InvalidAdminUserImportRowsRequestError extends Error {
  constructor(readonly code: string = "invalid_rows_request") {
    super(`Administrator user import rows request is invalid: ${code}`);
    this.name = "InvalidAdminUserImportRowsRequestError";
  }
}

export class ListAdminUserImportRowsService {
  constructor(private readonly repository: AdminUserImportRowsRepository) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly analysisId: string;
    readonly afterRowNumber: number;
    readonly limit: number;
  }): Promise<AdminUserImportMatchRowPage> {
    requirePermission(input.actor);
    const analysisId = requireUuid(input.analysisId);
    const afterRowNumber = requireInteger(
      input.afterRowNumber,
      1,
      5_001,
      "invalid_after_row_number"
    );
    const limit = requireInteger(input.limit, 1, 200, "invalid_limit");
    const result = await this.repository.listRows({
      analysisId,
      afterRowNumber,
      limit
    });
    if (!result) {
      throw new AdminUserImportRowsNotFoundError();
    }
    return result;
  }
}

function requireInteger(
  value: number,
  min: number,
  max: number,
  code: string
): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new InvalidAdminUserImportRowsRequestError(code);
  }
  return value;
}

function requireUuid(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new InvalidAdminUserImportRowsRequestError(
      "invalid_analysis_id"
    );
  }
  return value;
}

function requirePermission(actor: AdminRequestActor): void {
  if (
    actor.permission !== "imports.execute"
    || !UUID_PATTERN.test(actor.adminId)
  ) {
    throw new InvalidAdminUserImportRowsRequestError("permission");
  }
}
