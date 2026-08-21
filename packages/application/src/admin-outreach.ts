import {
  OUTREACH_CUSTOM_FIELD_TYPES,
  OUTREACH_MAX_PIPELINE_COLUMNS,
  OUTREACH_PIPELINE_COLUMN_OUTCOMES
} from "@ticket-platform/contracts";
import type {
  AddExistingContactsResult,
  AdminRequestActor,
  AdminSiteRegistrationPage,
  ImportEventParticipantsResult,
  OutreachBaseContact,
  MoveOutreachContactsResult,
  OutreachCampaignContactDetail,
  OutreachCampaignContactPage,
  OutreachCampaignExport,
  OutreachCampaignStatus,
  OutreachCampaignSummary,
  OutreachChannel,
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
  OutreachManager,
  OutreachPersonCard,
  OutreachPersonConflict,
  OutreachPersonUpdateResult,
  UpdateOutreachPersonRequest,
  UpdateOutreachTaskRuleRequest,
  OutreachPersonFilter,
  OutreachPersonPage,
  OutreachPipelineColumn,
  OutreachPipelineColumnOutcome,
  OutreachPipelineStage,
  OutreachTaskBoardItem,
  OutreachTaskRule,
  OutreachTaskType,
  OutreachTaskUrgency
} from "@ticket-platform/contracts";
import {
  normalizeContactInput,
  type ContactRejectionReason
} from "@ticket-platform/domain";
import type { IdGenerator } from "./identity.js";
import type { PhoneNormalizer } from "./phone.js";

/**
 * Следующий шаг, который ставится вместе с переносом карточки или записью касания.
 *
 * Одной операцией, а не двумя: между ними карточка успевала бы побывать в состоянии,
 * которое воронка запрещает, и запрет обходился бы случайно — закрыл вкладку и всё.
 */
export interface OutreachNextStep {
  readonly type: OutreachTaskType;
  readonly text: string;
  readonly dueAt: Date;
  readonly assignedAdminId?: string | null;
}

export interface NormalizedOutreachImportRow {
  readonly displayName: string | null;
  readonly phoneE164: string | null;
  readonly telegramUsername: string | null;
  readonly telegramUsernameNormalized: string | null;
  readonly maxIdentifier: string | null;
  readonly maxIdentifierNormalized: string | null;
  readonly email: string | null;
  readonly emailNormalized: string | null;
  readonly source: string | null;
  readonly note: string | null;
}

/**
 * Что умеет посчитать база. Пропущенные строки считает сервис — база их не видит,
 * до неё доходят только разобранные.
 */
export type OutreachImportCounts = Omit<
  OutreachImportResult,
  "invalidRows" | "invalidRowIndexes" | "ambiguousRows"
> & { readonly ambiguousRowIndexes: readonly number[] };

/** То же для загрузки прямо в базу: пропущенные строки считает сервис, база их не видит. */
export type OutreachBaseImportCounts = Omit<
  OutreachBaseImportResult,
  "invalidRows" | "invalidRowIndexes" | "ambiguousRows"
> & { readonly ambiguousRowIndexes: readonly number[] };

export interface OutreachExportRow {
  readonly displayName: string | null;
  readonly phone: string | null;
  readonly telegramUsername: string | null;
  readonly maxIdentifier: string | null;
  readonly source: string | null;
  readonly assignedAdminName: string | null;
  readonly stage: OutreachPipelineStage;
  readonly lostReason: OutreachLostReason | null;
  readonly status: OutreachContactStatus;
  readonly lastChannel: OutreachChannel | null;
  readonly lastActivityAt: string | null;
  readonly nextContactAt: string | null;
  readonly linkedUserId: string | null;
  readonly note: string | null;
}

export interface AdminOutreachRepository {
  listCampaigns(includeArchived: boolean): Promise<readonly OutreachCampaignSummary[]>;
  listEventParticipantRows(eventId: string): Promise<readonly OutreachImportRow[]>;
  listBaseContacts(input: {
    readonly campaignId: string;
    readonly search: string | null;
    readonly onlyMissing: boolean;
    readonly limit: number;
  }): Promise<readonly OutreachBaseContact[]>;
  addExistingContacts(input: {
    readonly campaignId: string;
    readonly contacts: readonly {
      readonly contactId: string;
      readonly campaignContactId: string;
    }[];
    readonly assignedAdminId: string;
    readonly now: Date;
  }): Promise<AddExistingContactsResult>;
  archiveCampaign(input: {
    readonly campaignId: string;
    readonly adminId: string;
    readonly at: Date;
  }): Promise<boolean>;
  restoreCampaign(campaignId: string): Promise<boolean>;
  removeContacts(input: {
    readonly campaignId: string;
    readonly campaignContactIds: readonly string[];
    readonly adminId: string;
    readonly now: Date;
  }): Promise<number>;
  moveContacts(input: {
    readonly campaignContactIds: readonly string[];
    readonly targetCampaignId: string;
    readonly now: Date;
  }): Promise<MoveOutreachContactsResult>;
  getCampaign(campaignId: string): Promise<OutreachCampaignSummary | null>;
  createCampaign(input: {
    readonly eventId: string | null;
    readonly id: string;
    readonly name: string;
    readonly description: string | null;
    readonly status: OutreachCampaignStatus;
    readonly createdByAdminId: string;
    readonly now: Date;
  }): Promise<void>;
  updateCampaign(input: {
    readonly eventId?: string | null;
    readonly campaignId: string;
    readonly name?: string;
    readonly description?: string | null;
    readonly status?: OutreachCampaignStatus;
    readonly requireOpenTask?: boolean;
    readonly callWindowStart?: number;
    readonly callWindowEnd?: number;
    readonly now: Date;
  }): Promise<boolean>;
  listPipelineColumns(
    campaignId: string
  ): Promise<readonly OutreachPipelineColumn[]>;
  // Replaces the campaign's entire column set: rows whose stage id is not in
  // `columns` are deleted (fails with "stage_in_use" if contacts still sit in
  // them), rows with a matching stage id are updated, and the remainder are
  // inserted as brand-new stages. This is how add/remove/rename/reorder are
  // all expressed as one call.
  updatePipelineColumns(input: {
    readonly campaignId: string;
    readonly columns: readonly OutreachPipelineColumn[];
    readonly now: Date;
  }): Promise<"updated" | "not_found" | "stage_in_use">;
  // Looks up the won/lost/open outcome of one stage, scoped through a
  // campaign contact so the caller does not need to know the campaign id.
  // Returns null when that stage no longer exists for the contact's campaign.
  getPipelineColumnOutcome(input: {
    readonly campaignContactId: string;
    readonly stage: string;
  }): Promise<OutreachPipelineColumnOutcome | null>;
  /**
   * Требует ли воронка следующего шага и есть ли он сейчас.
   *
   * `null` — строки участия нет. Проверка одна на перенос карточки и на запись касания:
   * без задачи карточка остаётся лежать, и вспомнить о ней некому.
   */
  getTaskGuard(input: {
    readonly campaignContactId: string;
  }): Promise<{
    readonly requireOpenTask: boolean;
    readonly hasOpenTask: boolean;
  } | null>;
  listCustomFieldDefinitions(
    campaignId: string
  ): Promise<readonly OutreachCustomFieldDefinition[]>;
  createCustomFieldDefinition(input: {
    readonly id: string;
    readonly campaignId: string | null;
    readonly key: string;
    readonly label: string;
    readonly type: OutreachCustomFieldType;
    readonly options: readonly string[] | null;
    readonly createdByAdminId: string;
    readonly now: Date;
  }): Promise<OutreachCustomFieldDefinition>;
  deleteCustomFieldDefinition(fieldId: string): Promise<boolean>;
  setCustomFieldValue(input: {
    readonly campaignContactId: string;
    readonly fieldId: string;
    readonly value: string | null;
    readonly now: Date;
  }): Promise<boolean>;
  /** Правила автозадач воронки. Пусто — правил не заводили. */
  listTaskRules(campaignId: string): Promise<readonly OutreachTaskRule[]>;
  updateTaskRule(input: {
    readonly ruleId: string;
    readonly changes: UpdateOutreachTaskRuleRequest;
    readonly now: Date;
  }): Promise<OutreachTaskRule | null>;
  listTaskBoard(input: {
    readonly assignedAdminId: string | null;
    readonly now: Date;
  }): Promise<readonly Omit<OutreachTaskBoardItem, "urgency">[]>;
  listContacts(input: {
    readonly campaignId: string;
    readonly search: string | null;
    readonly status: OutreachContactStatus | null;
    readonly stage: OutreachPipelineStage | null;
    readonly assignedAdminId: string | null;
    readonly page: number;
    readonly limit: number;
  }): Promise<OutreachCampaignContactPage>;
  getContact(campaignContactId: string): Promise<OutreachCampaignContactDetail | null>;
  /** Общая база: люди, а не их участия в кампаниях. */
  listPeople(input: {
    readonly search: string | null;
    readonly filter: OutreachPersonFilter;
    readonly page: number;
    readonly limit: number;
  }): Promise<OutreachPersonPage>;
  /** `viewerAdminId` нужен заметкам: снять свою может только автор, и знать это карточке. */
  getPerson(
    contactId: string,
    viewerAdminId: string
  ): Promise<OutreachPersonCard | null>;
  updatePerson(input: {
    readonly contactId: string;
    readonly fields: NormalizedOutreachImportRow;
    /** Признаки, которые правка меняет, — их проверяют на занятость другим человеком. */
    readonly conflictCandidates: readonly {
      readonly field: OutreachPersonConflict["field"];
      readonly value: string;
    }[];
    /** `undefined` — не трогать, `null` — снять ответственного. */
    readonly assignedAdminId: string | null | undefined;
    /** `undefined` — не трогать, `null` — встреча отменена. */
    readonly nextMeetingAt: Date | null | undefined;
    readonly actorAdminId: string;
    readonly auditId: string;
    readonly now: Date;
  }): Promise<OutreachPersonUpdateResult>;
  /** Значение общего поля у человека. Пустое значение стирает строку. */
  setPersonFieldValue(input: {
    readonly contactId: string;
    readonly fieldId: string;
    readonly value: string | null;
    readonly now: Date;
  }): Promise<boolean>;
  archivePerson(input: {
    readonly contactId: string;
    readonly reason: string | null;
    readonly actorAdminId: string;
    readonly auditId: string;
    readonly now: Date;
  }): Promise<boolean>;
  restorePerson(input: {
    readonly contactId: string;
    readonly actorAdminId: string;
    readonly auditId: string;
    readonly now: Date;
  }): Promise<boolean>;
  deletePerson(input: {
    readonly contactId: string;
    readonly reason: string | null;
    readonly actorAdminId: string;
    readonly auditId: string;
    readonly now: Date;
  }): Promise<DeleteOutreachPersonResult>;
  startImport(input: {
    readonly importId: string;
    readonly createdByAdminId: string;
    readonly filename: string | null;
    readonly campaignId: string | null;
    readonly now: Date;
  }): Promise<void>;
  recordImportOutcome(input: {
    readonly importId: string;
    readonly received: number;
    readonly createdContacts: number;
    readonly updatedContacts: number;
    readonly failedRows: readonly {
      readonly id: string;
      readonly lineNumber: number;
      readonly raw: OutreachImportRow;
      readonly status: "invalid" | "ambiguous";
      readonly reason: string | null;
    }[];
    readonly now: Date;
  }): Promise<void>;
  listImports(limit: number): Promise<readonly OutreachImportRun[]>;
  listPendingImportRows(input: {
    readonly importId: string | null;
    readonly limit: number;
  }): Promise<readonly OutreachImportRowRecord[]>;
  getPendingImportRow(rowId: string): Promise<OutreachImportRowRecord | null>;
  retryImportRow(input: {
    readonly rowId: string;
    readonly row: NormalizedOutreachImportRow & { readonly contactId: string };
    readonly actorAdminId: string;
    readonly now: Date;
  }): Promise<RetryOutreachImportRowResult>;
  dismissImportRow(input: {
    readonly rowId: string;
    readonly actorAdminId: string;
    readonly now: Date;
  }): Promise<boolean>;
  /** Загрузка прямо в базу, без кампании. */
  importPeople(input: {
    readonly createdByAdminId: string;
    readonly rows: readonly (NormalizedOutreachImportRow & {
      readonly contactId: string;
    })[];
    readonly skipAmbiguous: boolean;
    readonly now: Date;
  }): Promise<OutreachBaseImportCounts>;
  /** contactId — дубль, targetContactId — главный, к которому его сводят. */
  mergePeople(input: {
    readonly contactId: string;
    readonly targetContactId: string;
    readonly reason: string | null;
    readonly actorAdminId: string;
    readonly auditId: string;
    readonly now: Date;
  }): Promise<MergeOutreachPeopleResult>;
  importContacts(input: {
    readonly campaignId: string;
    /**
     * Ответственный за добавленные контакты. `null` — оставить без ответственного: так
     * приходят участники мероприятия, которых заводит работник, а не человек. Записывать
     * ответственным служебную учётку нельзя — менеджеры фильтруют доску по себе, и чужой
     * ответственный прячет контакт от всех сразу.
     */
    readonly assignedAdminId: string | null;
    readonly createdByAdminId: string;
    readonly rows: readonly (NormalizedOutreachImportRow & {
      readonly contactId: string;
      readonly campaignContactId: string;
    })[];
    /**
     * Пропускать строки, чьи опознаватели указывают на разные контакты, вместо отказа от
     * всей пачки. При загрузке файла такая строка не должна отменять сто пятьдесят соседних.
     */
    readonly skipAmbiguous: boolean;
    readonly now: Date;
  }): Promise<OutreachImportCounts>;
  assignContacts(input: {
    readonly campaignContactIds: readonly string[];
    readonly assignedAdminId: string;
    readonly now: Date;
  }): Promise<number>;
  recordActivities(input: {
    readonly activities: readonly {
      readonly id: string;
      readonly campaignContactId: string;
      readonly stageHistoryId: string | null;
      readonly taskId: string | null;
    }[];
    readonly actorAdminId: string;
    readonly action: "message" | "call";
    readonly channel: OutreachChannel;
    readonly result: Exclude<OutreachContactStatus, "new">;
    readonly note: string | null;
    readonly batchId: string | null;
    readonly stage: OutreachPipelineStage | null;
    readonly lostReason: OutreachLostReason | null;
    readonly nextContactAt: Date | null;
    readonly occurredAt: Date;
  }): Promise<number>;
  updateContactStage(input: {
    readonly campaignContactId: string;
    readonly actorAdminId: string;
    readonly historyId: string;
    readonly stage: OutreachPipelineStage;
    readonly lostReason: OutreachLostReason | null;
    readonly now: Date;
  }): Promise<boolean>;
  createTask(input: {
    readonly id: string;
    /** Человек, к которому относится задача. Заполняется всегда. */
    readonly contactId: string | null;
    /** Кампания, в рамках которой она поставлена. Пусто — задача про человека вообще. */
    readonly campaignContactId: string | null;
    readonly assignedAdminId: string | null;
    readonly createdByAdminId: string;
    readonly type: OutreachTaskType;
    readonly text: string;
    readonly dueAt: Date;
    readonly now: Date;
  }): Promise<boolean>;
  completeTask(input: {
    readonly taskId: string;
    readonly completedByAdminId: string;
    readonly now: Date;
  }): Promise<boolean>;
  listSiteRegistrations(input: {
    readonly onlyNeedsAttention: boolean;
    readonly page: number;
    readonly limit: number;
  }): Promise<AdminSiteRegistrationPage>;
  markPersonOwn(input: {
    readonly contactId: string;
    readonly isOwn: boolean;
    readonly note: string | null;
    readonly actorAdminId: string;
    readonly now: Date;
  }): Promise<boolean>;
  createNote(input: {
    readonly id: string;
    readonly contactId: string;
    readonly authorAdminId: string;
    readonly body: string;
    readonly now: Date;
  }): Promise<boolean>;
  deleteNote(input: {
    readonly noteId: string;
    readonly actorAdminId: string;
    readonly now: Date;
  }): Promise<boolean>;
  listManagers(): Promise<readonly OutreachManager[]>;
  exportCampaignContacts(campaignId: string): Promise<{
    readonly campaign: OutreachCampaignSummary | null;
    readonly rows: readonly OutreachExportRow[];
  }>;
}

export class AdminOutreachService {
  constructor(
    private readonly repository: AdminOutreachRepository,
    private readonly phoneNormalizer: PhoneNormalizer,
    private readonly idGenerator: IdGenerator
  ) {}

  listCampaigns(input: {
    readonly actor: AdminRequestActor;
    readonly includeArchived?: boolean;
  }): Promise<readonly OutreachCampaignSummary[]> {
    requirePermission(input.actor, "outreach.read");
    return this.repository.listCampaigns(input.includeArchived === true);
  }

  /**
   * Заводит участников мероприятия контактами кампании.
   *
   * Покупатель из бота в общей базе не существует — он живёт в `users`. Контакт на него
   * заводится сам, по телефону и нику: телефон у таких людей подтверждён, поэтому
   * спрашивать по каждому нечего. Совпадения приклеиваются к существующим контактам той
   * же логикой, что и обычный импорт CSV.
   */
  async importEventParticipants(input: {
    readonly actor: AdminRequestActor;
    readonly campaignId: string;
    /**
     * Из какого мероприятия брать участников. Без него берётся мероприятие кампании — но у
     * постоянной воронки направления своего мероприятия нет, и сверка называет его сама.
     */
    readonly eventId?: string;
    /**
     * Не передан — ответственным становится тот, кто нажал кнопку. `null` — контакт
     * остаётся ничьим: так наполняет кампанию работник, у которого хозяина нет.
     */
    readonly assignedAdminId?: string | null;
    readonly now: Date;
  }): Promise<ImportEventParticipantsResult> {
    requirePermission(input.actor, "outreach.write");
    requireUuid(input.campaignId);

    const campaign = await this.repository.getCampaign(input.campaignId);
    if (!campaign) {
      throw new Error("Outreach campaign was not found");
    }
    const eventId = input.eventId ?? campaign.eventId;
    if (!eventId) {
      throw new Error("Outreach campaign has no event to import from");
    }
    if (input.eventId) {
      requireUuid(input.eventId);
    }

    const rows = await this.repository.listEventParticipantRows(eventId);
    if (rows.length === 0) {
      return {
        received: 0,
        createdContacts: 0,
        updatedContacts: 0,
        addedToCampaign: 0,
        alreadyInCampaign: 0,
        invalidRows: 0,
        invalidRowIndexes: [],
        ambiguousRows: 0,
        ambiguousRowIndexes: [],
        eventTitle: campaign.eventTitle ?? ""
      };
    }

    // Пачками по 500: столько же, сколько принимает обычный импорт, и столько же
    // держится одна транзакция.
    let received = 0;
    let createdContacts = 0;
    let updatedContacts = 0;
    let addedToCampaign = 0;
    let alreadyInCampaign = 0;
    let invalidRows = 0;
    let ambiguousRows = 0;
    for (let offset = 0; offset < rows.length; offset += 500) {
      const batch = await this.importContacts({
        actor: input.actor,
        campaignId: input.campaignId,
        ...(input.assignedAdminId === undefined
          ? {}
          : { assignedAdminId: input.assignedAdminId }),
        rows: rows.slice(offset, offset + 500),
        skipInvalid: true,
        now: input.now
      });
      invalidRows += batch.invalidRows;
      ambiguousRows += batch.ambiguousRows;
      received += batch.received;
      createdContacts += batch.createdContacts;
      updatedContacts += batch.updatedContacts;
      addedToCampaign += batch.addedToCampaign;
      alreadyInCampaign += batch.alreadyInCampaign;
    }

    return {
      received,
      createdContacts,
      updatedContacts,
      addedToCampaign,
      alreadyInCampaign,
      invalidRows,
      invalidRowIndexes: [],
      ambiguousRows,
      ambiguousRowIndexes: [],
      eventTitle: campaign.eventTitle ?? ""
    };
  }

  /**
   * Контакты общей базы для добавления в кампанию. База живёт отдельно от кампаний:
   * человек в ней один, а кампаний, где он участвует, может быть несколько.
   */
  listBaseContacts(input: {
    readonly actor: AdminRequestActor;
    readonly campaignId: string;
    readonly search?: string;
    readonly onlyMissing?: boolean;
    readonly limit?: number;
  }): Promise<readonly OutreachBaseContact[]> {
    requirePermission(input.actor, "outreach.read");
    requireUuid(input.campaignId);
    const search = input.search?.trim() ?? "";
    return this.repository.listBaseContacts({
      campaignId: input.campaignId,
      search: search.length >= 2 ? search : null,
      onlyMissing: input.onlyMissing !== false,
      limit: Math.min(Math.max(input.limit ?? 100, 1), 500)
    });
  }

  async addExistingContacts(input: {
    readonly actor: AdminRequestActor;
    readonly campaignId: string;
    readonly contactIds: readonly string[];
    readonly assignedAdminId?: string;
    readonly now: Date;
  }): Promise<AddExistingContactsResult> {
    requirePermission(input.actor, "outreach.write");
    requireUuid(input.campaignId);
    requireIds(input.contactIds);
    for (const contactId of input.contactIds) {
      requireUuid(contactId);
    }
    const assignedAdminId = input.assignedAdminId ?? input.actor.adminId;
    requireUuid(assignedAdminId);

    return this.repository.addExistingContacts({
      campaignId: input.campaignId,
      contacts: unique(input.contactIds).map((contactId) => ({
        contactId,
        campaignContactId: this.idGenerator.newId()
      })),
      assignedAdminId,
      now: input.now
    });
  }

  async archiveCampaign(input: {
    readonly actor: AdminRequestActor;
    readonly campaignId: string;
    readonly now: Date;
  }): Promise<void> {
    requirePermission(input.actor, "outreach.write");
    requireUuid(input.campaignId);
    const archived = await this.repository.archiveCampaign({
      campaignId: input.campaignId,
      adminId: input.actor.adminId,
      at: input.now
    });
    if (!archived) {
      throw new Error("Outreach campaign was not found");
    }
  }

  async restoreCampaign(input: {
    readonly actor: AdminRequestActor;
    readonly campaignId: string;
  }): Promise<void> {
    requirePermission(input.actor, "outreach.write");
    requireUuid(input.campaignId);
    const restored = await this.repository.restoreCampaign(input.campaignId);
    if (!restored) {
      throw new Error("Outreach campaign was not found");
    }
  }

  /**
   * Переносит контакты в другую кампанию. Сам человек остаётся в общей базе — меняется
   * только то, в какой работе он числится. Стадия сбрасывается на первую в кампании
   * назначения: у каждой кампании свои стадии, и чужая там просто не существует.
   */
  /**
   * Убирает контакты из кампании. Человек остаётся в общей базе и в других кампаниях —
   * уходит только эта работа по нему, а её история сохраняется.
   */
  async removeContacts(input: {
    readonly actor: AdminRequestActor;
    readonly campaignId: string;
    readonly campaignContactIds: readonly string[];
    readonly now: Date;
  }): Promise<{ readonly removed: number }> {
    requirePermission(input.actor, "outreach.write");
    requireUuid(input.campaignId);
    requireIds(input.campaignContactIds);
    for (const contactId of input.campaignContactIds) {
      requireUuid(contactId);
    }

    return {
      removed: await this.repository.removeContacts({
        campaignId: input.campaignId,
        campaignContactIds: unique(input.campaignContactIds),
        adminId: input.actor.adminId,
        now: input.now
      })
    };
  }

  async moveContacts(input: {
    readonly actor: AdminRequestActor;
    readonly campaignContactIds: readonly string[];
    readonly targetCampaignId: string;
    readonly now: Date;
  }): Promise<MoveOutreachContactsResult> {
    requirePermission(input.actor, "outreach.write");
    requireIds(input.campaignContactIds);
    requireUuid(input.targetCampaignId);
    for (const contactId of input.campaignContactIds) {
      requireUuid(contactId);
    }

    return this.repository.moveContacts({
      campaignContactIds: unique(input.campaignContactIds),
      targetCampaignId: input.targetCampaignId,
      now: input.now
    });
  }

  async getCampaign(input: {
    readonly actor: AdminRequestActor;
    readonly campaignId: string;
  }): Promise<OutreachCampaignSummary | null> {
    requirePermission(input.actor, "outreach.read");
    requireUuid(input.campaignId);
    return this.repository.getCampaign(input.campaignId);
  }

  async createCampaign(input: {
    readonly actor: AdminRequestActor;
    readonly name: string;
    readonly description?: string;
    readonly status?: OutreachCampaignStatus;
    readonly eventId?: string;
    readonly now: Date;
  }): Promise<OutreachCampaignSummary> {
    requirePermission(input.actor, "outreach.write");
    const name = requiredText(input.name, 200, "Outreach campaign name");
    const description = optionalText(input.description, 2000);
    if (input.eventId !== undefined) {
      requireUuid(input.eventId);
    }
    const id = this.idGenerator.newId();
    await this.repository.createCampaign({
      id,
      name,
      description,
      status: input.status ?? "active",
      eventId: input.eventId ?? null,
      createdByAdminId: input.actor.adminId,
      now: input.now
    });
    const campaign = await this.repository.getCampaign(id);
    if (!campaign) {
      throw new Error("Outreach campaign creation failed");
    }
    return campaign;
  }

  async updateCampaign(input: {
    readonly actor: AdminRequestActor;
    readonly campaignId: string;
    readonly name?: string;
    readonly description?: string | null;
    readonly status?: OutreachCampaignStatus;
    readonly eventId?: string | null;
    readonly requireOpenTask?: boolean;
    readonly callWindowStart?: number;
    readonly callWindowEnd?: number;
    readonly now: Date;
  }): Promise<OutreachCampaignSummary | null> {
    requirePermission(input.actor, "outreach.write");
    requireUuid(input.campaignId);
    // Окно обзвона правится по частям, а проверять его надо целиком: недостающую половину
    // берём из того, что стоит сейчас, иначе «с девятнадцати до девятнадцати» пройдёт.
    if (
      input.callWindowStart !== undefined
      || input.callWindowEnd !== undefined
    ) {
      const current = await this.repository.getCampaign(input.campaignId);
      const start = input.callWindowStart ?? current?.callWindowStart ?? 12;
      const end = input.callWindowEnd ?? current?.callWindowEnd ?? 19;
      if (start >= end) {
        throw new Error("Outreach call window is invalid");
      }
    }
    if (input.eventId !== undefined && input.eventId !== null) {
      requireUuid(input.eventId);
    }
    const changed = await this.repository.updateCampaign({
      campaignId: input.campaignId,
      ...(input.eventId === undefined ? {} : { eventId: input.eventId }),
      ...(input.name === undefined
        ? {}
        : { name: requiredText(input.name, 200, "Outreach campaign name") }),
      ...(input.description === undefined
        ? {}
        : { description: optionalText(input.description ?? undefined, 2000) }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.requireOpenTask === undefined
        ? {}
        : { requireOpenTask: input.requireOpenTask }),
      ...(input.callWindowStart === undefined
        ? {}
        : { callWindowStart: input.callWindowStart }),
      ...(input.callWindowEnd === undefined
        ? {}
        : { callWindowEnd: input.callWindowEnd }),
      now: input.now
    });
    return changed ? this.repository.getCampaign(input.campaignId) : null;
  }

  /**
   * Правила автозадач воронки.
   *
   * Их заводит миграция, а кабинет включает, выключает и переписывает: набор поводов — это
   * то, что умеет автоматика, а не то, что придумывает менеджер.
   */
  async listTaskRules(input: {
    readonly actor: AdminRequestActor;
    readonly campaignId: string;
  }): Promise<readonly OutreachTaskRule[]> {
    requirePermission(input.actor, "outreach.read");
    requireUuid(input.campaignId);
    return this.repository.listTaskRules(input.campaignId);
  }

  async updateTaskRule(input: {
    readonly actor: AdminRequestActor;
    readonly ruleId: string;
    readonly changes: UpdateOutreachTaskRuleRequest;
    readonly now: Date;
  }): Promise<OutreachTaskRule | null> {
    requirePermission(input.actor, "outreach.write");
    requireUuid(input.ruleId);
    if (input.changes.taskText !== undefined) {
      requiredText(input.changes.taskText, 500, "Outreach task text");
    }
    if (
      input.changes.offsetDays !== undefined
      && (!Number.isInteger(input.changes.offsetDays)
        || Math.abs(input.changes.offsetDays) > 30)
    ) {
      throw new Error("Outreach task rule offset is invalid");
    }
    // Час нужен только тогда, когда окно обзвона не используется: иначе он ничего не
    // значит, и хранить его — значит хранить настройку, которая ни на что не влияет.
    const useCallWindow = input.changes.useCallWindow;
    const atHour = input.changes.atHour;
    if (
      useCallWindow === false
      && (atHour === undefined || atHour === null)
    ) {
      throw new Error("Outreach task rule needs an hour without the call window");
    }
    if (
      atHour !== undefined
      && atHour !== null
      && (!Number.isInteger(atHour) || atHour < 0 || atHour > 23)
    ) {
      throw new Error("Outreach task rule hour is invalid");
    }
    return this.repository.updateTaskRule({
      ruleId: input.ruleId,
      changes: input.changes,
      now: input.now
    });
  }

  listPipelineColumns(input: {
    readonly actor: AdminRequestActor;
    readonly campaignId: string;
  }): Promise<readonly OutreachPipelineColumn[]> {
    requirePermission(input.actor, "outreach.read");
    requireUuid(input.campaignId);
    return this.repository.listPipelineColumns(input.campaignId);
  }

  async updatePipelineColumns(input: {
    readonly actor: AdminRequestActor;
    readonly campaignId: string;
    readonly columns: readonly {
      // Omit stage (or pass one unknown to this campaign) to add a new
      // column; an existing stage id renames/reorders/re-flags that column.
      readonly stage?: string;
      readonly label: string;
      readonly outcome: OutreachPipelineColumnOutcome;
    }[];
    readonly now: Date;
  }): Promise<{ readonly updated: boolean }> {
    requirePermission(input.actor, "outreach.write");
    requireUuid(input.campaignId);
    if (
      input.columns.length < 1
      || input.columns.length > OUTREACH_MAX_PIPELINE_COLUMNS
    ) {
      throw new Error("Outreach pipeline column count is invalid");
    }
    const allowedOutcomes = new Set<string>(OUTREACH_PIPELINE_COLUMN_OUTCOMES);
    const seenStages = new Set<string>();
    const columns: OutreachPipelineColumn[] = input.columns.map(
      (column, index) => {
        if (!allowedOutcomes.has(column.outcome)) {
          throw new Error("Outreach pipeline column outcome is invalid");
        }
        const stage = column.stage && STAGE_ID_PATTERN.test(column.stage)
          ? column.stage
          : newStageId(this.idGenerator);
        if (seenStages.has(stage)) {
          throw new Error("Outreach pipeline column ids must be unique");
        }
        seenStages.add(stage);
        return {
          stage,
          label: requiredText(column.label, 60, "Outreach pipeline column label"),
          outcome: column.outcome,
          position: index + 1
        };
      }
    );
    const result = await this.repository.updatePipelineColumns({
      campaignId: input.campaignId,
      columns,
      now: input.now
    });
    if (result === "stage_in_use") {
      throw new Error(
        "Outreach pipeline stage still has contacts assigned to it"
      );
    }
    return { updated: result === "updated" };
  }

  listCustomFieldDefinitions(input: {
    readonly actor: AdminRequestActor;
    readonly campaignId: string;
  }): Promise<readonly OutreachCustomFieldDefinition[]> {
    requirePermission(input.actor, "outreach.read");
    requireUuid(input.campaignId);
    return this.repository.listCustomFieldDefinitions(input.campaignId);
  }

  async createCustomFieldDefinition(input: {
    readonly actor: AdminRequestActor;
    readonly campaignId?: string | null;
    readonly label: string;
    readonly type: OutreachCustomFieldType;
    readonly options?: readonly string[];
    readonly now: Date;
  }): Promise<OutreachCustomFieldDefinition> {
    requirePermission(input.actor, "outreach.write");
    if (input.campaignId) {
      requireUuid(input.campaignId);
    }
    if (!(OUTREACH_CUSTOM_FIELD_TYPES as readonly string[]).includes(input.type)) {
      throw new Error("Outreach custom field type is invalid");
    }
    const label = requiredText(input.label, 80, "Outreach custom field label");
    let options: readonly string[] | null = null;
    if (input.type === "select") {
      const trimmed = [...new Set(
        (input.options ?? [])
          .map((option) => option.trim())
          .filter((option) => option.length > 0)
      )];
      if (trimmed.length < 1 || trimmed.length > 50) {
        throw new Error("Outreach custom field options are invalid");
      }
      options = trimmed;
    } else if (input.options && input.options.length > 0) {
      throw new Error(
        "Outreach custom field options are only valid for a select field"
      );
    }
    return this.repository.createCustomFieldDefinition({
      id: this.idGenerator.newId(),
      campaignId: input.campaignId ?? null,
      key: newStageId(this.idGenerator).replace("s_", "f_"),
      label,
      type: input.type,
      options,
      createdByAdminId: input.actor.adminId,
      now: input.now
    });
  }

  async deleteCustomFieldDefinition(input: {
    readonly actor: AdminRequestActor;
    readonly fieldId: string;
  }): Promise<{ readonly deleted: boolean }> {
    requirePermission(input.actor, "outreach.write");
    requireUuid(input.fieldId);
    return {
      deleted: await this.repository.deleteCustomFieldDefinition(input.fieldId)
    };
  }

  async setCustomFieldValue(input: {
    readonly actor: AdminRequestActor;
    readonly campaignContactId: string;
    readonly fieldId: string;
    readonly value: string | null;
    readonly now: Date;
  }): Promise<{ readonly updated: boolean }> {
    requirePermission(input.actor, "outreach.write");
    requireUuid(input.campaignContactId);
    requireUuid(input.fieldId);
    return {
      updated: await this.repository.setCustomFieldValue({
        campaignContactId: input.campaignContactId,
        fieldId: input.fieldId,
        value: input.value === null ? null : optionalText(input.value, 500),
        now: input.now
      })
    };
  }

  async listTaskBoard(input: {
    readonly actor: AdminRequestActor;
    readonly onlyMine?: boolean;
    readonly now: Date;
  }): Promise<readonly OutreachTaskBoardItem[]> {
    requirePermission(input.actor, "outreach.read");
    const rows = await this.repository.listTaskBoard({
      assignedAdminId: input.onlyMine ? input.actor.adminId : null,
      now: input.now
    });
    return rows.map((row) => ({
      ...row,
      urgency: row.status === "completed"
        ? "completed"
        : computeTaskUrgency(new Date(row.dueAt), input.now)
    }));
  }

  listContacts(input: {
    readonly actor: AdminRequestActor;
    readonly campaignId: string;
    readonly search?: string;
    readonly status?: OutreachContactStatus;
    readonly stage?: OutreachPipelineStage;
    readonly assignedAdminId?: string;
    readonly mine?: boolean;
    readonly page?: number;
    readonly limit?: number;
  }): Promise<OutreachCampaignContactPage> {
    requirePermission(input.actor, "outreach.read");
    requireUuid(input.campaignId);
    const page = input.page ?? 1;
    const limit = input.limit ?? 50;
    if (!Number.isSafeInteger(page) || page < 1 || page > 100_000) {
      throw new Error("Outreach page is invalid");
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new Error("Outreach page limit is invalid");
    }
    if (input.assignedAdminId) {
      requireUuid(input.assignedAdminId);
    }
    return this.repository.listContacts({
      campaignId: input.campaignId,
      search: optionalText(input.search, 100),
      status: input.status ?? null,
      stage: input.stage ?? null,
      assignedAdminId: input.mine
        ? input.actor.adminId
        : input.assignedAdminId ?? null,
      page,
      limit
    });
  }

  getContact(input: {
    readonly actor: AdminRequestActor;
    readonly campaignContactId: string;
  }): Promise<OutreachCampaignContactDetail | null> {
    requirePermission(input.actor, "outreach.read");
    requireUuid(input.campaignContactId);
    return this.repository.getContact(input.campaignContactId);
  }

  listPeople(input: {
    readonly actor: AdminRequestActor;
    readonly search?: string;
    readonly filter?: OutreachPersonFilter;
    readonly page?: number;
    readonly limit?: number;
  }): Promise<OutreachPersonPage> {
    requirePermission(input.actor, "outreach.read");
    const page = input.page ?? 1;
    const limit = input.limit ?? 50;
    if (page < 1 || limit < 1 || limit > 200) {
      throw new Error("Outreach people page is invalid");
    }
    return this.repository.listPeople({
      search: input.search?.trim() || null,
      filter: input.filter ?? "all",
      page,
      limit
    });
  }

  getPerson(input: {
    readonly actor: AdminRequestActor;
    readonly contactId: string;
  }): Promise<OutreachPersonCard | null> {
    requirePermission(input.actor, "outreach.read");
    requireUuid(input.contactId);
    return this.repository.getPerson(input.contactId, input.actor.adminId);
  }

  async updatePerson(input: {
    readonly actor: AdminRequestActor;
    readonly contactId: string;
    readonly changes: UpdateOutreachPersonRequest;
    readonly now: Date;
  }): Promise<OutreachPersonUpdateResult> {
    requirePermission(input.actor, "outreach.write");
    requireUuid(input.contactId);

    const current = await this.repository.getPerson(
      input.contactId,
      input.actor.adminId
    );
    if (!current) {
      return { status: "not_found" };
    }

    // Правка идёт через тот же разбор, что и импорт: иначе исправленный руками телефон лёг бы
    // в базу в том виде, в каком его набрали, и человек перестал бы находиться поиском.
    const merged = {
      name: pick(input.changes.name, current.displayName),
      phone: pick(input.changes.phone, current.phone),
      telegram: pick(input.changes.telegram, current.telegramUsername),
      max: pick(input.changes.max, current.maxIdentifier),
      email: pick(input.changes.email, current.email)
    };
    const { identity, rejections, hasIdentifier } = normalizeContactInput(merged, {
      parsePhone: (candidate) => {
        try {
          return this.phoneNormalizer.normalize(candidate);
        } catch {
          return null;
        }
      }
    });
    // Правка — ручное действие, поэтому про непонятое поле говорим сразу, как в ручной форме.
    const blocking = rejections.find((rejection) => rejection.field !== "name");
    if (blocking) {
      throw new Error(REJECTION_MESSAGES[blocking.reason]);
    }
    if (!hasIdentifier) {
      throw new Error("Outreach contact identity is invalid");
    }

    const fields: NormalizedOutreachImportRow = {
      displayName: identity.name,
      phoneE164: identity.phoneE164,
      telegramUsername: identity.telegramUsername,
      telegramUsernameNormalized: identity.telegramUsernameNormalized,
      maxIdentifier: identity.maxIdentifier,
      maxIdentifierNormalized: identity.maxIdentifierNormalized,
      email: identity.email,
      emailNormalized: identity.emailNormalized,
      source: optionalText(pick(input.changes.source, current.source) ?? "", 200),
      note: optionalText(pick(input.changes.note, current.note) ?? "", 2000)
    };

    // На занятость проверяем только то, что действительно поменялось: иначе контакт
    // конфликтовал бы сам с собой при любой правке имени.
    const conflictCandidates: {
      readonly field: OutreachPersonConflict["field"];
      readonly value: string;
    }[] = [];
    if (fields.phoneE164 && fields.phoneE164 !== current.phone) {
      conflictCandidates.push({ field: "phone", value: fields.phoneE164 });
    }
    if (
      fields.telegramUsernameNormalized
      && fields.telegramUsernameNormalized !== current.telegramUsername?.toLowerCase()
    ) {
      conflictCandidates.push({
        field: "telegram",
        value: fields.telegramUsernameNormalized
      });
    }
    if (
      fields.maxIdentifierNormalized
      && fields.maxIdentifierNormalized !== current.maxIdentifier?.toLowerCase()
    ) {
      conflictCandidates.push({
        field: "max",
        value: fields.maxIdentifierNormalized
      });
    }
    if (
      fields.emailNormalized
      && fields.emailNormalized !== current.email?.toLowerCase()
    ) {
      conflictCandidates.push({ field: "email", value: fields.emailNormalized });
    }

    // Ответственный и встреча идут мимо разбора опознавателей: они ничего не говорят о том,
    // как человека найти, и проверять их на занятость незачем.
    const assignedAdminId = input.changes.assignedAdminId === undefined
      ? undefined
      : input.changes.assignedAdminId || null;
    if (assignedAdminId) {
      requireUuid(assignedAdminId);
    }
    const nextMeetingAt = input.changes.nextMeetingAt === undefined
      ? undefined
      : parseOptionalInstant(input.changes.nextMeetingAt);

    return this.repository.updatePerson({
      contactId: input.contactId,
      fields,
      conflictCandidates,
      assignedAdminId,
      nextMeetingAt,
      actorAdminId: input.actor.adminId,
      auditId: this.idGenerator.newId(),
      now: input.now
    });
  }

  /**
   * Ниша, запрос и прочие общие поля.
   *
   * Отдельной ручкой, а не частью правки карточки: поля заводятся администратором и
   * набор их заранее неизвестен, а правка карточки — это фиксированный список признаков,
   * каждый из которых проверяется на занятость другим человеком.
   */
  async setPersonField(input: {
    readonly actor: AdminRequestActor;
    readonly contactId: string;
    readonly fieldId: string;
    readonly value: string | null;
    readonly now: Date;
  }): Promise<{ readonly saved: boolean }> {
    requirePermission(input.actor, "outreach.write");
    requireUuid(input.contactId);
    requireUuid(input.fieldId);
    return {
      saved: await this.repository.setPersonFieldValue({
        contactId: input.contactId,
        fieldId: input.fieldId,
        value: optionalText(input.value ?? "", 500),
        now: input.now
      })
    };
  }

  async archivePerson(input: {
    readonly actor: AdminRequestActor;
    readonly contactId: string;
    readonly reason?: string;
    readonly now: Date;
  }): Promise<boolean> {
    requirePermission(input.actor, "outreach.write");
    requireUuid(input.contactId);
    return this.repository.archivePerson({
      contactId: input.contactId,
      reason: optionalText(input.reason ?? "", 500),
      actorAdminId: input.actor.adminId,
      auditId: this.idGenerator.newId(),
      now: input.now
    });
  }

  async restorePerson(input: {
    readonly actor: AdminRequestActor;
    readonly contactId: string;
    readonly now: Date;
  }): Promise<boolean> {
    requirePermission(input.actor, "outreach.write");
    requireUuid(input.contactId);
    return this.repository.restorePerson({
      contactId: input.contactId,
      actorAdminId: input.actor.adminId,
      auditId: this.idGenerator.newId(),
      now: input.now
    });
  }

  /**
   * Загрузка прямо в базу, без кампании.
   *
   * Раньше файл можно было залить только внутрь кампании, и чтобы просто пополнить базу,
   * приходилось заводить кампанию-пустышку. Кампания — это временная работа по человеку, а
   * база живёт постоянно; требовать первую ради второй неправильно.
   */
  async importPeople(input: {
    readonly actor: AdminRequestActor;
    readonly rows: readonly OutreachImportRow[];
    /** Загрузка, к которой относится пачка. Без неё журнал не ведётся. */
    readonly importId?: string;
    /** Номера строк файла по порядку строк пачки — по ним человек находит строку у себя. */
    readonly lines?: readonly number[];
    readonly now: Date;
  }): Promise<OutreachBaseImportResult> {
    requirePermission(input.actor, "outreach.write");
    if (input.rows.length < 1 || input.rows.length > 500) {
      throw new Error("Outreach import batch is invalid");
    }
    if (input.lines !== undefined && input.lines.length !== input.rows.length) {
      throw new Error("Outreach import line numbers are invalid");
    }

    const rows: (NormalizedOutreachImportRow & {
      readonly contactId: string;
    })[] = [];
    const invalidRowIndexes: number[] = [];
    input.rows.forEach((row, index) => {
      try {
        rows.push({
          // Загрузка файла всегда мягкая: в выгрузке на тысячи строк пара битых есть всегда,
          // и ронять из-за них всю пачку нельзя.
          ...this.normalizeImportRow(row, false),
          contactId: this.idGenerator.newId()
        });
      } catch {
        invalidRowIndexes.push(index);
      }
    });

    if (rows.length === 0) {
      await this.recordImportOutcome({
        importId: input.importId,
        rows: input.rows,
        lines: input.lines,
        received: input.rows.length,
        createdContacts: 0,
        updatedContacts: 0,
        invalidRowIndexes,
        ambiguousRowIndexes: [],
        now: input.now
      });
      return {
        received: input.rows.length,
        createdContacts: 0,
        updatedContacts: 0,
        invalidRows: invalidRowIndexes.length,
        invalidRowIndexes,
        ambiguousRows: 0,
        ambiguousRowIndexes: []
      };
    }

    const result = await this.repository.importPeople({
      createdByAdminId: input.actor.adminId,
      rows,
      skipAmbiguous: true,
      now: input.now
    });
    // База считала спорные строки по отфильтрованному списку — возвращаем их к номерам
    // исходных строк, иначе панель покажет не те строки файла.
    const keptIndexes = input.rows
      .map((_, index) => index)
      .filter((index) => !invalidRowIndexes.includes(index));
    const ambiguousRowIndexes = result.ambiguousRowIndexes
      .map((index) => keptIndexes[index])
      .filter((index): index is number => index !== undefined);

    await this.recordImportOutcome({
      importId: input.importId,
      rows: input.rows,
      lines: input.lines,
      received: input.rows.length,
      createdContacts: result.createdContacts,
      updatedContacts: result.updatedContacts,
      invalidRowIndexes,
      ambiguousRowIndexes,
      now: input.now
    });

    return {
      received: input.rows.length,
      createdContacts: result.createdContacts,
      updatedContacts: result.updatedContacts,
      invalidRows: invalidRowIndexes.length,
      invalidRowIndexes,
      ambiguousRows: ambiguousRowIndexes.length,
      ambiguousRowIndexes
    };
  }

  startImport(input: {
    readonly actor: AdminRequestActor;
    readonly filename?: string;
    readonly campaignId?: string;
    readonly now: Date;
  }): Promise<{ readonly importId: string }> {
    requirePermission(input.actor, "outreach.write");
    if (input.campaignId !== undefined) {
      requireUuid(input.campaignId);
    }
    const importId = this.idGenerator.newId();
    return this.repository.startImport({
      importId,
      createdByAdminId: input.actor.adminId,
      filename: optionalText(input.filename ?? "", 260),
      campaignId: input.campaignId ?? null,
      now: input.now
    }).then(() => ({ importId }));
  }

  listImports(input: {
    readonly actor: AdminRequestActor;
    readonly limit?: number;
  }): Promise<readonly OutreachImportRun[]> {
    requirePermission(input.actor, "outreach.read");
    const limit = input.limit ?? 30;
    if (limit < 1 || limit > 100) {
      throw new Error("Outreach import page is invalid");
    }
    return this.repository.listImports(limit);
  }

  listPendingImportRows(input: {
    readonly actor: AdminRequestActor;
    readonly importId?: string;
    readonly limit?: number;
  }): Promise<readonly OutreachImportRowRecord[]> {
    requirePermission(input.actor, "outreach.read");
    if (input.importId !== undefined) {
      requireUuid(input.importId);
    }
    const limit = input.limit ?? 200;
    if (limit < 1 || limit > 500) {
      throw new Error("Outreach import page is invalid");
    }
    return this.repository.listPendingImportRows({
      importId: input.importId ?? null,
      limit
    });
  }

  /**
   * Повторная попытка по исправленной строке. Разбор строгий, как в ручном вводе: человек
   * только что её правил и должен сразу узнать, что именно всё ещё не так.
   */
  async retryImportRow(input: {
    readonly actor: AdminRequestActor;
    readonly rowId: string;
    readonly row: OutreachImportRow;
    readonly now: Date;
  }): Promise<RetryOutreachImportRowResult> {
    requirePermission(input.actor, "outreach.write");
    requireUuid(input.rowId);
    const pending = await this.repository.getPendingImportRow(input.rowId);
    if (!pending) {
      return { resolved: false, reason: null, contactId: null };
    }
    return this.repository.retryImportRow({
      rowId: input.rowId,
      row: {
        ...this.normalizeImportRow(input.row, true),
        contactId: this.idGenerator.newId()
      },
      actorAdminId: input.actor.adminId,
      now: input.now
    });
  }

  dismissImportRow(input: {
    readonly actor: AdminRequestActor;
    readonly rowId: string;
    readonly now: Date;
  }): Promise<boolean> {
    requirePermission(input.actor, "outreach.write");
    requireUuid(input.rowId);
    return this.repository.dismissImportRow({
      rowId: input.rowId,
      actorAdminId: input.actor.adminId,
      now: input.now
    });
  }

  /**
   * Пишет итог пачки в журнал. Без `importId` не делает ничего: журнал ведётся только для
   * загрузки файла, а разовое добавление контакта руками в нём не нужно.
   */
  private async recordImportOutcome(input: {
    readonly importId: string | undefined;
    readonly rows: readonly OutreachImportRow[];
    readonly lines: readonly number[] | undefined;
    readonly received: number;
    readonly createdContacts: number;
    readonly updatedContacts: number;
    readonly invalidRowIndexes: readonly number[];
    readonly ambiguousRowIndexes: readonly number[];
    readonly now: Date;
  }): Promise<void> {
    if (input.importId === undefined) {
      return;
    }
    const failedRows = [
      ...input.invalidRowIndexes.map((index) => ({ index, status: "invalid" as const })),
      ...input.ambiguousRowIndexes.map((index) => ({ index, status: "ambiguous" as const }))
    ]
      .map(({ index, status }) => {
        const raw = input.rows[index];
        return raw === undefined
          ? null
          : {
            id: this.idGenerator.newId(),
            // Без номеров строк нумеруем от единицы внутри пачки: хуже, чем настоящий
            // номер в файле, но лучше, чем ничего.
            lineNumber: input.lines?.[index] ?? index + 1,
            raw,
            status,
            reason: IMPORT_FAILURE_REASONS[status]
          };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((first, second) => first.lineNumber - second.lineNumber);

    await this.repository.recordImportOutcome({
      importId: input.importId,
      received: input.received,
      createdContacts: input.createdContacts,
      updatedContacts: input.updatedContacts,
      failedRows,
      now: input.now
    });
  }

  /**
   * Объединение дублей. Право общее с правкой, а не с удалением: ничего не пропадает — дубль
   * остаётся указателем на главного, и вся его история видна в карточке главного.
   */
  async mergePeople(input: {
    readonly actor: AdminRequestActor;
    readonly contactId: string;
    readonly targetContactId: string;
    readonly reason?: string;
    readonly now: Date;
  }): Promise<MergeOutreachPeopleResult> {
    requirePermission(input.actor, "outreach.write");
    requireUuid(input.contactId);
    requireUuid(input.targetContactId);
    return this.repository.mergePeople({
      contactId: input.contactId,
      targetContactId: input.targetContactId,
      reason: optionalText(input.reason ?? "", 500),
      actorAdminId: input.actor.adminId,
      auditId: this.idGenerator.newId(),
      now: input.now
    });
  }

  /**
   * Удаление насовсем — единственное необратимое действие с базой, поэтому и право у него
   * своё. Что нельзя стирать, решает база: она же держит журналы, защищённые от удаления.
   */
  async deletePerson(input: {
    readonly actor: AdminRequestActor;
    readonly contactId: string;
    readonly reason?: string;
    readonly now: Date;
  }): Promise<DeleteOutreachPersonResult> {
    requirePermission(input.actor, "outreach.delete");
    requireUuid(input.contactId);
    return this.repository.deletePerson({
      contactId: input.contactId,
      reason: optionalText(input.reason ?? "", 500),
      actorAdminId: input.actor.adminId,
      auditId: this.idGenerator.newId(),
      now: input.now
    });
  }

  async importContacts(input: {
    readonly actor: AdminRequestActor;
    readonly campaignId: string;
    /** Не передан — отвечает тот, кто загружает. `null` — контакт остаётся без ответственного. */
    readonly assignedAdminId?: string | null;
    readonly rows: readonly OutreachImportRow[];
    /**
     * Пропускать строки с неразбираемым телефоном вместо отказа от всей пачки. Нужно при
     * загрузке файла: в выгрузке на тысячи контактов пара битых номеров есть всегда, и
     * ронять из-за них весь импорт нельзя. При добавлении одного контакта руками флага
     * нет — там про плохой телефон надо сказать сразу.
     */
    readonly skipInvalid?: boolean;
    /** Загрузка, к которой относится пачка. Без неё журнал не ведётся. */
    readonly importId?: string;
    /** Номера строк файла по порядку строк пачки. */
    readonly lines?: readonly number[];
    readonly now: Date;
  }): Promise<OutreachImportResult> {
    requirePermission(input.actor, "outreach.write");
    requireUuid(input.campaignId);
    if (input.rows.length < 1 || input.rows.length > 500) {
      throw new Error("Outreach import batch is invalid");
    }
    const assignedAdminId = input.assignedAdminId === undefined
      ? input.actor.adminId
      : input.assignedAdminId;
    if (assignedAdminId !== null) {
      requireUuid(assignedAdminId);
    }

    const rows: (NormalizedOutreachImportRow & {
      readonly contactId: string;
      readonly campaignContactId: string;
    })[] = [];
    const invalidRowIndexes: number[] = [];
    input.rows.forEach((row, index) => {
      try {
        rows.push({
          ...this.normalizeImportRow(row, input.skipInvalid !== true),
          contactId: this.idGenerator.newId(),
          campaignContactId: this.idGenerator.newId()
        });
      } catch (error) {
        if (input.skipInvalid !== true) {
          throw error;
        }
        invalidRowIndexes.push(index);
      }
    });

    if (rows.length === 0) {
      await this.recordImportOutcome({
        importId: input.importId,
        rows: input.rows,
        lines: input.lines,
        received: input.rows.length,
        createdContacts: 0,
        updatedContacts: 0,
        invalidRowIndexes,
        ambiguousRowIndexes: [],
        now: input.now
      });
      return {
        received: input.rows.length,
        createdContacts: 0,
        updatedContacts: 0,
        addedToCampaign: 0,
        alreadyInCampaign: 0,
        invalidRows: invalidRowIndexes.length,
        invalidRowIndexes,
        ambiguousRows: 0,
        ambiguousRowIndexes: []
      };
    }

    const result = await this.repository.importContacts({
      campaignId: input.campaignId,
      assignedAdminId,
      createdByAdminId: input.actor.adminId,
      rows,
      skipAmbiguous: input.skipInvalid === true,
      now: input.now
    });
    // Индексы из базы считаны по отфильтрованному списку — возвращаем их к номерам
    // исходных строк, иначе панель покажет не те строки файла.
    const keptIndexes = input.rows
      .map((_, index) => index)
      .filter((index) => !invalidRowIndexes.includes(index));
    const ambiguousRowIndexes = result.ambiguousRowIndexes
      .map((index) => keptIndexes[index])
      .filter((index): index is number => index !== undefined);

    await this.recordImportOutcome({
      importId: input.importId,
      rows: input.rows,
      lines: input.lines,
      received: input.rows.length,
      createdContacts: result.createdContacts,
      updatedContacts: result.updatedContacts,
      invalidRowIndexes,
      ambiguousRowIndexes,
      now: input.now
    });

    return {
      ...result,
      received: input.rows.length,
      invalidRows: invalidRowIndexes.length,
      invalidRowIndexes,
      ambiguousRows: ambiguousRowIndexes.length,
      ambiguousRowIndexes
    };
  }

  createContact(input: {
    readonly actor: AdminRequestActor;
    readonly campaignId: string;
    readonly assignedAdminId?: string;
    readonly contact: OutreachImportRow;
    readonly now: Date;
  }): Promise<OutreachImportResult> {
    return this.importContacts({
      actor: input.actor,
      campaignId: input.campaignId,
      ...(input.assignedAdminId
        ? { assignedAdminId: input.assignedAdminId }
        : {}),
      rows: [input.contact],
      now: input.now
    });
  }

  async assignContacts(input: {
    readonly actor: AdminRequestActor;
    readonly campaignContactIds: readonly string[];
    readonly assignedAdminId: string;
    readonly now: Date;
  }): Promise<{ readonly updated: number }> {
    requirePermission(input.actor, "outreach.write");
    requireIds(input.campaignContactIds);
    requireUuid(input.assignedAdminId);
    return {
      updated: await this.repository.assignContacts({
        campaignContactIds: unique(input.campaignContactIds),
        assignedAdminId: input.assignedAdminId,
        now: input.now
      })
    };
  }

  async recordActivities(input: {
    readonly actor: AdminRequestActor;
    readonly campaignContactIds: readonly string[];
    readonly channel: OutreachChannel;
    readonly result: Exclude<OutreachContactStatus, "new">;
    readonly stage?: OutreachPipelineStage;
    readonly lostReason?: OutreachLostReason;
    readonly note?: string;
    readonly nextContactAt?: Date;
    readonly now: Date;
  }): Promise<{ readonly recorded: number; readonly taskRequired: boolean }> {
    requirePermission(input.actor, "outreach.write");
    requireIds(input.campaignContactIds);
    const ids = unique(input.campaignContactIds);
    validateActivity(input.channel, input.result);
    let lostReason: OutreachLostReason | null = null;
    let outcome: OutreachPipelineColumnOutcome = "open";
    if (input.stage) {
      const found = await this.repository.getPipelineColumnOutcome({
        campaignContactId: ids[0] as string,
        stage: input.stage
      });
      if (found === null) {
        throw new Error("Outreach pipeline stage was not found for this campaign");
      }
      outcome = found;
      validateLostState(outcome, input.lostReason ?? null);
      lostReason = outcome === "lost" ? input.lostReason ?? null : null;
    }
    const nextContactAt = input.nextContactAt ?? null;
    if (
      nextContactAt
      && (Number.isNaN(nextContactAt.getTime()) || nextContactAt <= input.now)
    ) {
      throw new Error("Outreach next contact time is invalid");
    }
    // «Когда связаться снова» и есть следующий шаг: по этому времени запись касания сама
    // ставит задачу. Если воронка требует шага, а времени не назвали, — записывать нечего:
    // разговор состоялся, а карточка легла бы без напоминания.
    if (
      nextContactAt === null
      && outcome !== "lost"
      && await this.someoneNeedsNextStep(ids)
    ) {
      return { recorded: 0, taskRequired: true };
    }
    const recorded = await this.repository.recordActivities({
      activities: ids.map((campaignContactId) => ({
        id: this.idGenerator.newId(),
        campaignContactId,
        stageHistoryId: input.stage ? this.idGenerator.newId() : null,
        taskId: nextContactAt ? this.idGenerator.newId() : null
      })),
      actorAdminId: input.actor.adminId,
      action: input.channel === "phone" ? "call" : "message",
      channel: input.channel,
      result: input.result,
      note: optionalText(input.note, 2000),
      batchId: ids.length > 1 ? this.idGenerator.newId() : null,
      stage: input.stage ?? null,
      lostReason,
      nextContactAt,
      occurredAt: input.now
    });
    if (recorded !== ids.length) {
      throw new Error("Outreach campaign contact was not found");
    }
    return { recorded, taskRequired: false };
  }

  /** Хотя бы одна карточка из пачки останется без следующего шага. */
  private async someoneNeedsNextStep(
    campaignContactIds: readonly string[]
  ): Promise<boolean> {
    for (const campaignContactId of campaignContactIds) {
      const guard = await this.repository.getTaskGuard({ campaignContactId });
      if (guard !== null && guard.requireOpenTask && !guard.hasOpenTask) {
        return true;
      }
    }
    return false;
  }

  async updateContactStage(input: {
    readonly actor: AdminRequestActor;
    readonly campaignContactId: string;
    readonly stage: OutreachPipelineStage;
    readonly lostReason?: OutreachLostReason;
    /** Следующий шаг, который ставят вместе с переносом. */
    readonly task?: OutreachNextStep;
    readonly now: Date;
  }): Promise<{ readonly updated: boolean; readonly taskRequired: boolean }> {
    requirePermission(input.actor, "outreach.write");
    requireUuid(input.campaignContactId);
    const outcome = await this.repository.getPipelineColumnOutcome({
      campaignContactId: input.campaignContactId,
      stage: input.stage
    });
    if (outcome === null) {
      throw new Error("Outreach pipeline stage was not found for this campaign");
    }
    validateLostState(outcome, input.lostReason ?? null);
    if (await this.needsNextStep(input.campaignContactId, outcome, input.task)) {
      return { updated: false, taskRequired: true };
    }
    const updated = await this.repository.updateContactStage({
      campaignContactId: input.campaignContactId,
      actorAdminId: input.actor.adminId,
      historyId: this.idGenerator.newId(),
      stage: input.stage,
      lostReason: outcome === "lost" ? input.lostReason ?? null : null,
      now: input.now
    });
    if (updated && input.task) {
      await this.createNextStep(input.actor, input.campaignContactId, input.task, input.now);
    }
    return { updated, taskRequired: false };
  }

  /**
   * Останется ли карточка без следующего шага.
   *
   * Колонки с исходом «проигран» правило не касается: там работа кончилась, и требовать
   * звонок по отказавшемуся значит держать в списке дел то, чего делать не собираются.
   */
  private async needsNextStep(
    campaignContactId: string,
    outcome: OutreachPipelineColumnOutcome,
    task: OutreachNextStep | undefined
  ): Promise<boolean> {
    if (outcome === "lost" || task) {
      return false;
    }
    const guard = await this.repository.getTaskGuard({ campaignContactId });
    return guard !== null && guard.requireOpenTask && !guard.hasOpenTask;
  }

  private async createNextStep(
    actor: AdminRequestActor,
    campaignContactId: string,
    task: OutreachNextStep,
    now: Date
  ): Promise<void> {
    await this.repository.createTask({
      id: this.idGenerator.newId(),
      contactId: null,
      campaignContactId,
      assignedAdminId: task.assignedAdminId ?? null,
      createdByAdminId: actor.adminId,
      type: task.type,
      text: requiredText(task.text, 500, "Outreach task text"),
      dueAt: task.dueAt,
      now
    });
  }

  /**
   * Ставит следующий шаг по контакту.
   *
   * Кампанию указывать не обязательно: задача принадлежит человеку, а кампания её только
   * уточняет. Без кампании задачу можно поставить и тому, кто ни в одной не состоит, — из
   * карточки клиента спрашивают именно это.
   */
  async createTask(input: {
    readonly actor: AdminRequestActor;
    readonly contactId?: string;
    readonly campaignContactId?: string;
    readonly assignedAdminId?: string;
    readonly type: OutreachTaskType;
    readonly text: string;
    readonly dueAt: Date;
    readonly now: Date;
  }): Promise<{ readonly created: boolean }> {
    requirePermission(input.actor, "outreach.write");
    if (!input.campaignContactId && !input.contactId) {
      throw new Error("Outreach task needs a contact or a campaign contact");
    }
    if (input.campaignContactId) {
      requireUuid(input.campaignContactId);
    }
    if (input.contactId) {
      requireUuid(input.contactId);
    }
    if (input.assignedAdminId) {
      requireUuid(input.assignedAdminId);
    }
    if (Number.isNaN(input.dueAt.getTime())) {
      throw new Error("Outreach task due time is invalid");
    }
    return {
      created: await this.repository.createTask({
        id: this.idGenerator.newId(),
        // Кампания сильнее: по ней и человек, и ответственный берутся из строки участия.
        contactId: input.campaignContactId ? null : input.contactId ?? null,
        campaignContactId: input.campaignContactId ?? null,
        assignedAdminId: input.assignedAdminId ?? null,
        createdByAdminId: input.actor.adminId,
        type: input.type,
        text: requiredText(input.text, 500, "Outreach task text"),
        dueAt: input.dueAt,
        now: input.now
      })
    };
  }

  async completeTask(input: {
    readonly actor: AdminRequestActor;
    readonly taskId: string;
    readonly now: Date;
  }): Promise<{ readonly completed: boolean }> {
    requirePermission(input.actor, "outreach.write");
    requireUuid(input.taskId);
    return {
      completed: await this.repository.completeTask({
        taskId: input.taskId,
        completedByAdminId: input.actor.adminId,
        now: input.now
      })
    };
  }

  /**
   * Заявки с формы на сайте.
   *
   * Отдельный список, а не строчка в участниках мероприятия: у заявки два состояния, при
   * которых участника не завели вовсе — телефон уже был в списке или встречи не нашлось. В
   * участниках таких заявок нет по определению, и без этого списка их не видит никто.
   */
  listSiteRegistrations(input: {
    readonly actor: AdminRequestActor;
    readonly onlyNeedsAttention?: boolean;
    readonly page?: number;
    readonly limit?: number;
  }): Promise<AdminSiteRegistrationPage> {
    requirePermission(input.actor, "outreach.read");
    const page = input.page ?? 1;
    const limit = input.limit ?? 50;
    if (!Number.isSafeInteger(page) || page < 1 || page > 100_000) {
      throw new Error("Outreach page is invalid");
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      throw new Error("Outreach limit is invalid");
    }
    return this.repository.listSiteRegistrations({
      onlyNeedsAttention: input.onlyNeedsAttention === true,
      page,
      limit
    });
  }

  /**
   * Помечает человека «своим»: обзванивать его не надо.
   *
   * Отдельный признак, а не стадия «закрыт» и не отдельная кампания: человек может быть
   * одновременно и своим, и участником, и покупателем. Плашка идёт за ним всюду, где его
   * показывают, и не мешает ему участвовать в чём угодно.
   */
  async markPersonOwn(input: {
    readonly actor: AdminRequestActor;
    readonly contactId: string;
    readonly isOwn: boolean;
    readonly note?: string;
    readonly now: Date;
  }): Promise<{ readonly updated: boolean }> {
    requirePermission(input.actor, "outreach.write");
    requireUuid(input.contactId);
    const note = input.note?.trim();
    return {
      updated: await this.repository.markPersonOwn({
        contactId: input.contactId,
        isOwn: input.isOwn,
        note: input.isOwn && note ? optionalText(note, 200) : null,
        actorAdminId: input.actor.adminId,
        now: input.now
      })
    };
  }

  /** Заметка о человеке. Копится рядом с прежними, а не затирает их. */
  async createNote(input: {
    readonly actor: AdminRequestActor;
    readonly contactId: string;
    readonly body: string;
    readonly now: Date;
  }): Promise<{ readonly created: boolean }> {
    requirePermission(input.actor, "outreach.write");
    requireUuid(input.contactId);
    return {
      created: await this.repository.createNote({
        id: this.idGenerator.newId(),
        contactId: input.contactId,
        authorAdminId: input.actor.adminId,
        body: requiredText(input.body, 4000, "Outreach note"),
        now: input.now
      })
    };
  }

  /**
   * Снимает свою заметку. Чужую снять нельзя — это отказ, а не «не нашлось»: заметка
   * подписана именем, и стирать чужую подпись значит менять сказанное другим человеком.
   */
  async deleteNote(input: {
    readonly actor: AdminRequestActor;
    readonly noteId: string;
    readonly now: Date;
  }): Promise<{ readonly deleted: boolean }> {
    requirePermission(input.actor, "outreach.write");
    requireUuid(input.noteId);
    return {
      deleted: await this.repository.deleteNote({
        noteId: input.noteId,
        actorAdminId: input.actor.adminId,
        now: input.now
      })
    };
  }

  listManagers(input: {
    readonly actor: AdminRequestActor;
  }): Promise<readonly OutreachManager[]> {
    requirePermission(input.actor, "outreach.read");
    return this.repository.listManagers();
  }

  async exportCampaign(input: {
    readonly actor: AdminRequestActor;
    readonly campaignId: string;
  }): Promise<OutreachCampaignExport | null> {
    requirePermission(input.actor, "outreach.read");
    requireUuid(input.campaignId);
    const result = await this.repository.exportCampaignContacts(input.campaignId);
    if (!result.campaign) {
      return null;
    }
    const header = [
      "name",
      "phone",
      "telegram",
      "max",
      "source",
      "manager",
      "pipeline_stage",
      "lost_reason",
      "status",
      "last_channel",
      "last_activity_at",
      "next_contact_at",
      "registered_in_bot",
      "note"
    ];
    const lines = result.rows.map((row) => [
      row.displayName,
      row.phone,
      row.telegramUsername,
      row.maxIdentifier,
      row.source,
      row.assignedAdminName,
      row.stage,
      row.lostReason,
      row.status,
      row.lastChannel,
      row.lastActivityAt,
      row.nextContactAt,
      row.linkedUserId ? "yes" : "no",
      row.note
    ].map(csvCell).join(","));
    return {
      filename: `outreach-${slug(result.campaign.name)}.csv`,
      csv: `\uFEFF${header.join(",")}\r\n${lines.join("\r\n")}\r\n`
    };
  }

  /**
   * @param strict Ручной ввод: про непонятый телефон надо сказать сразу, а не молча завести
   * человека без него. При загрузке файла наоборот — строка с битым телефоном, но верным
   * ником должна сохраниться, иначе из-за пары ячеек теряются живые контакты.
   */
  private normalizeImportRow(
    row: OutreachImportRow,
    strict: boolean
  ): NormalizedOutreachImportRow {
    const { identity, rejections, hasIdentifier } = normalizeContactInput(row, {
      parsePhone: (candidate) => {
        try {
          return this.phoneNormalizer.normalize(candidate);
        } catch {
          return null;
        }
      }
    });

    // Сначала про конкретное поле, потом про строку целиком: человеку, который ввёл кривой
    // телефон, «нет признаков» ничего не объясняет, а «телефон неверный» объясняет всё.
    if (strict) {
      const blocking = rejections.find((rejection) => rejection.field !== "name");
      if (blocking) {
        throw new Error(REJECTION_MESSAGES[blocking.reason]);
      }
    }
    if (!hasIdentifier) {
      throw new Error("Outreach contact identity is invalid");
    }

    return {
      displayName: identity.name,
      phoneE164: identity.phoneE164,
      telegramUsername: identity.telegramUsername,
      telegramUsernameNormalized: identity.telegramUsernameNormalized,
      maxIdentifier: identity.maxIdentifier,
      maxIdentifierNormalized: identity.maxIdentifierNormalized,
      email: identity.email,
      emailNormalized: identity.emailNormalized,
      source: optionalText(row.source, 200),
      // Второго поля под телефон в базе нет, а терять рабочий номер нельзя — он уходит в
      // примечание, где его видно человеку.
      note: appendExtraPhones(optionalText(row.note, 2000), identity.extraPhones)
    };
  }
}

const IMPORT_FAILURE_REASONS: Record<"invalid" | "ambiguous", string> = {
  invalid: "Не разобрался ни один признак: ни телефон, ни ник, ни почта",
  ambiguous: "Признаки ведут на разных людей — сначала объедините их карточки"
};

const REJECTION_MESSAGES: Record<ContactRejectionReason, string> = {
  not_a_phone_number: "Phone number is invalid",
  not_a_telegram_username: "Outreach messenger identifier is invalid",
  not_a_max_identifier: "Outreach messenger identifier is invalid",
  not_an_email: "Outreach contact email is invalid",
  not_a_name: "Outreach contact name is invalid"
};

function appendExtraPhones(
  note: string | null,
  extraPhones: readonly string[]
): string | null {
  if (extraPhones.length === 0) {
    return note;
  }
  const line = `Ещё телефоны: ${extraPhones.join(", ")}`;
  return (note ? `${note}\n${line}` : line).slice(0, 2000);
}

/** Поля нет в правке — оставить как было; поле есть, но пустое — стереть. */
function pick(
  change: string | null | undefined,
  current: string | null
): string | undefined {
  if (change === undefined) {
    return current ?? undefined;
  }
  return change?.trim() ? change : undefined;
}

function requirePermission(
  actor: AdminRequestActor,
  permission: "outreach.read" | "outreach.write" | "outreach.delete"
): void {
  if (actor.permission !== permission || !UUID_PATTERN.test(actor.adminId)) {
    throw new Error("Administrator outreach permission is invalid");
  }
}

function requireIds(ids: readonly string[]): void {
  if (ids.length < 1 || ids.length > 100) {
    throw new Error("Outreach campaign contact selection is invalid");
  }
  ids.forEach(requireUuid);
}

function requireUuid(value: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new Error("Outreach identifier is invalid");
  }
}

/**
 * Время из панели. Пустая строка означает «встречи нет», а не «оставить как было»: правка
 * приходит целиком, и отличать одно от другого умеет только `undefined` выше по стеку.
 */
function parseOptionalInstant(value: string | null): Date | null {
  if (value === null || value.trim() === "") {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Outreach meeting time is invalid");
  }
  return parsed;
}

function requiredText(value: string, maximum: number, label: string): string {
  const result = value.trim();
  if (result.length < 1 || result.length > maximum) {
    throw new Error(`${label} is invalid`);
  }
  return result;
}

function optionalText(
  value: string | undefined,
  maximum: number
): string | null {
  if (value === undefined || value.trim() === "") {
    return null;
  }
  const result = value.trim();
  if (result.length > maximum) {
    throw new Error("Outreach text is invalid");
  }
  return result;
}

function validateActivity(
  channel: OutreachChannel,
  result: Exclude<OutreachContactStatus, "new">
): void {
  const allowed = channel === "phone"
    ? ["no_answer", "answered", "callback", "interested", "declined", "converted", "invalid"]
    : ["sent", "answered", "callback", "interested", "declined", "converted", "invalid"];
  if (!allowed.includes(result)) {
    throw new Error("Outreach activity result is invalid");
  }
}

function validateLostState(
  outcome: OutreachPipelineColumnOutcome,
  lostReason: OutreachLostReason | null
): void {
  if (outcome === "lost" && !lostReason) {
    throw new Error("Outreach lost reason is required");
  }
  if (outcome !== "lost" && lostReason) {
    throw new Error("Outreach lost reason is only valid for a lost-outcome stage");
  }
}

const STAGE_ID_PATTERN = /^[a-z0-9_]{1,40}$/;

function newStageId(idGenerator: IdGenerator): string {
  return `s_${idGenerator.newId().replaceAll("-", "").slice(0, 16)}`;
}

// Exported so the admin-web board can preview the same bucketing without a
// round trip, and so it is covered directly by unit tests.
export function computeTaskUrgency(dueAt: Date, now: Date): OutreachTaskUrgency {
  if (dueAt.getTime() < now.getTime()) {
    return "overdue";
  }
  const dayMs = 24 * 60 * 60 * 1000;
  const startOfToday = Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()
  );
  const startOfDue = Date.UTC(
    dueAt.getUTCFullYear(), dueAt.getUTCMonth(), dueAt.getUTCDate()
  );
  const diffDays = Math.round((startOfDue - startOfToday) / dayMs);
  if (diffDays <= 0) {
    return "today";
  }
  if (diffDays === 1) {
    return "tomorrow";
  }
  if (diffDays <= 7) {
    return "this_week";
  }
  return "later";
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function csvCell(value: string | null): string {
  const text = value ?? "";
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function slug(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-|-$/g, "");
  return normalized || "campaign";
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
