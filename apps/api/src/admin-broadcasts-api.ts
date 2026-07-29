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
  AdminBroadcastAudienceSnapshotUnavailableError,
  AdminBroadcastDraftExistsError,
  AdminBroadcastDraftNotFoundError,
  AdminBroadcastNotEditableError,
  AdminBroadcastNotFoundError,
  AdminBroadcastPublishedVersionUnavailableError,
  AdminBroadcastVersionConflictError,
  InvalidAdminBroadcastError
} from "@ticket-platform/application";
import type {
  AdminBroadcast,
  AdminBroadcastSummary,
  CreateAdminBroadcastRequest,
  PublishAdminBroadcastDraftRequest,
  ScheduleAdminBroadcastRequest,
  UpdateAdminBroadcastDraftRequest
} from "@ticket-platform/contracts";
import { z } from "zod";
import {
  RequireAdminPermission,
  type AuthenticatedAdminRequest
} from "./admin-auth.js";

const ADMIN_BROADCASTS = Symbol("ADMIN_BROADCASTS");
const contentSchema = z.object({
  text: z.string().trim().min(1).max(4_000),
  disableLinkPreview: z.boolean(),
  buttons: z.array(z.object({
    label: z.string().trim().min(1).max(64),
    url: z.string().trim().min(1).max(2_048)
  }).strict()).max(8)
}).strict();
const definitionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  audienceSnapshotId: z.string().uuid(),
  content: contentSchema,
  reason: z.string().trim().min(1).max(500)
}).strict();
const updateSchema = definitionSchema.extend({
  expectedLockVersion: z.number().int().min(1)
}).strict();
const publishSchema = z.object({
  expectedLockVersion: z.number().int().min(1),
  reason: z.string().trim().min(1).max(500)
}).strict();
const scheduleSchema = z.object({
  expectedLockVersion: z.number().int().min(1),
  scheduledAt: z.string().datetime(),
  timezone: z.string().trim().min(1).max(100),
  ratePerSecond: z.number().int().min(1).max(25),
  reason: z.string().trim().min(1).max(500)
}).strict();

type Actor = NonNullable<AuthenticatedAdminRequest["adminActor"]>;

export interface AdminBroadcastHandlers {
  readonly list: {
    execute(input: { readonly actor: Actor }): Promise<
      readonly AdminBroadcastSummary[]
    >;
  };
  readonly get: {
    execute(input: {
      readonly actor: Actor;
      readonly broadcastId: string;
    }): Promise<AdminBroadcast>;
  };
  readonly create: {
    execute(input: {
      readonly actor: Actor;
      readonly request: CreateAdminBroadcastRequest;
      readonly metadata: ReturnType<typeof mutationMetadata>;
    }): Promise<AdminBroadcast>;
  };
  readonly updateDraft: {
    execute(input: {
      readonly actor: Actor;
      readonly broadcastId: string;
      readonly request: UpdateAdminBroadcastDraftRequest;
      readonly metadata: ReturnType<typeof mutationMetadata>;
    }): Promise<AdminBroadcast>;
  };
  readonly publish: {
    execute(input: {
      readonly actor: Actor;
      readonly broadcastId: string;
      readonly request: PublishAdminBroadcastDraftRequest;
      readonly metadata: ReturnType<typeof mutationMetadata>;
    }): Promise<AdminBroadcast>;
  };
  readonly schedule: {
    execute(input: {
      readonly actor: Actor;
      readonly broadcastId: string;
      readonly request: ScheduleAdminBroadcastRequest;
      readonly metadata: ReturnType<typeof mutationMetadata>;
    }): Promise<AdminBroadcast>;
  };
}

@Controller("api/v1/broadcasts")
export class AdminBroadcastsController {
  constructor(
    @Inject(ADMIN_BROADCASTS)
    private readonly handlers: AdminBroadcastHandlers
  ) {}

  @Get()
  @RequireAdminPermission("broadcasts.send")
  list(
    @Req() request: AuthenticatedAdminRequest
  ): Promise<readonly AdminBroadcastSummary[]> {
    return this.handlers.list.execute({ actor: requireActor(request) });
  }

  @Get(":broadcastId")
  @RequireAdminPermission("broadcasts.send")
  async get(
    @Param("broadcastId") broadcastId: string,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<AdminBroadcast> {
    try {
      return await this.handlers.get.execute({
        actor: requireActor(request),
        broadcastId
      });
    } catch (error) {
      throw mapError(error);
    }
  }

  @Post()
  @RequireAdminPermission("broadcasts.send")
  async create(
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<AdminBroadcast> {
    const parsed = definitionSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidBroadcast();
    }
    try {
      return await this.handlers.create.execute({
        actor: requireActor(request),
        request: parsed.data,
        metadata: mutationMetadata(request)
      });
    } catch (error) {
      throw mapError(error);
    }
  }

  @Patch(":broadcastId/draft")
  @RequireAdminPermission("broadcasts.send")
  async updateDraft(
    @Param("broadcastId") broadcastId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<AdminBroadcast> {
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidBroadcast();
    }
    try {
      return await this.handlers.updateDraft.execute({
        actor: requireActor(request),
        broadcastId,
        request: parsed.data,
        metadata: mutationMetadata(request)
      });
    } catch (error) {
      throw mapError(error);
    }
  }

  @Post(":broadcastId/publish")
  @RequireAdminPermission("broadcasts.send")
  async publish(
    @Param("broadcastId") broadcastId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<AdminBroadcast> {
    const parsed = publishSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidBroadcast();
    }
    try {
      return await this.handlers.publish.execute({
        actor: requireActor(request),
        broadcastId,
        request: parsed.data,
        metadata: mutationMetadata(request)
      });
    } catch (error) {
      throw mapError(error);
    }
  }

  @Post(":broadcastId/schedule")
  @RequireAdminPermission("broadcasts.send")
  async schedule(
    @Param("broadcastId") broadcastId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<AdminBroadcast> {
    const parsed = scheduleSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidBroadcast();
    }
    try {
      return await this.handlers.schedule.execute({
        actor: requireActor(request),
        broadcastId,
        request: parsed.data,
        metadata: mutationMetadata(request)
      });
    } catch (error) {
      throw mapError(error);
    }
  }
}

@Module({})
export class AdminBroadcastsApiModule {
  static register(handlers: AdminBroadcastHandlers): DynamicModule {
    return {
      module: AdminBroadcastsApiModule,
      controllers: [AdminBroadcastsController],
      providers: [{ provide: ADMIN_BROADCASTS, useValue: handlers }]
    };
  }
}

function requireActor(request: AuthenticatedAdminRequest): Actor {
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

function invalidBroadcast(): BadRequestException {
  return new BadRequestException({
    code: "INVALID_ADMIN_BROADCAST",
    title: "Broadcast mutation is invalid"
  });
}

function mapError(error: unknown): unknown {
  if (error instanceof InvalidAdminBroadcastError) {
    return invalidBroadcast();
  }
  if (error instanceof AdminBroadcastNotFoundError) {
    return new NotFoundException({
      code: "ADMIN_BROADCAST_NOT_FOUND",
      title: "Broadcast was not found"
    });
  }
  if (error instanceof AdminBroadcastVersionConflictError) {
    return new ConflictException({
      code: "ADMIN_BROADCAST_VERSION_CONFLICT",
      title: "Broadcast was changed by another administrator"
    });
  }
  if (error instanceof AdminBroadcastDraftNotFoundError) {
    return new ConflictException({
      code: "ADMIN_BROADCAST_DRAFT_NOT_FOUND",
      title: "Broadcast has no draft to publish"
    });
  }
  if (error instanceof AdminBroadcastAudienceSnapshotUnavailableError) {
    return new UnprocessableEntityException({
      code: "ADMIN_BROADCAST_AUDIENCE_SNAPSHOT_UNAVAILABLE",
      title: "Broadcast requires a ready audience snapshot"
    });
  }
  if (
    error instanceof AdminBroadcastNotEditableError
    || error instanceof AdminBroadcastDraftExistsError
    || error instanceof AdminBroadcastPublishedVersionUnavailableError
  ) {
    return new ConflictException({
      code: error instanceof AdminBroadcastNotEditableError
        ? "ADMIN_BROADCAST_NOT_EDITABLE"
        : error instanceof AdminBroadcastDraftExistsError
          ? "ADMIN_BROADCAST_DRAFT_EXISTS"
          : "ADMIN_BROADCAST_PUBLISHED_VERSION_UNAVAILABLE",
      title: error.message
    });
  }
  return error;
}
