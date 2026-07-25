export interface MigrationDescriptor {
  readonly id: string;
  readonly description: string;
  readonly destructive: boolean;
}

export const migrations: readonly MigrationDescriptor[] = [
  {
    id: "20260721160000_foundation_identity_audit_outbox",
    description: "Create foundation identity, audit, outbox, and worker heartbeat tables",
    destructive: false
  },
  {
    id: "20260721162000_foundation_idempotency_keys",
    description: "Create foundation idempotency key table for Telegram updates, callbacks, webhooks, and jobs",
    destructive: false
  },
  {
    id: "20260722100000_contacts_wallet_ledger",
    description: "Create user contacts and the append-only wallet ledger foundation",
    destructive: false
  },
  {
    id: "20260722230000_pgboss_v37_outbox_queues",
    description: "Install pinned pg-boss v37 schema and provision outbox dispatch queues",
    destructive: false
  },
  {
    id: "20260723223000_admin_rbac",
    description: "Create admin accounts, roles, permission grants, and append-only audit protection",
    destructive: false
  },
  {
    id: "20260724120000_event_sales_catalog_orders",
    description: "Create event catalog, pricing, immutable offers and orders, reservations, and tickets",
    destructive: false
  },
  {
    id: "20260724170000_payment_confirmation_tickets",
    description: "Create payment attempts and append-only manual payment evidence",
    destructive: false
  },
  {
    id: "20260724190000_notification_delivery_ledger",
    description: "Create the leased idempotent notification delivery ledger",
    destructive: false
  },
  {
    id: "20260724220000_tbank_payment_attempts_webhooks",
    description: "Expand payment attempts and add append-only T-Bank webhook evidence",
    destructive: false
  },
  {
    id: "20260725120000_tbank_payment_reconciliation",
    description: "Add leased T-Bank reconciliation state and append-only observations",
    destructive: false
  },
  {
    id: "20260725160000_tbank_full_refunds",
    description: "Add full T-Bank refund requests, leases, and append-only evidence",
    destructive: false
  }
];

export * from "./postgres.js";
export * from "./node-postgres.js";
export * from "./telegram-start-persistence.js";
export * from "./phone-persistence.js";
export * from "./outbox-persistence.js";
export * from "./health-persistence.js";
export * from "./admin-authorization-persistence.js";
export * from "./admin-bootstrap-persistence.js";
export * from "./admin-operations-persistence.js";
export * from "./order-sales-persistence.js";
export * from "./offer-acceptance-persistence.js";
export * from "./order-expiry-persistence.js";
export * from "./payment-confirmation-persistence.js";
export * from "./notification-delivery-persistence.js";
export * from "./ticket-access-persistence.js";
export * from "./tbank-payment-persistence.js";
export * from "./tbank-reconciliation-persistence.js";
export * from "./tbank-refund-persistence.js";
