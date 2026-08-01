export const OUTREACH_CAMPAIGN_STATUSES = [
  "draft",
  "active",
  "completed"
] as const;

export const OUTREACH_CONTACT_STATUSES = [
  "new",
  "sent",
  "no_answer",
  "answered",
  "callback",
  "interested",
  "declined",
  "converted",
  "invalid"
] as const;

export const OUTREACH_CHANNELS = [
  "phone",
  "telegram",
  "max",
  "whatsapp",
  "sms",
  "other"
] as const;

// Pipeline stages are fully manager-editable (add/remove/rename/reorder), so
// there is no longer a fixed literal union of stage ids. A campaign's real
// stage list always comes from OutreachPipelineColumn[]. This constant only
// seeds the default stages a brand-new campaign starts with (mirrored by the
// database seed trigger) and is used as a fallback/reference in the UI.
export const OUTREACH_DEFAULT_PIPELINE_STAGES = [
  "new",
  "first_contact",
  "dialogue",
  "follow_up",
  "interested",
  "won",
  "lost"
] as const;

export const OUTREACH_PIPELINE_COLUMN_OUTCOMES = [
  "open",
  "won",
  "lost"
] as const;

export const OUTREACH_MAX_PIPELINE_COLUMNS = 20;

export const OUTREACH_LOST_REASONS = [
  "declined",
  "not_relevant",
  "invalid_contact",
  "duplicate",
  "other"
] as const;

export const OUTREACH_TASK_TYPES = ["call", "message", "other"] as const;
export const OUTREACH_TASK_STATUSES = [
  "open",
  "completed",
  "cancelled"
] as const;

export const OUTREACH_TASK_URGENCIES = [
  "overdue",
  "today",
  "tomorrow",
  "this_week",
  "later",
  "completed"
] as const;

export const OUTREACH_CUSTOM_FIELD_TYPES = [
  "text",
  "number",
  "date",
  "select"
] as const;

export type OutreachCampaignStatus =
  typeof OUTREACH_CAMPAIGN_STATUSES[number];
export type OutreachContactStatus =
  typeof OUTREACH_CONTACT_STATUSES[number];
export type OutreachChannel = typeof OUTREACH_CHANNELS[number];
// Any stage id currently configured for the campaign (see
// OutreachPipelineColumn.stage). Kept as a distinct alias, not a literal
// union, so call sites document intent without hard-coding stage names.
export type OutreachPipelineStage = string;
export type OutreachPipelineColumnOutcome =
  typeof OUTREACH_PIPELINE_COLUMN_OUTCOMES[number];
export type OutreachLostReason = typeof OUTREACH_LOST_REASONS[number];
export type OutreachTaskType = typeof OUTREACH_TASK_TYPES[number];
export type OutreachTaskStatus = typeof OUTREACH_TASK_STATUSES[number];
export type OutreachTaskUrgency = typeof OUTREACH_TASK_URGENCIES[number];
export type OutreachCustomFieldType = typeof OUTREACH_CUSTOM_FIELD_TYPES[number];

export interface OutreachCampaignSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: OutreachCampaignStatus;
  /** Мероприятие, на которое продаёт кампания. Пусто, если привязки нет. */
  readonly eventId: string | null;
  readonly eventTitle: string | null;
  /** Кампания убрана из списка. История сохраняется, кампанию можно вернуть. */
  readonly archivedAt: string | null;
  readonly totalContacts: number;
  readonly untouchedContacts: number;
  readonly interestedContacts: number;
  readonly convertedContacts: number;
  readonly createdAt: string;
  readonly completedAt: string | null;
}

export interface OutreachManager {
  readonly id: string;
  readonly displayName: string;
}

export interface OutreachPipelineColumn {
  readonly stage: OutreachPipelineStage;
  readonly label: string;
  readonly position: number;
  readonly outcome: OutreachPipelineColumnOutcome;
}

export interface OutreachCustomFieldDefinition {
  readonly id: string;
  // null means the field applies to every campaign; otherwise it only
  // applies to that one campaign, mirroring amoCRM's per-pipeline fields.
  readonly campaignId: string | null;
  readonly key: string;
  readonly label: string;
  readonly type: OutreachCustomFieldType;
  readonly options: readonly string[] | null;
  readonly position: number;
}

export interface OutreachCustomFieldValue {
  readonly fieldId: string;
  readonly key: string;
  readonly label: string;
  readonly type: OutreachCustomFieldType;
  readonly options: readonly string[] | null;
  // Always the display/edit string form: numbers and dates are serialized
  // (e.g. "2026-08-01"); the API validates/parses by field type on write.
  readonly value: string | null;
}

export interface OutreachTaskBoardItem {
  readonly id: string;
  readonly campaignContactId: string;
  readonly campaignId: string;
  readonly campaignName: string;
  readonly contactName: string | null;
  readonly contactPhone: string | null;
  readonly assignedAdminId: string;
  readonly assignedAdminName: string;
  readonly type: OutreachTaskType;
  readonly text: string;
  readonly dueAt: string;
  readonly status: OutreachTaskStatus;
  readonly urgency: OutreachTaskUrgency;
}

export interface OutreachCampaignContactSummary {
  readonly id: string;
  readonly contactId: string;
  readonly displayName: string | null;
  readonly phone: string | null;
  readonly telegramUsername: string | null;
  readonly maxIdentifier: string | null;
  readonly source: string | null;
  readonly note: string | null;
  readonly linkedUserId: string | null;
  readonly assignedAdminId: string | null;
  readonly assignedAdminName: string | null;
  readonly stage: OutreachPipelineStage;
  readonly lostReason: OutreachLostReason | null;
  readonly status: OutreachContactStatus;
  readonly lastActivityAt: string | null;
  readonly nextContactAt: string | null;
  readonly lastChannel: OutreachChannel | null;
  readonly lastResult: OutreachContactStatus | null;
  readonly openTask: OutreachTask | null;
  readonly customFields: readonly OutreachCustomFieldValue[];
}

export interface OutreachCampaignContactPage {
  readonly items: readonly OutreachCampaignContactSummary[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
}

export interface OutreachActivity {
  readonly id: string;
  readonly actorAdminId: string;
  readonly actorName: string;
  readonly channel: OutreachChannel;
  readonly result: Exclude<OutreachContactStatus, "new">;
  readonly note: string | null;
  readonly occurredAt: string;
}

export interface OutreachTask {
  readonly id: string;
  readonly assignedAdminId: string;
  readonly assignedAdminName: string;
  readonly createdByAdminId: string;
  readonly createdByAdminName: string;
  readonly completedByAdminId: string | null;
  readonly completedByAdminName: string | null;
  readonly type: OutreachTaskType;
  readonly text: string;
  readonly dueAt: string;
  readonly status: OutreachTaskStatus;
  readonly createdAt: string;
  readonly completedAt: string | null;
}

export interface OutreachStageHistoryEntry {
  readonly id: string;
  readonly actorAdminId: string | null;
  readonly actorName: string;
  readonly fromStage: OutreachPipelineStage | null;
  readonly toStage: OutreachPipelineStage;
  readonly lostReason: OutreachLostReason | null;
  readonly occurredAt: string;
}

export interface OutreachContactParticipation {
  readonly participantId: string;
  readonly eventId: string;
  readonly eventTitle: string;
  readonly guests: number;
  readonly sleepingPlaces: number;
}

export interface OutreachCampaignContactDetail
extends OutreachCampaignContactSummary {
  readonly activities: readonly OutreachActivity[];
  readonly tasks: readonly OutreachTask[];
  readonly stageHistory: readonly OutreachStageHistoryEntry[];
  /** Мероприятия, на которые этот человек уже записан участником. */
  readonly participations: readonly OutreachContactParticipation[];
}

export interface OutreachImportRow {
  readonly name?: string;
  readonly phone?: string;
  readonly telegram?: string;
  readonly max?: string;
  readonly source?: string;
  readonly note?: string;
}

export interface MoveOutreachContactsRequest {
  readonly campaignContactIds: readonly string[];
  readonly targetCampaignId: string;
}

export interface MoveOutreachContactsResult {
  readonly moved: number;
  /** Контакты, которые уже были в кампании назначения. */
  readonly alreadyThere: number;
}

export interface ImportEventParticipantsResult extends OutreachImportResult {
  readonly eventTitle: string;
}

export interface OutreachImportResult {
  readonly received: number;
  readonly createdContacts: number;
  readonly updatedContacts: number;
  readonly addedToCampaign: number;
  readonly alreadyInCampaign: number;
}

export interface OutreachCampaignExport {
  readonly filename: string;
  readonly csv: string;
}
