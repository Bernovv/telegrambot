import {
  ADMIN_PRODUCT_TYPES,
  type AdminEventCatalogMutationResult,
  type AdminEventPricingRuleInput,
  type AdminEventProductInput,
  type AdminProductType,
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

export interface AdminEventProductRecord {
  readonly code: string;
  readonly productType: AdminProductType;
  readonly title: string;
  readonly description: string;
  readonly currency: string;
  readonly bundleComposition: readonly Readonly<Record<string, unknown>>[];
  readonly inventoryUnitsPerItem: number;
  readonly capacity: number | null;
  readonly maximumQuantityPerOrder: number;
  readonly isActive: boolean;
  readonly sortOrder: number;
}

export interface AdminEventPricingRuleRecord {
  readonly currency: string;
  readonly minimumQuantity: number;
  readonly maximumQuantity: number | null;
  readonly unitPriceKopecks: string;
  readonly priority: number;
  readonly specificity: 0;
  readonly validFrom: Date | null;
  readonly validUntil: Date | null;
  readonly conditions: Readonly<Record<string, never>>;
  readonly explanation: string;
  readonly isActive: boolean;
}

type CatalogFailure =
  | "event_not_found"
  | "not_draft"
  | "version_conflict"
  | "product_not_found"
  | "pricing_rule_not_found"
  | "product_code_conflict"
  | "currency_mismatch";

export interface AdminEventCatalogManagementRepository {
  createProduct(input: {
    readonly eventId: string;
    readonly productId: string;
    readonly expectedLockVersion: number;
    readonly product: AdminEventProductRecord;
    readonly audit: AdminEventAuditContext;
  }): Promise<
    | { readonly status: "created"; readonly lockVersion: number }
    | { readonly status: CatalogFailure }
  >;
  updateProduct(input: {
    readonly eventId: string;
    readonly productId: string;
    readonly expectedLockVersion: number;
    readonly product: AdminEventProductRecord;
    readonly audit: AdminEventAuditContext;
  }): Promise<
    | { readonly status: "updated"; readonly lockVersion: number }
    | { readonly status: CatalogFailure }
  >;
  createPricingRule(input: {
    readonly eventId: string;
    readonly productId: string;
    readonly pricingRuleId: string;
    readonly expectedLockVersion: number;
    readonly pricingRule: AdminEventPricingRuleRecord;
    readonly audit: AdminEventAuditContext;
  }): Promise<
    | { readonly status: "created"; readonly lockVersion: number }
    | { readonly status: CatalogFailure }
  >;
  updatePricingRule(input: {
    readonly eventId: string;
    readonly productId: string;
    readonly pricingRuleId: string;
    readonly expectedLockVersion: number;
    readonly pricingRule: AdminEventPricingRuleRecord;
    readonly audit: AdminEventAuditContext;
  }): Promise<
    | { readonly status: "updated"; readonly lockVersion: number }
    | { readonly status: CatalogFailure }
  >;
}

export class AdminEventProductNotFoundError extends Error {
  constructor() {
    super("Administrator event product was not found");
    this.name = "AdminEventProductNotFoundError";
  }
}

export class AdminEventPricingRuleNotFoundError extends Error {
  constructor() {
    super("Administrator event pricing rule was not found");
    this.name = "AdminEventPricingRuleNotFoundError";
  }
}

export class AdminEventProductCodeConflictError extends Error {
  constructor() {
    super("Administrator event product code already exists");
    this.name = "AdminEventProductCodeConflictError";
  }
}

export class CreateAdminEventProductService {
  constructor(
    private readonly repository: AdminEventCatalogManagementRepository,
    private readonly idGenerator: IdGenerator
  ) {}

  async execute(input: ProductCommand): Promise<AdminEventCatalogMutationResult> {
    validateCommand(input.actor, input.eventId, input.expectedLockVersion);
    const productId = this.idGenerator.newId();
    requireAdminEventUuid(productId);
    const audit = buildAdminEventAuditContext(
      input.actor,
      input.reason,
      input.metadata,
      this.idGenerator
    );
    const result = await this.repository.createProduct({
      eventId: input.eventId,
      productId,
      expectedLockVersion: input.expectedLockVersion,
      product: parseProduct(input.product),
      audit
    });
    return mutationResult(result, input.eventId, productId, audit);
  }
}

export class UpdateAdminEventProductService {
  constructor(
    private readonly repository: AdminEventCatalogManagementRepository,
    private readonly idGenerator: IdGenerator
  ) {}

  async execute(
    input: ProductCommand & { readonly productId: string }
  ): Promise<AdminEventCatalogMutationResult> {
    validateCommand(input.actor, input.eventId, input.expectedLockVersion);
    requireAdminEventUuid(input.productId);
    const audit = buildAdminEventAuditContext(
      input.actor,
      input.reason,
      input.metadata,
      this.idGenerator
    );
    const result = await this.repository.updateProduct({
      eventId: input.eventId,
      productId: input.productId,
      expectedLockVersion: input.expectedLockVersion,
      product: parseProduct(input.product),
      audit
    });
    return mutationResult(result, input.eventId, input.productId, audit);
  }
}

export class CreateAdminEventPricingRuleService {
  constructor(
    private readonly repository: AdminEventCatalogManagementRepository,
    private readonly idGenerator: IdGenerator
  ) {}

  async execute(input: PricingRuleCommand): Promise<AdminEventCatalogMutationResult> {
    validateCommand(input.actor, input.eventId, input.expectedLockVersion);
    requireAdminEventUuid(input.productId);
    const pricingRuleId = this.idGenerator.newId();
    requireAdminEventUuid(pricingRuleId);
    const audit = buildAdminEventAuditContext(
      input.actor,
      input.reason,
      input.metadata,
      this.idGenerator
    );
    const result = await this.repository.createPricingRule({
      eventId: input.eventId,
      productId: input.productId,
      pricingRuleId,
      expectedLockVersion: input.expectedLockVersion,
      pricingRule: parsePricingRule(input.pricingRule),
      audit
    });
    return mutationResult(result, input.eventId, pricingRuleId, audit);
  }
}

export class UpdateAdminEventPricingRuleService {
  constructor(
    private readonly repository: AdminEventCatalogManagementRepository,
    private readonly idGenerator: IdGenerator
  ) {}

  async execute(
    input: PricingRuleCommand & { readonly pricingRuleId: string }
  ): Promise<AdminEventCatalogMutationResult> {
    validateCommand(input.actor, input.eventId, input.expectedLockVersion);
    requireAdminEventUuid(input.productId);
    requireAdminEventUuid(input.pricingRuleId);
    const audit = buildAdminEventAuditContext(
      input.actor,
      input.reason,
      input.metadata,
      this.idGenerator
    );
    const result = await this.repository.updatePricingRule({
      eventId: input.eventId,
      productId: input.productId,
      pricingRuleId: input.pricingRuleId,
      expectedLockVersion: input.expectedLockVersion,
      pricingRule: parsePricingRule(input.pricingRule),
      audit
    });
    return mutationResult(
      result,
      input.eventId,
      input.pricingRuleId,
      audit
    );
  }
}

interface ProductCommand {
  readonly actor: AdminRequestActor;
  readonly eventId: string;
  readonly expectedLockVersion: number;
  readonly product: AdminEventProductInput;
  readonly reason: string;
  readonly metadata: AdminEventMutationMetadata;
}

interface PricingRuleCommand {
  readonly actor: AdminRequestActor;
  readonly eventId: string;
  readonly productId: string;
  readonly expectedLockVersion: number;
  readonly pricingRule: AdminEventPricingRuleInput;
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

function parseProduct(input: AdminEventProductInput): AdminEventProductRecord {
  const code = required(input.code, 100).toLowerCase();
  const currency = required(input.currency, 3).toUpperCase();
  if (
    !/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(code)
    || code.length < 2
    || !ADMIN_PRODUCT_TYPES.includes(input.productType)
    || !/^[A-Z]{3}$/.test(currency)
    || !integerBetween(input.inventoryUnitsPerItem, 1, 1_000_000)
    || (
      input.capacity !== null
      && !integerBetween(input.capacity, 1, 10_000_000)
    )
    || !integerBetween(input.maximumQuantityPerOrder, 1, 100_000)
    || !integerBetween(input.sortOrder, 0, 1_000_000)
    || input.bundleComposition.length > 50
  ) {
    throw new InvalidAdminEventMutationError();
  }
  let bundleSize = 0;
  try {
    bundleSize = JSON.stringify(input.bundleComposition).length;
  } catch {
    throw new InvalidAdminEventMutationError();
  }
  if (
    bundleSize > 10_000
    || input.bundleComposition.some(
      (item) => typeof item !== "object" || item === null || Array.isArray(item)
    )
  ) {
    throw new InvalidAdminEventMutationError();
  }
  return {
    code,
    productType: input.productType,
    title: required(input.title, 250),
    description: optional(input.description, 5_000) ?? "",
    currency,
    bundleComposition: input.bundleComposition,
    inventoryUnitsPerItem: input.inventoryUnitsPerItem,
    capacity: input.capacity,
    maximumQuantityPerOrder: input.maximumQuantityPerOrder,
    isActive: input.isActive,
    sortOrder: input.sortOrder
  };
}

function parsePricingRule(
  input: AdminEventPricingRuleInput
): AdminEventPricingRuleRecord {
  const currency = required(input.currency, 3).toUpperCase();
  const validFrom = nullableDate(input.validFrom);
  const validUntil = nullableDate(input.validUntil);
  if (
    !/^[A-Z]{3}$/.test(currency)
    || !integerBetween(input.minimumQuantity, 1, 100_000)
    || (
      input.maximumQuantity !== null
      && (
        !integerBetween(input.maximumQuantity, input.minimumQuantity, 100_000)
      )
    )
    || !/^\d{1,19}$/.test(input.unitPriceKopecks)
    || BigInt(input.unitPriceKopecks) > POSTGRES_BIGINT_MAX
    || !integerBetween(input.priority, -1_000_000, 1_000_000)
    || (
      validFrom !== null
      && validUntil !== null
      && validUntil <= validFrom
    )
  ) {
    throw new InvalidAdminEventMutationError();
  }
  return {
    currency,
    minimumQuantity: input.minimumQuantity,
    maximumQuantity: input.maximumQuantity,
    unitPriceKopecks: BigInt(input.unitPriceKopecks).toString(),
    priority: input.priority,
    specificity: 0,
    validFrom,
    validUntil,
    conditions: {},
    explanation: required(input.explanation, 500),
    isActive: input.isActive
  };
}

function mutationResult(
  result:
    | { readonly status: "created" | "updated"; readonly lockVersion: number }
    | { readonly status: CatalogFailure },
  eventId: string,
  resourceId: string,
  audit: AdminEventAuditContext
): AdminEventCatalogMutationResult {
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
  if (result.status === "product_not_found") {
    throw new AdminEventProductNotFoundError();
  }
  if (result.status === "pricing_rule_not_found") {
    throw new AdminEventPricingRuleNotFoundError();
  }
  if (result.status === "product_code_conflict") {
    throw new AdminEventProductCodeConflictError();
  }
  if (result.status === "currency_mismatch") {
    throw new InvalidAdminEventMutationError();
  }
  throw new InvalidAdminEventMutationError();
}

function required(value: string, maximum: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new InvalidAdminEventMutationError();
  }
  return normalized;
}

function optional(value: string, maximum: number): string | null {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length > maximum) {
    throw new InvalidAdminEventMutationError();
  }
  return normalized;
}

function nullableDate(value: string | null): Date | null {
  if (value === null) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new InvalidAdminEventMutationError();
  }
  return parsed;
}

function integerBetween(value: number, minimum: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;
