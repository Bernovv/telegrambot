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
export * from "./admin-events.js";
export * from "./admin-event-management.js";
export * from "./admin-event-catalog-management.js";
export * from "./admin-event-content-management.js";
export * from "./admin-event-offer-management.js";
export * from "./admin-event-scenario-management.js";
export * from "./scenario-runtime.js";
export * from "./scenario-wallet-credit.js";
export * from "./user-classification.js";
export * from "./admin-user-classification.js";
export * from "./admin-segments.js";
export * from "./admin-saved-segments.js";
export * from "./segment-audience-snapshots.js";
export * from "./admin-broadcasts.js";
export * from "./broadcast-preparation.js";
export * from "./broadcast-delivery.js";
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
