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

/** Заполненный ответ анкеты. Пустые поля до карточки не доезжают — показывать нечего. */
export interface OutreachParticipationAnswer {
  readonly fieldId: string;
  readonly label: string;
  readonly value: string;
}

export interface OutreachContactParticipation {
  readonly participantId: string;
  readonly eventId: string;
  readonly eventTitle: string;
  readonly guests: number;
  readonly sleepingPlaces: number;
  /**
   * Ответы анкеты этого человека по этому мероприятию. Анкета заполняется на вкладке
   * мероприятия и висит на участнике, а в карточке нужна для ответа на вопрос «что мы про
   * человека знаем» — иначе ради неё приходится помнить, на какое событие он ездил.
   */
  readonly answers: readonly OutreachParticipationAnswer[];
}

export interface OutreachCampaignContactDetail
extends OutreachCampaignContactSummary {
  readonly activities: readonly OutreachActivity[];
  readonly tasks: readonly OutreachTask[];
  readonly stageHistory: readonly OutreachStageHistoryEntry[];
  /** Мероприятия, на которые этот человек уже записан участником. */
  readonly participations: readonly OutreachContactParticipation[];
}

/**
 * Общая база: человек, а не его участие в кампании.
 *
 * Различие важное и держится намеренно. `OutreachCampaignContact*` — это работа по человеку в
 * рамках одной кампании, со стадией воронки и ответственным. `OutreachPerson*` — сам человек:
 * он живёт в базе постоянно, состоит сразу в нескольких кампаниях или ни в одной, и история у
 * него одна на всех.
 */
export const OUTREACH_PERSON_FILTERS = [
  "all",
  "without_phone",
  "without_name",
  "without_campaign",
  "in_bot",
  "archived"
] as const;

export type OutreachPersonFilter = typeof OUTREACH_PERSON_FILTERS[number];

export interface OutreachPerson {
  readonly contactId: string;
  readonly displayName: string | null;
  readonly phone: string | null;
  readonly telegramUsername: string | null;
  readonly maxIdentifier: string | null;
  readonly email: string | null;
  readonly source: string | null;
  /** Пользователь бота, если человека узнали по подтверждённому телефону. */
  readonly linkedUserId: string | null;
  /** В скольких кампаниях состоит сейчас — без тех, откуда его убрали. */
  readonly campaignCount: number;
  readonly lastActivityAt: string | null;
  readonly archivedAt: string | null;
  readonly createdAt: string;
}

export interface OutreachPersonPage {
  readonly items: readonly OutreachPerson[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
}

export interface OutreachPersonCampaign {
  readonly campaignContactId: string;
  readonly campaignId: string;
  readonly campaignName: string;
  readonly stage: OutreachPipelineStage;
  /** Название стадии так, как его назвал менеджер в этой кампании. */
  readonly stageLabel: string;
  readonly assignedAdminName: string | null;
  /** Человека убрали из кампании, но история осталась. */
  readonly removedAt: string | null;
}

/** Звонок или сообщение из любой кампании — в общей ленте нужно знать, из какой. */
export interface OutreachPersonActivity extends OutreachActivity {
  readonly campaignId: string;
  readonly campaignName: string;
}

export interface OutreachPersonCard {
  readonly contactId: string;
  readonly displayName: string | null;
  readonly phone: string | null;
  readonly telegramUsername: string | null;
  readonly maxIdentifier: string | null;
  readonly email: string | null;
  readonly source: string | null;
  readonly note: string | null;
  readonly linkedUserId: string | null;
  readonly archivedAt: string | null;
  readonly archivedReason: string | null;
  /** Карточка признана дублем: смотреть надо главного, ссылка на него здесь. */
  readonly mergedIntoContactId: string | null;
  readonly mergedIntoDisplayName: string | null;
  /** Сколько дублей свели в эту карточку — их история уже показана ниже. */
  readonly mergedDuplicates: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly campaigns: readonly OutreachPersonCampaign[];
  /** Вся история звонков и сообщений из всех кампаний одной лентой. */
  readonly activities: readonly OutreachPersonActivity[];
  readonly participations: readonly OutreachContactParticipation[];
}

/**
 * Правка карточки. Пустая строка означает «стереть значение», отсутствие поля — «не трогать».
 * Различие существенное: правка одного телефона не должна обнулять почту.
 */
export interface UpdateOutreachPersonRequest {
  readonly name?: string | null | undefined;
  readonly phone?: string | null | undefined;
  readonly telegram?: string | null | undefined;
  readonly max?: string | null | undefined;
  readonly email?: string | null | undefined;
  readonly source?: string | null | undefined;
  readonly note?: string | null | undefined;
}

/** Признак уже занят другим человеком — какой именно и кем. */
export interface OutreachPersonConflict {
  readonly field: "phone" | "telegram" | "max" | "email";
  readonly contactId: string;
  readonly displayName: string | null;
}

export type OutreachPersonUpdateResult =
  | { readonly status: "updated" }
  | { readonly status: "not_found" }
  | { readonly status: "conflict"; readonly conflict: OutreachPersonConflict };

/**
 * Почему человека нельзя стереть насовсем.
 *
 * `in_bot` — это клиент бота с согласиями и, возможно, оплатами. `has_activity` — звонки и
 * сообщения, они физически неудаляемы: журнал активностей защищён триггером. `has_participation`
 * — человек записан на мероприятие.
 */
export const OUTREACH_DELETE_BLOCKERS = [
  "in_bot",
  "has_activity",
  "has_participation"
] as const;

export type OutreachDeleteBlocker = typeof OUTREACH_DELETE_BLOCKERS[number];

export interface DeleteOutreachPersonResult {
  readonly deleted: boolean;
  /** Пусто, когда удалили. Иначе — что помешало; архив остаётся доступен всегда. */
  readonly blockers: readonly OutreachDeleteBlocker[];
}

/**
 * Объединение дублей.
 *
 * Проигравший контакт не исчезает: на него ссылается журнал активностей, защищённый от
 * изменений, да и звонок был сделан по той карточке, которая была. Он получает указатель на
 * главного, уходит в архив, а карточка главного собирает историю по всей цепочке.
 */
export const OUTREACH_MERGE_BLOCKERS = [
  "same_contact",
  "already_merged",
  "target_already_merged"
] as const;

export type OutreachMergeBlocker = typeof OUTREACH_MERGE_BLOCKERS[number];

export interface MergeOutreachPeopleResult {
  readonly merged: boolean;
  readonly blocker?: OutreachMergeBlocker;
  /** Что переехало к главному — панель показывает это в подтверждении. */
  readonly movedCampaigns: number;
  readonly movedParticipations: number;
  readonly takenIdentifiers: readonly OutreachPersonConflict["field"][];
}

export interface OutreachImportRow {
  readonly name?: string;
  readonly phone?: string;
  readonly telegram?: string;
  readonly max?: string;
  readonly email?: string;
  readonly source?: string;
  readonly note?: string;
}

/** Контакт из общей базы — для добавления в кампанию. */
export interface OutreachBaseContact {
  readonly contactId: string;
  readonly displayName: string | null;
  readonly phone: string | null;
  readonly telegramUsername: string | null;
  readonly maxIdentifier: string | null;
  readonly source: string | null;
  /** Уже состоит в этой кампании — добавлять нечего. */
  readonly inCampaign: boolean;
  /** В скольких кампаниях человек уже участвует. */
  readonly campaignCount: number;
}

export interface AddExistingContactsRequest {
  readonly contactIds: readonly string[];
  readonly assignedAdminId?: string;
}

export interface AddExistingContactsResult {
  readonly added: number;
  readonly alreadyInCampaign: number;
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
  /** Строки, у которых не удалось разобрать телефон или ник: пропущены. */
  readonly invalidRows: number;
  /** Их номера внутри присланной пачки — чтобы панель показала строки файла. */
  readonly invalidRowIndexes: readonly number[];
  /**
   * Строки, где телефон указывает на один контакт, а Telegram или MAX — на другой.
   * Слить их автоматически нельзя: неизвестно, какой из контактов правильный.
   */
  readonly ambiguousRows: number;
  readonly ambiguousRowIndexes: readonly number[];
  readonly createdContacts: number;
  readonly updatedContacts: number;
  readonly addedToCampaign: number;
  readonly alreadyInCampaign: number;
}

/**
 * Итог загрузки прямо в базу. Отдельный тип, а не общий с загрузкой в кампанию: счётчиков
 * «добавлено в кампанию» здесь нет, и присылать их нулями значит врать.
 */
export interface OutreachBaseImportResult {
  readonly received: number;
  /** Строки, где не удалось разобрать ни одного признака: пропущены. */
  readonly invalidRows: number;
  readonly invalidRowIndexes: readonly number[];
  /** Строки, чьи признаки ведут на разных людей. Решает человек — см. объединение дублей. */
  readonly ambiguousRows: number;
  readonly ambiguousRowIndexes: readonly number[];
  readonly createdContacts: number;
  readonly updatedContacts: number;
}

export interface OutreachCampaignExport {
  readonly filename: string;
  readonly csv: string;
}
