import { createHash } from "node:crypto";
import type {
  AdminEventOfferMutationResult,
  AdminRequestActor,
  PublishAdminEventOfferVersionRequest
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

export interface ImmutableOfferSnapshot {
  readonly storagePath: string;
  readonly contentType: "text/html";
  readonly bytes: Uint8Array;
}

export interface OfferSnapshotStorage {
  storeImmutable(
    snapshot: ImmutableOfferSnapshot
  ): Promise<{ readonly publicUrl: string }>;
}

export interface AdminEventOfferVersionRecord {
  readonly documentTitle: string;
  readonly sourceType: "google_docs" | "html";
  readonly sourceUrl: string | null;
  readonly publicUrl: string;
  readonly storagePath: string;
  readonly contentType: "text/html";
  readonly sha256: string;
  readonly sourceRevisionId: string | null;
  readonly displayTextSnapshot: string;
}

type OfferFailure =
  | "event_not_found"
  | "not_draft"
  | "version_conflict"
  | "ambiguous_offer_document"
  | "offer_not_active";

export interface AdminEventOfferManagementRepository {
  prepareOfferVersion(input: {
    readonly eventId: string;
    readonly expectedLockVersion: number;
  }): Promise<
    | { readonly status: "ready"; readonly offerDocumentId: string | null }
    | { readonly status: OfferFailure }
  >;
  publishOfferVersion(input: {
    readonly eventId: string;
    readonly expectedLockVersion: number;
    readonly offerDocumentId: string;
    readonly offerVersionId: string;
    readonly version: AdminEventOfferVersionRecord;
    readonly audit: AdminEventAuditContext;
  }): Promise<
    | { readonly status: "published"; readonly lockVersion: number }
    | { readonly status: OfferFailure }
  >;
  deactivateOffer(input: {
    readonly eventId: string;
    readonly expectedLockVersion: number;
    readonly audit: AdminEventAuditContext;
  }): Promise<
    | {
        readonly status: "deactivated";
        readonly offerVersionId: string;
        readonly lockVersion: number;
      }
    | { readonly status: OfferFailure }
  >;
}

export class AdminEventOfferDocumentAmbiguousError extends Error {
  constructor() {
    super("Event has more than one active offer document");
    this.name = "AdminEventOfferDocumentAmbiguousError";
  }
}

export class AdminEventOfferNotActiveError extends Error {
  constructor() {
    super("Event has no active offer version");
    this.name = "AdminEventOfferNotActiveError";
  }
}

export class AdminOfferSnapshotStorageUnavailableError extends Error {
  constructor() {
    super("Immutable offer snapshot storage is unavailable");
    this.name = "AdminOfferSnapshotStorageUnavailableError";
  }
}

export class PublishAdminEventOfferVersionService {
  constructor(
    private readonly repository: AdminEventOfferManagementRepository,
    private readonly storage: OfferSnapshotStorage,
    private readonly idGenerator: IdGenerator
  ) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly eventId: string;
    readonly expectedLockVersion: number;
    readonly offer: PublishAdminEventOfferVersionRequest["offer"];
    readonly reason: string;
    readonly metadata: AdminEventMutationMetadata;
  }): Promise<AdminEventOfferMutationResult> {
    validateMutation(input.actor, input.eventId, input.expectedLockVersion);
    const offer = parseOffer(input.offer);
    const prepared = await this.repository.prepareOfferVersion({
      eventId: input.eventId,
      expectedLockVersion: input.expectedLockVersion
    });
    if (prepared.status !== "ready") {
      throwOfferFailure(prepared.status);
    }

    const offerDocumentId =
      prepared.offerDocumentId ?? this.idGenerator.newId();
    const offerVersionId = this.idGenerator.newId();
    requireAdminEventUuid(offerDocumentId);
    requireAdminEventUuid(offerVersionId);
    const storagePath = `offers/${input.eventId}/${offerVersionId}.html`;
    const bytes = renderOfferHtml(offer.documentTitle, offer.displayTextSnapshot);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    let publicUrl: string;
    try {
      const stored = await this.storage.storeImmutable({
        storagePath,
        contentType: "text/html",
        bytes
      });
      publicUrl = requireHttpsUrl(stored.publicUrl);
    } catch (error) {
      if (error instanceof InvalidAdminEventMutationError) {
        throw error;
      }
      throw new AdminOfferSnapshotStorageUnavailableError();
    }

    const audit = buildAdminEventAuditContext(
      input.actor,
      input.reason,
      input.metadata,
      this.idGenerator
    );
    const result = await this.repository.publishOfferVersion({
      eventId: input.eventId,
      expectedLockVersion: input.expectedLockVersion,
      offerDocumentId,
      offerVersionId,
      version: {
        ...offer,
        publicUrl,
        storagePath,
        contentType: "text/html",
        sha256
      },
      audit
    });
    if (result.status !== "published") {
      throwOfferFailure(result.status);
    }
    return {
      eventId: input.eventId,
      resourceId: offerVersionId,
      status: "draft",
      lockVersion: result.lockVersion,
      updatedAt: audit.occurredAt.toISOString()
    };
  }
}

export class DeactivateAdminEventOfferService {
  constructor(
    private readonly repository: AdminEventOfferManagementRepository,
    private readonly idGenerator: IdGenerator
  ) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly eventId: string;
    readonly expectedLockVersion: number;
    readonly reason: string;
    readonly metadata: AdminEventMutationMetadata;
  }): Promise<AdminEventOfferMutationResult> {
    validateMutation(input.actor, input.eventId, input.expectedLockVersion);
    const audit = buildAdminEventAuditContext(
      input.actor,
      input.reason,
      input.metadata,
      this.idGenerator
    );
    const result = await this.repository.deactivateOffer({
      eventId: input.eventId,
      expectedLockVersion: input.expectedLockVersion,
      audit
    });
    if (result.status !== "deactivated") {
      throwOfferFailure(result.status);
    }
    return {
      eventId: input.eventId,
      resourceId: result.offerVersionId,
      status: "draft",
      lockVersion: result.lockVersion,
      updatedAt: audit.occurredAt.toISOString()
    };
  }
}

function validateMutation(
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

function parseOffer(
  input: PublishAdminEventOfferVersionRequest["offer"]
): Omit<
  AdminEventOfferVersionRecord,
  "publicUrl" | "storagePath" | "contentType" | "sha256"
> {
  const documentTitle = bounded(input.documentTitle, 1, 250);
  const displayTextSnapshot = normalizeDisplayText(input.displayTextSnapshot);
  if (input.sourceType !== "google_docs" && input.sourceType !== "html") {
    throw new InvalidAdminEventMutationError();
  }
  const sourceUrl = optionalHttpsUrl(input.sourceUrl);
  if (input.sourceType === "google_docs" && sourceUrl === null) {
    throw new InvalidAdminEventMutationError();
  }
  return {
    documentTitle,
    sourceType: input.sourceType,
    sourceUrl,
    sourceRevisionId: optional(input.sourceRevisionId, 250),
    displayTextSnapshot
  };
}

function normalizeDisplayText(value: string): string {
  const normalized = value.replaceAll("\r\n", "\n").trim();
  if (normalized.length < 1 || normalized.length > 50_000) {
    throw new InvalidAdminEventMutationError();
  }
  return normalized;
}

function renderOfferHtml(title: string, displayText: string): Uint8Array {
  const html = [
    "<!doctype html>",
    '<html lang="ru"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'\">",
    `<title>${escapeHtml(title)}</title>`,
    "<style>body{max-width:820px;margin:40px auto;padding:0 20px;color:#17211d;font:16px/1.6 system-ui,sans-serif}h1{font-size:28px;line-height:1.2}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}</style>",
    `</head><body><h1>${escapeHtml(title)}</h1><pre>${escapeHtml(displayText)}</pre></body></html>`
  ].join("");
  return new TextEncoder().encode(html);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function requireHttpsUrl(value: string): string {
  const url = parseHttpsUrl(value);
  if (!url) {
    throw new InvalidAdminEventMutationError();
  }
  return url;
}

function optionalHttpsUrl(value: string | null): string | null {
  if (value === null || !value.trim()) {
    return null;
  }
  const url = parseHttpsUrl(value);
  if (!url || url.length > 2_000) {
    throw new InvalidAdminEventMutationError();
  }
  return url;
}

function parseHttpsUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || url.href.length > 2_000
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function bounded(value: string, minimum: number, maximum: number): string {
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new InvalidAdminEventMutationError();
  }
  return normalized;
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

function throwOfferFailure(status: OfferFailure): never {
  if (status === "event_not_found") {
    throw new AdminEventNotFoundError();
  }
  if (status === "not_draft") {
    throw new AdminEventNotDraftError();
  }
  if (status === "version_conflict") {
    throw new AdminEventVersionConflictError();
  }
  if (status === "ambiguous_offer_document") {
    throw new AdminEventOfferDocumentAmbiguousError();
  }
  if (status === "offer_not_active") {
    throw new AdminEventOfferNotActiveError();
  }
  throw new InvalidAdminEventMutationError();
}
