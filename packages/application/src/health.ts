import type {
  HealthReadinessReport,
  HealthStatus
} from "@ticket-platform/contracts";

export interface HealthProbeResult {
  readonly status: HealthStatus;
  readonly message: string;
  readonly runbook: string;
}

export interface HealthProbe {
  readonly name: string;
  check(): Promise<HealthProbeResult>;
}

export interface ReadinessCheck {
  execute(): Promise<HealthReadinessReport>;
}

export interface HealthClock {
  now(): Date;
}

const systemClock: HealthClock = {
  now: () => new Date()
};

const statusPriority: Readonly<Record<HealthStatus, number>> = {
  healthy: 0,
  degraded: 1,
  maintenance: 2,
  unknown: 3,
  failed: 4
};

export class GetReadinessService implements ReadinessCheck {
  private readonly lastSuccessByProbe = new Map<string, string>();

  constructor(
    private readonly service: string,
    private readonly version: string,
    private readonly probes: readonly HealthProbe[],
    private readonly clock: HealthClock = systemClock
  ) {}

  async execute(): Promise<HealthReadinessReport> {
    const components = await Promise.all(this.probes.map((probe) => this.checkProbe(probe)));
    const checkedAt = this.clock.now().toISOString();

    return {
      service: this.service,
      status: aggregateStatus(components.map((component) => component.status)),
      version: this.version,
      checkedAt,
      components
    };
  }

  private async checkProbe(probe: HealthProbe) {
    const startedAt = this.clock.now();

    try {
      const result = await probe.check();
      const finishedAt = this.clock.now();
      const checkedAt = finishedAt.toISOString();

      if (result.status !== "failed" && result.status !== "unknown") {
        this.lastSuccessByProbe.set(probe.name, checkedAt);
      }

      return {
        name: probe.name,
        status: result.status,
        checkedAt,
        latencyMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
        message: result.message,
        lastSuccessAt: this.lastSuccessByProbe.get(probe.name) ?? null,
        runbook: result.runbook
      };
    } catch {
      const finishedAt = this.clock.now();

      return {
        name: probe.name,
        status: "failed" as const,
        checkedAt: finishedAt.toISOString(),
        latencyMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
        message: "probe_failed",
        lastSuccessAt: this.lastSuccessByProbe.get(probe.name) ?? null,
        runbook: "docs/runbooks/health-readiness.md#probe-failure"
      };
    }
  }
}

export function isReadyStatus(status: HealthStatus): boolean {
  return status === "healthy" || status === "degraded";
}

function aggregateStatus(statuses: readonly HealthStatus[]): HealthStatus {
  return statuses.reduce<HealthStatus>(
    (current, status) => statusPriority[status] > statusPriority[current] ? status : current,
    "healthy"
  );
}
