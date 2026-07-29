import type {
  AdminRequestActor,
  AdminSavedSegment,
  AdminSavedSegmentSummary,
  AdminSegmentExpression,
  CreateAdminSavedSegmentRequest,
  PublishAdminSavedSegmentRequest,
  UpdateAdminSavedSegmentDraftRequest
} from "@ticket-platform/contracts";
import {
  AdminSegmentClassificationUnavailableError,
  InvalidAdminSegmentPreviewError,
  collectAdminSegmentClassificationCodes,
  normalizeAdminSegmentExpression
} from "./admin-segments.js";
import {
  buildAdminEventAuditContext,
  type AdminEventAuditContext,
  type AdminEventMutationMetadata
} from "./admin-event-management.js";
import type { IdGenerator } from "./identity.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SegmentMutationFailure =
  | "not_found"
  | "version_conflict"
  | "draft_not_found"
  | "classification_unavailable";

export interface AdminSavedSegmentRepository {
  list(): Promise<readonly AdminSavedSegmentSummary[]>;
  get(segmentId: string): Promise<AdminSavedSegment | null>;
  findUnavailableClassificationCodes(input: {
    readonly statusCodes: readonly string[];
    readonly categoryCodes: readonly string[];
  }): Promise<{
    readonly statusCodes: readonly string[];
    readonly categoryCodes: readonly string[];
  }>;
  create(input: {
    readonly segmentId: string;
    readonly versionId: string;
    readonly name: string;
    readonly description: string | null;
    readonly expression: AdminSegmentExpression;
    readonly audit: AdminEventAuditContext;
  }): Promise<AdminSavedSegment>;
  saveDraft(input: {
    readonly segmentId: string;
    readonly proposedVersionId: string;
    readonly expectedLockVersion: number;
    readonly name: string;
    readonly description: string | null;
    readonly expression: AdminSegmentExpression;
    readonly audit: AdminEventAuditContext;
  }): Promise<
    | { readonly status: "saved"; readonly value: AdminSavedSegment }
    | { readonly status: "not_found" | "version_conflict" }
  >;
  publishDraft(input: {
    readonly segmentId: string;
    readonly expectedLockVersion: number;
    readonly statusCodes: readonly string[];
    readonly categoryCodes: readonly string[];
    readonly audit: AdminEventAuditContext;
  }): Promise<
    | { readonly status: "published"; readonly value: AdminSavedSegment }
    | {
        readonly status: SegmentMutationFailure;
        readonly statusCodes?: readonly string[];
        readonly categoryCodes?: readonly string[];
      }
  >;
}

export class InvalidAdminSavedSegmentError extends Error {
  constructor() {
    super("Saved administrator segment is invalid");
    this.name = "InvalidAdminSavedSegmentError";
  }
}

export class AdminSavedSegmentNotFoundError extends Error {
  constructor() {
    super("Saved administrator segment was not found");
    this.name = "AdminSavedSegmentNotFoundError";
  }
}

export class AdminSavedSegmentVersionConflictError extends Error {
  constructor() {
    super("Saved administrator segment version is stale");
    this.name = "AdminSavedSegmentVersionConflictError";
  }
}

export class AdminSavedSegmentDraftNotFoundError extends Error {
  constructor() {
    super("Saved administrator segment has no draft to publish");
    this.name = "AdminSavedSegmentDraftNotFoundError";
  }
}

export class ListAdminSavedSegmentsService {
  constructor(private readonly repository: AdminSavedSegmentRepository) {}

  execute(input: {
    readonly actor: AdminRequestActor;
  }): Promise<readonly AdminSavedSegmentSummary[]> {
    requirePermission(input.actor, "users.read");
    return this.repository.list();
  }
}

export class GetAdminSavedSegmentService {
  constructor(private readonly repository: AdminSavedSegmentRepository) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly segmentId: string;
  }): Promise<AdminSavedSegment> {
    requirePermission(input.actor, "users.read");
    requireUuid(input.segmentId);
    const segment = await this.repository.get(input.segmentId);
    if (!segment) {
      throw new AdminSavedSegmentNotFoundError();
    }
    return segment;
  }
}

export class CreateAdminSavedSegmentService {
  constructor(
    private readonly repository: AdminSavedSegmentRepository,
    private readonly idGenerator: IdGenerator
  ) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly request: CreateAdminSavedSegmentRequest;
    readonly metadata: AdminEventMutationMetadata;
  }): Promise<AdminSavedSegment> {
    requirePermission(input.actor, "broadcasts.send");
    const parsed = await parseDefinition(this.repository, input.request);
    return this.repository.create({
      segmentId: requireUuid(this.idGenerator.newId()),
      versionId: requireUuid(this.idGenerator.newId()),
      ...parsed,
      audit: buildAudit(
        input.actor,
        input.request.reason,
        input.metadata,
        this.idGenerator
      )
    });
  }
}

export class UpdateAdminSavedSegmentDraftService {
  constructor(
    private readonly repository: AdminSavedSegmentRepository,
    private readonly idGenerator: IdGenerator
  ) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly segmentId: string;
    readonly request: UpdateAdminSavedSegmentDraftRequest;
    readonly metadata: AdminEventMutationMetadata;
  }): Promise<AdminSavedSegment> {
    requirePermission(input.actor, "broadcasts.send");
    requireUuid(input.segmentId);
    requireLockVersion(input.request.expectedLockVersion);
    const parsed = await parseDefinition(this.repository, input.request);
    const result = await this.repository.saveDraft({
      segmentId: input.segmentId,
      proposedVersionId: requireUuid(this.idGenerator.newId()),
      expectedLockVersion: input.request.expectedLockVersion,
      ...parsed,
      audit: buildAudit(
        input.actor,
        input.request.reason,
        input.metadata,
        this.idGenerator
      )
    });
    if (result.status !== "saved") {
      throwFailure(result.status);
    }
    return result.value;
  }
}

export class PublishAdminSavedSegmentService {
  constructor(
    private readonly repository: AdminSavedSegmentRepository,
    private readonly idGenerator: IdGenerator
  ) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly segmentId: string;
    readonly request: PublishAdminSavedSegmentRequest;
    readonly metadata: AdminEventMutationMetadata;
  }): Promise<AdminSavedSegment> {
    requirePermission(input.actor, "broadcasts.send");
    requireUuid(input.segmentId);
    requireLockVersion(input.request.expectedLockVersion);
    const segment = await this.repository.get(input.segmentId);
    if (!segment) {
      throw new AdminSavedSegmentNotFoundError();
    }
    if (!segment.draft) {
      throw new AdminSavedSegmentDraftNotFoundError();
    }
    const codes = collectAdminSegmentClassificationCodes(
      segment.draft.expression
    );
    const result = await this.repository.publishDraft({
      segmentId: input.segmentId,
      expectedLockVersion: input.request.expectedLockVersion,
      ...codes,
      audit: buildAudit(
        input.actor,
        input.request.reason,
        input.metadata,
        this.idGenerator
      )
    });
    if (result.status === "classification_unavailable") {
      throw new AdminSegmentClassificationUnavailableError(
        result.statusCodes ?? [],
        result.categoryCodes ?? []
      );
    }
    if (result.status !== "published") {
      throwFailure(result.status);
    }
    return result.value;
  }
}

async function parseDefinition(
  repository: AdminSavedSegmentRepository,
  input: {
    readonly name: string;
    readonly description?: string | null;
    readonly expression: AdminSegmentExpression;
  }
): Promise<{
  readonly name: string;
  readonly description: string | null;
  readonly expression: AdminSegmentExpression;
}> {
  const name = bounded(input.name, 1, 120);
  const description = optional(input.description, 1000);
  let expression: AdminSegmentExpression;
  try {
    expression = normalizeAdminSegmentExpression(input.expression);
  } catch (error) {
    if (error instanceof InvalidAdminSegmentPreviewError) {
      throw new InvalidAdminSavedSegmentError();
    }
    throw error;
  }
  const codes = collectAdminSegmentClassificationCodes(expression);
  const unavailable =
    await repository.findUnavailableClassificationCodes(codes);
  if (
    unavailable.statusCodes.length > 0
    || unavailable.categoryCodes.length > 0
  ) {
    throw new AdminSegmentClassificationUnavailableError(
      unavailable.statusCodes,
      unavailable.categoryCodes
    );
  }
  return { name, description, expression };
}

function buildAudit(
  actor: AdminRequestActor,
  reason: string,
  metadata: AdminEventMutationMetadata,
  idGenerator: IdGenerator
): AdminEventAuditContext {
  try {
    return buildAdminEventAuditContext(
      actor,
      bounded(reason, 1, 500),
      metadata,
      idGenerator
    );
  } catch {
    throw new InvalidAdminSavedSegmentError();
  }
}

function bounded(value: string, minimum: number, maximum: number): string {
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new InvalidAdminSavedSegmentError();
  }
  return normalized;
}

function optional(value: string | null | undefined, maximum: number): string | null {
  if (value === undefined || value === null || value.trim() === "") {
    return null;
  }
  return bounded(value, 1, maximum);
}

function requireUuid(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new InvalidAdminSavedSegmentError();
  }
  return value;
}

function requireLockVersion(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new InvalidAdminSavedSegmentError();
  }
}

function requirePermission(
  actor: AdminRequestActor,
  permission: "users.read" | "broadcasts.send"
): void {
  if (actor.permission !== permission || !UUID_PATTERN.test(actor.adminId)) {
    throw new InvalidAdminSavedSegmentError();
  }
}

function throwFailure(
  status: Exclude<SegmentMutationFailure, "classification_unavailable">
): never {
  switch (status) {
    case "not_found":
      throw new AdminSavedSegmentNotFoundError();
    case "version_conflict":
      throw new AdminSavedSegmentVersionConflictError();
    case "draft_not_found":
      throw new AdminSavedSegmentDraftNotFoundError();
  }
}
