import {
  ADMIN_EVENT_CONTENT_BLOCK_TYPES,
  type AdminEventContentBlockInput,
  type AdminEventContentBlockType,
  type AdminEventContentMutationResult,
  type AdminRequestActor
} from "@ticket-platform/contracts";
import {
  AdminEventNotDraftError,
  AdminEventNotFoundError,
  AdminEventVersionConflictError,
  InvalidAdminEventMutationError,
  buildAdminEventAuditContext,
  requireAdminEventUuid,
  requireAdminEventsWrite,
  type AdminEventAuditContext,
  type AdminEventMutationMetadata
} from "./admin-event-management.js";
import type { IdGenerator } from "./identity.js";

export interface AdminEventContentBlockRecord {
  readonly blockType: AdminEventContentBlockType;
  readonly title: string | null;
  readonly contentSchemaVersion: 1;
  readonly content: Readonly<Record<string, unknown>>;
  readonly sortOrder: number;
  readonly isVisible: boolean;
}

type ContentFailure =
  | "event_not_found"
  | "not_draft"
  | "version_conflict"
  | "content_block_not_found"
  | "sort_order_conflict";

export interface AdminEventContentManagementRepository {
  createContentBlock(input: {
    readonly eventId: string;
    readonly contentBlockId: string;
    readonly expectedLockVersion: number;
    readonly contentBlock: AdminEventContentBlockRecord;
    readonly audit: AdminEventAuditContext;
  }): Promise<
    | { readonly status: "created"; readonly lockVersion: number }
    | { readonly status: ContentFailure }
  >;
  updateContentBlock(input: {
    readonly eventId: string;
    readonly contentBlockId: string;
    readonly expectedLockVersion: number;
    readonly contentBlock: AdminEventContentBlockRecord;
    readonly audit: AdminEventAuditContext;
  }): Promise<
    | { readonly status: "updated"; readonly lockVersion: number }
    | { readonly status: ContentFailure }
  >;
}

export class AdminEventContentBlockNotFoundError extends Error {
  constructor() {
    super("Administrator event content block was not found");
    this.name = "AdminEventContentBlockNotFoundError";
  }
}

export class AdminEventContentSortOrderConflictError extends Error {
  constructor() {
    super("Administrator event content sort order already exists");
    this.name = "AdminEventContentSortOrderConflictError";
  }
}

export class CreateAdminEventContentBlockService {
  constructor(
    private readonly repository: AdminEventContentManagementRepository,
    private readonly idGenerator: IdGenerator
  ) {}

  async execute(
    input: ContentBlockCommand
  ): Promise<AdminEventContentMutationResult> {
    validateCommand(input.actor, input.eventId, input.expectedLockVersion);
    const contentBlockId = this.idGenerator.newId();
    requireAdminEventUuid(contentBlockId);
    const audit = buildAdminEventAuditContext(
      input.actor,
      input.reason,
      input.metadata,
      this.idGenerator
    );
    const result = await this.repository.createContentBlock({
      eventId: input.eventId,
      contentBlockId,
      expectedLockVersion: input.expectedLockVersion,
      contentBlock: parseContentBlock(input.contentBlock),
      audit
    });
    return mutationResult(
      result,
      input.eventId,
      contentBlockId,
      audit
    );
  }
}

export class UpdateAdminEventContentBlockService {
  constructor(
    private readonly repository: AdminEventContentManagementRepository,
    private readonly idGenerator: IdGenerator
  ) {}

  async execute(
    input: ContentBlockCommand & { readonly contentBlockId: string }
  ): Promise<AdminEventContentMutationResult> {
    validateCommand(input.actor, input.eventId, input.expectedLockVersion);
    requireAdminEventUuid(input.contentBlockId);
    const audit = buildAdminEventAuditContext(
      input.actor,
      input.reason,
      input.metadata,
      this.idGenerator
    );
    const result = await this.repository.updateContentBlock({
      eventId: input.eventId,
      contentBlockId: input.contentBlockId,
      expectedLockVersion: input.expectedLockVersion,
      contentBlock: parseContentBlock(input.contentBlock),
      audit
    });
    return mutationResult(
      result,
      input.eventId,
      input.contentBlockId,
      audit
    );
  }
}

interface ContentBlockCommand {
  readonly actor: AdminRequestActor;
  readonly eventId: string;
  readonly expectedLockVersion: number;
  readonly contentBlock: AdminEventContentBlockInput;
  readonly reason: string;
  readonly metadata: AdminEventMutationMetadata;
}

function validateCommand(
  actor: AdminRequestActor,
  eventId: string,
  expectedLockVersion: number
): void {
  requireAdminEventsWrite(actor);
  requireAdminEventUuid(eventId);
  if (!Number.isSafeInteger(expectedLockVersion) || expectedLockVersion < 1) {
    throw new InvalidAdminEventMutationError();
  }
}

function parseContentBlock(
  input: AdminEventContentBlockInput
): AdminEventContentBlockRecord {
  if (
    !ADMIN_EVENT_CONTENT_BLOCK_TYPES.includes(input.blockType)
    || !Number.isSafeInteger(input.sortOrder)
    || input.sortOrder < 0
    || input.sortOrder > 1_000_000
  ) {
    throw new InvalidAdminEventMutationError();
  }
  return {
    blockType: input.blockType,
    title: optional(input.title, 250),
    contentSchemaVersion: 1,
    content: normalizeJsonObject(input.content),
    sortOrder: input.sortOrder,
    isVisible: input.isVisible
  };
}

function normalizeJsonObject(
  value: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidAdminEventMutationError();
  }
  const budget = { nodes: 0 };
  assertJsonValue(value, 0, budget);
  const serialized = JSON.stringify(value);
  if (serialized.length > 50_000) {
    throw new InvalidAdminEventMutationError();
  }
  return JSON.parse(serialized) as Readonly<Record<string, unknown>>;
}

function assertJsonValue(
  value: unknown,
  depth: number,
  budget: { nodes: number }
): void {
  budget.nodes += 1;
  if (depth > 12 || budget.nodes > 2_000) {
    throw new InvalidAdminEventMutationError();
  }
  if (
    value === null
    || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }
  if (typeof value === "string") {
    if (value.length > 10_000) {
      throw new InvalidAdminEventMutationError();
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 500) {
      throw new InvalidAdminEventMutationError();
    }
    for (const item of value) {
      assertJsonValue(item, depth + 1, budget);
    }
    return;
  }
  if (typeof value !== "object") {
    throw new InvalidAdminEventMutationError();
  }
  const entries = Object.entries(value);
  if (
    entries.length > 200
    || entries.some(([key]) => key.length > 200)
  ) {
    throw new InvalidAdminEventMutationError();
  }
  for (const [, item] of entries) {
    assertJsonValue(item, depth + 1, budget);
  }
}

function mutationResult(
  result:
    | { readonly status: "created" | "updated"; readonly lockVersion: number }
    | { readonly status: ContentFailure },
  eventId: string,
  resourceId: string,
  audit: AdminEventAuditContext
): AdminEventContentMutationResult {
  if ("lockVersion" in result) {
    return {
      eventId,
      resourceId,
      status: "draft",
      lockVersion: result.lockVersion,
      updatedAt: audit.occurredAt.toISOString()
    };
  }
  if (result.status === "event_not_found") {
    throw new AdminEventNotFoundError();
  }
  if (result.status === "not_draft") {
    throw new AdminEventNotDraftError();
  }
  if (result.status === "version_conflict") {
    throw new AdminEventVersionConflictError();
  }
  if (result.status === "content_block_not_found") {
    throw new AdminEventContentBlockNotFoundError();
  }
  if (result.status === "sort_order_conflict") {
    throw new AdminEventContentSortOrderConflictError();
  }
  throw new InvalidAdminEventMutationError();
}

function optional(value: string | null, maximum: number): string | null {
  if (value === null) {
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length > maximum) {
    throw new InvalidAdminEventMutationError();
  }
  return normalized;
}
