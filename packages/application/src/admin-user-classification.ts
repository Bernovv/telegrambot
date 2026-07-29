import type {
  AdminRequestActor,
  AdminUserCategoryDefinition,
  AdminUserClassificationCatalog,
  AdminUserClassificationMutationResult,
  AdminUserStatusDefinition,
  AssignAdminUserClassificationRequest,
  CreateAdminUserCategoryRequest,
  CreateAdminUserStatusRequest,
  RemoveAdminUserClassificationRequest,
  UpdateAdminUserCategoryRequest,
  UpdateAdminUserStatusRequest
} from "@ticket-platform/contracts";
import type {
  AddUserCategoryCommand,
  RemoveUserCategoryCommand,
  RemoveUserStatusCommand,
  SetUserStatusCommand,
  UserClassificationResult
} from "./user-classification.js";
import type {
  AdminEventAuditContext,
  AdminEventMutationMetadata
} from "./admin-event-management.js";
import { buildAdminEventAuditContext } from "./admin-event-management.js";
import type { IdGenerator } from "./identity.js";

const CODE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
const COLOR_PATTERN = /^#[0-9A-F]{6}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AdminUserClassificationRepository {
  listCatalog(): Promise<AdminUserClassificationCatalog>;
  createStatus(input: {
    readonly status: AdminUserStatusDefinition;
    readonly audit: AdminEventAuditContext;
  }): Promise<"created" | "code_conflict" | "transition_not_found">;
  updateStatus(input: {
    readonly statusId: string;
    readonly expectedLockVersion: number;
    readonly patch: Omit<
      AdminUserStatusDefinition,
      "id" | "code" | "isSystem" | "lockVersion"
    >;
    readonly audit: AdminEventAuditContext;
  }): Promise<
    | { readonly status: "updated"; readonly value: AdminUserStatusDefinition }
    | {
        readonly status:
          | "not_found"
          | "version_conflict"
          | "transition_not_found"
          | "system_deactivation";
      }
  >;
  createCategory(input: {
    readonly category: AdminUserCategoryDefinition;
    readonly audit: AdminEventAuditContext;
  }): Promise<"created" | "code_conflict">;
  updateCategory(input: {
    readonly categoryId: string;
    readonly expectedLockVersion: number;
    readonly patch: Omit<
      AdminUserCategoryDefinition,
      "id" | "code" | "isSystem" | "lockVersion"
    >;
    readonly audit: AdminEventAuditContext;
  }): Promise<
    | { readonly status: "updated"; readonly value: AdminUserCategoryDefinition }
    | {
        readonly status:
          | "not_found"
          | "version_conflict"
          | "system_deactivation";
      }
  >;
}

export class InvalidAdminUserClassificationMutationError extends Error {
  constructor() {
    super("Administrator user classification mutation is invalid");
    this.name = "InvalidAdminUserClassificationMutationError";
  }
}

export class AdminUserClassificationCodeConflictError extends Error {
  constructor() {
    super("Administrator user classification code already exists");
    this.name = "AdminUserClassificationCodeConflictError";
  }
}

export class AdminUserClassificationNotFoundError extends Error {
  constructor() {
    super("Administrator user classification definition was not found");
    this.name = "AdminUserClassificationNotFoundError";
  }
}

export class AdminUserClassificationVersionConflictError extends Error {
  constructor() {
    super("Administrator user classification version is stale");
    this.name = "AdminUserClassificationVersionConflictError";
  }
}

export class AdminUserClassificationTransitionNotFoundError extends Error {
  constructor() {
    super("Administrator user status transition target was not found");
    this.name = "AdminUserClassificationTransitionNotFoundError";
  }
}

export class AdminSystemUserClassificationProtectedError extends Error {
  constructor() {
    super("System user classification definition is protected");
    this.name = "AdminSystemUserClassificationProtectedError";
  }
}

export class ListAdminUserClassificationService {
  constructor(private readonly repository: AdminUserClassificationRepository) {}

  execute(input: {
    readonly actor: AdminRequestActor;
  }): Promise<AdminUserClassificationCatalog> {
    requirePermission(input.actor, "users.read");
    return this.repository.listCatalog();
  }
}

export class CreateAdminUserStatusService {
  constructor(
    private readonly repository: AdminUserClassificationRepository,
    private readonly idGenerator: IdGenerator
  ) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly request: CreateAdminUserStatusRequest;
    readonly metadata: AdminEventMutationMetadata;
  }): Promise<AdminUserStatusDefinition> {
    requirePermission(input.actor, "users.write");
    const id = requireUuid(this.idGenerator.newId());
    const status = parseStatus(id, input.request);
    const audit = buildAudit(
      input.actor,
      input.request.reason,
      input.metadata,
      this.idGenerator
    );
    const result = await this.repository.createStatus({ status, audit });
    if (result === "code_conflict") {
      throw new AdminUserClassificationCodeConflictError();
    }
    if (result === "transition_not_found") {
      throw new AdminUserClassificationTransitionNotFoundError();
    }
    return status;
  }
}

export class UpdateAdminUserStatusService {
  constructor(
    private readonly repository: AdminUserClassificationRepository,
    private readonly idGenerator: IdGenerator
  ) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly statusId: string;
    readonly request: UpdateAdminUserStatusRequest;
    readonly metadata: AdminEventMutationMetadata;
  }): Promise<AdminUserStatusDefinition> {
    requirePermission(input.actor, "users.write");
    requireUuid(input.statusId);
    requireLockVersion(input.request.expectedLockVersion);
    const parsed = parseStatusPatch(input.request);
    const result = await this.repository.updateStatus({
      statusId: input.statusId,
      expectedLockVersion: input.request.expectedLockVersion,
      patch: parsed,
      audit: buildAudit(
        input.actor,
        input.request.reason,
        input.metadata,
        this.idGenerator
      )
    });
    return unwrapMutation(result);
  }
}

export class CreateAdminUserCategoryService {
  constructor(
    private readonly repository: AdminUserClassificationRepository,
    private readonly idGenerator: IdGenerator
  ) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly request: CreateAdminUserCategoryRequest;
    readonly metadata: AdminEventMutationMetadata;
  }): Promise<AdminUserCategoryDefinition> {
    requirePermission(input.actor, "users.write");
    const id = requireUuid(this.idGenerator.newId());
    const category = parseCategory(id, input.request);
    const result = await this.repository.createCategory({
      category,
      audit: buildAudit(
        input.actor,
        input.request.reason,
        input.metadata,
        this.idGenerator
      )
    });
    if (result === "code_conflict") {
      throw new AdminUserClassificationCodeConflictError();
    }
    return category;
  }
}

export class UpdateAdminUserCategoryService {
  constructor(
    private readonly repository: AdminUserClassificationRepository,
    private readonly idGenerator: IdGenerator
  ) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly categoryId: string;
    readonly request: UpdateAdminUserCategoryRequest;
    readonly metadata: AdminEventMutationMetadata;
  }): Promise<AdminUserCategoryDefinition> {
    requirePermission(input.actor, "users.write");
    requireUuid(input.categoryId);
    requireLockVersion(input.request.expectedLockVersion);
    const result = await this.repository.updateCategory({
      categoryId: input.categoryId,
      expectedLockVersion: input.request.expectedLockVersion,
      patch: parseCategoryPatch(input.request),
      audit: buildAudit(
        input.actor,
        input.request.reason,
        input.metadata,
        this.idGenerator
      )
    });
    return unwrapMutation(result);
  }
}

interface ClassificationCommandService<TCommand> {
  execute(command: TCommand): Promise<UserClassificationResult>;
}

export class AssignAdminUserStatusService {
  constructor(
    private readonly service: ClassificationCommandService<SetUserStatusCommand>,
    private readonly idGenerator: IdGenerator
  ) {}

  execute(input: {
    readonly actor: AdminRequestActor;
    readonly userId: string;
    readonly request: AssignAdminUserClassificationRequest;
    readonly metadata: AdminEventMutationMetadata;
  }): Promise<AdminUserClassificationMutationResult> {
    return executeManualClassification(
      this.service,
      input,
      this.idGenerator,
      { statusCode: requireCode(input.request.code) }
    );
  }
}

export class AssignAdminUserCategoryService {
  constructor(
    private readonly service: ClassificationCommandService<AddUserCategoryCommand>,
    private readonly idGenerator: IdGenerator
  ) {}

  execute(input: {
    readonly actor: AdminRequestActor;
    readonly userId: string;
    readonly request: AssignAdminUserClassificationRequest;
    readonly metadata: AdminEventMutationMetadata;
  }): Promise<AdminUserClassificationMutationResult> {
    return executeManualClassification(
      this.service,
      input,
      this.idGenerator,
      { categoryCode: requireCode(input.request.code) }
    );
  }
}

export class RemoveAdminUserStatusService {
  constructor(
    private readonly service: ClassificationCommandService<RemoveUserStatusCommand>,
    private readonly idGenerator: IdGenerator
  ) {}

  execute(input: {
    readonly actor: AdminRequestActor;
    readonly userId: string;
    readonly code: string;
    readonly request: RemoveAdminUserClassificationRequest;
    readonly metadata: AdminEventMutationMetadata;
  }): Promise<AdminUserClassificationMutationResult> {
    return executeManualClassification(
      this.service,
      input,
      this.idGenerator,
      { statusCode: requireCode(input.code) }
    );
  }
}

export class RemoveAdminUserCategoryService {
  constructor(
    private readonly service: ClassificationCommandService<RemoveUserCategoryCommand>,
    private readonly idGenerator: IdGenerator
  ) {}

  execute(input: {
    readonly actor: AdminRequestActor;
    readonly userId: string;
    readonly code: string;
    readonly request: RemoveAdminUserClassificationRequest;
    readonly metadata: AdminEventMutationMetadata;
  }): Promise<AdminUserClassificationMutationResult> {
    return executeManualClassification(
      this.service,
      input,
      this.idGenerator,
      { categoryCode: requireCode(input.code) }
    );
  }
}

async function executeManualClassification<
  TCommand extends SetUserStatusCommand
    | AddUserCategoryCommand
    | RemoveUserStatusCommand
    | RemoveUserCategoryCommand
>(
  service: ClassificationCommandService<TCommand>,
  input: {
    readonly actor: AdminRequestActor;
    readonly userId: string;
    readonly request: { readonly reason: string };
    readonly metadata: AdminEventMutationMetadata;
  },
  idGenerator: IdGenerator,
  classification: Pick<TCommand, "statusCode" & keyof TCommand>
    | Pick<TCommand, "categoryCode" & keyof TCommand>
): Promise<AdminUserClassificationMutationResult> {
  requirePermission(input.actor, "users.write");
  requireUuid(input.userId);
  const auditId = requireUuid(idGenerator.newId());
  const result = await service.execute({
    userId: input.userId,
    source: "manual",
    sourceReference: `manual:${auditId}`,
    actorAdminId: input.actor.adminId,
    reason: required(input.request.reason, 500),
    assignedAt: input.metadata.occurredAt,
    audit: {
      auditId,
      actorRole: input.actor.roleCodes.join(",").slice(0, 200),
      requestId: input.metadata.requestId,
      ipAddress: input.metadata.ipAddress,
      userAgent: input.metadata.userAgent
    },
    ...classification
  } as TCommand);
  return {
    changed: result.changed,
    statusCodes: result.statusCodes,
    categoryCodes: result.categoryCodes
  };
}

function parseStatus(
  id: string,
  input: CreateAdminUserStatusRequest
): AdminUserStatusDefinition {
  const code = requireCode(input.code);
  const exclusivityGroup = optionalCode(input.exclusivityGroup);
  return {
    id,
    code,
    displayName: required(input.displayName, 120),
    color: requireColor(input.color),
    description: optional(input.description, 500),
    isSystem: false,
    exclusivityGroup,
    allowedTransitionCodes: transitionCodes(
      input.allowedTransitionCodes,
      code,
      exclusivityGroup
    ),
    isActive: true,
    lockVersion: 1
  };
}

function parseStatusPatch(
  input: UpdateAdminUserStatusRequest
): Omit<
  AdminUserStatusDefinition,
  "id" | "code" | "isSystem" | "lockVersion"
> {
  const exclusivityGroup = optionalCode(input.exclusivityGroup);
  return {
    displayName: required(input.displayName, 120),
    color: requireColor(input.color),
    description: optional(input.description, 500),
    exclusivityGroup,
    allowedTransitionCodes: transitionCodes(
      input.allowedTransitionCodes,
      null,
      exclusivityGroup
    ),
    isActive: input.isActive
  };
}

function parseCategory(
  id: string,
  input: CreateAdminUserCategoryRequest
): AdminUserCategoryDefinition {
  return {
    id,
    code: requireCode(input.code),
    displayName: required(input.displayName, 120),
    color: requireColor(input.color),
    description: optional(input.description, 500),
    isSystem: false,
    isActive: true,
    lockVersion: 1
  };
}

function parseCategoryPatch(
  input: UpdateAdminUserCategoryRequest
): Omit<
  AdminUserCategoryDefinition,
  "id" | "code" | "isSystem" | "lockVersion"
> {
  return {
    displayName: required(input.displayName, 120),
    color: requireColor(input.color),
    description: optional(input.description, 500),
    isActive: input.isActive
  };
}

function transitionCodes(
  value: readonly string[] | null,
  ownCode: string | null,
  exclusivityGroup: string | null
): readonly string[] | null {
  if (value === null) {
    return null;
  }
  if (
    !exclusivityGroup
    || value.length < 1
    || value.length > 64
  ) {
    throw new InvalidAdminUserClassificationMutationError();
  }
  const normalized = [...new Set(value.map(requireCode))].sort();
  if (normalized.length !== value.length || (ownCode && normalized.includes(ownCode))) {
    throw new InvalidAdminUserClassificationMutationError();
  }
  return normalized;
}

function buildAudit(
  actor: AdminRequestActor,
  reason: string,
  metadata: AdminEventMutationMetadata,
  idGenerator: IdGenerator
): AdminEventAuditContext {
  try {
    return buildAdminEventAuditContext(actor, reason, metadata, idGenerator);
  } catch {
    throw new InvalidAdminUserClassificationMutationError();
  }
}

function requirePermission(
  actor: AdminRequestActor,
  permission: "users.read" | "users.write"
): void {
  if (actor.permission !== permission || !UUID_PATTERN.test(actor.adminId)) {
    throw new InvalidAdminUserClassificationMutationError();
  }
}

function requireUuid(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new InvalidAdminUserClassificationMutationError();
  }
  return value;
}

function requireCode(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!CODE_PATTERN.test(normalized)) {
    throw new InvalidAdminUserClassificationMutationError();
  }
  return normalized;
}

function optionalCode(value: string | null): string | null {
  return value === null ? null : requireCode(value);
}

function requireColor(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!COLOR_PATTERN.test(normalized)) {
    throw new InvalidAdminUserClassificationMutationError();
  }
  return normalized;
}

function required(value: string, maximum: number): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > maximum) {
    throw new InvalidAdminUserClassificationMutationError();
  }
  return normalized;
}

function optional(value: string | null, maximum: number): string | null {
  return value === null ? null : required(value, maximum);
}

function requireLockVersion(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new InvalidAdminUserClassificationMutationError();
  }
}

function unwrapMutation<TValue>(
  result:
    | { readonly status: "updated"; readonly value: TValue }
    | {
        readonly status:
          | "not_found"
          | "version_conflict"
          | "transition_not_found"
          | "system_deactivation";
      }
): TValue {
  switch (result.status) {
    case "updated":
      return result.value;
    case "not_found":
      throw new AdminUserClassificationNotFoundError();
    case "version_conflict":
      throw new AdminUserClassificationVersionConflictError();
    case "transition_not_found":
      throw new AdminUserClassificationTransitionNotFoundError();
    case "system_deactivation":
      throw new AdminSystemUserClassificationProtectedError();
  }
}
