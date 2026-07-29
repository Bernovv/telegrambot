export const ADMIN_SEGMENT_BOOLEAN_OPERATORS = ["and", "or"] as const;
export type AdminSegmentBooleanOperator =
  typeof ADMIN_SEGMENT_BOOLEAN_OPERATORS[number];

export const ADMIN_SEGMENT_CLASSIFICATION_KINDS =
  ["status", "category"] as const;
export type AdminSegmentClassificationKind =
  typeof ADMIN_SEGMENT_CLASSIFICATION_KINDS[number];

export const ADMIN_SEGMENT_MATCH_MODES = ["any", "all", "none"] as const;
export type AdminSegmentMatchMode =
  typeof ADMIN_SEGMENT_MATCH_MODES[number];

export interface AdminSegmentClassificationCondition {
  readonly kind: AdminSegmentClassificationKind;
  readonly mode: AdminSegmentMatchMode;
  readonly codes: readonly string[];
}

export interface AdminSegmentConditionGroup {
  readonly operator: AdminSegmentBooleanOperator;
  readonly conditions: readonly AdminSegmentClassificationCondition[];
}

export interface AdminSegmentExpression {
  readonly operator: AdminSegmentBooleanOperator;
  readonly groups: readonly AdminSegmentConditionGroup[];
}

export interface PreviewAdminSegmentRequest extends AdminSegmentExpression {
  readonly sampleLimit?: number;
}

export interface AdminSegmentSampleUser {
  readonly id: string;
  readonly displayName: string | null;
  readonly telegramUsername: string | null;
  readonly registeredAt: string;
  readonly statusCodes: readonly string[];
  readonly categoryCodes: readonly string[];
}

export interface AdminSegmentPreview {
  readonly totalCount: string;
  readonly sampleUsers: readonly AdminSegmentSampleUser[];
}

export type AdminSegmentVersionStatus = "draft" | "published";

export interface AdminSegmentVersion {
  readonly id: string;
  readonly versionNumber: number;
  readonly status: AdminSegmentVersionStatus;
  readonly schemaVersion: 1;
  readonly name: string;
  readonly description: string | null;
  readonly expression: AdminSegmentExpression;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly publishedAt: string | null;
}

export interface AdminSavedSegmentSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly lockVersion: number;
  readonly draftVersionNumber: number | null;
  readonly publishedVersionNumber: number | null;
  readonly updatedAt: string;
}

export interface AdminSavedSegment {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly lockVersion: number;
  readonly draft: AdminSegmentVersion | null;
  readonly published: AdminSegmentVersion | null;
  readonly updatedAt: string;
}

export interface CreateAdminSavedSegmentRequest {
  readonly name: string;
  readonly description?: string | null;
  readonly expression: AdminSegmentExpression;
  readonly reason: string;
}

export interface UpdateAdminSavedSegmentDraftRequest {
  readonly expectedLockVersion: number;
  readonly name: string;
  readonly description?: string | null;
  readonly expression: AdminSegmentExpression;
  readonly reason: string;
}

export interface PublishAdminSavedSegmentRequest {
  readonly expectedLockVersion: number;
  readonly reason: string;
}

export type AdminSegmentAudienceSnapshotStatus = "pending" | "ready";

export interface AdminSegmentAudienceSnapshotSummary {
  readonly id: string;
  readonly segmentId: string;
  readonly segmentVersionId: string;
  readonly segmentVersionNumber: number;
  readonly status: AdminSegmentAudienceSnapshotStatus;
  readonly totalCount: string | null;
  readonly requestedAt: string;
  readonly completedAt: string | null;
}

export interface AdminSegmentAudienceSnapshot
extends AdminSegmentAudienceSnapshotSummary {
  readonly sampleUsers: readonly AdminSegmentSampleUser[];
}

export interface RequestAdminSegmentAudienceSnapshotRequest {
  readonly segmentVersionId: string;
  readonly reason: string;
}
