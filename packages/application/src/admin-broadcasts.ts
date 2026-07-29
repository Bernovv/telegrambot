import type {
  AdminBroadcast,
  AdminBroadcastContent,
  AdminBroadcastSummary,
  AdminRequestActor,
  CreateAdminBroadcastRequest,
  PublishAdminBroadcastDraftRequest,
  ScheduleAdminBroadcastRequest,
  UpdateAdminBroadcastDraftRequest
} from "@ticket-platform/contracts";
import {
  buildAdminEventAuditContext,
  type AdminEventAuditContext,
  type AdminEventMutationMetadata
} from "./admin-event-management.js";
import type { IdGenerator } from "./identity.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type BroadcastFailure =
  | "not_found"
  | "version_conflict"
  | "draft_not_found"
  | "snapshot_not_ready"
  | "not_editable"
  | "published_not_found"
  | "draft_exists";

export interface AdminBroadcastRepository {
  list(): Promise<readonly AdminBroadcastSummary[]>;
  get(broadcastId: string): Promise<AdminBroadcast | null>;
  create(input: {
    readonly broadcastId: string;
    readonly versionId: string;
    readonly name: string;
    readonly audienceSnapshotId: string;
    readonly content: AdminBroadcastContent;
    readonly audit: AdminEventAuditContext;
  }): Promise<
    | { readonly status: "created"; readonly value: AdminBroadcast }
    | { readonly status: "snapshot_not_ready" }
  >;
  saveDraft(input: {
    readonly broadcastId: string;
    readonly proposedVersionId: string;
    readonly expectedLockVersion: number;
    readonly name: string;
    readonly audienceSnapshotId: string;
    readonly content: AdminBroadcastContent;
    readonly audit: AdminEventAuditContext;
  }): Promise<
    | { readonly status: "saved"; readonly value: AdminBroadcast }
    | {
        readonly status:
          | "not_found"
          | "version_conflict"
          | "snapshot_not_ready"
          | "not_editable";
      }
  >;
  publishDraft(input: {
    readonly broadcastId: string;
    readonly expectedLockVersion: number;
    readonly publicationEventId: string;
    readonly audit: AdminEventAuditContext;
  }): Promise<
    | { readonly status: "published"; readonly value: AdminBroadcast }
    | { readonly status: BroadcastFailure }
  >;
  schedule(input: {
    readonly broadcastId: string;
    readonly expectedLockVersion: number;
    readonly scheduledAt: Date;
    readonly timezone: string;
    readonly ratePerSecond: number;
    readonly scheduleEventId: string;
    readonly audit: AdminEventAuditContext;
  }): Promise<
    | { readonly status: "scheduled"; readonly value: AdminBroadcast }
    | { readonly status: BroadcastFailure }
  >;
}

export class InvalidAdminBroadcastError extends Error {
  constructor() {
    super("Administrator broadcast is invalid");
    this.name = "InvalidAdminBroadcastError";
  }
}

export class AdminBroadcastNotFoundError extends Error {
  constructor() {
    super("Administrator broadcast was not found");
    this.name = "AdminBroadcastNotFoundError";
  }
}

export class AdminBroadcastVersionConflictError extends Error {
  constructor() {
    super("Administrator broadcast version is stale");
    this.name = "AdminBroadcastVersionConflictError";
  }
}

export class AdminBroadcastDraftNotFoundError extends Error {
  constructor() {
    super("Administrator broadcast has no draft to publish");
    this.name = "AdminBroadcastDraftNotFoundError";
  }
}

export class AdminBroadcastAudienceSnapshotUnavailableError extends Error {
  constructor() {
    super("Administrator broadcast requires a ready audience snapshot");
    this.name = "AdminBroadcastAudienceSnapshotUnavailableError";
  }
}

export class AdminBroadcastNotEditableError extends Error {
  constructor() {
    super("Scheduled administrator broadcast cannot be edited");
    this.name = "AdminBroadcastNotEditableError";
  }
}

export class AdminBroadcastPublishedVersionUnavailableError extends Error {
  constructor() {
    super("Administrator broadcast requires a published version");
    this.name = "AdminBroadcastPublishedVersionUnavailableError";
  }
}

export class AdminBroadcastDraftExistsError extends Error {
  constructor() {
    super("Administrator broadcast draft must be published before scheduling");
    this.name = "AdminBroadcastDraftExistsError";
  }
}

export class ListAdminBroadcastsService {
  constructor(private readonly repository: AdminBroadcastRepository) {}

  execute(input: {
    readonly actor: AdminRequestActor;
  }): Promise<readonly AdminBroadcastSummary[]> {
    requirePermission(input.actor);
    return this.repository.list();
  }
}

export class GetAdminBroadcastService {
  constructor(private readonly repository: AdminBroadcastRepository) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly broadcastId: string;
  }): Promise<AdminBroadcast> {
    requirePermission(input.actor);
    requireUuid(input.broadcastId);
    const broadcast = await this.repository.get(input.broadcastId);
    if (!broadcast) {
      throw new AdminBroadcastNotFoundError();
    }
    return broadcast;
  }
}

export class CreateAdminBroadcastService {
  constructor(
    private readonly repository: AdminBroadcastRepository,
    private readonly idGenerator: IdGenerator
  ) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly request: CreateAdminBroadcastRequest;
    readonly metadata: AdminEventMutationMetadata;
  }): Promise<AdminBroadcast> {
    requirePermission(input.actor);
    const parsed = parseDefinition(input.request);
    const result = await this.repository.create({
      broadcastId: requireUuid(this.idGenerator.newId()),
      versionId: requireUuid(this.idGenerator.newId()),
      ...parsed,
      audit: buildAudit(
        input.actor,
        input.request.reason,
        input.metadata,
        this.idGenerator
      )
    });
    if (result.status === "snapshot_not_ready") {
      throw new AdminBroadcastAudienceSnapshotUnavailableError();
    }
    return result.value;
  }
}

export class UpdateAdminBroadcastDraftService {
  constructor(
    private readonly repository: AdminBroadcastRepository,
    private readonly idGenerator: IdGenerator
  ) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly broadcastId: string;
    readonly request: UpdateAdminBroadcastDraftRequest;
    readonly metadata: AdminEventMutationMetadata;
  }): Promise<AdminBroadcast> {
    requirePermission(input.actor);
    requireUuid(input.broadcastId);
    requireLockVersion(input.request.expectedLockVersion);
    const result = await this.repository.saveDraft({
      broadcastId: input.broadcastId,
      proposedVersionId: requireUuid(this.idGenerator.newId()),
      expectedLockVersion: input.request.expectedLockVersion,
      ...parseDefinition(input.request),
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

export class PublishAdminBroadcastDraftService {
  constructor(
    private readonly repository: AdminBroadcastRepository,
    private readonly idGenerator: IdGenerator
  ) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly broadcastId: string;
    readonly request: PublishAdminBroadcastDraftRequest;
    readonly metadata: AdminEventMutationMetadata;
  }): Promise<AdminBroadcast> {
    requirePermission(input.actor);
    requireUuid(input.broadcastId);
    requireLockVersion(input.request.expectedLockVersion);
    const publicationEventId = requireUuid(this.idGenerator.newId());
    const result = await this.repository.publishDraft({
      broadcastId: input.broadcastId,
      expectedLockVersion: input.request.expectedLockVersion,
      publicationEventId,
      audit: buildAudit(
        input.actor,
        input.request.reason,
        input.metadata,
        this.idGenerator
      )
    });
    if (result.status !== "published") {
      throwFailure(result.status);
    }
    return result.value;
  }
}

export class ScheduleAdminBroadcastService {
  constructor(
    private readonly repository: AdminBroadcastRepository,
    private readonly idGenerator: IdGenerator
  ) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly broadcastId: string;
    readonly request: ScheduleAdminBroadcastRequest;
    readonly metadata: AdminEventMutationMetadata;
  }): Promise<AdminBroadcast> {
    requirePermission(input.actor);
    requireUuid(input.broadcastId);
    requireLockVersion(input.request.expectedLockVersion);
    const scheduledAt = parseScheduledAt(
      input.request.scheduledAt,
      input.metadata.occurredAt
    );
    const timezone = parseTimezone(input.request.timezone);
    if (
      !Number.isSafeInteger(input.request.ratePerSecond)
      || input.request.ratePerSecond < 1
      || input.request.ratePerSecond > 25
    ) {
      throw new InvalidAdminBroadcastError();
    }
    const result = await this.repository.schedule({
      broadcastId: input.broadcastId,
      expectedLockVersion: input.request.expectedLockVersion,
      scheduledAt,
      timezone,
      ratePerSecond: input.request.ratePerSecond,
      scheduleEventId: requireUuid(this.idGenerator.newId()),
      audit: buildAudit(
        input.actor,
        input.request.reason,
        input.metadata,
        this.idGenerator
      )
    });
    if (result.status !== "scheduled") {
      throwFailure(result.status);
    }
    return result.value;
  }
}

function parseDefinition(input: {
  readonly name: string;
  readonly audienceSnapshotId: string;
  readonly content: AdminBroadcastContent;
}): {
  readonly name: string;
  readonly audienceSnapshotId: string;
  readonly content: AdminBroadcastContent;
} {
  return {
    name: bounded(input.name, 1, 120),
    audienceSnapshotId: requireUuid(input.audienceSnapshotId),
    content: parseContent(input.content)
  };
}

function parseContent(content: AdminBroadcastContent): AdminBroadcastContent {
  const text = content.text.trim();
  if (
    text.length < 1
    || text.length > 4_000
    || typeof content.disableLinkPreview !== "boolean"
    || content.buttons.length > 8
  ) {
    throw new InvalidAdminBroadcastError();
  }
  const buttons = content.buttons.map((button) => {
    const label = bounded(button.label, 1, 64);
    const url = bounded(button.url, 1, 2_048);
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new InvalidAdminBroadcastError();
    }
    if (
      parsed.protocol !== "https:"
      || !parsed.hostname
      || parsed.username
      || parsed.password
    ) {
      throw new InvalidAdminBroadcastError();
    }
    return { label, url: parsed.toString() };
  });
  if (new Set(buttons.map((button) => button.url)).size !== buttons.length) {
    throw new InvalidAdminBroadcastError();
  }
  return { text, disableLinkPreview: content.disableLinkPreview, buttons };
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
    throw new InvalidAdminBroadcastError();
  }
}

function throwFailure(status: BroadcastFailure): never {
  switch (status) {
    case "not_found":
      throw new AdminBroadcastNotFoundError();
    case "version_conflict":
      throw new AdminBroadcastVersionConflictError();
    case "draft_not_found":
      throw new AdminBroadcastDraftNotFoundError();
    case "snapshot_not_ready":
      throw new AdminBroadcastAudienceSnapshotUnavailableError();
    case "not_editable":
      throw new AdminBroadcastNotEditableError();
    case "published_not_found":
      throw new AdminBroadcastPublishedVersionUnavailableError();
    case "draft_exists":
      throw new AdminBroadcastDraftExistsError();
  }
}

function parseScheduledAt(value: string, occurredAt: Date): Date {
  const parsed = new Date(value);
  const earliest = occurredAt.getTime() - 5 * 60_000;
  const latest = occurredAt.getTime() + 366 * 24 * 60 * 60_000;
  if (
    Number.isNaN(occurredAt.getTime())
    || Number.isNaN(parsed.getTime())
    || parsed.toISOString() !== value
    || parsed.getTime() < earliest
    || parsed.getTime() > latest
  ) {
    throw new InvalidAdminBroadcastError();
  }
  return parsed;
}

function parseTimezone(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length < 1
    || normalized.length > 100
    || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+$/.test(normalized)
  ) {
    throw new InvalidAdminBroadcastError();
  }
  try {
    new Intl.DateTimeFormat("ru-RU", { timeZone: normalized }).format();
  } catch {
    throw new InvalidAdminBroadcastError();
  }
  return normalized;
}

function requirePermission(actor: AdminRequestActor): void {
  if (
    actor.permission !== "broadcasts.send"
    || !UUID_PATTERN.test(actor.adminId)
  ) {
    throw new InvalidAdminBroadcastError();
  }
}

function requireUuid(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new InvalidAdminBroadcastError();
  }
  return value;
}

function requireLockVersion(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new InvalidAdminBroadcastError();
  }
}

function bounded(value: string, minimum: number, maximum: number): string {
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new InvalidAdminBroadcastError();
  }
  return normalized;
}
