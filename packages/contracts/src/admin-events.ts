export const ADMIN_EVENT_STATUSES = [
  "draft",
  "published",
  "sales_paused",
  "sold_out",
  "finished",
  "archived"
] as const;

export type AdminEventStatus = typeof ADMIN_EVENT_STATUSES[number];

export const ADMIN_PRODUCT_TYPES = [
  "adult_standard",
  "adult_vip",
  "child",
  "family_standard",
  "family_vip",
  "custom"
] as const;

export type AdminProductType = typeof ADMIN_PRODUCT_TYPES[number];

export const ADMIN_EVENT_CONTENT_BLOCK_TYPES = [
  "hero",
  "description",
  "program",
  "faq",
  "contacts",
  "media",
  "custom"
] as const;

export type AdminEventContentBlockType =
  typeof ADMIN_EVENT_CONTENT_BLOCK_TYPES[number];

export const ADMIN_OFFER_SOURCE_TYPES = [
  "google_docs",
  "upload",
  "html"
] as const;

export type AdminOfferSourceType = typeof ADMIN_OFFER_SOURCE_TYPES[number];

export const ADMIN_SCENARIO_NODE_TYPES = [
  "start",
  "message",
  "media",
  "menu",
  "choice",
  "text_input",
  "number_input",
  "phone_request",
  "condition",
  "set_status",
  "add_category",
  "wallet_credit",
  "event_selector",
  "order_start",
  "order_add_item",
  "order_summary",
  "offer_acceptance",
  "payment_start",
  "survey_start",
  "support_request",
  "notification",
  "delay",
  "subflow",
  "end"
] as const;

export type AdminScenarioNodeType =
  typeof ADMIN_SCENARIO_NODE_TYPES[number];

export type AdminScenarioVersionStatus =
  "draft" | "validating" | "published" | "retired";

export interface AdminScenarioNode {
  readonly id: string;
  readonly type: AdminScenarioNodeType;
  readonly schemaVersion: number;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface AdminScenarioEdge {
  readonly id: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly label: string | null;
  readonly priority: number;
  readonly condition: Readonly<Record<string, unknown>>;
}

export interface AdminScenarioValidationIssue {
  readonly code: string;
  readonly message: string;
  readonly nodeId: string | null;
  readonly edgeId: string | null;
}

export interface AdminEventScenarioVersion {
  readonly id: string;
  readonly scenarioId: string;
  readonly scenarioTitle: string;
  readonly versionNumber: number;
  readonly status: AdminScenarioVersionStatus;
  readonly schemaVersion: number;
  readonly nodes: readonly AdminScenarioNode[];
  readonly edges: readonly AdminScenarioEdge[];
  readonly validationIssues: readonly AdminScenarioValidationIssue[];
  readonly createdByAdminId: string | null;
  readonly publishedByAdminId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly publishedAt: string | null;
}

export interface AdminEventSummary {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly status: AdminEventStatus;
  readonly timezone: string;
  readonly startsAt: string;
  readonly endsAt: string | null;
  readonly salesStartsAt: string | null;
  readonly salesEndsAt: string | null;
  readonly locationName: string | null;
  readonly capacity: number;
  readonly productCount: number;
  readonly activeProductCount: number;
  readonly orderCount: number;
  readonly paidOrderCount: number;
  readonly ticketCount: number;
  readonly reservedInventoryUnits: number;
  readonly consumedInventoryUnits: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AdminEventPricingRule {
  readonly id: string;
  readonly currency: string;
  readonly minimumQuantity: number;
  readonly maximumQuantity: number | null;
  readonly unitPriceKopecks: string;
  readonly priority: number;
  readonly specificity: number;
  readonly validFrom: string | null;
  readonly validUntil: string | null;
  readonly conditions: Readonly<Record<string, unknown>>;
  readonly explanation: string;
  readonly isActive: boolean;
}

export interface AdminEventProduct {
  readonly id: string;
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
  readonly reservedInventoryUnits: number;
  readonly consumedInventoryUnits: number;
  readonly pricingRules: readonly AdminEventPricingRule[];
}

export interface AdminEventContentBlock {
  readonly id: string;
  readonly blockType: AdminEventContentBlockType;
  readonly title: string | null;
  readonly contentSchemaVersion: number;
  readonly content: Readonly<Record<string, unknown>>;
  readonly sortOrder: number;
  readonly isVisible: boolean;
}

export interface AdminEventOfferVersion {
  readonly id: string;
  readonly offerDocumentId: string;
  readonly documentTitle: string;
  readonly sourceType: AdminOfferSourceType;
  readonly sourceUrl: string | null;
  readonly versionNumber: number;
  readonly publicUrl: string;
  readonly storagePath: string;
  readonly contentType: "application/pdf" | "text/html";
  readonly sha256: string;
  readonly publishedAt: string;
  readonly publishedByAdminId: string | null;
  readonly isActive: boolean;
  readonly sourceRevisionId: string | null;
  readonly displayTextSnapshot: string;
  readonly acceptanceCount: number;
}

export interface AdminEventDetail extends AdminEventSummary {
  readonly description: string;
  readonly locationAddress: string | null;
  readonly supportContact: string | null;
  readonly reservationTtlMinutes: number;
  readonly phoneRequiredForPurchase: boolean;
  readonly offerRequired: boolean;
  readonly publishedScenarioVersionId: string | null;
  readonly activeOfferVersionId: string | null;
  readonly publishedAt: string | null;
  readonly lockVersion: number;
  readonly contentBlocks: readonly AdminEventContentBlock[];
  readonly products: readonly AdminEventProduct[];
  readonly offerVersions: readonly AdminEventOfferVersion[];
  readonly scenarioVersions: readonly AdminEventScenarioVersion[];
  readonly activeOffer: {
    readonly id: string;
    readonly documentTitle: string;
    readonly versionNumber: number;
    readonly publicUrl: string;
    readonly contentType: string;
    readonly sha256: string;
    readonly publishedAt: string;
  } | null;
}

export interface AdminEventGeneralInput {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly timezone: string;
  readonly startsAt: string;
  readonly endsAt: string | null;
  readonly salesStartsAt: string | null;
  readonly salesEndsAt: string | null;
  readonly locationName: string | null;
  readonly locationAddress: string | null;
  readonly supportContact: string | null;
  readonly capacity: number;
  readonly reservationTtlMinutes: number;
  readonly phoneRequiredForPurchase: boolean;
  readonly offerRequired: boolean;
}

export interface CreateAdminEventRequest extends AdminEventGeneralInput {
  readonly reason: string;
}

export interface UpdateAdminEventGeneralRequest extends AdminEventGeneralInput {
  readonly expectedLockVersion: number;
  readonly reason: string;
}

export interface AdminEventMutationResult {
  readonly eventId: string;
  readonly status: "draft";
  readonly lockVersion: number;
  readonly updatedAt: string;
}

export type PublishAdminEventRequest = AdminEventCatalogMutationRequest;

export interface AdminEventPublicationResult {
  readonly eventId: string;
  readonly status: "published";
  readonly lockVersion: number;
  readonly publishedAt: string;
}

export interface AdminEventProductInput {
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

export interface AdminEventPricingRuleInput {
  readonly currency: string;
  readonly minimumQuantity: number;
  readonly maximumQuantity: number | null;
  readonly unitPriceKopecks: string;
  readonly priority: number;
  readonly validFrom: string | null;
  readonly validUntil: string | null;
  readonly explanation: string;
  readonly isActive: boolean;
}

export interface AdminEventCatalogMutationRequest {
  readonly expectedLockVersion: number;
  readonly reason: string;
}

export interface CreateAdminEventProductRequest
  extends AdminEventCatalogMutationRequest {
  readonly product: AdminEventProductInput;
}

export type UpdateAdminEventProductRequest = CreateAdminEventProductRequest;

export interface CreateAdminEventPricingRuleRequest
  extends AdminEventCatalogMutationRequest {
  readonly pricingRule: AdminEventPricingRuleInput;
}

export type UpdateAdminEventPricingRuleRequest =
  CreateAdminEventPricingRuleRequest;

export interface AdminEventCatalogMutationResult
  extends AdminEventMutationResult {
  readonly resourceId: string;
}

export interface AdminEventContentBlockInput {
  readonly blockType: AdminEventContentBlockType;
  readonly title: string | null;
  readonly content: Readonly<Record<string, unknown>>;
  readonly sortOrder: number;
  readonly isVisible: boolean;
}

export interface CreateAdminEventContentBlockRequest
  extends AdminEventCatalogMutationRequest {
  readonly contentBlock: AdminEventContentBlockInput;
}

export type UpdateAdminEventContentBlockRequest =
  CreateAdminEventContentBlockRequest;

export interface AdminEventContentMutationResult
  extends AdminEventMutationResult {
  readonly resourceId: string;
}

export interface PublishAdminEventOfferVersionRequest
  extends AdminEventCatalogMutationRequest {
  readonly offer: {
    readonly documentTitle: string;
    readonly sourceType: "google_docs" | "html";
    readonly sourceUrl: string | null;
    readonly sourceRevisionId: string | null;
    readonly displayTextSnapshot: string;
  };
}

export type DeactivateAdminEventOfferRequest =
  AdminEventCatalogMutationRequest;

export interface AdminEventOfferMutationResult
  extends AdminEventMutationResult {
  readonly resourceId: string;
}

export interface SaveAdminEventScenarioDraftRequest
  extends AdminEventCatalogMutationRequest {
  readonly scenario: {
    readonly title: string;
    readonly schemaVersion: number;
    readonly nodes: readonly AdminScenarioNode[];
    readonly edges: readonly AdminScenarioEdge[];
  };
}

export type PublishAdminEventScenarioVersionRequest =
  AdminEventCatalogMutationRequest;

export interface AdminEventScenarioMutationResult
  extends AdminEventMutationResult {
  readonly resourceId: string;
  readonly versionStatus: "draft" | "published";
  readonly validationIssues: readonly AdminScenarioValidationIssue[];
}
