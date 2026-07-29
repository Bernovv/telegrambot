import type {
  AdminSegmentAudienceSnapshotSummary
} from "./admin-segments.js";

export interface AdminBroadcastLinkButton {
  readonly label: string;
  readonly url: string;
}

export interface AdminBroadcastContent {
  readonly text: string;
  readonly disableLinkPreview: boolean;
  readonly buttons: readonly AdminBroadcastLinkButton[];
}

export type AdminBroadcastVersionStatus = "draft" | "published";
export type AdminBroadcastLifecycleStatus =
  | "draft"
  | "scheduled"
  | "preparing"
  | "sending"
  | "paused"
  | "completed"
  | "cancelled"
  | "failed";

export interface AdminBroadcastSchedule {
  readonly scheduledVersionId: string;
  readonly scheduledAt: string;
  readonly timezone: string;
  readonly ratePerSecond: number;
  readonly preparedAt: string | null;
  readonly sendStartedAt: string | null;
  readonly completedAt: string | null;
  readonly pausedAt: string | null;
  readonly autoPauseReason: string | null;
  readonly plannedRecipientCount: string | null;
  readonly reachableRecipientCount: string | null;
  readonly skippedRecipientCount: string | null;
  readonly attemptedRecipientCount: string;
  readonly sentRecipientCount: string;
  readonly failedRecipientCount: string;
}

export interface AdminBroadcastVersion {
  readonly id: string;
  readonly versionNumber: number;
  readonly status: AdminBroadcastVersionStatus;
  readonly schemaVersion: 1;
  readonly name: string;
  readonly audienceSnapshot: AdminSegmentAudienceSnapshotSummary;
  readonly content: AdminBroadcastContent;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly publishedAt: string | null;
}

export interface AdminBroadcastSummary {
  readonly id: string;
  readonly name: string;
  readonly lockVersion: number;
  readonly lifecycleStatus: AdminBroadcastLifecycleStatus;
  readonly draftVersionNumber: number | null;
  readonly publishedVersionNumber: number | null;
  readonly audienceTotalCount: string | null;
  readonly schedule: AdminBroadcastSchedule | null;
  readonly updatedAt: string;
}

export interface AdminBroadcast {
  readonly id: string;
  readonly name: string;
  readonly lockVersion: number;
  readonly lifecycleStatus: AdminBroadcastLifecycleStatus;
  readonly draft: AdminBroadcastVersion | null;
  readonly published: AdminBroadcastVersion | null;
  readonly schedule: AdminBroadcastSchedule | null;
  readonly updatedAt: string;
}

export interface CreateAdminBroadcastRequest {
  readonly name: string;
  readonly audienceSnapshotId: string;
  readonly content: AdminBroadcastContent;
  readonly reason: string;
}

export interface UpdateAdminBroadcastDraftRequest {
  readonly expectedLockVersion: number;
  readonly name: string;
  readonly audienceSnapshotId: string;
  readonly content: AdminBroadcastContent;
  readonly reason: string;
}

export interface PublishAdminBroadcastDraftRequest {
  readonly expectedLockVersion: number;
  readonly reason: string;
}

export interface ScheduleAdminBroadcastRequest {
  readonly expectedLockVersion: number;
  readonly scheduledAt: string;
  readonly timezone: string;
  readonly ratePerSecond: number;
  readonly reason: string;
}
