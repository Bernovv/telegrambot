import {
  OUTREACH_CUSTOM_FIELD_TYPES,
  OUTREACH_MAX_PIPELINE_COLUMNS,
  OUTREACH_PIPELINE_COLUMN_OUTCOMES
} from "@ticket-platform/contracts";
import type {
  AdminRequestActor,
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
  OutreachManager,
  OutreachPipelineColumn,
  OutreachPipelineColumnOutcome,
  OutreachPipelineStage,
  OutreachTaskBoardItem,
  OutreachTaskType,
  OutreachTaskUrgency
} from "@ticket-platform/contracts";
import type { IdGenerator } from "./identity.js";
import type { PhoneNormalizer } from "./phone.js";

export interface NormalizedOutreachImportRow {
  readonly displayName: string | null;
  readonly phoneE164: string | null;
  readonly telegramUsername: string | null;
  readonly telegramUsernameNormalized: string | null;
  readonly maxIdentifier: string | null;
  readonly maxIdentifierNormalized: string | null;
  readonly source: string | null;
  readonly note: string | null;
}

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
  listCampaigns(): Promise<readonly OutreachCampaignSummary[]>;
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
  importContacts(input: {
    readonly campaignId: string;
    readonly assignedAdminId: string;
    readonly createdByAdminId: string;
    readonly rows: readonly (NormalizedOutreachImportRow & {
      readonly contactId: string;
      readonly campaignContactId: string;
    })[];
    readonly now: Date;
  }): Promise<OutreachImportResult>;
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
    readonly campaignContactId: string;
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
  }): Promise<readonly OutreachCampaignSummary[]> {
    requirePermission(input.actor, "outreach.read");
    return this.repository.listCampaigns();
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
    readonly now: Date;
  }): Promise<OutreachCampaignSummary | null> {
    requirePermission(input.actor, "outreach.write");
    requireUuid(input.campaignId);
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
      now: input.now
    });
    return changed ? this.repository.getCampaign(input.campaignId) : null;
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

  async importContacts(input: {
    readonly actor: AdminRequestActor;
    readonly campaignId: string;
    readonly assignedAdminId?: string;
    readonly rows: readonly OutreachImportRow[];
    readonly now: Date;
  }): Promise<OutreachImportResult> {
    requirePermission(input.actor, "outreach.write");
    requireUuid(input.campaignId);
    if (input.rows.length < 1 || input.rows.length > 500) {
      throw new Error("Outreach import batch is invalid");
    }
    const assignedAdminId = input.assignedAdminId ?? input.actor.adminId;
    requireUuid(assignedAdminId);
    const rows = input.rows.map((row) => ({
      ...this.normalizeImportRow(row),
      contactId: this.idGenerator.newId(),
      campaignContactId: this.idGenerator.newId()
    }));
    return this.repository.importContacts({
      campaignId: input.campaignId,
      assignedAdminId,
      createdByAdminId: input.actor.adminId,
      rows,
      now: input.now
    });
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
  }): Promise<{ readonly recorded: number }> {
    requirePermission(input.actor, "outreach.write");
    requireIds(input.campaignContactIds);
    const ids = unique(input.campaignContactIds);
    validateActivity(input.channel, input.result);
    let lostReason: OutreachLostReason | null = null;
    if (input.stage) {
      const outcome = await this.repository.getPipelineColumnOutcome({
        campaignContactId: ids[0] as string,
        stage: input.stage
      });
      if (outcome === null) {
        throw new Error("Outreach pipeline stage was not found for this campaign");
      }
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
    return { recorded };
  }

  async updateContactStage(input: {
    readonly actor: AdminRequestActor;
    readonly campaignContactId: string;
    readonly stage: OutreachPipelineStage;
    readonly lostReason?: OutreachLostReason;
    readonly now: Date;
  }): Promise<{ readonly updated: boolean }> {
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
    return {
      updated: await this.repository.updateContactStage({
        campaignContactId: input.campaignContactId,
        actorAdminId: input.actor.adminId,
        historyId: this.idGenerator.newId(),
        stage: input.stage,
        lostReason: outcome === "lost" ? input.lostReason ?? null : null,
        now: input.now
      })
    };
  }

  async createTask(input: {
    readonly actor: AdminRequestActor;
    readonly campaignContactId: string;
    readonly assignedAdminId?: string;
    readonly type: OutreachTaskType;
    readonly text: string;
    readonly dueAt: Date;
    readonly now: Date;
  }): Promise<{ readonly created: boolean }> {
    requirePermission(input.actor, "outreach.write");
    requireUuid(input.campaignContactId);
    if (input.assignedAdminId) {
      requireUuid(input.assignedAdminId);
    }
    if (Number.isNaN(input.dueAt.getTime())) {
      throw new Error("Outreach task due time is invalid");
    }
    return {
      created: await this.repository.createTask({
        id: this.idGenerator.newId(),
        campaignContactId: input.campaignContactId,
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

  private normalizeImportRow(row: OutreachImportRow): NormalizedOutreachImportRow {
    const displayName = optionalText(row.name, 200);
    const telegramUsername = normalizeHandle(row.telegram);
    const maxIdentifier = normalizeHandle(row.max);
    let phoneE164: string | null = null;
    if (row.phone?.trim()) {
      phoneE164 = this.phoneNormalizer.normalize(row.phone.trim());
    }
    if (!phoneE164 && !telegramUsername && !maxIdentifier) {
      throw new Error("Outreach contact identity is invalid");
    }
    return {
      displayName,
      phoneE164,
      telegramUsername,
      telegramUsernameNormalized: telegramUsername?.toLowerCase() ?? null,
      maxIdentifier,
      maxIdentifierNormalized: maxIdentifier?.toLowerCase() ?? null,
      source: optionalText(row.source, 200),
      note: optionalText(row.note, 2000)
    };
  }
}

function requirePermission(
  actor: AdminRequestActor,
  permission: "outreach.read" | "outreach.write"
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

function normalizeHandle(value: string | undefined): string | null {
  if (!value?.trim()) {
    return null;
  }
  const normalized = value.trim().replace(/^@/, "");
  if (!/^[A-Za-z0-9_.-]{2,100}$/.test(normalized)) {
    throw new Error("Outreach messenger identifier is invalid");
  }
  return normalized;
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
