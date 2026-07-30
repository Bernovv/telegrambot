import type {
  AdminOrderDetail,
  AdminOrderStatus,
  AdminOrderSummary,
  AdminUserDetail,
  AdminUserSummary,
  CursorPage
} from "@ticket-platform/contracts";
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
import type {
  AdminUserCategoryDefinition,
  AdminUserClassificationCatalog,
  AdminUserClassificationMutationResult,
  AdminUserStatusDefinition,
  CreateAdminUserCategoryRequest,
  CreateAdminUserStatusRequest,
  AssignAdminUserClassificationRequest,
  RemoveAdminUserClassificationRequest,
  UpdateAdminUserCategoryRequest,
  UpdateAdminUserStatusRequest
} from "@ticket-platform/contracts/admin-user-classification";
import type {
  AdminSavedSegment,
  AdminSavedSegmentSummary,
  AdminSegmentAudienceSnapshot,
  AdminSegmentAudienceSnapshotSummary,
  AdminSegmentPreview,
  CreateAdminSavedSegmentRequest,
  PublishAdminSavedSegmentRequest,
  PreviewAdminSegmentRequest,
  RequestAdminSegmentAudienceSnapshotRequest,
  UpdateAdminSavedSegmentDraftRequest
} from "@ticket-platform/contracts/admin-segments";
import type {
  AdminBroadcast,
  AdminBroadcastSummary,
  AdminBroadcastTestDelivery,
  ControlAdminBroadcastRequest,
  CreateAdminBroadcastRequest,
  PublishAdminBroadcastDraftRequest,
  RequestAdminBroadcastTestSendRequest,
  ScheduleAdminBroadcastRequest,
  UpdateAdminBroadcastDraftRequest
} from "@ticket-platform/contracts/admin-broadcasts";
import type {
  AnalyzeAdminUserImportRequest,
  AnalyzeAdminUserImportResponse,
  AdminUserImportMatchRowPage,
  CreateAdminUserImportPreviewRequest,
  CreateAdminUserImportPreviewResponse,
  DecideAdminUserImportRowRequest,
  DecideAdminUserImportRowResponse
} from "@ticket-platform/contracts/admin-imports";

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

export function previewAdminUserImport(
  input: CreateAdminUserImportPreviewRequest
): Promise<CreateAdminUserImportPreviewResponse> {
  return requestAdminMutation("imports/users/preview", "POST", input);
}

export function analyzeAdminUserImport(
  batchId: string,
  input: AnalyzeAdminUserImportRequest
): Promise<AnalyzeAdminUserImportResponse> {
  return requestAdminMutation(
    `imports/users/${encodeURIComponent(batchId)}/analyze`,
    "POST",
    input
  );
}

export function decideAdminUserImportRow(
  analysisId: string,
  rowNumber: number,
  input: DecideAdminUserImportRowRequest
): Promise<DecideAdminUserImportRowResponse> {
  return requestAdminMutation(
    `imports/users/analyses/${encodeURIComponent(analysisId)}`
      + `/rows/${rowNumber}/decision`,
    "POST",
    input
  );
}

export function listAdminUserImportRows(
  analysisId: string,
  afterRowNumber: number,
  signal?: AbortSignal
): Promise<AdminUserImportMatchRowPage> {
  const query = new URLSearchParams({
    afterRowNumber: String(afterRowNumber),
    limit: "200"
  });
  return requestAdminApi(
    `imports/users/analyses/${encodeURIComponent(analysisId)}`
      + `/rows?${query.toString()}`,
    signal
  );
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

export function getUserClassificationCatalog(
  signal?: AbortSignal
): Promise<AdminUserClassificationCatalog> {
  return requestAdminApi("classification", signal);
}

export function createUserStatus(
  input: CreateAdminUserStatusRequest
): Promise<AdminUserStatusDefinition> {
  return requestAdminMutation("classification/statuses", "POST", input);
}

export function updateUserStatus(
  statusId: string,
  input: UpdateAdminUserStatusRequest
): Promise<AdminUserStatusDefinition> {
  return requestAdminMutation(
    `classification/statuses/${encodeURIComponent(statusId)}`,
    "PATCH",
    input
  );
}

export function createUserCategory(
  input: CreateAdminUserCategoryRequest
): Promise<AdminUserCategoryDefinition> {
  return requestAdminMutation("classification/categories", "POST", input);
}

export function updateUserCategory(
  categoryId: string,
  input: UpdateAdminUserCategoryRequest
): Promise<AdminUserCategoryDefinition> {
  return requestAdminMutation(
    `classification/categories/${encodeURIComponent(categoryId)}`,
    "PATCH",
    input
  );
}

export function assignUserStatus(
  userId: string,
  input: AssignAdminUserClassificationRequest
): Promise<AdminUserClassificationMutationResult> {
  return requestAdminMutation(
    `users/${encodeURIComponent(userId)}/classification/statuses`,
    "POST",
    input
  );
}

export function assignUserCategory(
  userId: string,
  input: AssignAdminUserClassificationRequest
): Promise<AdminUserClassificationMutationResult> {
  return requestAdminMutation(
    `users/${encodeURIComponent(userId)}/classification/categories`,
    "POST",
    input
  );
}

export function removeUserStatus(
  userId: string,
  code: string,
  input: RemoveAdminUserClassificationRequest
): Promise<AdminUserClassificationMutationResult> {
  return requestAdminMutation(
    `users/${encodeURIComponent(userId)}/classification/statuses/${encodeURIComponent(code)}/remove`,
    "POST",
    input
  );
}

export function removeUserCategory(
  userId: string,
  code: string,
  input: RemoveAdminUserClassificationRequest
): Promise<AdminUserClassificationMutationResult> {
  return requestAdminMutation(
    `users/${encodeURIComponent(userId)}/classification/categories/${encodeURIComponent(code)}/remove`,
    "POST",
    input
  );
}

export function previewAdminSegment(
  input: PreviewAdminSegmentRequest
): Promise<AdminSegmentPreview> {
  return requestAdminMutation("segments/preview", "POST", input);
}

export function listAdminSavedSegments(
  signal?: AbortSignal
): Promise<readonly AdminSavedSegmentSummary[]> {
  return requestAdminApi("segments", signal);
}

export function getAdminSavedSegment(
  segmentId: string,
  signal?: AbortSignal
): Promise<AdminSavedSegment> {
  return requestAdminApi(
    `segments/${encodeURIComponent(segmentId)}`,
    signal
  );
}

export function createAdminSavedSegment(
  input: CreateAdminSavedSegmentRequest
): Promise<AdminSavedSegment> {
  return requestAdminMutation("segments", "POST", input);
}

export function updateAdminSavedSegmentDraft(
  segmentId: string,
  input: UpdateAdminSavedSegmentDraftRequest
): Promise<AdminSavedSegment> {
  return requestAdminMutation(
    `segments/${encodeURIComponent(segmentId)}/draft`,
    "PATCH",
    input
  );
}

export function publishAdminSavedSegment(
  segmentId: string,
  input: PublishAdminSavedSegmentRequest
): Promise<AdminSavedSegment> {
  return requestAdminMutation(
    `segments/${encodeURIComponent(segmentId)}/publish`,
    "POST",
    input
  );
}

export function listAdminSegmentAudienceSnapshots(
  segmentId: string,
  signal?: AbortSignal
): Promise<readonly AdminSegmentAudienceSnapshotSummary[]> {
  return requestAdminApi(
    `segments/${encodeURIComponent(segmentId)}/audience-snapshots`,
    signal
  );
}

export function getAdminSegmentAudienceSnapshot(
  segmentId: string,
  snapshotId: string,
  signal?: AbortSignal
): Promise<AdminSegmentAudienceSnapshot> {
  return requestAdminApi(
    `segments/${encodeURIComponent(segmentId)}/audience-snapshots/${encodeURIComponent(snapshotId)}`,
    signal
  );
}

export function requestAdminSegmentAudienceSnapshot(
  segmentId: string,
  input: RequestAdminSegmentAudienceSnapshotRequest
): Promise<AdminSegmentAudienceSnapshotSummary> {
  return requestAdminMutation(
    `segments/${encodeURIComponent(segmentId)}/audience-snapshots`,
    "POST",
    input
  );
}

export function listAdminBroadcasts(
  signal?: AbortSignal
): Promise<readonly AdminBroadcastSummary[]> {
  return requestAdminApi("broadcasts", signal);
}

export function getAdminBroadcast(
  broadcastId: string,
  signal?: AbortSignal
): Promise<AdminBroadcast> {
  return requestAdminApi(
    `broadcasts/${encodeURIComponent(broadcastId)}`,
    signal
  );
}

export function createAdminBroadcast(
  input: CreateAdminBroadcastRequest
): Promise<AdminBroadcast> {
  return requestAdminMutation("broadcasts", "POST", input);
}

export function updateAdminBroadcastDraft(
  broadcastId: string,
  input: UpdateAdminBroadcastDraftRequest
): Promise<AdminBroadcast> {
  return requestAdminMutation(
    `broadcasts/${encodeURIComponent(broadcastId)}/draft`,
    "PATCH",
    input
  );
}

export function publishAdminBroadcastDraft(
  broadcastId: string,
  input: PublishAdminBroadcastDraftRequest
): Promise<AdminBroadcast> {
  return requestAdminMutation(
    `broadcasts/${encodeURIComponent(broadcastId)}/publish`,
    "POST",
    input
  );
}

export function scheduleAdminBroadcast(
  broadcastId: string,
  input: ScheduleAdminBroadcastRequest
): Promise<AdminBroadcast> {
  return requestAdminMutation(
    `broadcasts/${encodeURIComponent(broadcastId)}/schedule`,
    "POST",
    input
  );
}

export function pauseAdminBroadcast(
  broadcastId: string,
  input: ControlAdminBroadcastRequest
): Promise<AdminBroadcast> {
  return controlAdminBroadcast(broadcastId, "pause", input);
}

export function resumeAdminBroadcast(
  broadcastId: string,
  input: ControlAdminBroadcastRequest
): Promise<AdminBroadcast> {
  return controlAdminBroadcast(broadcastId, "resume", input);
}

export function cancelAdminBroadcast(
  broadcastId: string,
  input: ControlAdminBroadcastRequest
): Promise<AdminBroadcast> {
  return controlAdminBroadcast(broadcastId, "cancel", input);
}

export function requestAdminBroadcastTestSend(
  broadcastId: string,
  input: RequestAdminBroadcastTestSendRequest
): Promise<AdminBroadcastTestDelivery> {
  return requestAdminMutation(
    `broadcasts/${encodeURIComponent(broadcastId)}/test-send`,
    "POST",
    input
  );
}

function controlAdminBroadcast(
  broadcastId: string,
  action: "pause" | "resume" | "cancel",
  input: ControlAdminBroadcastRequest
): Promise<AdminBroadcast> {
  return requestAdminMutation(
    `broadcasts/${encodeURIComponent(broadcastId)}/${action}`,
    "POST",
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
