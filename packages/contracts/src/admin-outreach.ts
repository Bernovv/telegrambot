import type { AdminOrderStatus } from "./admin-operations.js";

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
  /** Пусто — задача про человека вообще, а не про его работу в какой-то кампании. */
  readonly campaignContactId: string | null;
  readonly campaignId: string | null;
  readonly campaignName: string | null;
  readonly contactName: string | null;
  readonly contactPhone: string | null;
  /**
   * Признаки контакта нужны прямо на доске: с задачи можно связаться, не открывая кампанию,
   * а какой канал предложить — видно только по ним.
   */
  readonly contactTelegramUsername: string | null;
  readonly contactMaxIdentifier: string | null;
  /** Человек в общей базе. По нему доска уводит в карточку клиента. */
  readonly contactId: string;
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
  readonly ticketTitle: string;
  /** Сколько заплатил помимо бота: ручные оплаты заводятся прямо на участнике. */
  readonly amountKopecks: string | null;
  /** Отметка на входе. Пусто — не пришёл или мероприятие ещё не было. */
  readonly checkedInAt: string | null;
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

/** Задача по человеку. Может жить в кампании, а может относиться к человеку целиком. */
export interface OutreachPersonTask extends OutreachTask {
  readonly campaignContactId: string | null;
  readonly campaignId: string | null;
  readonly campaignName: string | null;
}

/**
 * Заметка менеджера о человеке.
 *
 * Не путать с полем `note` самого контакта: то приезжает из импорта и перезаписывается
 * целиком. Заметки копятся, у каждой есть автор и дата, и снять свою может только она сама.
 */
export interface OutreachNote {
  readonly id: string;
  readonly body: string;
  readonly authorAdminId: string;
  readonly authorName: string;
  readonly createdAt: string;
  /** Автор снял заметку. Такие в карточку не приезжают вовсе. */
  readonly deletedAt: string | null;
  /** Смотрящий и есть автор. Чужую заметку снять нельзя — и кнопки для неё быть не должно. */
  readonly canDelete: boolean;
}

/** Переход по стадии — с названиями стадий так, как их назвали в той кампании. */
export interface OutreachPersonStageChange extends OutreachStageHistoryEntry {
  readonly campaignId: string;
  readonly campaignName: string;
  readonly fromLabel: string | null;
  readonly toLabel: string;
}

/** Значение дополнительного поля. Поля заводятся по кампаниям, отсюда её название. */
export interface OutreachPersonCustomField {
  readonly fieldId: string;
  readonly label: string;
  readonly campaignName: string;
  readonly value: string;
}

/**
 * Ответ анкеты. Источников два: анкета участника, заполненная организатором, и анкета к
 * заказу покупателя бота. Вопросы у них общие, а вопрос «что мы про человека знаем» не
 * различает, кто вписал ответ, — поэтому в карточке они лежат одним списком.
 */
export const OUTREACH_QUESTIONNAIRE_SOURCES = [
  "participant",
  "order"
] as const;

export type OutreachQuestionnaireSource =
  typeof OUTREACH_QUESTIONNAIRE_SOURCES[number];

export interface OutreachPersonQuestionnaire {
  readonly source: OutreachQuestionnaireSource;
  readonly eventId: string | null;
  readonly eventTitle: string | null;
  readonly filledAt: string | null;
  readonly answers: readonly OutreachParticipationAnswer[];
}

/** Заказ покупателя бота. */
export interface OutreachPersonOrder {
  readonly id: string;
  readonly number: string;
  readonly status: AdminOrderStatus;
  readonly eventId: string;
  readonly eventTitle: string;
  readonly totalKopecks: string;
  readonly createdAt: string;
  readonly paidAt: string | null;
  /** Заказ исключён из отчётов: тестовый или ошибочный. В сумму оплаченного не идёт. */
  readonly excludedAt: string | null;
}

/**
 * Согласие с офертой. Ссылка ведёт на ту редакцию, с которой человек согласился, а не на
 * действующую: в этом весь смысл неизменяемых версий.
 */
export interface OutreachPersonConsent {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly versionNumber: number;
  readonly publicUrl: string;
  readonly acceptedAt: string;
  readonly channel: string;
}

/** Заявка с формы на сайте — как её прислали. */
export interface OutreachPersonSiteRegistration {
  readonly id: string;
  readonly eventTitle: string | null;
  readonly page: string;
  readonly status: string;
  readonly consentAt: string;
  readonly createdAt: string;
}

/** Откуда человек пришёл в бота: метка источника, кампания и код партнёра из диплинка. */
export interface OutreachPersonTouchpoint {
  readonly channel: string;
  readonly source: string | null;
  readonly campaign: string | null;
  readonly partnerCode: string | null;
  readonly occurredAt: string;
  readonly isFirstTouch: boolean;
}

/** Человек как пользователь бота. Пусто, если он в бота не заходил. */
export interface OutreachPersonBotProfile {
  readonly userId: string;
  readonly registeredAt: string;
  readonly lastSeenAt: string | null;
  readonly isBlocked: boolean;
  readonly phoneStatus: string;
  readonly walletAvailableKopecks: string;
  readonly touchpoints: readonly OutreachPersonTouchpoint[];
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
  /** Кто завёл человека в базе. Пусто, если администратора уже удалили. */
  readonly createdByName: string | null;
  readonly campaigns: readonly OutreachPersonCampaign[];
  /** Вся история звонков и сообщений из всех кампаний одной лентой. */
  readonly activities: readonly OutreachPersonActivity[];
  readonly tasks: readonly OutreachPersonTask[];
  readonly notes: readonly OutreachNote[];
  readonly stageChanges: readonly OutreachPersonStageChange[];
  readonly customFields: readonly OutreachPersonCustomField[];
  readonly participations: readonly OutreachContactParticipation[];
  readonly questionnaires: readonly OutreachPersonQuestionnaire[];
  /** Пусто, если человека нет в боте. Тогда нет ни заказов, ни согласий. */
  readonly bot: OutreachPersonBotProfile | null;
  readonly orders: readonly OutreachPersonOrder[];
  /** Сколько человек заплатил всего, без исключённых из отчётов заказов. */
  readonly paidTotalKopecks: string;
  readonly consents: readonly OutreachPersonConsent[];
  readonly siteRegistrations: readonly OutreachPersonSiteRegistration[];
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

/**
 * Журнал загрузок. Хранит только строки, которые не легли: те, что легли, уже лежат
 * контактами, и вторая их копия — мусор.
 */
export const OUTREACH_IMPORT_ROW_STATUSES = [
  "invalid",
  "ambiguous",
  "resolved",
  "dismissed"
] as const;

export type OutreachImportRowStatus =
  typeof OUTREACH_IMPORT_ROW_STATUSES[number];

export interface OutreachImportRun {
  readonly id: string;
  readonly filename: string | null;
  /** Пусто — грузили прямо в базу. Иначе название кампании. */
  readonly campaignId: string | null;
  readonly campaignName: string | null;
  readonly createdByName: string;
  readonly received: number;
  readonly createdContacts: number;
  readonly updatedContacts: number;
  readonly invalidRows: number;
  readonly ambiguousRows: number;
  /** Сколько строк ещё ждёт разбора — ради них журнал и заведён. */
  readonly pendingRows: number;
  readonly createdAt: string;
}

export interface OutreachImportRowRecord {
  readonly id: string;
  readonly importId: string;
  readonly filename: string | null;
  readonly lineNumber: number;
  readonly status: OutreachImportRowStatus;
  readonly reason: string | null;
  /** Что было в строке файла — чинить придётся именно это. */
  readonly raw: OutreachImportRow;
  readonly createdAt: string;
}

export interface StartOutreachImportRequest {
  readonly filename?: string;
  readonly campaignId?: string;
}

export interface RetryOutreachImportRowResult {
  readonly resolved: boolean;
  /** Строка снова не легла: причина та же, что и при загрузке. */
  readonly reason: string | null;
  readonly contactId: string | null;
}

export interface OutreachCampaignExport {
  readonly filename: string;
  readonly csv: string;
}
