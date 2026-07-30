import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  DynamicModule,
  Get,
  Inject,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException
} from "@nestjs/common";
import {
  AdminUserImportDecisionNotFoundError,
  AdminUserImportDecisionVersionConflictError,
  AdminUserImportBatchNotFoundError,
  AdminUserImportRowsNotFoundError,
  InvalidAdminUserImportRowsRequestError,
  InvalidAdminUserImportDecisionError,
  InvalidAdminUserImportAnalysisError,
  InvalidAdminUserImportError
} from "@ticket-platform/application";
import type {
  AdminRequestActor,
  AdminUserImportMatchRowPage,
  AnalyzeAdminUserImportRequest,
  AnalyzeAdminUserImportResponse,
  CreateAdminUserImportPreviewRequest,
  CreateAdminUserImportPreviewResponse,
  DecideAdminUserImportRowRequest,
  DecideAdminUserImportRowResponse
} from "@ticket-platform/contracts";
import { z } from "zod";
import {
  RequireAdminPermission,
  type AuthenticatedAdminRequest
} from "./admin-auth.js";

const ADMIN_IMPORTS = Symbol("ADMIN_IMPORTS");
const MAX_BASE64_LENGTH = Math.ceil((512 * 1_024) / 3) * 4;
const previewSchema = z.object({
  fileName: z.string().trim().min(1).max(120),
  contentBase64: z.string().min(4).max(MAX_BASE64_LENGTH)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  reason: z.string().trim().min(1).max(500)
}).strict();
const analysisSchema = z.object({
  reason: z.string().trim().min(1).max(500)
}).strict();
const batchIdSchema = z.string().uuid();
const rowNumberSchema = z.coerce.number().int().min(2).max(5_001);
const decisionSchema = z.object({
  action: z.enum([
    "CREATE_NEW_USER",
    "MERGE_SAFE_FIELDS",
    "IGNORE_ROW"
  ]),
  targetUserId: z.string().uuid().nullable(),
  expectedDecisionVersion: z.number().int().min(0).max(1_000_000),
  reason: z.string().trim().min(1).max(500)
}).strict();
const rowsQuerySchema = z.object({
  afterRowNumber: z.coerce.number().int().min(1).max(5_001)
    .default(1),
  limit: z.coerce.number().int().min(1).max(200).default(200)
}).strict();

export interface AdminImportHandlers {
  readonly previewUsers: {
    execute(input: {
      readonly actor: AdminRequestActor;
      readonly request: CreateAdminUserImportPreviewRequest;
      readonly metadata: ReturnType<typeof mutationMetadata>;
    }): Promise<CreateAdminUserImportPreviewResponse>;
  };
  readonly analyzeUsers: {
    execute(input: {
      readonly actor: AdminRequestActor;
      readonly batchId: string;
      readonly request: AnalyzeAdminUserImportRequest;
      readonly metadata: ReturnType<typeof mutationMetadata>;
    }): Promise<AnalyzeAdminUserImportResponse>;
  };
  readonly decideUserRow: {
    execute(input: {
      readonly actor: AdminRequestActor;
      readonly analysisId: string;
      readonly rowNumber: number;
      readonly request: DecideAdminUserImportRowRequest;
      readonly metadata: ReturnType<typeof mutationMetadata>;
    }): Promise<DecideAdminUserImportRowResponse>;
  };
  readonly listUserRows: {
    execute(input: {
      readonly actor: AdminRequestActor;
      readonly analysisId: string;
      readonly afterRowNumber: number;
      readonly limit: number;
    }): Promise<AdminUserImportMatchRowPage>;
  };
}

@Controller("api/v1/imports")
export class AdminImportsController {
  constructor(
    @Inject(ADMIN_IMPORTS)
    private readonly handlers: AdminImportHandlers
  ) {}

  @Post("users/preview")
  @RequireAdminPermission("imports.execute")
  async previewUsers(
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<CreateAdminUserImportPreviewResponse> {
    const parsed = previewSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidImport();
    }
    try {
      return await this.handlers.previewUsers.execute({
        actor: requireActor(request),
        request: parsed.data,
        metadata: mutationMetadata(request)
      });
    } catch (error) {
      if (error instanceof InvalidAdminUserImportError) {
        throw invalidImport(error.code);
      }
      throw error;
    }
  }

  @Post("users/:batchId/analyze")
  @RequireAdminPermission("imports.execute")
  async analyzeUsers(
    @Param("batchId") batchId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<AnalyzeAdminUserImportResponse> {
    const parsedBatchId = batchIdSchema.safeParse(batchId);
    const parsed = analysisSchema.safeParse(body);
    if (!parsedBatchId.success || !parsed.success) {
      throw invalidAnalysis();
    }
    try {
      return await this.handlers.analyzeUsers.execute({
        actor: requireActor(request),
        batchId: parsedBatchId.data,
        request: parsed.data,
        metadata: mutationMetadata(request)
      });
    } catch (error) {
      if (error instanceof InvalidAdminUserImportAnalysisError) {
        throw invalidAnalysis(error.code);
      }
      if (error instanceof AdminUserImportBatchNotFoundError) {
        throw new NotFoundException({
          code: "ADMIN_USER_IMPORT_BATCH_NOT_FOUND",
          title: "User import batch was not found"
        });
      }
      throw error;
    }
  }

  @Post("users/analyses/:analysisId/rows/:rowNumber/decision")
  @RequireAdminPermission("imports.execute")
  async decideUserRow(
    @Param("analysisId") analysisId: string,
    @Param("rowNumber") rowNumber: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<DecideAdminUserImportRowResponse> {
    const parsedAnalysisId = batchIdSchema.safeParse(analysisId);
    const parsedRowNumber = rowNumberSchema.safeParse(rowNumber);
    const parsed = decisionSchema.safeParse(body);
    if (
      !parsedAnalysisId.success
      || !parsedRowNumber.success
      || !parsed.success
    ) {
      throw invalidDecision();
    }
    try {
      return await this.handlers.decideUserRow.execute({
        actor: requireActor(request),
        analysisId: parsedAnalysisId.data,
        rowNumber: parsedRowNumber.data,
        request: parsed.data,
        metadata: mutationMetadata(request)
      });
    } catch (error) {
      if (error instanceof InvalidAdminUserImportDecisionError) {
        throw invalidDecision(error.code);
      }
      if (error instanceof AdminUserImportDecisionNotFoundError) {
        throw new NotFoundException({
          code: "ADMIN_USER_IMPORT_DECISION_TARGET_NOT_FOUND",
          title: "User import decision target was not found"
        });
      }
      if (error instanceof AdminUserImportDecisionVersionConflictError) {
        throw new ConflictException({
          code: "ADMIN_USER_IMPORT_DECISION_VERSION_CONFLICT",
          title: "User import decision has changed"
        });
      }
      throw error;
    }
  }

  @Get("users/analyses/:analysisId/rows")
  @RequireAdminPermission("imports.execute")
  async listUserRows(
    @Param("analysisId") analysisId: string,
    @Query() query: unknown,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<AdminUserImportMatchRowPage> {
    const parsedAnalysisId = batchIdSchema.safeParse(analysisId);
    const parsed = rowsQuerySchema.safeParse(query);
    if (!parsedAnalysisId.success || !parsed.success) {
      throw invalidRowsRequest();
    }
    try {
      return await this.handlers.listUserRows.execute({
        actor: requireActor(request),
        analysisId: parsedAnalysisId.data,
        afterRowNumber: parsed.data.afterRowNumber,
        limit: parsed.data.limit
      });
    } catch (error) {
      if (error instanceof InvalidAdminUserImportRowsRequestError) {
        throw invalidRowsRequest(error.code);
      }
      if (error instanceof AdminUserImportRowsNotFoundError) {
        throw new NotFoundException({
          code: "ADMIN_USER_IMPORT_ANALYSIS_NOT_FOUND",
          title: "User import analysis was not found"
        });
      }
      throw error;
    }
  }
}

@Module({})
export class AdminImportsApiModule {
  static register(handlers: AdminImportHandlers): DynamicModule {
    return {
      module: AdminImportsApiModule,
      controllers: [AdminImportsController],
      providers: [{ provide: ADMIN_IMPORTS, useValue: handlers }]
    };
  }
}

function requireActor(
  request: AuthenticatedAdminRequest
): AdminRequestActor {
  if (!request.adminActor) {
    throw new UnauthorizedException();
  }
  return request.adminActor;
}

function mutationMetadata(request: AuthenticatedAdminRequest) {
  return {
    requestId: readRequestId(request),
    ipAddress: request.ip || null,
    userAgent: request.headers["user-agent"]?.slice(0, 500) ?? null,
    occurredAt: new Date()
  };
}

function readRequestId(request: AuthenticatedAdminRequest): string {
  const header = request.headers["x-request-id"];
  if (
    typeof header === "string"
    && header.length >= 8
    && header.length <= 200
    && /^[A-Za-z0-9._:-]+$/.test(header)
  ) {
    return header;
  }
  return String(request.id).slice(0, 200);
}

function invalidImport(reason = "invalid_import"): BadRequestException {
  return new BadRequestException({
    code: "INVALID_ADMIN_USER_IMPORT",
    title: "User import preview is invalid",
    reason
  });
}

function invalidAnalysis(reason = "invalid_analysis"): BadRequestException {
  return new BadRequestException({
    code: "INVALID_ADMIN_USER_IMPORT_ANALYSIS",
    title: "User import analysis is invalid",
    reason
  });
}

function invalidDecision(reason = "invalid_decision"): BadRequestException {
  return new BadRequestException({
    code: "INVALID_ADMIN_USER_IMPORT_DECISION",
    title: "User import decision is invalid",
    reason
  });
}

function invalidRowsRequest(
  reason = "invalid_rows_request"
): BadRequestException {
  return new BadRequestException({
    code: "INVALID_ADMIN_USER_IMPORT_ROWS_REQUEST",
    title: "User import rows request is invalid",
    reason
  });
}
