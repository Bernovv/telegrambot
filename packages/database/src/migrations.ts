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
  },
  {
    id: "20260726120000_scenario_versions",
    description: "Create immutable versioned event scenarios, nodes, and edges",
    destructive: false
  },
  {
    id: "20260726160000_scenario_runtime",
    description: "Create pinned scenario sessions and append-only execution events",
    destructive: false
  },
  {
    id: "20260726200000_application_migration_checksums",
    description: "Create append-only SHA-256 evidence for applied application migrations",
    destructive: false
  },
  {
    id: "20260728120000_internal_zero_due_payments",
    description: "Allow audited internal confirmation for orders with zero external due",
    destructive: false
  },
  {
    id: "20260728160000_scenario_wallet_credit",
    description: "Allow bounded idempotent wallet credits from published scenario nodes",
    destructive: false
  },
  {
    id: "20260728200000_user_statuses_categories",
    description: "Create protected user status and category catalogs with append-only assignment history",
    destructive: false
  },
  {
    id: "20260729120000_segment_versions",
    description: "Create saved segments with mutable drafts and immutable published versions",
    destructive: false
  },
  {
    id: "20260729160000_segment_audience_snapshots",
    description: "Create immutable recipient snapshots for published segment versions",
    destructive: false
  },
  {
    id: "20260729200000_broadcast_versions",
    description: "Create broadcast drafts with immutable content and audience versions",
    destructive: false
  },
  {
    id: "20260730120000_broadcast_scheduling_delivery_ledger",
    description: "Add immutable broadcast schedules and recipient delivery preparation",
    destructive: false
  },
  {
    id: "20260730160000_broadcast_delivery_execution",
    description: "Add leased rate-limited broadcast delivery execution and progress",
    destructive: false
  },
  {
    id: "20260730200000_broadcast_manual_lifecycle_control",
    description: "Add audited manual pause, resume, and cancellation metadata for broadcasts",
    destructive: false
  },
  {
    id: "20260730220000_broadcast_test_deliveries",
    description: "Add protected asynchronous Telegram test deliveries for broadcast content",
    destructive: false
  },
  {
    id: "20260731000000_broadcast_personalization_v2",
    description: "Add versioned broadcast personalization with immutable recipient context snapshots",
    destructive: false
  },
  {
    id: "20260731040000_broadcast_photo_media_v3",
    description: "Allow one validated photo in immutable broadcast content schema v3",
    destructive: false
  },
  {
    id: "20260731100000_user_import_staging",
    description: "Create append-only checksum-deduplicated CSV user import staging",
    destructive: false
  },
  {
    id: "20260731160000_user_import_identity_matching",
    description: "Create immutable user import identity-match analyses and external identity directory",
    destructive: false
  },
  {
    id: "20260731200000_user_import_row_decisions",
    description: "Create append-only optimistic administrator decisions for ambiguous import rows",
    destructive: false
  }
];
