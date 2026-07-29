export interface AdminUserStatusDefinition {
  readonly id: string;
  readonly code: string;
  readonly displayName: string;
  readonly color: string;
  readonly description: string | null;
  readonly isSystem: boolean;
  readonly exclusivityGroup: string | null;
  readonly allowedTransitionCodes: readonly string[] | null;
  readonly isActive: boolean;
  readonly lockVersion: number;
}

export interface AdminUserCategoryDefinition {
  readonly id: string;
  readonly code: string;
  readonly displayName: string;
  readonly color: string;
  readonly description: string | null;
  readonly isSystem: boolean;
  readonly isActive: boolean;
  readonly lockVersion: number;
}

export interface AdminUserClassificationCatalog {
  readonly statuses: readonly AdminUserStatusDefinition[];
  readonly categories: readonly AdminUserCategoryDefinition[];
}

export interface CreateAdminUserStatusRequest {
  readonly code: string;
  readonly displayName: string;
  readonly color: string;
  readonly description: string | null;
  readonly exclusivityGroup: string | null;
  readonly allowedTransitionCodes: readonly string[] | null;
  readonly reason: string;
}

export interface UpdateAdminUserStatusRequest {
  readonly expectedLockVersion: number;
  readonly displayName: string;
  readonly color: string;
  readonly description: string | null;
  readonly exclusivityGroup: string | null;
  readonly allowedTransitionCodes: readonly string[] | null;
  readonly isActive: boolean;
  readonly reason: string;
}

export interface CreateAdminUserCategoryRequest {
  readonly code: string;
  readonly displayName: string;
  readonly color: string;
  readonly description: string | null;
  readonly reason: string;
}

export interface UpdateAdminUserCategoryRequest {
  readonly expectedLockVersion: number;
  readonly displayName: string;
  readonly color: string;
  readonly description: string | null;
  readonly isActive: boolean;
  readonly reason: string;
}

export interface AssignAdminUserClassificationRequest {
  readonly code: string;
  readonly reason: string;
}

export interface RemoveAdminUserClassificationRequest {
  readonly reason: string;
}

export interface AdminUserClassificationMutationResult {
  readonly changed: boolean;
  readonly statusCodes: readonly string[];
  readonly categoryCodes: readonly string[];
}
