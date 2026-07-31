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
    id: "20260726090000_business_picnic_2026_catalog_seed",
    description: "Seed the Business Picnic 2026 event, ticket products, pricing rules, and offer version",
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
    id: "20260727090000_referral_program",
    description: "Create referral tier configuration and attribution, seeded with the 7/10/15% default tiers",
    destructive: false
  },
  {
    id: "20260728090000_participant_engagement",
    description: "Create participant questionnaire responses, reminder-cadence dedup, and admin broadcasts",
    destructive: false
  },
  {
    id: "20260728120000_outbox_dispatch_retry_window",
    description: "Widen the outbox dispatch retry window so a multi-hour Telegram outage cannot drop deliveries",
    destructive: false
  },
  {
    id: "20260728140000_phone_bonus_campaign",
    description: "Activate the 100 RUB phone bonus campaign outside development seeds",
    destructive: false
  },
  {
    id: "20260728160000_offer_version_pdf",
    description: "Publish the signed offer PDF as the active immutable offer version",
    destructive: false
  },
  {
    id: "20260729100000_outreach_tracking",
    description: "Create outreach campaigns, pre-registration contacts, assignments, and append-only manager activities",
    destructive: false
  },
  {
    id: "20260729110000_outreach_pipeline_tasks",
    description: "Add the outreach sales pipeline, stage history, and manager follow-up tasks",
    destructive: false
  },
  {
    id: "20260730100000_outreach_pipeline_columns",
    description: "Add per-campaign labels and ordering for outreach pipeline columns",
    destructive: false
  },
  {
    id: "20260730150000_outreach_flexible_pipeline_fields",
    description: "Let managers add/remove/rename outreach pipeline stages with a won/lost outcome flag, and add custom contact fields",
    destructive: false
  },
  {
    id: "20260731100000_event_accommodation",
    description: "Add tent accommodation planning: sleeping-place flag on products, manual party groups, and append-only fixed plans",
    destructive: false
  },
  {
    id: "20260731140000_event_participants_and_exclusions",
    description: "Add manually entered event participants, order exclusion for test orders, and archiving for outreach contacts",
    destructive: false
  }
];
