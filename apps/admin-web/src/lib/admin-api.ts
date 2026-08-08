import type {
  AdminOrderDetail,
  AdminOrderStatus,
  AdminOrderSummary,
  AdminUserDetail,
  AdminUserSummary,
  ConfirmAdminManualPaymentRequest,
  ConfirmAdminManualPaymentResult,
  AdminBroadcastAudienceFilters,
  AdminBroadcastAudienceResult,
  AdminBroadcastListResult,
  CreateAdminBroadcastRequest,
  CreateAdminBroadcastResult,
  UploadAdminBroadcastImageRequest,
  UploadAdminBroadcastImageResult,
  CursorPage,
  RequestAdminFullRefundRequest,
  RequestAdminFullRefundResult
} from "@ticket-platform/contracts";
import type {
  OutreachCampaignContactDetail,
  OutreachCampaignContactPage,
  OutreachCampaignExport,
  OutreachCampaignStatus,
  OutreachCampaignSummary,
  OutreachChannel,
  AddExistingContactsResult,
  ImportEventParticipantsResult,
  MoveOutreachContactsResult,
  OutreachBaseContact,
  OutreachContactStatus,
  OutreachCustomFieldDefinition,
  OutreachCustomFieldType,
  OutreachImportResult,
  OutreachImportRow,
  OutreachLostReason,
  OutreachManager,
  OutreachPipelineColumn,
  OutreachPipelineStage,
  OutreachTaskBoardItem,
  OutreachTaskType
} from "@ticket-platform/contracts/admin-outreach";

// A column not yet saved has no stage id: the server assigns one on create.
export type OutreachPipelineColumnDraft = Omit<OutreachPipelineColumn, "stage" | "position"> & {
  readonly stage?: OutreachPipelineStage;
};
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
  AccommodationSummary,
  CreateEventParticipantFieldRequest,
  CreateEventParticipantRequest,
  UpdateEventParticipantRequest
} from "@ticket-platform/contracts/admin-accommodation";
import type {
  EventParticipantsView,
  SaveParticipantAnswerRequest
} from "@ticket-platform/contracts/admin-participants";
import type {
  CancelEventExpenseRequest,
  CreateEventExpenseRequest,
  CreateVendorRequest,
  EventExpensesView,
  UpdateEventExpenseRequest
} from "@ticket-platform/contracts/admin-expenses";

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
  readonly includeExcluded?: boolean;
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

export function getAccommodationSummary(
  eventId: string,
  signal?: AbortSignal
): Promise<AccommodationSummary> {
  return requestAdminApi(
    `events/${encodeURIComponent(eventId)}/accommodation`,
    signal
  );
}

export function getEventParticipants(
  eventId: string,
  signal?: AbortSignal
): Promise<EventParticipantsView> {
  return requestAdminApi(
    `events/${encodeURIComponent(eventId)}/participants`,
    signal
  );
}

/**
 * Один ответ бумажной анкеты. Сохраняется по полю, а не формой целиком: анкеты вносят
 * стопкой, и обрыв связи не должен стоить получаса работы.
 */
export function saveParticipantAnswer(
  eventId: string,
  input: SaveParticipantAnswerRequest
): Promise<{ readonly saved: boolean }> {
  return requestAdminMutation(
    `events/${encodeURIComponent(eventId)}/participants/answers`,
    "POST",
    input
  );
}

export function getEventExpenses(
  eventId: string,
  signal?: AbortSignal
): Promise<EventExpensesView> {
  return requestAdminApi(
    `events/${encodeURIComponent(eventId)}/expenses`,
    signal
  );
}

export function addVendor(
  input: CreateVendorRequest
): Promise<{ readonly added: boolean }> {
  return requestAdminMutation("vendors", "POST", input);
}

export function addEventExpense(
  eventId: string,
  input: CreateEventExpenseRequest
): Promise<{ readonly added: boolean }> {
  return requestAdminMutation(
    `events/${encodeURIComponent(eventId)}/expenses`,
    "POST",
    input
  );
}

export function updateEventExpense(
  eventId: string,
  input: UpdateEventExpenseRequest
): Promise<{ readonly updated: boolean }> {
  return requestAdminMutation(
    `events/${encodeURIComponent(eventId)}/expenses/update`,
    "POST",
    input
  );
}

export function cancelEventExpense(
  eventId: string,
  input: CancelEventExpenseRequest
): Promise<{ readonly cancelled: boolean }> {
  return requestAdminMutation(
    `events/${encodeURIComponent(eventId)}/expenses/cancel`,
    "POST",
    input
  );
}

export function mergeAccommodationParties(input: {
  readonly eventId: string;
  readonly orderIds: readonly string[];
  readonly note?: string;
}): Promise<{ readonly merged: boolean }> {
  return requestAdminMutation(
    `events/${encodeURIComponent(input.eventId)}/accommodation/groups`,
    "POST",
    {
      orderIds: input.orderIds,
      ...(input.note ? { note: input.note } : {})
    }
  );
}

export function splitAccommodationGroup(input: {
  readonly eventId: string;
  readonly groupId: string;
}): Promise<{ readonly split: boolean }> {
  return requestAdminMutation(
    `events/${encodeURIComponent(input.eventId)}/accommodation/groups/split`,
    "POST",
    { groupId: input.groupId }
  );
}

export function fixAccommodationPlan(input: {
  readonly eventId: string;
  readonly note?: string;
}): Promise<AccommodationSummary> {
  return requestAdminMutation(
    `events/${encodeURIComponent(input.eventId)}/accommodation/plans`,
    "POST",
    input.note ? { note: input.note } : {}
  );
}

export function addEventParticipant(
  eventId: string,
  input: CreateEventParticipantRequest
): Promise<{ readonly added: boolean }> {
  return requestAdminMutation(
    `events/${encodeURIComponent(eventId)}/participants`,
    "POST",
    input
  );
}

export function updateEventParticipant(
  eventId: string,
  input: UpdateEventParticipantRequest
): Promise<{ readonly updated: boolean }> {
  return requestAdminMutation(
    `events/${encodeURIComponent(eventId)}/participants/update`,
    "POST",
    input
  );
}

export function addEventParticipantField(
  eventId: string,
  input: CreateEventParticipantFieldRequest
): Promise<{ readonly added: boolean }> {
  return requestAdminMutation(
    `events/${encodeURIComponent(eventId)}/participant-fields`,
    "POST",
    input
  );
}

export function removeEventParticipantField(input: {
  readonly eventId: string;
  readonly fieldId: string;
}): Promise<{ readonly removed: boolean }> {
  return requestAdminMutation(
    `events/${encodeURIComponent(input.eventId)}/participant-fields/delete`,
    "POST",
    { fieldId: input.fieldId }
  );
}

export function setEventParticipantFieldValue(input: {
  readonly eventId: string;
  readonly participantId: string;
  readonly fieldId: string;
  readonly value: string | null;
}): Promise<{ readonly saved: boolean }> {
  return requestAdminMutation(
    `events/${encodeURIComponent(input.eventId)}/participant-fields/value`,
    "POST",
    {
      participantId: input.participantId,
      fieldId: input.fieldId,
      value: input.value
    }
  );
}

export function removeEventParticipant(input: {
  readonly eventId: string;
  readonly participantId: string;
  readonly reason: string;
}): Promise<{ readonly removed: boolean }> {
  return requestAdminMutation(
    `events/${encodeURIComponent(input.eventId)}/participants/remove`,
    "POST",
    { participantId: input.participantId, reason: input.reason }
  );
}

export function excludeOrderFromReports(input: {
  readonly orderId: string;
  readonly reason: string;
}): Promise<{ readonly excluded: boolean }> {
  return requestAdminMutation(
    `orders/${encodeURIComponent(input.orderId)}/exclude`,
    "POST",
    { reason: input.reason }
  );
}

export function includeOrderInReports(
  orderId: string
): Promise<{ readonly included: boolean }> {
  return requestAdminMutation(
    `orders/${encodeURIComponent(orderId)}/include`,
    "POST",
    {}
  );
}

export function listOutreachCampaigns(
  signal?: AbortSignal,
  includeArchived = false
): Promise<readonly OutreachCampaignSummary[]> {
  return requestAdminApi(
    includeArchived ? "outreach/campaigns?includeArchived=true" : "outreach/campaigns",
    signal
  );
}

export function archiveOutreachCampaign(
  campaignId: string
): Promise<{ readonly archived: boolean }> {
  return requestAdminMutation(
    `outreach/campaigns/${encodeURIComponent(campaignId)}/archive`,
    "POST",
    {}
  );
}

export function restoreOutreachCampaign(
  campaignId: string
): Promise<{ readonly restored: boolean }> {
  return requestAdminMutation(
    `outreach/campaigns/${encodeURIComponent(campaignId)}/restore`,
    "POST",
    {}
  );
}

export function importEventParticipantsIntoCampaign(
  campaignId: string
): Promise<ImportEventParticipantsResult> {
  return requestAdminMutation(
    `outreach/campaigns/${encodeURIComponent(campaignId)}/import-participants`,
    "POST",
    {}
  );
}

export function listOutreachBaseContacts(
  input: {
    readonly campaignId: string;
    readonly search?: string;
    readonly onlyMissing?: boolean;
    readonly limit?: number;
  },
  signal?: AbortSignal
): Promise<readonly OutreachBaseContact[]> {
  const query = new URLSearchParams({ campaignId: input.campaignId });
  if (input.search) {
    query.set("search", input.search);
  }
  if (input.onlyMissing === false) {
    query.set("onlyMissing", "false");
  }
  if (input.limit !== undefined) {
    query.set("limit", String(input.limit));
  }
  return requestAdminApi(`outreach/contacts?${query.toString()}`, signal);
}

export function addExistingContactsToCampaign(input: {
  readonly campaignId: string;
  readonly contactIds: readonly string[];
}): Promise<AddExistingContactsResult> {
  return requestAdminMutation(
    `outreach/campaigns/${encodeURIComponent(input.campaignId)}/contacts/add`,
    "POST",
    { contactIds: input.contactIds }
  );
}

export function removeOutreachContacts(input: {
  readonly campaignId: string;
  readonly campaignContactIds: readonly string[];
}): Promise<{ readonly removed: number }> {
  return requestAdminMutation(
    `outreach/campaigns/${encodeURIComponent(input.campaignId)}/contacts/remove`,
    "POST",
    { campaignContactIds: input.campaignContactIds }
  );
}

export function cancelOrder(input: {
  readonly orderId: string;
  readonly reason: string;
}): Promise<{
  readonly orderNumber: string;
  readonly walletReleasedKopecks: string;
}> {
  return requestAdminMutation(
    `orders/${encodeURIComponent(input.orderId)}/cancel`,
    "POST",
    { reason: input.reason }
  );
}

export function moveOutreachContacts(input: {
  readonly campaignContactIds: readonly string[];
  readonly targetCampaignId: string;
}): Promise<MoveOutreachContactsResult> {
  return requestAdminMutation(
    "outreach/campaign-contacts/move",
    "POST",
    input
  );
}

export function createOutreachCampaign(input: {
  readonly name: string;
  readonly description?: string;
  readonly eventId?: string;
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
    readonly eventId?: string | null;
  }
): Promise<OutreachCampaignSummary> {
  return requestAdminMutation(
    `outreach/campaigns/${encodeURIComponent(campaignId)}`,
    "PATCH",
    input
  );
}

export function listOutreachPipelineColumns(
  campaignId: string,
  signal?: AbortSignal
): Promise<readonly OutreachPipelineColumn[]> {
  return requestAdminApi(
    `outreach/campaigns/${encodeURIComponent(campaignId)}/pipeline`,
    signal
  );
}

export function updateOutreachPipelineColumns(
  campaignId: string,
  columns: readonly OutreachPipelineColumnDraft[]
): Promise<{ readonly updated: boolean }> {
  return requestAdminMutation(
    `outreach/campaigns/${encodeURIComponent(campaignId)}/pipeline`,
    "PATCH",
    { columns }
  );
}

export function listOutreachCustomFieldDefinitions(
  campaignId: string,
  signal?: AbortSignal
): Promise<readonly OutreachCustomFieldDefinition[]> {
  return requestAdminApi(
    `outreach/campaigns/${encodeURIComponent(campaignId)}/custom-fields`,
    signal
  );
}

export function createOutreachCustomFieldDefinition(input: {
  readonly campaignId?: string;
  readonly label: string;
  readonly type: OutreachCustomFieldType;
  readonly options?: readonly string[];
}): Promise<OutreachCustomFieldDefinition> {
  return requestAdminMutation("outreach/custom-fields", "POST", input);
}

export function deleteOutreachCustomFieldDefinition(
  fieldId: string
): Promise<{ readonly deleted: boolean }> {
  return requestAdminMutation(
    `outreach/custom-fields/${encodeURIComponent(fieldId)}/delete`,
    "POST",
    {}
  );
}

export function setOutreachCustomFieldValue(
  campaignContactId: string,
  fieldId: string,
  value: string | null
): Promise<{ readonly updated: boolean }> {
  return requestAdminMutation(
    `outreach/campaign-contacts/${encodeURIComponent(campaignContactId)}/custom-fields/${encodeURIComponent(fieldId)}`,
    "PATCH",
    { value }
  );
}

export function listOutreachTaskBoard(
  onlyMine: boolean,
  signal?: AbortSignal
): Promise<readonly OutreachTaskBoardItem[]> {
  return requestAdminApi(
    `outreach/tasks/board?mine=${onlyMine ? "true" : "false"}`,
    signal
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

export function createOutreachContact(
  campaignId: string,
  input: OutreachImportRow & {
    readonly assignedAdminId?: string;
  }
): Promise<OutreachImportResult> {
  return requestAdminMutation(
    `outreach/campaigns/${encodeURIComponent(campaignId)}/contacts`,
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

export function confirmManualPayment(
  orderId: string,
  input: ConfirmAdminManualPaymentRequest,
  idempotencyKey: string
): Promise<ConfirmAdminManualPaymentResult> {
  return requestAdminMutation(
    `orders/${encodeURIComponent(orderId)}/manual-payment`,
    "POST",
    input,
    idempotencyKey
  );
}

export function requestFullRefund(
  orderId: string,
  input: RequestAdminFullRefundRequest,
  idempotencyKey: string
): Promise<RequestAdminFullRefundResult> {
  return requestAdminMutation(
    `orders/${encodeURIComponent(orderId)}/refunds/full`,
    "POST",
    input,
    idempotencyKey
  );
}

export function createBroadcast(
  input: CreateAdminBroadcastRequest
): Promise<CreateAdminBroadcastResult> {
  return requestAdminMutation("broadcasts", "POST", input);
}

export function listBroadcasts(signal?: AbortSignal): Promise<AdminBroadcastListResult> {
  return requestAdminApi<AdminBroadcastListResult>("broadcasts", signal);
}

export function uploadBroadcastImage(
  input: UploadAdminBroadcastImageRequest
): Promise<UploadAdminBroadcastImageResult> {
  return requestAdminMutation("broadcast-images", "POST", input);
}

export function countBroadcastAudience(
  filters: AdminBroadcastAudienceFilters,
  signal?: AbortSignal
): Promise<AdminBroadcastAudienceResult> {
  const query = new URLSearchParams();
  if (filters.targetAudience) {
    query.set("targetAudience", filters.targetAudience);
  }
  if (filters.targetEventId) {
    query.set("targetEventId", filters.targetEventId);
  }
  if (filters.targetOrderStatus) {
    query.set("targetOrderStatus", filters.targetOrderStatus);
  }
  const search = query.toString();
  return requestAdminApi<AdminBroadcastAudienceResult>(
    `broadcasts/audience${search ? `?${search}` : ""}`,
    signal
  );
}

export function buildParticipantsExportPath(eventId: string): string {
  return `/admin-api/events/${encodeURIComponent(eventId)}/participants/export`;
}

// One key per attempt, reused across retries of the same attempt: a manual payment or refund that
// times out mid-flight must settle once, not once per click.
export function newIdempotencyKey(prefix: string): string {
  return `${prefix}.${crypto.randomUUID()}`;
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
  input: unknown,
  idempotencyKey?: string
): Promise<T> {
  const response = await fetch(`/admin-api/${path}`, {
    method,
    cache: "no-store",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...(idempotencyKey === undefined
        ? {}
        : { "idempotency-key": idempotencyKey })
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
