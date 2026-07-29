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
  Patch,
  Post,
  Req,
  UnprocessableEntityException,
  UnauthorizedException
} from "@nestjs/common";
import {
  AdminSavedSegmentDraftNotFoundError,
  AdminSavedSegmentNotFoundError,
  AdminSavedSegmentVersionConflictError,
  AdminSegmentAudienceSnapshotNotFoundError,
  AdminSegmentAudienceSnapshotVersionUnavailableError,
  AdminSegmentClassificationUnavailableError,
  InvalidAdminSegmentAudienceSnapshotError,
  InvalidAdminSavedSegmentError,
  InvalidAdminSegmentPreviewError
} from "@ticket-platform/application";
import type {
  AdminSavedSegment,
  AdminSavedSegmentSummary,
  AdminSegmentAudienceSnapshot,
  AdminSegmentAudienceSnapshotSummary,
  AdminSegmentPreview,
  CreateAdminSavedSegmentRequest,
  PublishAdminSavedSegmentRequest,
  PreviewAdminSegmentRequest,
  RequestAdminSegmentAudienceSnapshotRequest,
  UpdateAdminSavedSegmentDraftRequest
} from "@ticket-platform/contracts";
import { z } from "zod";
import {
  RequireAdminPermission,
  type AuthenticatedAdminRequest
} from "./admin-auth.js";

const ADMIN_SEGMENTS = Symbol("ADMIN_SEGMENTS");
const codeSchema = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/);
const conditionSchema = z.object({
  kind: z.enum(["status", "category"]),
  mode: z.enum(["any", "all", "none"]),
  codes: z.array(codeSchema).min(1).max(20)
}).strict();
const previewSchema = z.object({
  operator: z.enum(["and", "or"]),
  groups: z.array(z.object({
    operator: z.enum(["and", "or"]),
    conditions: z.array(conditionSchema).min(1).max(8)
  }).strict()).min(1).max(8),
  sampleLimit: z.number().int().min(1).max(50).optional()
}).strict();
const expressionSchema = previewSchema.omit({ sampleLimit: true });
const definitionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(1000).nullable().optional(),
  expression: expressionSchema,
  reason: z.string().trim().min(1).max(500)
}).strict();
const updateSchema = definitionSchema.extend({
  expectedLockVersion: z.number().int().min(1)
}).strict();
const publishSchema = z.object({
  expectedLockVersion: z.number().int().min(1),
  reason: z.string().trim().min(1).max(500)
}).strict();
const requestSnapshotSchema = z.object({
  segmentVersionId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500)
}).strict();

export interface AdminSegmentsHandlers {
  readonly preview: {
    execute(input: {
      readonly actor: NonNullable<AuthenticatedAdminRequest["adminActor"]>;
      readonly request: PreviewAdminSegmentRequest;
    }): Promise<AdminSegmentPreview>;
  };
  readonly list: {
    execute(input: {
      readonly actor: NonNullable<AuthenticatedAdminRequest["adminActor"]>;
    }): Promise<readonly AdminSavedSegmentSummary[]>;
  };
  readonly get: {
    execute(input: {
      readonly actor: NonNullable<AuthenticatedAdminRequest["adminActor"]>;
      readonly segmentId: string;
    }): Promise<AdminSavedSegment>;
  };
  readonly create: {
    execute(input: {
      readonly actor: NonNullable<AuthenticatedAdminRequest["adminActor"]>;
      readonly request: CreateAdminSavedSegmentRequest;
      readonly metadata: ReturnType<typeof mutationMetadata>;
    }): Promise<AdminSavedSegment>;
  };
  readonly updateDraft: {
    execute(input: {
      readonly actor: NonNullable<AuthenticatedAdminRequest["adminActor"]>;
      readonly segmentId: string;
      readonly request: UpdateAdminSavedSegmentDraftRequest;
      readonly metadata: ReturnType<typeof mutationMetadata>;
    }): Promise<AdminSavedSegment>;
  };
  readonly publish: {
    execute(input: {
      readonly actor: NonNullable<AuthenticatedAdminRequest["adminActor"]>;
      readonly segmentId: string;
      readonly request: PublishAdminSavedSegmentRequest;
      readonly metadata: ReturnType<typeof mutationMetadata>;
    }): Promise<AdminSavedSegment>;
  };
  readonly listSnapshots: {
    execute(input: {
      readonly actor: NonNullable<AuthenticatedAdminRequest["adminActor"]>;
      readonly segmentId: string;
    }): Promise<readonly AdminSegmentAudienceSnapshotSummary[]>;
  };
  readonly getSnapshot: {
    execute(input: {
      readonly actor: NonNullable<AuthenticatedAdminRequest["adminActor"]>;
      readonly segmentId: string;
      readonly snapshotId: string;
    }): Promise<AdminSegmentAudienceSnapshot>;
  };
  readonly requestSnapshot: {
    execute(input: {
      readonly actor: NonNullable<AuthenticatedAdminRequest["adminActor"]>;
      readonly segmentId: string;
      readonly request: RequestAdminSegmentAudienceSnapshotRequest;
      readonly metadata: ReturnType<typeof mutationMetadata>;
    }): Promise<AdminSegmentAudienceSnapshotSummary>;
  };
}

@Controller("api/v1/segments")
export class AdminSegmentsController {
  constructor(
    @Inject(ADMIN_SEGMENTS)
    private readonly handlers: AdminSegmentsHandlers
  ) {}

  @Get()
  @RequireAdminPermission("users.read")
  list(
    @Req() request: AuthenticatedAdminRequest
  ): Promise<readonly AdminSavedSegmentSummary[]> {
    return this.handlers.list.execute({ actor: requireActor(request) });
  }

  @Get(":segmentId/audience-snapshots")
  @RequireAdminPermission("users.read")
  listSnapshots(
    @Param("segmentId") segmentId: string,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<readonly AdminSegmentAudienceSnapshotSummary[]> {
    return this.handlers.listSnapshots.execute({
      actor: requireActor(request),
      segmentId
    });
  }

  @Get(":segmentId/audience-snapshots/:snapshotId")
  @RequireAdminPermission("users.read")
  async getSnapshot(
    @Param("segmentId") segmentId: string,
    @Param("snapshotId") snapshotId: string,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<AdminSegmentAudienceSnapshot> {
    try {
      return await this.handlers.getSnapshot.execute({
        actor: requireActor(request),
        segmentId,
        snapshotId
      });
    } catch (error) {
      throw mapSavedSegmentError(error);
    }
  }

  @Post(":segmentId/audience-snapshots")
  @RequireAdminPermission("broadcasts.send")
  async requestSnapshot(
    @Param("segmentId") segmentId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<AdminSegmentAudienceSnapshotSummary> {
    const parsed = requestSnapshotSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidSnapshot();
    }
    try {
      return await this.handlers.requestSnapshot.execute({
        actor: requireActor(request),
        segmentId,
        request: parsed.data,
        metadata: mutationMetadata(request)
      });
    } catch (error) {
      throw mapSavedSegmentError(error);
    }
  }

  @Get(":segmentId")
  @RequireAdminPermission("users.read")
  async get(
    @Param("segmentId") segmentId: string,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<AdminSavedSegment> {
    try {
      return await this.handlers.get.execute({
        actor: requireActor(request),
        segmentId
      });
    } catch (error) {
      throw mapSavedSegmentError(error);
    }
  }

  @Post()
  @RequireAdminPermission("broadcasts.send")
  async create(
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<AdminSavedSegment> {
    const parsed = definitionSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidSavedSegment();
    }
    try {
      return await this.handlers.create.execute({
        actor: requireActor(request),
        request: {
          name: parsed.data.name,
          expression: parsed.data.expression,
          reason: parsed.data.reason,
          ...(parsed.data.description === undefined
            ? {}
            : { description: parsed.data.description })
        },
        metadata: mutationMetadata(request)
      });
    } catch (error) {
      throw mapSavedSegmentError(error);
    }
  }

  @Patch(":segmentId/draft")
  @RequireAdminPermission("broadcasts.send")
  async updateDraft(
    @Param("segmentId") segmentId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<AdminSavedSegment> {
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidSavedSegment();
    }
    try {
      return await this.handlers.updateDraft.execute({
        actor: requireActor(request),
        segmentId,
        request: {
          expectedLockVersion: parsed.data.expectedLockVersion,
          name: parsed.data.name,
          expression: parsed.data.expression,
          reason: parsed.data.reason,
          ...(parsed.data.description === undefined
            ? {}
            : { description: parsed.data.description })
        },
        metadata: mutationMetadata(request)
      });
    } catch (error) {
      throw mapSavedSegmentError(error);
    }
  }

  @Post(":segmentId/publish")
  @RequireAdminPermission("broadcasts.send")
  async publish(
    @Param("segmentId") segmentId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<AdminSavedSegment> {
    const parsed = publishSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidSavedSegment();
    }
    try {
      return await this.handlers.publish.execute({
        actor: requireActor(request),
        segmentId,
        request: parsed.data,
        metadata: mutationMetadata(request)
      });
    } catch (error) {
      throw mapSavedSegmentError(error);
    }
  }

  @Post("preview")
  @RequireAdminPermission("users.read")
  async preview(
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<AdminSegmentPreview> {
    const parsed = previewSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidPreview();
    }
    try {
      return await this.handlers.preview.execute({
        actor: requireActor(request),
        request: {
          operator: parsed.data.operator,
          groups: parsed.data.groups,
          ...(parsed.data.sampleLimit === undefined
            ? {}
            : { sampleLimit: parsed.data.sampleLimit })
        }
      });
    } catch (error) {
      if (error instanceof InvalidAdminSegmentPreviewError) {
        throw invalidPreview();
      }
      if (error instanceof AdminSegmentClassificationUnavailableError) {
        throw new UnprocessableEntityException({
          code: "ADMIN_SEGMENT_CLASSIFICATION_UNAVAILABLE",
          title: "Segment references unavailable classification codes",
          statusCodes: error.statusCodes,
          categoryCodes: error.categoryCodes
        });
      }
      throw error;
    }
  }
}

@Module({})
export class AdminSegmentsApiModule {
  static register(handlers: AdminSegmentsHandlers): DynamicModule {
    return {
      module: AdminSegmentsApiModule,
      controllers: [AdminSegmentsController],
      providers: [{ provide: ADMIN_SEGMENTS, useValue: handlers }]
    };
  }
}

function requireActor(
  request: AuthenticatedAdminRequest
): NonNullable<AuthenticatedAdminRequest["adminActor"]> {
  if (!request.adminActor) {
    throw new UnauthorizedException();
  }
  return request.adminActor;
}

function invalidPreview(): BadRequestException {
  return new BadRequestException({
    code: "INVALID_ADMIN_SEGMENT_PREVIEW",
    title: "Administrator segment preview is invalid"
  });
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

function invalidSavedSegment(): BadRequestException {
  return new BadRequestException({
    code: "INVALID_ADMIN_SAVED_SEGMENT",
    title: "Saved segment mutation is invalid"
  });
}

function invalidSnapshot(): BadRequestException {
  return new BadRequestException({
    code: "INVALID_ADMIN_SEGMENT_AUDIENCE_SNAPSHOT",
    title: "Segment audience snapshot request is invalid"
  });
}

function mapSavedSegmentError(error: unknown): unknown {
  if (error instanceof InvalidAdminSavedSegmentError) {
    return invalidSavedSegment();
  }
  if (error instanceof AdminSavedSegmentNotFoundError) {
    return new NotFoundException({
      code: "ADMIN_SAVED_SEGMENT_NOT_FOUND",
      title: "Saved segment was not found"
    });
  }
  if (error instanceof AdminSavedSegmentVersionConflictError) {
    return new ConflictException({
      code: "ADMIN_SAVED_SEGMENT_VERSION_CONFLICT",
      title: "Saved segment was changed by another administrator"
    });
  }
  if (error instanceof AdminSavedSegmentDraftNotFoundError) {
    return new ConflictException({
      code: "ADMIN_SAVED_SEGMENT_DRAFT_NOT_FOUND",
      title: "Saved segment has no draft to publish"
    });
  }
  if (error instanceof AdminSegmentClassificationUnavailableError) {
    return new UnprocessableEntityException({
      code: "ADMIN_SEGMENT_CLASSIFICATION_UNAVAILABLE",
      title: "Segment references unavailable classification codes",
      statusCodes: error.statusCodes,
      categoryCodes: error.categoryCodes
    });
  }
  if (error instanceof InvalidAdminSegmentAudienceSnapshotError) {
    return invalidSnapshot();
  }
  if (error instanceof AdminSegmentAudienceSnapshotNotFoundError) {
    return new NotFoundException({
      code: "ADMIN_SEGMENT_AUDIENCE_SNAPSHOT_NOT_FOUND",
      title: "Segment audience snapshot was not found"
    });
  }
  if (error instanceof AdminSegmentAudienceSnapshotVersionUnavailableError) {
    return new UnprocessableEntityException({
      code: "ADMIN_SEGMENT_VERSION_NOT_PUBLISHED",
      title: "Audience snapshot requires a published segment version"
    });
  }
  return error;
}
