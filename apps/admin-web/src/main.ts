import type { HealthSnapshot } from "@ticket-platform/contracts";

export function renderAdminShell(health: HealthSnapshot): string {
  return `Admin shell: ${health.service} is ${health.status}`;
}
