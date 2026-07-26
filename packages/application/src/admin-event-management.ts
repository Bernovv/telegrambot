import type {
  AdminEventGeneralInput,
  AdminEventMutationResult,
  AdminEventPublicationResult,
  AdminRequestActor
} from "@ticket-platform/contracts";
import type { IdGenerator } from "./identity.js";

export interface AdminEventGeneralRecord {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly timezone: string;
  readonly startsAt: Date;
  readonly endsAt: Date | null;
  readonly salesStartsAt: Date | null;
  readonly salesEndsAt: Date | null;
  readonly locationName: string | null;
  readonly locationAddress: string | null;
  readonly supportContact: string | null;
  readonly capacity: number;
  readonly reservationTtlMinutes: number;
  readonly phoneRequiredForPurchase: boolean;
  readonly offerRequired: boolean;
}

export interface AdminEventAuditContext {
  readonly auditId: string;
  readonly actorAdminId: string;
  readonly actorRole: string;
  readonly reason: string;
  readonly requestId: string;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly occurredAt: Date;
}

export interface AdminEventManagementRepository {
  createDraft(input: {
    readonly eventId: string;
    readonly event: AdminEventGeneralRecord;
    readonly audit: AdminEventAuditContext;
  }): Promise<"created" | "slug_conflict">;
  updateDraft(input: {
    readonly eventId: string;
    readonly expectedLockVersion: number;
    readonly event: AdminEventGeneralRecord;
    readonly audit: AdminEventAuditContext;
  }): Promise<
    | { readonly status: "updated"; readonly lockVersion: number }
    | { readonly status: "not_found" | "not_draft" | "version_conflict" | "slug_conflict" }
  >;
  publishDraft(input: {
    readonly eventId: string;
    readonly expectedLockVersion: number;
    readonly audit: AdminEventAuditContext;
  }): Promise<
    | { readonly status: "published"; readonly lockVersion: number }
    | {
      readonly status:
        | "not_found"
        | "not_draft"
        | "version_conflict";
    }
    | {
      readonly status: "requirements_failed";
      readonly issues: readonly AdminEventPublicationIssue[];
    }
  >;
}

export type AdminEventPublicationIssue =
  | "missing_title"
  | "missing_start"
  | "missing_support_contact"
  | "missing_active_product"
  | "active_product_without_price"
  | "missing_active_offer"
  | "missing_published_scenario";

export interface AdminEventMutationMetadata {
  readonly requestId: string;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly occurredAt: Date;
}

export class InvalidAdminEventMutationError extends Error {
  constructor() {
    super("Administrator event mutation is invalid");
    this.name = "InvalidAdminEventMutationError";
  }
}

export class AdminEventSlugConflictError extends Error {
  constructor() {
    super("Administrator event slug already exists");
    this.name = "AdminEventSlugConflictError";
  }
}

export class AdminEventNotFoundError extends Error {
  constructor() {
    super("Administrator event was not found");
    this.name = "AdminEventNotFoundError";
  }
}

export class AdminEventNotDraftError extends Error {
  constructor() {
    super("Only draft events can be changed by this operation");
    this.name = "AdminEventNotDraftError";
  }
}

export class AdminEventVersionConflictError extends Error {
  constructor() {
    super("Administrator event version is stale");
    this.name = "AdminEventVersionConflictError";
  }
}

export class AdminEventPublicationRequirementsError extends Error {
  constructor(readonly issues: readonly AdminEventPublicationIssue[]) {
    super("Administrator event publication requirements were not met");
    this.name = "AdminEventPublicationRequirementsError";
  }
}

export class CreateAdminEventDraftService {
  constructor(
    private readonly repository: AdminEventManagementRepository,
    private readonly idGenerator: IdGenerator
  ) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly event: AdminEventGeneralInput;
    readonly reason: string;
    readonly metadata: AdminEventMutationMetadata;
  }): Promise<AdminEventMutationResult> {
    requireAdminEventsWrite(input.actor);
    const eventId = this.idGenerator.newId();
    requireAdminEventUuid(eventId);
    const audit = buildAdminEventAuditContext(
      input.actor,
      input.reason,
      input.metadata,
      this.idGenerator
    );
    const result = await this.repository.createDraft({
      eventId,
      event: parseEvent(input.event),
      audit
    });
    if (result === "slug_conflict") {
      throw new AdminEventSlugConflictError();
    }
    return {
      eventId,
      status: "draft",
      lockVersion: 1,
      updatedAt: audit.occurredAt.toISOString()
    };
  }
}

export class UpdateAdminEventGeneralService {
  constructor(
    private readonly repository: AdminEventManagementRepository,
    private readonly idGenerator: IdGenerator
  ) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly eventId: string;
    readonly expectedLockVersion: number;
    readonly event: AdminEventGeneralInput;
    readonly reason: string;
    readonly metadata: AdminEventMutationMetadata;
  }): Promise<AdminEventMutationResult> {
    requireAdminEventsWrite(input.actor);
    requireAdminEventUuid(input.eventId);
    if (
      !Number.isSafeInteger(input.expectedLockVersion)
      || input.expectedLockVersion < 1
    ) {
      throw new InvalidAdminEventMutationError();
    }
    const audit = buildAdminEventAuditContext(
      input.actor,
      input.reason,
      input.metadata,
      this.idGenerator
    );
    const result = await this.repository.updateDraft({
      eventId: input.eventId,
      expectedLockVersion: input.expectedLockVersion,
      event: parseEvent(input.event),
      audit
    });
    if (result.status !== "updated") {
      switch (result.status) {
        case "not_found":
          throw new AdminEventNotFoundError();
        case "not_draft":
          throw new AdminEventNotDraftError();
        case "version_conflict":
          throw new AdminEventVersionConflictError();
        case "slug_conflict":
          throw new AdminEventSlugConflictError();
      }
    }
    return {
      eventId: input.eventId,
      status: "draft",
      lockVersion: result.lockVersion,
      updatedAt: audit.occurredAt.toISOString()
    };
  }
}

export class PublishAdminEventService {
  constructor(
    private readonly repository: AdminEventManagementRepository,
    private readonly idGenerator: IdGenerator
  ) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly eventId: string;
    readonly expectedLockVersion: number;
    readonly reason: string;
    readonly metadata: AdminEventMutationMetadata;
  }): Promise<AdminEventPublicationResult> {
    requireAdminEventsPublish(input.actor);
    requireAdminEventUuid(input.eventId);
    if (
      !Number.isSafeInteger(input.expectedLockVersion)
      || input.expectedLockVersion < 1
    ) {
      throw new InvalidAdminEventMutationError();
    }
    const audit = buildAdminEventAuditContext(
      input.actor,
      input.reason,
      input.metadata,
      this.idGenerator
    );
    const result = await this.repository.publishDraft({
      eventId: input.eventId,
      expectedLockVersion: input.expectedLockVersion,
      audit
    });
    if (result.status !== "published") {
      switch (result.status) {
        case "not_found":
          throw new AdminEventNotFoundError();
        case "not_draft":
          throw new AdminEventNotDraftError();
        case "version_conflict":
          throw new AdminEventVersionConflictError();
        case "requirements_failed":
          throw new AdminEventPublicationRequirementsError(result.issues);
      }
    }
    return {
      eventId: input.eventId,
      status: "published",
      lockVersion: result.lockVersion,
      publishedAt: audit.occurredAt.toISOString()
    };
  }
}

export function buildAdminEventAuditContext(
  actor: AdminRequestActor,
  reason: string,
  metadata: AdminEventMutationMetadata,
  idGenerator: IdGenerator
): AdminEventAuditContext {
  requireAdminEventUuid(actor.adminId);
  const auditId = idGenerator.newId();
  requireAdminEventUuid(auditId);
  const actorRole = [...actor.roleCodes]
    .filter((role) => /^[a-z][a-z0-9_]{1,63}$/.test(role))
    .sort()
    .join(",");
  const normalizedReason = normalizeRequired(reason, 500);
  const requestId = normalizeRequired(metadata.requestId, 200);
  const ipAddress = normalizeOptional(metadata.ipAddress, 64);
  const userAgent = normalizeOptional(metadata.userAgent, 500);
  if (!actorRole || Number.isNaN(metadata.occurredAt.getTime())) {
    throw new InvalidAdminEventMutationError();
  }
  return {
    auditId,
    actorAdminId: actor.adminId,
    actorRole,
    reason: normalizedReason,
    requestId,
    ipAddress,
    userAgent,
    occurredAt: metadata.occurredAt
  };
}

function parseEvent(input: AdminEventGeneralInput): AdminEventGeneralRecord {
  const timezone = normalizeRequired(input.timezone, 100);
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
  } catch {
    throw new InvalidAdminEventMutationError();
  }
  const startsAt = parseDate(input.startsAt);
  const endsAt = parseNullableDate(input.endsAt);
  const salesStartsAt = parseNullableDate(input.salesStartsAt);
  const salesEndsAt = parseNullableDate(input.salesEndsAt);
  if (
    (endsAt !== null && endsAt <= startsAt)
    || (
      salesStartsAt !== null
      && salesEndsAt !== null
      && salesEndsAt <= salesStartsAt
    )
    || !Number.isSafeInteger(input.capacity)
    || input.capacity < 1
    || input.capacity > 10_000_000
    || !Number.isSafeInteger(input.reservationTtlMinutes)
    || input.reservationTtlMinutes < 1
    || input.reservationTtlMinutes > 1_440
  ) {
    throw new InvalidAdminEventMutationError();
  }
  const slug = normalizeRequired(input.slug, 100).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length < 2) {
    throw new InvalidAdminEventMutationError();
  }
  return {
    slug,
    title: normalizeRequired(input.title, 250),
    description: normalizeOptional(input.description, 10_000) ?? "",
    timezone,
    startsAt,
    endsAt,
    salesStartsAt,
    salesEndsAt,
    locationName: normalizeOptional(input.locationName, 250),
    locationAddress: normalizeOptional(input.locationAddress, 500),
    supportContact: normalizeOptional(input.supportContact, 250),
    capacity: input.capacity,
    reservationTtlMinutes: input.reservationTtlMinutes,
    phoneRequiredForPurchase: input.phoneRequiredForPurchase,
    offerRequired: input.offerRequired
  };
}

export function requireAdminEventsWrite(actor: AdminRequestActor): void {
  if (actor.permission !== "events.write") {
    throw new InvalidAdminEventMutationError();
  }
  requireAdminEventUuid(actor.adminId);
}

export function requireAdminEventsPublish(actor: AdminRequestActor): void {
  if (actor.permission !== "events.publish") {
    throw new InvalidAdminEventMutationError();
  }
  requireAdminEventUuid(actor.adminId);
}

export function requireAdminEventUuid(value: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new InvalidAdminEventMutationError();
  }
}

function parseDate(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new InvalidAdminEventMutationError();
  }
  return parsed;
}

function parseNullableDate(value: string | null): Date | null {
  return value === null ? null : parseDate(value);
}

function normalizeRequired(value: string, maximum: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new InvalidAdminEventMutationError();
  }
  return normalized;
}

function normalizeOptional(value: string | null, maximum: number): string | null {
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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
