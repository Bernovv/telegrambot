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

export type OutreachCampaignStatus =
  typeof OUTREACH_CAMPAIGN_STATUSES[number];
export type OutreachContactStatus =
  typeof OUTREACH_CONTACT_STATUSES[number];
export type OutreachChannel = typeof OUTREACH_CHANNELS[number];

export interface OutreachCampaignSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: OutreachCampaignStatus;
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
  readonly status: OutreachContactStatus;
  readonly lastActivityAt: string | null;
  readonly nextContactAt: string | null;
  readonly lastChannel: OutreachChannel | null;
  readonly lastResult: OutreachContactStatus | null;
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

export interface OutreachCampaignContactDetail
extends OutreachCampaignContactSummary {
  readonly activities: readonly OutreachActivity[];
}

export interface OutreachImportRow {
  readonly name?: string;
  readonly phone?: string;
  readonly telegram?: string;
  readonly max?: string;
  readonly source?: string;
  readonly note?: string;
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
