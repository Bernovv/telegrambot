import type {
  AdminPersonConversations,
  ConversationReplyResult
} from "@ticket-platform/contracts/admin-conversations";
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
  MarkOutreachPersonOwnRequest,
  MoveOutreachContactsResult,
  OutreachBaseContact,
  OutreachContactStatus,
  OutreachCustomFieldDefinition,
  OutreachCustomFieldType,
  OutreachImportResult,
  OutreachImportRow,
  OutreachLostReason,
  DeleteOutreachPersonResult,
  MergeOutreachPeopleResult,
  OutreachBaseImportResult,
  OutreachImportRowRecord,
  OutreachImportRun,
  RetryOutreachImportRowResult,
  StartOutreachImportRequest,
  OutreachManager,
  OutreachPersonCard,
  RequestTelegramLookupResult,
  OutreachPersonUpdateResult,
  UpdateOutreachPersonRequest,
  OutreachPersonFilter,
  OutreachPersonPage,
  OutreachPipelineColumn,
  OutreachPipelineStage,
  OutreachTaskBoardItem,
  OutreachTaskRule,
  CreateOutreachTaskRuleRequest,
  CreateOutreachTaskRuleOutcome,
  UpdateOutreachTaskRuleRequest,
  OutreachTaskType
} from "@ticket-platform/contracts/admin-outreach";
import type {
  BookMentorSlotRequest,
  CreateMentorSlotsRequest,
  CreateMentorSlotsResult,
  MentorSlot,
  MentorSlotFilters,
  SetStaffRoleRequest,
  StaffView
} from "@ticket-platform/contracts/admin-staff";

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
  SetPrivateTentRequest,
  UpdateEventParticipantRequest
} from "@ticket-platform/contracts/admin-accommodation";
import type {
  EventParticipantsView,
  ImportParticipantsRequest,
  ImportParticipantsResult,
  SaveParticipantAnswerRequest,
  SetParticipantAttendanceRequest
} from "@ticket-platform/contracts/admin-participants";
import type { EventOverview } from "@ticket-platform/contracts/admin-overview";
import type { EventReport } from "@ticket-platform/contracts/admin-event-report";
import type { AdminSiteRegistrationPage }
  from "@ticket-platform/contracts/site-registration";

import type {
  CreateEventOrganizerRequest,
  EventTeamView,
  RemoveEventOrganizerRequest,
  UpdateEventOrganizerRequest
} from "@ticket-platform/contracts/admin-organizers";
import type {
  CreateEventInventoryNeedRequest,
  CreateInventoryItemRequest,
  EventInventoryView,
  RecordInventoryMovementRequest,
  SetInventoryComponentRequest,
  UpdateEventInventoryNeedRequest
} from "@ticket-platform/contracts/admin-inventory";
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

/**
 * Отметка «пришёл» и её снятие. Запрос на строку: отмечают по одному человеку у входа в
 * зал, и ждать сохранения всего списка там нечего.
 */
export function setParticipantAttendance(
  eventId: string,
  input: SetParticipantAttendanceRequest
): Promise<{ readonly saved: boolean }> {
  return requestAdminMutation(
    `events/${encodeURIComponent(eventId)}/participants/attendance`,
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

export function setPrivateTent(
  eventId: string,
  input: SetPrivateTentRequest
): Promise<{ readonly saved: boolean }> {
  return requestAdminMutation(
    `events/${encodeURIComponent(eventId)}/accommodation/private-tent`,
    "POST",
    input
  );
}

export function getEventInventory(
  eventId: string,
  signal?: AbortSignal
): Promise<EventInventoryView> {
  return requestAdminApi(
    `events/${encodeURIComponent(eventId)}/inventory`,
    signal
  );
}

export function addInventoryItem(
  input: CreateInventoryItemRequest
): Promise<{ readonly added: boolean }> {
  return requestAdminMutation("inventory/items", "POST", input);
}

export function setInventoryComponent(
  input: SetInventoryComponentRequest
): Promise<{ readonly saved: boolean }> {
  return requestAdminMutation("inventory/components", "POST", input);
}

export function addEventInventoryNeed(
  eventId: string,
  input: CreateEventInventoryNeedRequest
): Promise<{ readonly added: boolean }> {
  return requestAdminMutation(
    `events/${encodeURIComponent(eventId)}/inventory/needs`,
    "POST",
    input
  );
}

export function updateEventInventoryNeed(
  eventId: string,
  input: UpdateEventInventoryNeedRequest
): Promise<{ readonly updated: boolean }> {
  return requestAdminMutation(
    `events/${encodeURIComponent(eventId)}/inventory/needs/update`,
    "POST",
    input
  );
}

export function recordInventoryMovement(
  eventId: string,
  input: RecordInventoryMovementRequest
): Promise<{ readonly recorded: boolean }> {
  return requestAdminMutation(
    `events/${encodeURIComponent(eventId)}/inventory/movements`,
    "POST",
    input
  );
}

export function getEventOverview(
  eventId: string,
  signal?: AbortSignal
): Promise<EventOverview> {
  return requestAdminApi(`events/${encodeURIComponent(eventId)}/overview`, signal);
}

export function getEventTeam(
  eventId: string,
  signal?: AbortSignal
): Promise<EventTeamView> {
  return requestAdminApi(`events/${encodeURIComponent(eventId)}/team`, signal);
}

export function addEventOrganizer(
  eventId: string,
  input: CreateEventOrganizerRequest
): Promise<{ readonly added: boolean }> {
  return requestAdminMutation(
    `events/${encodeURIComponent(eventId)}/team`,
    "POST",
    input
  );
}

export function updateEventOrganizer(
  eventId: string,
  input: UpdateEventOrganizerRequest
): Promise<{ readonly updated: boolean }> {
  return requestAdminMutation(
    `events/${encodeURIComponent(eventId)}/team/update`,
    "POST",
    input
  );
}

export function removeEventOrganizer(
  eventId: string,
  input: RemoveEventOrganizerRequest
): Promise<{ readonly removed: boolean }> {
  return requestAdminMutation(
    `events/${encodeURIComponent(eventId)}/team/remove`,
    "POST",
    input
  );
}

export function importEventParticipants(
  eventId: string,
  input: ImportParticipantsRequest
): Promise<ImportParticipantsResult> {
  return requestAdminMutation(
    `events/${encodeURIComponent(eventId)}/participants/import`,
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

export function listOutreachTaskRules(
  campaignId: string,
  signal?: AbortSignal
): Promise<readonly OutreachTaskRule[]> {
  return requestAdminApi(
    `outreach/campaigns/${encodeURIComponent(campaignId)}/task-rules`,
    signal
  );
}

export function createOutreachTaskRule(
  campaignId: string,
  request: CreateOutreachTaskRuleRequest
): Promise<CreateOutreachTaskRuleOutcome> {
  return requestAdminMutation(
    `outreach/campaigns/${encodeURIComponent(campaignId)}/task-rules`,
    "POST",
    request
  );
}

export function deleteOutreachTaskRule(
  ruleId: string
): Promise<{ readonly deleted: boolean }> {
  return requestAdminMutation(
    `outreach/task-rules/${encodeURIComponent(ruleId)}/delete`,
    "POST",
    {}
  );
}

export function updateOutreachTaskRule(
  ruleId: string,
  changes: UpdateOutreachTaskRuleRequest
): Promise<OutreachTaskRule> {
  return requestAdminMutation(
    `outreach/task-rules/${encodeURIComponent(ruleId)}`,
    "PATCH",
    changes
  );
}

export function updateOutreachCampaignSettings(
  campaignId: string,
  input: {
    readonly requireOpenTask?: boolean;
    readonly callWindowStart?: number;
    readonly callWindowEnd?: number;
  }
): Promise<OutreachCampaignSummary> {
  return requestAdminMutation(
    `outreach/campaigns/${encodeURIComponent(campaignId)}`,
    "PATCH",
    input
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

export function listOutreachPeople(
  input: {
    readonly search?: string;
    readonly filter?: OutreachPersonFilter;
    readonly page?: number;
    readonly limit?: number;
  },
  signal?: AbortSignal
): Promise<OutreachPersonPage> {
  const query = new URLSearchParams();
  if (input.search) {
    query.set("search", input.search);
  }
  if (input.filter && input.filter !== "all") {
    query.set("filter", input.filter);
  }
  if (input.page) {
    query.set("page", String(input.page));
  }
  if (input.limit) {
    query.set("limit", String(input.limit));
  }
  const suffix = query.toString();
  return requestAdminApi(
    suffix ? `outreach/base?${suffix}` : "outreach/base",
    signal
  );
}

/**
 * Переписка человека.
 *
 * Отдельным запросом, а не частью карточки: у разговорчивого человека реплик сотни, а
 * карточку открывают ради стадии и телефона. Курсор — время реплики: пока менеджер читает,
 * человек пишет ещё, и страница по номеру вернула бы уже прочитанное.
 */
export function getPersonConversations(
  contactId: string,
  options: {
    readonly limit?: number;
    readonly before?: string;
    readonly search?: string;
  } = {},
  signal?: AbortSignal
): Promise<AdminPersonConversations> {
  const query = new URLSearchParams();
  if (options.limit !== undefined) {
    query.set("limit", String(options.limit));
  }
  if (options.before !== undefined) {
    query.set("before", options.before);
  }
  if (options.search !== undefined && options.search !== "") {
    query.set("search", options.search);
  }
  const suffix = query.toString();
  return requestAdminApi(
    `conversations/people/${encodeURIComponent(contactId)}${suffix ? `?${suffix}` : ""}`,
    signal
  );
}

/**
 * Ответ менеджера.
 *
 * Ручка отвечает сразу, не дожидаясь мессенджера: реплика ложится в очередь и появляется в
 * ленте со статусом «отправляется». Ждать Telegram здесь нельзя — их сеть иногда думает
 * секундами, а менеджер в это время жмёт кнопку второй раз.
 */
/**
 * Адрес файла вложения.
 *
 * Обычная ссылка, а не запрос: картинку показывает `<img>`, голосовое — `<audio>`, и оба
 * ходят за файлом сами, с той же сессией. Тянуть файл в память панели ради этого незачем.
 */
/**
 * Файл в переписку.
 *
 * Содержимое уходит base64 внутри JSON — тем же путём, что картинка рассылки: прокси панели
 * принимает только JSON, и ради одной ручки учить его multipart дороже, чем смириться с
 * третью лишних байт.
 */
export async function sendConversationFile(
  conversationId: string,
  input: {
    readonly file: File;
    readonly caption?: string;
    readonly takeOver?: boolean;
  }
): Promise<ConversationReplyResult> {
  const buffer = await input.file.arrayBuffer();
  return await requestAdminMutation(
    `conversations/${encodeURIComponent(conversationId)}/files`,
    "POST",
    {
      fileName: input.file.name,
      // Пустой тип бывает у файлов без расширения: пусть решает сервер, а не браузер.
      mimeType: input.file.type === "" ? "application/octet-stream" : input.file.type,
      contentBase64: toBase64(new Uint8Array(buffer)),
      ...(input.caption === undefined || input.caption === ""
        ? {}
        : { caption: input.caption }),
      ...(input.takeOver === undefined ? {} : { takeOver: input.takeOver })
    }
  );
}

/**
 * Base64 без загрузки всего файла в строку одним куском.
 *
 * `String.fromCharCode(...bytes)` на мегабайтном файле роняет вкладку: аргументов у вызова
 * столько же, сколько байт, и стек кончается. Отсюда куски по 32 КБ.
 */
function toBase64(bytes: Uint8Array): string {
  const chunkSize = 32 * 1_024;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export function conversationAttachmentUrl(attachmentId: string): string {
  return `/admin-api/conversations/attachments/${encodeURIComponent(attachmentId)}/file`;
}

export function sendConversationReply(
  conversationId: string,
  input: { readonly text: string; readonly takeOver?: boolean }
): Promise<ConversationReplyResult> {
  return requestAdminMutation(
    `conversations/${encodeURIComponent(conversationId)}/messages`,
    "POST",
    input
  );
}

export function getOutreachPerson(
  contactId: string,
  signal?: AbortSignal
): Promise<OutreachPersonCard> {
  return requestAdminApi(
    `outreach/base/${encodeURIComponent(contactId)}`,
    signal
  );
}

/**
 * Попросить аккаунт компании поискать человека в Telegram по телефону.
 *
 * Ответ — расписка о принятой просьбе, а не исход поиска: спрашивает Telegram отдельный
 * процесс, и результат появится в карточке через несколько секунд.
 */
export function requestOutreachTelegramLookup(
  contactId: string
): Promise<RequestTelegramLookupResult> {
  return requestAdminMutation(
    `outreach/base/${encodeURIComponent(contactId)}/telegram-lookup`,
    "POST",
    {}
  );
}

/** Занятый признак приходит обычным ответом, а не ошибкой: см. комментарий в API. */
export function updateOutreachPerson(
  contactId: string,
  changes: UpdateOutreachPersonRequest
): Promise<Exclude<OutreachPersonUpdateResult, { status: "not_found" }>> {
  return requestAdminMutation(
    `outreach/base/${encodeURIComponent(contactId)}`,
    "PATCH",
    changes
  );
}

/** Ниша, запрос и прочие общие поля: набор их заводит администратор. */
export function setOutreachPersonField(
  contactId: string,
  fieldId: string,
  value: string | null
): Promise<{ readonly saved: boolean }> {
  return requestAdminMutation(
    `outreach/base/${encodeURIComponent(contactId)}/fields`,
    "POST",
    { fieldId, value }
  );
}

export function archiveOutreachPerson(
  contactId: string,
  reason?: string
): Promise<{ readonly archived: boolean }> {
  return requestAdminMutation(
    `outreach/base/${encodeURIComponent(contactId)}/archive`,
    "POST",
    reason ? { reason } : {}
  );
}

export function restoreOutreachPerson(
  contactId: string
): Promise<{ readonly restored: boolean }> {
  return requestAdminMutation(
    `outreach/base/${encodeURIComponent(contactId)}/restore`,
    "POST",
    {}
  );
}

export function deleteOutreachPerson(
  contactId: string,
  reason?: string
): Promise<DeleteOutreachPersonResult> {
  return requestAdminMutation(
    `outreach/base/${encodeURIComponent(contactId)}/delete`,
    "POST",
    reason ? { reason } : {}
  );
}

/**
 * Заводит загрузку в журнале. Идентификатор потом передаётся с каждой пачкой, чтобы строки,
 * которые не легли, нашлись и после закрытия вкладки.
 */
export function startOutreachImport(
  input: StartOutreachImportRequest
): Promise<{ readonly importId: string }> {
  return requestAdminMutation("outreach/imports", "POST", input);
}

/** Загрузка прямо в базу: людей заводит и обновляет, ни в какую кампанию не кладёт. */
export function importOutreachPeople(
  rows: readonly OutreachImportRow[],
  journal?: { readonly importId: string; readonly lines: readonly number[] }
): Promise<OutreachBaseImportResult> {
  return requestAdminMutation("outreach/base/import", "POST", {
    rows,
    ...(journal ?? {})
  });
}

export function listOutreachImports(
  signal?: AbortSignal
): Promise<readonly OutreachImportRun[]> {
  return requestAdminApi("outreach/imports", signal);
}

export function listPendingOutreachImportRows(
  importId?: string,
  signal?: AbortSignal
): Promise<readonly OutreachImportRowRecord[]> {
  return requestAdminApi(
    importId
      ? `outreach/import-rows?importId=${encodeURIComponent(importId)}`
      : "outreach/import-rows",
    signal
  );
}

export function retryOutreachImportRow(
  rowId: string,
  row: OutreachImportRow
): Promise<RetryOutreachImportRowResult> {
  return requestAdminMutation(
    `outreach/import-rows/${encodeURIComponent(rowId)}/retry`,
    "POST",
    { row }
  );
}

export function dismissOutreachImportRow(
  rowId: string
): Promise<{ readonly dismissed: boolean }> {
  return requestAdminMutation(
    `outreach/import-rows/${encodeURIComponent(rowId)}/dismiss`,
    "POST",
    {}
  );
}

/** contactId — открытая карточка-дубль, targetContactId — главный. */
export function mergeOutreachPeople(
  contactId: string,
  targetContactId: string,
  reason?: string
): Promise<MergeOutreachPeopleResult> {
  return requestAdminMutation(
    `outreach/base/${encodeURIComponent(contactId)}/merge`,
    "POST",
    { targetContactId, ...(reason ? { reason } : {}) }
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
}): Promise<{ readonly recorded: number; readonly taskRequired: boolean }> {
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
    /** Следующий шаг: воронка может не отпускать карточку без него. */
    readonly task?: {
      readonly assignedAdminId?: string;
      readonly type: OutreachTaskType;
      readonly text: string;
      readonly dueAt: string;
    };
  }
): Promise<{ readonly updated: boolean; readonly taskRequired: boolean }> {
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

/** Задача про человека вообще: без кампании, и потому доступна всем в базе. */
export function createOutreachPersonTask(
  contactId: string,
  input: {
    readonly assignedAdminId?: string;
    readonly type: OutreachTaskType;
    readonly text: string;
    readonly dueAt: string;
  }
): Promise<{ readonly created: boolean }> {
  return requestAdminMutation(
    `outreach/base/${encodeURIComponent(contactId)}/tasks`,
    "POST",
    input
  );
}

export function listSiteRegistrations(
  input: {
    readonly needsAttention?: boolean;
    readonly page?: number;
    readonly limit?: number;
  },
  signal?: AbortSignal
): Promise<AdminSiteRegistrationPage> {
  const query = new URLSearchParams();
  if (input.needsAttention) {
    query.set("needsAttention", "true");
  }
  if (input.page) {
    query.set("page", String(input.page));
  }
  if (input.limit) {
    query.set("limit", String(input.limit));
  }
  const suffix = query.toString();
  return requestAdminApi(
    suffix
      ? `outreach/site-registrations?${suffix}`
      : "outreach/site-registrations",
    signal
  );
}

/** Пометка «свой». `isOwn: false` снимает её вместе с объяснением. */
export function markOutreachPersonOwn(
  contactId: string,
  input: MarkOutreachPersonOwnRequest
): Promise<{ readonly updated: boolean }> {
  return requestAdminMutation(
    `outreach/base/${encodeURIComponent(contactId)}/own`,
    "POST",
    input
  );
}

export function createOutreachNote(
  contactId: string,
  body: string
): Promise<{ readonly created: boolean }> {
  return requestAdminMutation(
    `outreach/base/${encodeURIComponent(contactId)}/notes`,
    "POST",
    { body }
  );
}

export function deleteOutreachNote(
  noteId: string
): Promise<{ readonly deleted: boolean }> {
  return requestAdminMutation(
    `outreach/notes/${encodeURIComponent(noteId)}/delete`,
    "POST",
    {}
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

export function getEventReport(
  eventId: string,
  signal?: AbortSignal
): Promise<EventReport> {
  return requestAdminApi(
    `events/${encodeURIComponent(eventId)}/report`,
    signal
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

/**
 * Команда кабинета.
 *
 * Путь `staff`, а не `team`: адрес `events/:id/team` уже занят долями организаторов
 * мероприятия, и одно слово на две разные вещи однажды отправило бы запрос не туда.
 */
export function getStaff(signal?: AbortSignal): Promise<StaffView> {
  return requestAdminApi("staff", signal);
}

export function setStaffRole(
  request: SetStaffRoleRequest
): Promise<{ readonly changed: boolean }> {
  return requestAdminMutation("staff/roles", "POST", request);
}

export function listMentorSlots(
  filters: MentorSlotFilters,
  signal?: AbortSignal
): Promise<readonly MentorSlot[]> {
  const query = new URLSearchParams();
  if (filters.mentorAdminId) {
    query.set("mentorAdminId", filters.mentorAdminId);
  }
  if (filters.onlyFree !== undefined) {
    query.set("onlyFree", filters.onlyFree ? "true" : "false");
  }
  if (filters.from) {
    query.set("from", filters.from);
  }
  if (filters.to) {
    query.set("to", filters.to);
  }
  const suffix = query.size === 0 ? "" : `?${query.toString()}`;
  return requestAdminApi(`staff/slots${suffix}`, signal);
}

export function createMentorSlots(
  request: CreateMentorSlotsRequest
): Promise<CreateMentorSlotsResult> {
  return requestAdminMutation("staff/slots", "POST", request);
}

export function cancelMentorSlot(
  slotId: string
): Promise<{ readonly cancelled: boolean }> {
  return requestAdminMutation("staff/slots/remove", "POST", { slotId });
}

export function bookMentorSlot(
  request: BookMentorSlotRequest
): Promise<{ readonly booked: boolean }> {
  return requestAdminMutation("staff/slots/book", "POST", request);
}

export function releaseMentorSlot(
  slotId: string
): Promise<{ readonly released: boolean }> {
  return requestAdminMutation("staff/slots/release", "POST", { slotId });
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
