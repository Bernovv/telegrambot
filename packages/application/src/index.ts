import type { HealthSnapshot } from "@ticket-platform/contracts";

export function getLivenessSnapshot(service: string, version: string): HealthSnapshot {
  return {
    service,
    status: "healthy",
    version,
    checkedAt: new Date().toISOString()
  };
}

export * from "./identity.js";
export * from "./phone.js";
export * from "./outbox.js";
export * from "./health.js";
export * from "./admin-authorization.js";
export * from "./admin-operations.js";
export * from "./admin-bootstrap.js";
export * from "./orders.js";
export * from "./order-references.js";
export * from "./offer-acceptance.js";
export * from "./order-expiry.js";
export * from "./payment-confirmation.js";
export * from "./ticket-references.js";
export * from "./notification-delivery.js";
export * from "./ticket-access.js";
export * from "./tbank-payments.js";
export * from "./tbank-reconciliation.js";
export * from "./tbank-refunds.js";
