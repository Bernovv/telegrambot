import type { DomainEvent } from "@ticket-platform/domain";
import type {
  IdGenerator,
  OutboxWriter,
  UnitOfWork
} from "./identity.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

export type UserClassificationSource =
  | "manual"
  | "scenario"
  | "survey"
  | "import"
  | "payment";

export interface UserStatusDefinition {
  readonly id: string;
  readonly code: string;
  readonly displayName: string;
  readonly color: string;
  readonly exclusivityGroup: string | null;
  readonly allowedTransitionCodes: readonly string[] | null;
  readonly isActive: boolean;
}

export interface UserCategoryDefinition {
  readonly id: string;
  readonly code: string;
  readonly displayName: string;
  readonly color: string;
  readonly isActive: boolean;
}

export interface ActiveUserStatusAssignment {
  readonly id: string;
  readonly statusId: string;
  readonly code: string;
  readonly exclusivityGroup: string | null;
  readonly allowedTransitionCodes: readonly string[] | null;
}

export interface ActiveUserCategoryAssignment {
  readonly id: string;
  readonly categoryId: string;
  readonly code: string;
}

export interface UserClassificationSnapshot {
  readonly statusCodes: readonly string[];
  readonly categoryCodes: readonly string[];
}

export interface UserClassificationRepository {
  lockUser(userId: string): Promise<boolean>;
  findStatusByCode(code: string): Promise<UserStatusDefinition | null>;
  findCategoryByCode(code: string): Promise<UserCategoryDefinition | null>;
  findActiveStatus(
    userId: string,
    statusId: string
  ): Promise<ActiveUserStatusAssignment | null>;
  findActiveStatusInGroup(
    userId: string,
    exclusivityGroup: string
  ): Promise<ActiveUserStatusAssignment | null>;
  closeStatusAssignment(input: {
    readonly assignmentId: string;
    readonly removedAt: Date;
    readonly source: UserClassificationSource;
    readonly sourceReference: string;
    readonly reason: string;
  }): Promise<void>;
  createStatusAssignment(input: {
    readonly assignmentId: string;
    readonly userId: string;
    readonly status: UserStatusDefinition;
    readonly source: UserClassificationSource;
    readonly sourceReference: string;
    readonly actorAdminId: string | null;
    readonly reason: string;
    readonly assignedAt: Date;
  }): Promise<void>;
  findActiveCategory(
    userId: string,
    categoryId: string
  ): Promise<ActiveUserCategoryAssignment | null>;
  createCategoryAssignment(input: {
    readonly assignmentId: string;
    readonly userId: string;
    readonly category: UserCategoryDefinition;
    readonly source: UserClassificationSource;
    readonly sourceReference: string;
    readonly actorAdminId: string | null;
    readonly reason: string;
    readonly assignedAt: Date;
  }): Promise<void>;
  closeCategoryAssignment(input: {
    readonly assignmentId: string;
    readonly removedAt: Date;
    readonly source: UserClassificationSource;
    readonly sourceReference: string;
    readonly reason: string;
  }): Promise<void>;
  getActiveSnapshot(userId: string): Promise<UserClassificationSnapshot>;
}

export interface UserClassificationAuditContext {
  readonly auditId: string;
  readonly actorRole: string;
  readonly requestId: string;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

export interface UserClassificationAuditWriter {
  append(input: {
    readonly audit: UserClassificationAuditContext;
    readonly actorAdminId: string;
    readonly action: string;
    readonly userId: string;
    readonly reason: string;
    readonly before: UserClassificationSnapshot;
    readonly after: UserClassificationSnapshot;
    readonly occurredAt: Date;
  }): Promise<void>;
}

interface ClassificationCommand {
  readonly userId: string;
  readonly source: UserClassificationSource;
  readonly sourceReference: string;
  readonly actorAdminId: string | null;
  readonly reason: string;
  readonly assignedAt: Date;
  readonly audit?: UserClassificationAuditContext;
}

export interface SetUserStatusCommand extends ClassificationCommand {
  readonly statusCode: string;
}

export interface AddUserCategoryCommand extends ClassificationCommand {
  readonly categoryCode: string;
}

export interface RemoveUserStatusCommand extends ClassificationCommand {
  readonly statusCode: string;
}

export interface RemoveUserCategoryCommand extends ClassificationCommand {
  readonly categoryCode: string;
}

export interface UserClassificationResult extends UserClassificationSnapshot {
  readonly changed: boolean;
  readonly assignmentId: string;
}

export class UserClassificationNotFoundError extends Error {
  constructor(readonly kind: "user" | "status" | "category") {
    super(`User classification ${kind} was not found`);
    this.name = "UserClassificationNotFoundError";
  }
}

export class UserStatusTransitionNotAllowedError extends Error {
  constructor(readonly fromCode: string, readonly toCode: string) {
    super(`User status transition is not allowed: ${fromCode} -> ${toCode}`);
    this.name = "UserStatusTransitionNotAllowedError";
  }
}

export class SetUserStatusService {
  constructor(
    private readonly repository: UserClassificationRepository,
    private readonly outboxWriter: OutboxWriter,
    private readonly unitOfWork: UnitOfWork,
    private readonly idGenerator: IdGenerator,
    private readonly auditWriter?: UserClassificationAuditWriter
  ) {}

  execute(command: SetUserStatusCommand): Promise<UserClassificationResult> {
    validateClassificationCommand(command);
    requireCode(command.statusCode);

    return this.unitOfWork.transact(async () => {
      if (!await this.repository.lockUser(command.userId)) {
        throw new UserClassificationNotFoundError("user");
      }
      const status = await this.repository.findStatusByCode(command.statusCode);
      if (!status?.isActive) {
        throw new UserClassificationNotFoundError("status");
      }
      const existing = await this.repository.findActiveStatus(
        command.userId,
        status.id
      );
      if (existing) {
        return {
          ...await this.repository.getActiveSnapshot(command.userId),
          changed: false,
          assignmentId: existing.id
        };
      }
      const before = await this.auditSnapshot(command);

      const replaced = status.exclusivityGroup
        ? await this.repository.findActiveStatusInGroup(
            command.userId,
            status.exclusivityGroup
          )
        : null;
      if (
        replaced?.allowedTransitionCodes
        && !replaced.allowedTransitionCodes.includes(status.code)
      ) {
        throw new UserStatusTransitionNotAllowedError(
          replaced.code,
          status.code
        );
      }
      if (replaced) {
        await this.repository.closeStatusAssignment({
          assignmentId: replaced.id,
          removedAt: command.assignedAt,
          source: command.source,
          sourceReference: command.sourceReference,
          reason: command.reason
        });
      }

      const assignmentId = this.idGenerator.newId();
      await this.repository.createStatusAssignment({
        assignmentId,
        userId: command.userId,
        status,
        source: command.source,
        sourceReference: command.sourceReference,
        actorAdminId: command.actorAdminId,
        reason: command.reason.trim(),
        assignedAt: command.assignedAt
      });
      await this.outboxWriter.append(classificationEvent(
        this.idGenerator.newId(),
        "UserStatusAssigned",
        command,
        assignmentId,
        status.code,
        replaced?.code ?? null
      ));
      const after = await this.repository.getActiveSnapshot(command.userId);
      await this.appendAudit(command, "user_status.assigned", before, after);
      return {
        ...after,
        changed: true,
        assignmentId
      };
    });
  }

  private auditSnapshot(
    command: ClassificationCommand
  ): Promise<UserClassificationSnapshot> {
    return command.audit
      ? this.repository.getActiveSnapshot(command.userId)
      : Promise.resolve({ statusCodes: [], categoryCodes: [] });
  }

  private appendAudit(
    command: ClassificationCommand,
    action: string,
    before: UserClassificationSnapshot,
    after: UserClassificationSnapshot
  ): Promise<void> {
    return appendClassificationAudit(
      this.auditWriter,
      command,
      action,
      before,
      after
    );
  }
}

export class AddUserCategoryService {
  constructor(
    private readonly repository: UserClassificationRepository,
    private readonly outboxWriter: OutboxWriter,
    private readonly unitOfWork: UnitOfWork,
    private readonly idGenerator: IdGenerator,
    private readonly auditWriter?: UserClassificationAuditWriter
  ) {}

  execute(command: AddUserCategoryCommand): Promise<UserClassificationResult> {
    validateClassificationCommand(command);
    requireCode(command.categoryCode);

    return this.unitOfWork.transact(async () => {
      if (!await this.repository.lockUser(command.userId)) {
        throw new UserClassificationNotFoundError("user");
      }
      const category = await this.repository.findCategoryByCode(
        command.categoryCode
      );
      if (!category?.isActive) {
        throw new UserClassificationNotFoundError("category");
      }
      const existing = await this.repository.findActiveCategory(
        command.userId,
        category.id
      );
      if (existing) {
        return {
          ...await this.repository.getActiveSnapshot(command.userId),
          changed: false,
          assignmentId: existing.id
        };
      }
      const before = command.audit
        ? await this.repository.getActiveSnapshot(command.userId)
        : { statusCodes: [], categoryCodes: [] };

      const assignmentId = this.idGenerator.newId();
      await this.repository.createCategoryAssignment({
        assignmentId,
        userId: command.userId,
        category,
        source: command.source,
        sourceReference: command.sourceReference,
        actorAdminId: command.actorAdminId,
        reason: command.reason.trim(),
        assignedAt: command.assignedAt
      });
      await this.outboxWriter.append(classificationEvent(
        this.idGenerator.newId(),
        "UserCategoryAssigned",
        command,
        assignmentId,
        category.code,
        null
      ));
      const after = await this.repository.getActiveSnapshot(command.userId);
      await appendClassificationAudit(
        this.auditWriter,
        command,
        "user_category.assigned",
        before,
        after
      );
      return {
        ...after,
        changed: true,
        assignmentId
      };
    });
  }
}

export class RemoveUserStatusService {
  constructor(
    private readonly repository: UserClassificationRepository,
    private readonly outboxWriter: OutboxWriter,
    private readonly unitOfWork: UnitOfWork,
    private readonly idGenerator: IdGenerator,
    private readonly auditWriter?: UserClassificationAuditWriter
  ) {}

  execute(command: RemoveUserStatusCommand): Promise<UserClassificationResult> {
    validateClassificationCommand(command);
    requireCode(command.statusCode);
    return this.unitOfWork.transact(async () => {
      if (!await this.repository.lockUser(command.userId)) {
        throw new UserClassificationNotFoundError("user");
      }
      const status = await this.repository.findStatusByCode(command.statusCode);
      if (!status) {
        throw new UserClassificationNotFoundError("status");
      }
      const active = await this.repository.findActiveStatus(
        command.userId,
        status.id
      );
      if (!active) {
        return {
          ...await this.repository.getActiveSnapshot(command.userId),
          changed: false,
          assignmentId: status.id
        };
      }
      const before = command.audit
        ? await this.repository.getActiveSnapshot(command.userId)
        : { statusCodes: [], categoryCodes: [] };
      await this.repository.closeStatusAssignment({
        assignmentId: active.id,
        removedAt: command.assignedAt,
        source: command.source,
        sourceReference: command.sourceReference,
        reason: command.reason
      });
      await this.outboxWriter.append(classificationEvent(
        this.idGenerator.newId(),
        "UserStatusRemoved",
        command,
        active.id,
        status.code,
        null
      ));
      const after = await this.repository.getActiveSnapshot(command.userId);
      await appendClassificationAudit(
        this.auditWriter,
        command,
        "user_status.removed",
        before,
        after
      );
      return { ...after, changed: true, assignmentId: active.id };
    });
  }
}

export class RemoveUserCategoryService {
  constructor(
    private readonly repository: UserClassificationRepository,
    private readonly outboxWriter: OutboxWriter,
    private readonly unitOfWork: UnitOfWork,
    private readonly idGenerator: IdGenerator,
    private readonly auditWriter?: UserClassificationAuditWriter
  ) {}

  execute(command: RemoveUserCategoryCommand): Promise<UserClassificationResult> {
    validateClassificationCommand(command);
    requireCode(command.categoryCode);
    return this.unitOfWork.transact(async () => {
      if (!await this.repository.lockUser(command.userId)) {
        throw new UserClassificationNotFoundError("user");
      }
      const category = await this.repository.findCategoryByCode(
        command.categoryCode
      );
      if (!category) {
        throw new UserClassificationNotFoundError("category");
      }
      const active = await this.repository.findActiveCategory(
        command.userId,
        category.id
      );
      if (!active) {
        return {
          ...await this.repository.getActiveSnapshot(command.userId),
          changed: false,
          assignmentId: category.id
        };
      }
      const before = command.audit
        ? await this.repository.getActiveSnapshot(command.userId)
        : { statusCodes: [], categoryCodes: [] };
      await this.repository.closeCategoryAssignment({
        assignmentId: active.id,
        removedAt: command.assignedAt,
        source: command.source,
        sourceReference: command.sourceReference,
        reason: command.reason
      });
      await this.outboxWriter.append(classificationEvent(
        this.idGenerator.newId(),
        "UserCategoryRemoved",
        command,
        active.id,
        category.code,
        null
      ));
      const after = await this.repository.getActiveSnapshot(command.userId);
      await appendClassificationAudit(
        this.auditWriter,
        command,
        "user_category.removed",
        before,
        after
      );
      return { ...after, changed: true, assignmentId: active.id };
    });
  }
}

function validateClassificationCommand(command: ClassificationCommand): void {
  if (!UUID_PATTERN.test(command.userId)) {
    throw new Error("User classification identity is invalid");
  }
  if (
    command.actorAdminId !== null
    && !UUID_PATTERN.test(command.actorAdminId)
  ) {
    throw new Error("User classification actor is invalid");
  }
  if (
    !["manual", "scenario", "survey", "import", "payment"]
      .includes(command.source)
  ) {
    throw new Error("User classification source is invalid");
  }
  if (
    command.sourceReference.length < 8
    || command.sourceReference.length > 250
    || !/^[A-Za-z0-9._:-]+$/.test(command.sourceReference)
  ) {
    throw new Error("User classification source reference is invalid");
  }
  const reason = command.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new Error("User classification reason is invalid");
  }
  if (Number.isNaN(command.assignedAt.getTime())) {
    throw new Error("User classification time is invalid");
  }
  if (
    command.source === "manual"
    && (
      command.actorAdminId === null
      || !command.audit
      || !UUID_PATTERN.test(command.audit.auditId)
    )
  ) {
    throw new Error("Manual user classification audit is required");
  }
}

function requireCode(code: string): void {
  if (!CODE_PATTERN.test(code)) {
    throw new Error("User classification code is invalid");
  }
}

function classificationEvent(
  eventId: string,
  eventType:
    | "UserStatusAssigned"
    | "UserCategoryAssigned"
    | "UserStatusRemoved"
    | "UserCategoryRemoved",
  command: ClassificationCommand,
  assignmentId: string,
  code: string,
  replacedCode: string | null
): DomainEvent<{
  assignmentId: string;
  userId: string;
  code: string;
  source: UserClassificationSource;
  sourceReference: string;
  replacedCode: string | null;
}> {
  return {
    eventId,
    aggregateType: "user",
    aggregateId: command.userId,
    eventType,
    schemaVersion: 1,
    payload: {
      assignmentId,
      userId: command.userId,
      code,
      source: command.source,
      sourceReference: command.sourceReference,
      replacedCode
    },
    occurredAt: command.assignedAt
  };
}

function appendClassificationAudit(
  writer: UserClassificationAuditWriter | undefined,
  command: ClassificationCommand,
  action: string,
  before: UserClassificationSnapshot,
  after: UserClassificationSnapshot
): Promise<void> {
  if (!command.audit) {
    return Promise.resolve();
  }
  if (!writer || !command.actorAdminId) {
    throw new Error("Manual user classification audit writer is unavailable");
  }
  return writer.append({
    audit: command.audit,
    actorAdminId: command.actorAdminId,
    action,
    userId: command.userId,
    reason: command.reason.trim(),
    before,
    after,
    occurredAt: command.assignedAt
  });
}
