import type {
  AdminOrderDetail,
  AdminOrderStatus,
  AdminOrderSummary,
  AdminUserDetail,
  AdminUserSummary,
  CursorPage
} from "@ticket-platform/contracts";
import type {
  OutreachCampaignContactDetail,
  OutreachCampaignContactPage,
  OutreachCampaignExport,
  OutreachCampaignStatus,
  OutreachCampaignSummary,
  OutreachChannel,
  OutreachContactStatus,
  OutreachImportResult,
  OutreachImportRow,
  OutreachLostReason,
  OutreachManager,
  OutreachPipelineStage,
  OutreachTaskType
} from "@ticket-platform/contracts/admin-outreach";
import type {
  AdminEventDetail,
  AdminEventCatalogMutationResult,
  AdminEventContentMutationResult,
  AdminEventMutationResult,
  AdminEventOfferMutationResult,
  AdminEventPublicationResult,
  AdminEventScenarioMutationResult,
  AdminEventStatus,
  AdminEventSummary,
  CreateAdminEventRequest,
  CreateAdminEventContentBlockRequest,
  CreateAdminEventPricingRuleRequest,
  CreateAdminEventProductRequest,
  DeactivateAdminEventOfferRequest,
  PublishAdminEventOfferVersionRequest,
  PublishAdminEventRequest,
  PublishAdminEventScenarioVersionRequest,
  SaveAdminEventScenarioDraftRequest,
  UpdateAdminEventContentBlockRequest,
  UpdateAdminEventGeneralRequest,
  UpdateAdminEventPricingRuleRequest,
  UpdateAdminEventProductRequest
} from "@ticket-platform/contracts/admin-events";

export interface UserListFilters {
  readonly search?: string;
  readonly blocked?: boolean;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface OrderListFilters {
  readonly search?: string;
  readonly status?: AdminOrderStatus;
  readonly userId?: string;
  readonly eventId?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface EventListFilters {
  readonly search?: string;
  readonly status?: AdminEventStatus;
  readonly cursor?: string;
  readonly limit?: number;
}

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export function listUsers(
  filters: UserListFilters,
  signal?: AbortSignal
): Promise<CursorPage<AdminUserSummary>> {
  return requestAdminApi(buildAdminApiPath("users", filters), signal);
}

export function getUser(
  userId: string,
  signal?: AbortSignal
): Promise<AdminUserDetail> {
  return requestAdminApi(`users/${encodeURIComponent(userId)}`, signal);
}

export function listOutreachCampaigns(
  signal?: AbortSignal
): Promise<readonly OutreachCampaignSummary[]> {
  return requestAdminApi("outreach/campaigns", signal);
}

export function createOutreachCampaign(input: {
  readonly name: string;
  readonly description?: string;
}): Promise<OutreachCampaignSummary> {
  return requestAdminMutation("outreach/campaigns", "POST", input);
}

export function getOutreachCampaign(
  campaignId: string,
  signal?: AbortSignal
): Promise<OutreachCampaignSummary> {
  return requestAdminApi(
    `outreach/campaigns/${encodeURIComponent(campaignId)}`,
    signal
  );
}

export function updateOutreachCampaign(
  campaignId: string,
  input: {
    readonly name?: string;
    readonly description?: string | null;
    readonly status?: OutreachCampaignStatus;
  }
): Promise<OutreachCampaignSummary> {
  return requestAdminMutation(
    `outreach/campaigns/${encodeURIComponent(campaignId)}`,
    "PATCH",
    input
  );
}

export interface OutreachContactFilters {
  readonly search?: string;
  readonly status?: OutreachContactStatus;
  readonly stage?: OutreachPipelineStage;
  readonly assignedAdminId?: string;
  readonly mine?: boolean;
  readonly page?: number;
  readonly limit?: number;
}

export function listOutreachContacts(
  campaignId: string,
  filters: OutreachContactFilters,
  signal?: AbortSignal
): Promise<OutreachCampaignContactPage> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") {
      query.set(key, String(value));
    }
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return requestAdminApi(
    `outreach/campaigns/${encodeURIComponent(campaignId)}/contacts${suffix}`,
    signal
  );
}

export function getOutreachContact(
  campaignContactId: string,
  signal?: AbortSignal
): Promise<OutreachCampaignContactDetail> {
  return requestAdminApi(
    `outreach/campaign-contacts/${encodeURIComponent(campaignContactId)}`,
    signal
  );
}

export function listOutreachManagers(
  signal?: AbortSignal
): Promise<readonly OutreachManager[]> {
  return requestAdminApi("outreach/managers", signal);
}

export function importOutreachContacts(
  campaignId: string,
  input: {
    readonly assignedAdminId?: string;
    readonly rows: readonly OutreachImportRow[];
  }
): Promise<OutreachImportResult> {
  return requestAdminMutation(
    `outreach/campaigns/${encodeURIComponent(campaignId)}/import`,
    "POST",
    input
  );
}

export function recordOutreachActivities(input: {
  readonly campaignContactIds: readonly string[];
  readonly channel: OutreachChannel;
  readonly result: Exclude<OutreachContactStatus, "new">;
  readonly stage?: OutreachPipelineStage;
  readonly lostReason?: OutreachLostReason;
  readonly note?: string;
  readonly nextContactAt?: string;
}): Promise<{ readonly recorded: number }> {
  return requestAdminMutation(
    "outreach/campaign-contacts/activities",
    "POST",
    input
  );
}

export function updateOutreachContactStage(
  campaignContactId: string,
  input: {
    readonly stage: OutreachPipelineStage;
    readonly lostReason?: OutreachLostReason;
  }
): Promise<{ readonly updated: boolean }> {
  return requestAdminMutation(
    `outreach/campaign-contacts/${encodeURIComponent(campaignContactId)}/stage`,
    "PATCH",
    input
  );
}

export function createOutreachTask(
  campaignContactId: string,
  input: {
    readonly assignedAdminId?: string;
    readonly type: OutreachTaskType;
    readonly text: string;
    readonly dueAt: string;
  }
): Promise<{ readonly created: boolean }> {
  return requestAdminMutation(
    `outreach/campaign-contacts/${encodeURIComponent(campaignContactId)}/tasks`,
    "POST",
    input
  );
}

export function completeOutreachTask(
  taskId: string
): Promise<{ readonly completed: boolean }> {
  return requestAdminMutation(
    `outreach/tasks/${encodeURIComponent(taskId)}/complete`,
    "PATCH",
    {}
  );
}

export function assignOutreachContacts(input: {
  readonly campaignContactIds: readonly string[];
  readonly assignedAdminId: string;
}): Promise<{ readonly updated: number }> {
  return requestAdminMutation(
    "outreach/campaign-contacts/assign",
    "POST",
    input
  );
}

export function exportOutreachCampaign(
  campaignId: string
): Promise<OutreachCampaignExport> {
  return requestAdminApi(
    `outreach/campaigns/${encodeURIComponent(campaignId)}/export`
  );
}

export function listOrders(
  filters: OrderListFilters,
  signal?: AbortSignal
): Promise<CursorPage<AdminOrderSummary>> {
  return requestAdminApi(buildAdminApiPath("orders", filters), signal);
}

export function getOrder(
  orderId: string,
  signal?: AbortSignal
): Promise<AdminOrderDetail> {
  return requestAdminApi(`orders/${encodeURIComponent(orderId)}`, signal);
}

export function listEvents(
  filters: EventListFilters,
  signal?: AbortSignal
): Promise<CursorPage<AdminEventSummary>> {
  return requestAdminApi(buildAdminApiPath("events", filters), signal);
}

export function getEvent(
  eventId: string,
  signal?: AbortSignal
): Promise<AdminEventDetail> {
  return requestAdminApi(`events/${encodeURIComponent(eventId)}`, signal);
}

export function createEvent(
  input: CreateAdminEventRequest
): Promise<AdminEventMutationResult> {
  return requestAdminMutation("events", "POST", input);
}

export function updateEventGeneral(
  eventId: string,
  input: UpdateAdminEventGeneralRequest
): Promise<AdminEventMutationResult> {
  return requestAdminMutation(
    `events/${encodeURIComponent(eventId)}/general`,
    "PATCH",
    input
  );
}

export function publishEvent(
  eventId: string,
  input: PublishAdminEventRequest
): Promise<AdminEventPublicationResult> {
  return requestAdminMutation(
    `events/${encodeURIComponent(eventId)}/publish`,
    "POST",
    input
  );
}

export function createEventContentBlock(
  eventId: string,
  input: CreateAdminEventContentBlockRequest
): Promise<AdminEventContentMutationResult> {
  return requestAdminMutation(
    `events/${encodeURIComponent(eventId)}/content-blocks`,
    "POST",
    input
  );
}

export function updateEventContentBlock(
  eventId: string,
  contentBlockId: string,
  input: UpdateAdminEventContentBlockRequest
): Promise<AdminEventContentMutationResult> {
  return requestAdminMutation(
    `events/${encodeURIComponent(eventId)}/content-blocks/${encodeURIComponent(contentBlockId)}`,
    "PATCH",
    input
  );
}

export function publishEventOfferVersion(
  eventId: string,
  input: PublishAdminEventOfferVersionRequest
): Promise<AdminEventOfferMutationResult> {
  return requestAdminMutation(
    `events/${encodeURIComponent(eventId)}/offer-versions`,
    "POST",
    input
  );
}

export function deactivateEventOffer(
  eventId: string,
  input: DeactivateAdminEventOfferRequest
): Promise<AdminEventOfferMutationResult> {
  return requestAdminMutation(
    `events/${encodeURIComponent(eventId)}/offer/deactivate`,
    "PATCH",
    input
  );
}

export function saveEventScenarioDraft(
  eventId: string,
  input: SaveAdminEventScenarioDraftRequest
): Promise<AdminEventScenarioMutationResult> {
  return requestAdminMutation(
    `events/${encodeURIComponent(eventId)}/scenario-drafts`,
    "POST",
    input
  );
}

export function publishEventScenarioVersion(
  eventId: string,
  scenarioVersionId: string,
  input: PublishAdminEventScenarioVersionRequest
): Promise<AdminEventScenarioMutationResult> {
  return requestAdminMutation(
    `events/${encodeURIComponent(eventId)}/scenario-versions/${encodeURIComponent(scenarioVersionId)}/publish`,
    "POST",
    input
  );
}

export function createEventProduct(
  eventId: string,
  input: CreateAdminEventProductRequest
): Promise<AdminEventCatalogMutationResult> {
  return requestAdminMutation(
    `events/${encodeURIComponent(eventId)}/products`,
    "POST",
    input
  );
}

export function updateEventProduct(
  eventId: string,
  productId: string,
  input: UpdateAdminEventProductRequest
): Promise<AdminEventCatalogMutationResult> {
  return requestAdminMutation(
    `events/${encodeURIComponent(eventId)}/products/${encodeURIComponent(productId)}`,
    "PATCH",
    input
  );
}

export function createEventPricingRule(
  eventId: string,
  productId: string,
  input: CreateAdminEventPricingRuleRequest
): Promise<AdminEventCatalogMutationResult> {
  return requestAdminMutation(
    `events/${encodeURIComponent(eventId)}/products/${encodeURIComponent(productId)}/pricing-rules`,
    "POST",
    input
  );
}

export function updateEventPricingRule(
  eventId: string,
  productId: string,
  pricingRuleId: string,
  input: UpdateAdminEventPricingRuleRequest
): Promise<AdminEventCatalogMutationResult> {
  return requestAdminMutation(
    `events/${encodeURIComponent(eventId)}/products/${encodeURIComponent(productId)}/pricing-rules/${encodeURIComponent(pricingRuleId)}`,
    "PATCH",
    input
  );
}

export function buildAdminApiPath(
  resource: "users" | "orders" | "events",
  filters: UserListFilters | OrderListFilters | EventListFilters
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") {
      query.set(key, String(value));
    }
  }
  const encoded = query.toString();
  return encoded ? `${resource}?${encoded}` : resource;
}

async function requestAdminApi<T>(
  path: string,
  signal?: AbortSignal
): Promise<T> {
  const response = await fetch(`/admin-api/${path}`, {
    method: "GET",
    cache: "no-store",
    headers: { accept: "application/json" },
    ...(signal ? { signal } : {})
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const problem = readProblem(body);
    throw new AdminApiError(
      response.status,
      problem.code,
      problem.title
    );
  }
  return body as T;
}

async function requestAdminMutation<T>(
  path: string,
  method: "POST" | "PATCH",
  input: unknown
): Promise<T> {
  const response = await fetch(`/admin-api/${path}`, {
    method,
    cache: "no-store",
    headers: {
      accept: "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify(input)
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const problem = readProblem(body);
    throw new AdminApiError(response.status, problem.code, problem.title);
  }
  return body as T;
}

function readProblem(value: unknown): { readonly code: string; readonly title: string } {
  if (typeof value !== "object" || value === null) {
    return {
      code: "ADMIN_API_ERROR",
      title: "Не удалось выполнить запрос"
    };
  }
  const record = value as Record<string, unknown>;
  return {
    code: typeof record.code === "string" ? record.code : "ADMIN_API_ERROR",
    title:
      typeof record.title === "string"
        ? record.title
        : "Не удалось выполнить запрос"
  };
}
