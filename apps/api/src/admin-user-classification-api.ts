import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  DynamicModule,
  Get,
  HttpCode,
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
  AdminSystemUserClassificationProtectedError,
  AdminUserClassificationCodeConflictError,
  AdminUserClassificationNotFoundError,
  AdminUserClassificationTransitionNotFoundError,
  AdminUserClassificationVersionConflictError,
  InvalidAdminUserClassificationMutationError,
  UserClassificationNotFoundError,
  UserStatusTransitionNotAllowedError
} from "@ticket-platform/application";
import type {
  AdminUserCategoryDefinition,
  AdminUserClassificationCatalog,
  AdminUserClassificationMutationResult,
  AdminUserStatusDefinition,
  CreateAdminUserCategoryRequest,
  CreateAdminUserStatusRequest,
  AssignAdminUserClassificationRequest,
  RemoveAdminUserClassificationRequest,
  UpdateAdminUserCategoryRequest,
  UpdateAdminUserStatusRequest
} from "@ticket-platform/contracts";
import { z } from "zod";
import {
  RequireAdminPermission,
  type AuthenticatedAdminRequest
} from "./admin-auth.js";

const ADMIN_USER_CLASSIFICATION = Symbol("ADMIN_USER_CLASSIFICATION");
const idSchema = z.string().uuid();
const codeSchema = z.string().trim().regex(/^[a-z][a-z0-9_]{1,63}$/);
const colorSchema = z.string().trim().regex(/^#[0-9A-F]{6}$/);
const descriptionSchema = z.string().trim().min(1).max(500).nullable();
const reasonSchema = z.string().trim().min(3).max(500);
const transitionSchema = z.array(codeSchema).min(1).max(64).nullable();
const assignSchema = z.object({
  code: codeSchema,
  reason: reasonSchema
}).strict();
const removeSchema = z.object({ reason: reasonSchema }).strict();

const createStatusSchema = z.object({
  code: codeSchema,
  displayName: z.string().trim().min(1).max(120),
  color: colorSchema,
  description: descriptionSchema,
  exclusivityGroup: codeSchema.nullable(),
  allowedTransitionCodes: transitionSchema,
  reason: reasonSchema
}).strict();

const updateStatusSchema = createStatusSchema.omit({ code: true }).extend({
  expectedLockVersion: z.number().int().min(1),
  isActive: z.boolean()
}).strict();

const createCategorySchema = z.object({
  code: codeSchema,
  displayName: z.string().trim().min(1).max(120),
  color: colorSchema,
  description: descriptionSchema,
  reason: reasonSchema
}).strict();

const updateCategorySchema = createCategorySchema.omit({ code: true }).extend({
  expectedLockVersion: z.number().int().min(1),
  isActive: z.boolean()
}).strict();

export interface AdminUserClassificationHandlers {
  readonly list: {
    execute(input: {
      readonly actor: NonNullable<AuthenticatedAdminRequest["adminActor"]>;
    }): Promise<AdminUserClassificationCatalog>;
  };
  readonly createStatus: {
    execute(input: {
      readonly actor: NonNullable<AuthenticatedAdminRequest["adminActor"]>;
      readonly request: CreateAdminUserStatusRequest;
      readonly metadata: ReturnType<typeof mutationMetadata>;
    }): Promise<AdminUserStatusDefinition>;
  };
  readonly updateStatus: {
    execute(input: {
      readonly actor: NonNullable<AuthenticatedAdminRequest["adminActor"]>;
      readonly statusId: string;
      readonly request: UpdateAdminUserStatusRequest;
      readonly metadata: ReturnType<typeof mutationMetadata>;
    }): Promise<AdminUserStatusDefinition>;
  };
  readonly createCategory: {
    execute(input: {
      readonly actor: NonNullable<AuthenticatedAdminRequest["adminActor"]>;
      readonly request: CreateAdminUserCategoryRequest;
      readonly metadata: ReturnType<typeof mutationMetadata>;
    }): Promise<AdminUserCategoryDefinition>;
  };
  readonly updateCategory: {
    execute(input: {
      readonly actor: NonNullable<AuthenticatedAdminRequest["adminActor"]>;
      readonly categoryId: string;
      readonly request: UpdateAdminUserCategoryRequest;
      readonly metadata: ReturnType<typeof mutationMetadata>;
    }): Promise<AdminUserCategoryDefinition>;
  };
  readonly assignStatus: AdminAssignmentHandler<AssignAdminUserClassificationRequest>;
  readonly assignCategory: AdminAssignmentHandler<AssignAdminUserClassificationRequest>;
  readonly removeStatus: AdminRemovalHandler;
  readonly removeCategory: AdminRemovalHandler;
}

interface AdminAssignmentHandler<TRequest> {
  execute(input: {
    readonly actor: NonNullable<AuthenticatedAdminRequest["adminActor"]>;
    readonly userId: string;
    readonly request: TRequest;
    readonly metadata: ReturnType<typeof mutationMetadata>;
  }): Promise<AdminUserClassificationMutationResult>;
}

interface AdminRemovalHandler {
  execute(input: {
    readonly actor: NonNullable<AuthenticatedAdminRequest["adminActor"]>;
    readonly userId: string;
    readonly code: string;
    readonly request: RemoveAdminUserClassificationRequest;
    readonly metadata: ReturnType<typeof mutationMetadata>;
  }): Promise<AdminUserClassificationMutationResult>;
}

@Controller("api/v1/classification")
export class AdminUserClassificationController {
  constructor(
    @Inject(ADMIN_USER_CLASSIFICATION)
    private readonly handlers: AdminUserClassificationHandlers
  ) {}

  @Get()
  @RequireAdminPermission("users.read")
  list(
    @Req() request: AuthenticatedAdminRequest
  ): Promise<AdminUserClassificationCatalog> {
    return this.handlers.list.execute({ actor: requireActor(request) });
  }

  @Post("statuses")
  @RequireAdminPermission("users.write")
  createStatus(
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<AdminUserStatusDefinition> {
    const parsed = createStatusSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidMutation();
    }
    return this.mapMutation(() => this.handlers.createStatus.execute({
      actor: requireActor(request),
      request: parsed.data,
      metadata: mutationMetadata(request)
    }));
  }

  @Patch("statuses/:id")
  @HttpCode(200)
  @RequireAdminPermission("users.write")
  updateStatus(
    @Param("id") statusId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<AdminUserStatusDefinition> {
    const parsedId = idSchema.safeParse(statusId);
    const parsed = updateStatusSchema.safeParse(body);
    if (!parsedId.success || !parsed.success) {
      throw invalidMutation();
    }
    return this.mapMutation(() => this.handlers.updateStatus.execute({
      actor: requireActor(request),
      statusId: parsedId.data,
      request: parsed.data,
      metadata: mutationMetadata(request)
    }));
  }

  @Post("categories")
  @RequireAdminPermission("users.write")
  createCategory(
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<AdminUserCategoryDefinition> {
    const parsed = createCategorySchema.safeParse(body);
    if (!parsed.success) {
      throw invalidMutation();
    }
    return this.mapMutation(() => this.handlers.createCategory.execute({
      actor: requireActor(request),
      request: parsed.data,
      metadata: mutationMetadata(request)
    }));
  }

  @Patch("categories/:id")
  @HttpCode(200)
  @RequireAdminPermission("users.write")
  updateCategory(
    @Param("id") categoryId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<AdminUserCategoryDefinition> {
    const parsedId = idSchema.safeParse(categoryId);
    const parsed = updateCategorySchema.safeParse(body);
    if (!parsedId.success || !parsed.success) {
      throw invalidMutation();
    }
    return this.mapMutation(() => this.handlers.updateCategory.execute({
      actor: requireActor(request),
      categoryId: parsedId.data,
      request: parsed.data,
      metadata: mutationMetadata(request)
    }));
  }

  private async mapMutation<TResult>(
    work: () => Promise<TResult>
  ): Promise<TResult> {
    try {
      return await work();
    } catch (error) {
      throw mapMutationError(error);
    }
  }
}

@Controller("api/v1/users/:userId/classification")
export class AdminUserClassificationAssignmentsController {
  constructor(
    @Inject(ADMIN_USER_CLASSIFICATION)
    private readonly handlers: AdminUserClassificationHandlers
  ) {}

  @Post("statuses")
  @RequireAdminPermission("users.write")
  assignStatus(
    @Param("userId") userId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<AdminUserClassificationMutationResult> {
    return this.assign(this.handlers.assignStatus, userId, body, request);
  }

  @Post("categories")
  @RequireAdminPermission("users.write")
  assignCategory(
    @Param("userId") userId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<AdminUserClassificationMutationResult> {
    return this.assign(this.handlers.assignCategory, userId, body, request);
  }

  @Post("statuses/:code/remove")
  @RequireAdminPermission("users.write")
  removeStatus(
    @Param("userId") userId: string,
    @Param("code") code: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<AdminUserClassificationMutationResult> {
    return this.remove(this.handlers.removeStatus, userId, code, body, request);
  }

  @Post("categories/:code/remove")
  @RequireAdminPermission("users.write")
  removeCategory(
    @Param("userId") userId: string,
    @Param("code") code: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedAdminRequest
  ): Promise<AdminUserClassificationMutationResult> {
    return this.remove(
      this.handlers.removeCategory,
      userId,
      code,
      body,
      request
    );
  }

  private async assign(
    handler: AdminAssignmentHandler<AssignAdminUserClassificationRequest>,
    userId: string,
    body: unknown,
    request: AuthenticatedAdminRequest
  ): Promise<AdminUserClassificationMutationResult> {
    const parsedId = idSchema.safeParse(userId);
    const parsed = assignSchema.safeParse(body);
    if (!parsedId.success || !parsed.success) {
      throw invalidMutation();
    }
    try {
      return await handler.execute({
        actor: requireActor(request),
        userId: parsedId.data,
        request: parsed.data,
        metadata: mutationMetadata(request)
      });
    } catch (error) {
      throw mapMutationError(error);
    }
  }

  private async remove(
    handler: AdminRemovalHandler,
    userId: string,
    code: string,
    body: unknown,
    request: AuthenticatedAdminRequest
  ): Promise<AdminUserClassificationMutationResult> {
    const parsedId = idSchema.safeParse(userId);
    const parsedCode = codeSchema.safeParse(code);
    const parsed = removeSchema.safeParse(body);
    if (!parsedId.success || !parsedCode.success || !parsed.success) {
      throw invalidMutation();
    }
    try {
      return await handler.execute({
        actor: requireActor(request),
        userId: parsedId.data,
        code: parsedCode.data,
        request: parsed.data,
        metadata: mutationMetadata(request)
      });
    } catch (error) {
      throw mapMutationError(error);
    }
  }
}

@Module({})
export class AdminUserClassificationApiModule {
  static register(
    handlers: AdminUserClassificationHandlers
  ): DynamicModule {
    return {
      module: AdminUserClassificationApiModule,
      controllers: [
        AdminUserClassificationController,
        AdminUserClassificationAssignmentsController
      ],
      providers: [{ provide: ADMIN_USER_CLASSIFICATION, useValue: handlers }]
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

function invalidMutation(): BadRequestException {
  return new BadRequestException({
    code: "INVALID_ADMIN_USER_CLASSIFICATION_MUTATION",
    title: "User classification mutation is invalid"
  });
}

function mapMutationError(error: unknown): unknown {
  if (error instanceof InvalidAdminUserClassificationMutationError) {
    return invalidMutation();
  }
  if (error instanceof AdminUserClassificationCodeConflictError) {
    return new ConflictException({
      code: "ADMIN_USER_CLASSIFICATION_CODE_CONFLICT",
      title: "Classification code is already in use"
    });
  }
  if (error instanceof AdminUserClassificationNotFoundError) {
    return new NotFoundException({
      code: "ADMIN_USER_CLASSIFICATION_NOT_FOUND",
      title: "Classification definition was not found"
    });
  }
  if (error instanceof AdminUserClassificationVersionConflictError) {
    return new ConflictException({
      code: "ADMIN_USER_CLASSIFICATION_VERSION_CONFLICT",
      title: "Classification definition was changed by another administrator"
    });
  }
  if (error instanceof AdminUserClassificationTransitionNotFoundError) {
    return new UnprocessableEntityException({
      code: "ADMIN_USER_STATUS_TRANSITION_NOT_FOUND",
      title: "One or more status transition targets are unavailable"
    });
  }
  if (error instanceof AdminSystemUserClassificationProtectedError) {
    return new ConflictException({
      code: "ADMIN_SYSTEM_USER_CLASSIFICATION_PROTECTED",
      title: "System classification definition cannot be deactivated"
    });
  }
  if (error instanceof UserClassificationNotFoundError) {
    return new NotFoundException({
      code: "USER_CLASSIFICATION_TARGET_NOT_FOUND",
      title: "User or classification target was not found"
    });
  }
  if (error instanceof UserStatusTransitionNotAllowedError) {
    return new UnprocessableEntityException({
      code: "USER_STATUS_TRANSITION_NOT_ALLOWED",
      title: "User status transition is not allowed"
    });
  }
  return error;
}
