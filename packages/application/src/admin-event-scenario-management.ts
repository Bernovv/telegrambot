import type {
  AdminEventScenarioMutationResult,
  AdminRequestActor,
  SaveAdminEventScenarioDraftRequest
} from "@ticket-platform/contracts";
import {
  SCENARIO_NODE_TYPES,
  validateScenarioGraph,
  type ScenarioGraph,
  type ScenarioValidationIssue
} from "@ticket-platform/scenario-engine";
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

type ScenarioFailure =
  | "event_not_found"
  | "not_draft"
  | "version_conflict"
  | "version_not_found"
  | "version_not_draft";

export interface AdminEventScenarioManagementRepository {
  saveDraft(input: {
    readonly eventId: string;
    readonly expectedLockVersion: number;
    readonly proposedScenarioId: string;
    readonly proposedVersionId: string;
    readonly title: string;
    readonly graph: ScenarioGraph;
    readonly validationIssues: readonly ScenarioValidationIssue[];
    readonly audit: AdminEventAuditContext;
  }): Promise<
    | {
        readonly status: "saved";
        readonly scenarioVersionId: string;
        readonly lockVersion: number;
      }
    | { readonly status: ScenarioFailure }
  >;
  loadDraft(input: {
    readonly eventId: string;
    readonly scenarioVersionId: string;
    readonly expectedLockVersion: number;
  }): Promise<
    | { readonly status: "ready"; readonly graph: ScenarioGraph }
    | { readonly status: ScenarioFailure }
  >;
  publishDraft(input: {
    readonly eventId: string;
    readonly scenarioVersionId: string;
    readonly expectedLockVersion: number;
    readonly validationIssues: readonly ScenarioValidationIssue[];
    readonly audit: AdminEventAuditContext;
  }): Promise<
    | { readonly status: "published"; readonly lockVersion: number }
    | { readonly status: ScenarioFailure }
  >;
}

export class AdminScenarioVersionNotFoundError extends Error {
  constructor() {
    super("Scenario version was not found for the event");
    this.name = "AdminScenarioVersionNotFoundError";
  }
}

export class AdminScenarioVersionNotDraftError extends Error {
  constructor() {
    super("Published scenario version is immutable");
    this.name = "AdminScenarioVersionNotDraftError";
  }
}

export class AdminScenarioValidationFailedError extends Error {
  constructor(
    readonly issues: readonly ScenarioValidationIssue[]
  ) {
    super("Scenario graph did not pass publication validation");
    this.name = "AdminScenarioValidationFailedError";
  }
}

export class SaveAdminEventScenarioDraftService {
  constructor(
    private readonly repository: AdminEventScenarioManagementRepository,
    private readonly idGenerator: IdGenerator
  ) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly eventId: string;
    readonly expectedLockVersion: number;
    readonly scenario: SaveAdminEventScenarioDraftRequest["scenario"];
    readonly reason: string;
    readonly metadata: AdminEventMutationMetadata;
  }): Promise<AdminEventScenarioMutationResult> {
    requireAdminEventsWrite(input.actor);
    validateMutation(input.eventId, input.expectedLockVersion);
    const title = bounded(input.scenario.title, 1, 250);
    const graph = parseGraph(input.scenario);
    const validation = validateScenarioGraph(graph);
    const proposedScenarioId = this.idGenerator.newId();
    const proposedVersionId = this.idGenerator.newId();
    requireAdminEventUuid(proposedScenarioId);
    requireAdminEventUuid(proposedVersionId);
    const audit = buildAdminEventAuditContext(
      input.actor,
      input.reason,
      input.metadata,
      this.idGenerator
    );
    const result = await this.repository.saveDraft({
      eventId: input.eventId,
      expectedLockVersion: input.expectedLockVersion,
      proposedScenarioId,
      proposedVersionId,
      title,
      graph,
      validationIssues: validation.issues,
      audit
    });
    if (result.status !== "saved") {
      throwScenarioFailure(result.status);
    }
    return {
      eventId: input.eventId,
      resourceId: result.scenarioVersionId,
      status: "draft",
      versionStatus: "draft",
      lockVersion: result.lockVersion,
      validationIssues: validation.issues,
      updatedAt: audit.occurredAt.toISOString()
    };
  }
}

export class PublishAdminEventScenarioVersionService {
  constructor(
    private readonly repository: AdminEventScenarioManagementRepository,
    private readonly idGenerator: IdGenerator
  ) {}

  async execute(input: {
    readonly actor: AdminRequestActor;
    readonly eventId: string;
    readonly scenarioVersionId: string;
    readonly expectedLockVersion: number;
    readonly reason: string;
    readonly metadata: AdminEventMutationMetadata;
  }): Promise<AdminEventScenarioMutationResult> {
    requireScenarioPublish(input.actor);
    validateMutation(input.eventId, input.expectedLockVersion);
    requireAdminEventUuid(input.scenarioVersionId);
    const loaded = await this.repository.loadDraft({
      eventId: input.eventId,
      scenarioVersionId: input.scenarioVersionId,
      expectedLockVersion: input.expectedLockVersion
    });
    if (loaded.status !== "ready") {
      throwScenarioFailure(loaded.status);
    }
    const validation = validateScenarioGraph(loaded.graph);
    if (!validation.valid) {
      throw new AdminScenarioValidationFailedError(validation.issues);
    }
    const audit = buildAdminEventAuditContext(
      input.actor,
      input.reason,
      input.metadata,
      this.idGenerator
    );
    const result = await this.repository.publishDraft({
      eventId: input.eventId,
      scenarioVersionId: input.scenarioVersionId,
      expectedLockVersion: input.expectedLockVersion,
      validationIssues: validation.issues,
      audit
    });
    if (result.status !== "published") {
      throwScenarioFailure(result.status);
    }
    return {
      eventId: input.eventId,
      resourceId: input.scenarioVersionId,
      status: "draft",
      versionStatus: "published",
      lockVersion: result.lockVersion,
      validationIssues: [],
      updatedAt: audit.occurredAt.toISOString()
    };
  }
}

function parseGraph(
  input: SaveAdminEventScenarioDraftRequest["scenario"]
): ScenarioGraph {
  if (
    !Number.isSafeInteger(input.schemaVersion)
    || input.schemaVersion < 1
    || input.schemaVersion > 32_767
    || input.nodes.length > 500
    || input.edges.length > 2_000
  ) {
    throw new InvalidAdminEventMutationError();
  }
  return {
    schemaVersion: input.schemaVersion,
    nodes: input.nodes.map((node) => {
      requireAdminEventUuid(node.id);
      if (
        !SCENARIO_NODE_TYPES.includes(node.type)
        || !Number.isSafeInteger(node.schemaVersion)
        || node.schemaVersion < 1
        || node.schemaVersion > 32_767
      ) {
        throw new InvalidAdminEventMutationError();
      }
      return {
        id: node.id,
        type: node.type,
        schemaVersion: node.schemaVersion,
        payload: normalizeJsonObject(node.payload)
      };
    }),
    edges: input.edges.map((edge) => {
      requireAdminEventUuid(edge.id);
      requireAdminEventUuid(edge.fromNodeId);
      requireAdminEventUuid(edge.toNodeId);
      if (
        (edge.label !== null && bounded(edge.label, 1, 250) !== edge.label.trim())
        || !Number.isSafeInteger(edge.priority)
        || edge.priority < -1_000_000
        || edge.priority > 1_000_000
      ) {
        throw new InvalidAdminEventMutationError();
      }
      return {
        id: edge.id,
        fromNodeId: edge.fromNodeId,
        toNodeId: edge.toNodeId,
        label: edge.label === null ? null : edge.label.trim(),
        priority: edge.priority,
        condition: normalizeJsonObject(edge.condition)
      };
    })
  };
}

function normalizeJsonObject(
  value: Readonly<Record<string, unknown>>
): Readonly<Record<string, unknown>> {
  try {
    const encoded = JSON.stringify(value);
    if (encoded.length > 50_000) {
      throw new Error("too large");
    }
    const parsed: unknown = JSON.parse(encoded);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("not object");
    }
    return parsed as Readonly<Record<string, unknown>>;
  } catch {
    throw new InvalidAdminEventMutationError();
  }
}

function validateMutation(eventId: string, expectedLockVersion: number): void {
  requireAdminEventUuid(eventId);
  if (!Number.isSafeInteger(expectedLockVersion) || expectedLockVersion < 1) {
    throw new InvalidAdminEventMutationError();
  }
}

function requireScenarioPublish(actor: AdminRequestActor): void {
  if (actor.permission !== "scenarios.publish") {
    throw new InvalidAdminEventMutationError();
  }
  requireAdminEventUuid(actor.adminId);
}

function bounded(value: string, minimum: number, maximum: number): string {
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new InvalidAdminEventMutationError();
  }
  return normalized;
}

function throwScenarioFailure(status: ScenarioFailure): never {
  switch (status) {
    case "event_not_found":
      throw new AdminEventNotFoundError();
    case "not_draft":
      throw new AdminEventNotDraftError();
    case "version_conflict":
      throw new AdminEventVersionConflictError();
    case "version_not_found":
      throw new AdminScenarioVersionNotFoundError();
    case "version_not_draft":
      throw new AdminScenarioVersionNotDraftError();
  }
}
