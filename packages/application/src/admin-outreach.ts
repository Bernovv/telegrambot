import type {
  AdminRequestActor,
  OutreachCampaignContactDetail,
  OutreachCampaignContactPage,
  OutreachCampaignExport,
  OutreachCampaignStatus,
  OutreachCampaignSummary,
  OutreachChannel,
  OutreachContactStatus,
  OutreachImportResult,
  OutreachImportRow,
  OutreachManager
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
    readonly id: string;
    readonly name: string;
    readonly description: string | null;
    readonly status: OutreachCampaignStatus;
    readonly createdByAdminId: string;
    readonly now: Date;
  }): Promise<void>;
  updateCampaign(input: {
    readonly campaignId: string;
    readonly name?: string;
    readonly description?: string | null;
    readonly status?: OutreachCampaignStatus;
    readonly now: Date;
  }): Promise<boolean>;
  listContacts(input: {
    readonly campaignId: string;
    readonly search: string | null;
    readonly status: OutreachContactStatus | null;
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
    }[];
    readonly actorAdminId: string;
    readonly action: "message" | "call";
    readonly channel: OutreachChannel;
    readonly result: Exclude<OutreachContactStatus, "new">;
    readonly note: string | null;
    readonly batchId: string | null;
    readonly nextContactAt: Date | null;
    readonly occurredAt: Date;
  }): Promise<number>;
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
    readonly now: Date;
  }): Promise<OutreachCampaignSummary> {
    requirePermission(input.actor, "outreach.write");
    const name = requiredText(input.name, 200, "Outreach campaign name");
    const description = optionalText(input.description, 2000);
    const id = this.idGenerator.newId();
    await this.repository.createCampaign({
      id,
      name,
      description,
      status: input.status ?? "active",
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
    readonly now: Date;
  }): Promise<OutreachCampaignSummary | null> {
    requirePermission(input.actor, "outreach.write");
    requireUuid(input.campaignId);
    const changed = await this.repository.updateCampaign({
      campaignId: input.campaignId,
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

  listContacts(input: {
    readonly actor: AdminRequestActor;
    readonly campaignId: string;
    readonly search?: string;
    readonly status?: OutreachContactStatus;
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
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("Outreach page limit is invalid");
    }
    if (input.assignedAdminId) {
      requireUuid(input.assignedAdminId);
    }
    return this.repository.listContacts({
      campaignId: input.campaignId,
      search: optionalText(input.search, 100),
      status: input.status ?? null,
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
    readonly note?: string;
    readonly nextContactAt?: Date;
    readonly now: Date;
  }): Promise<{ readonly recorded: number }> {
    requirePermission(input.actor, "outreach.write");
    requireIds(input.campaignContactIds);
    const ids = unique(input.campaignContactIds);
    validateActivity(input.channel, input.result);
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
        campaignContactId
      })),
      actorAdminId: input.actor.adminId,
      action: input.channel === "phone" ? "call" : "message",
      channel: input.channel,
      result: input.result,
      note: optionalText(input.note, 2000),
      batchId: ids.length > 1 ? this.idGenerator.newId() : null,
      nextContactAt: input.result === "callback" ? nextContactAt : null,
      occurredAt: input.now
    });
    if (recorded !== ids.length) {
      throw new Error("Outreach campaign contact was not found");
    }
    return { recorded };
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
