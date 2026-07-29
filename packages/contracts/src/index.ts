export type HealthStatus = "healthy" | "degraded" | "failed" | "unknown" | "maintenance";

export interface HealthSnapshot {
  readonly service: string;
  readonly status: HealthStatus;
  readonly version: string;
  readonly checkedAt: string;
}

export interface HealthComponentSnapshot {
  readonly name: string;
  readonly status: HealthStatus;
  readonly checkedAt: string;
  readonly latencyMs: number;
  readonly message: string;
  readonly lastSuccessAt: string | null;
  readonly runbook: string;
}

export interface HealthReadinessReport extends HealthSnapshot {
  readonly components: readonly HealthComponentSnapshot[];
}

export interface ProblemDetails {
  readonly type: string;
  readonly code: string;
  readonly title: string;
  readonly status: number;
  readonly detail?: string;
  readonly requestId: string;
}

export * from "./telegram.js";
export * from "./jobs.js";
export * from "./admin-auth.js";
export * from "./admin-operations.js";
export * from "./admin-events.js";
export * from "./admin-outreach.js";
export * from "./orders.js";
