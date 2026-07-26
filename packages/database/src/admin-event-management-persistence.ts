import type {
  AdminEventAuditContext,
  AdminEventGeneralRecord,
  AdminEventManagementRepository,
  AdminEventPublicationIssue
} from "@ticket-platform/application";
import type {
  SqlConnection,
  SqlConnectionPool
} from "./postgres.js";

interface EventGeneralRow {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly timezone: string;
  readonly starts_at: Date | string;
  readonly ends_at: Date | string | null;
  readonly sales_starts_at: Date | string | null;
  readonly sales_ends_at: Date | string | null;
  readonly location_name: string | null;
  readonly location_address: string | null;
  readonly support_contact: string | null;
  readonly status: string;
  readonly capacity: number;
  readonly reservation_ttl_minutes: number;
  readonly phone_required_for_purchase: boolean;
  readonly offer_required: boolean;
  readonly active_offer_version_id: string | null;
  readonly published_scenario_version_id: string | null;
  readonly lock_version: number;
}

interface EventPublicationCatalogRow {
  readonly active_product_count: string | number;
  readonly unpriced_active_product_count: string | number;
}

export class PostgresAdminEventManagementRepository
implements AdminEventManagementRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  createDraft(input: Parameters<AdminEventManagementRepository["createDraft"]>[0]) {
    return this.write(async (connection) => {
      await lockSlug(connection, input.event.slug);
      if (await slugExists(connection, input.event.slug, null)) {
        return "slug_conflict" as const;
      }
      await connection.query(
        `insert into public.events (
           id, slug, title, description, timezone, starts_at, ends_at,
           sales_starts_at, sales_ends_at, location_name, location_address,
           support_contact, status, capacity, reservation_ttl_minutes,
           phone_required_for_purchase, offer_required, lock_version,
           created_at, updated_at
         ) values (
           $1, $2, $3, $4, $5, $6, $7,
           $8, $9, $10, $11,
           $12, 'draft', $13, $14,
           $15, $16, 1,
           $17, $17
         )`,
        eventValues(input.eventId, input.event, input.audit.occurredAt)
      );
      await appendAudit(
        connection,
        input.audit,
        "event.draft_created",
        input.eventId,
        null,
        eventSnapshot(input.event, "draft", 1)
      );
      return "created" as const;
    });
  }

  updateDraft(input: Parameters<AdminEventManagementRepository["updateDraft"]>[0]) {
    return this.write(async (connection) => {
      await lockEventSales(connection, input.eventId);
      const existing = await connection.query<EventGeneralRow>(
        `${EVENT_GENERAL_SELECT} where id = $1 for update`,
        [input.eventId]
      );
      const row = existing.rows[0];
      if (!row) {
        return { status: "not_found" as const };
      }
      if (row.status !== "draft") {
        return { status: "not_draft" as const };
      }
      if (row.lock_version !== input.expectedLockVersion) {
        return { status: "version_conflict" as const };
      }
      await lockSlug(connection, input.event.slug);
      if (await slugExists(connection, input.event.slug, input.eventId)) {
        return { status: "slug_conflict" as const };
      }
      const updated = await connection.query<{ readonly lock_version: number }>(
        `update public.events
         set slug = $2,
             title = $3,
             description = $4,
             timezone = $5,
             starts_at = $6,
             ends_at = $7,
             sales_starts_at = $8,
             sales_ends_at = $9,
             location_name = $10,
             location_address = $11,
             support_contact = $12,
             capacity = $13,
             reservation_ttl_minutes = $14,
             phone_required_for_purchase = $15,
             offer_required = $16,
             lock_version = lock_version + 1,
             updated_at = $17
         where id = $1
         returning lock_version`,
        eventValues(input.eventId, input.event, input.audit.occurredAt)
      );
      const lockVersion = updated.rows[0]?.lock_version;
      if (!lockVersion) {
        throw new Error("Administrator event update lost its locked row");
      }
      await appendAudit(
        connection,
        input.audit,
        "event.general_updated",
        input.eventId,
        rowSnapshot(row),
        eventSnapshot(input.event, "draft", lockVersion)
      );
      return { status: "updated" as const, lockVersion };
    });
  }

  publishDraft(input: Parameters<AdminEventManagementRepository["publishDraft"]>[0]) {
    return this.write(async (connection) => {
      await lockEventSales(connection, input.eventId);
      const existing = await connection.query<EventGeneralRow>(
        `${EVENT_GENERAL_SELECT} where id = $1 for update`,
        [input.eventId]
      );
      const row = existing.rows[0];
      if (!row) {
        return { status: "not_found" as const };
      }
      if (row.status !== "draft") {
        return { status: "not_draft" as const };
      }
      if (row.lock_version !== input.expectedLockVersion) {
        return { status: "version_conflict" as const };
      }

      const catalog = await connection.query<EventPublicationCatalogRow>(
        `select
           count(*) filter (where products.is_active) as active_product_count,
           count(*) filter (
             where products.is_active
               and not exists (
                 select 1
                 from public.pricing_rules rules
                 where rules.product_id = products.id
                   and rules.is_active
                   and rules.unit_price_kopecks > 0
               )
           ) as unpriced_active_product_count
         from public.ticket_products products
         where products.event_id = $1`,
        [input.eventId]
      );
      const issues = publicationIssues(row, catalog.rows[0]);
      if (issues.length > 0) {
        return { status: "requirements_failed" as const, issues };
      }

      const updated = await connection.query<{ readonly lock_version: number }>(
        `update public.events
         set status = 'published',
             published_at = $2,
             lock_version = lock_version + 1,
             updated_at = $2
         where id = $1
         returning lock_version`,
        [input.eventId, input.audit.occurredAt]
      );
      const lockVersion = updated.rows[0]?.lock_version;
      if (!lockVersion) {
        throw new Error("Administrator event publication lost its locked row");
      }
      await appendAudit(
        connection,
        input.audit,
        "event.published",
        input.eventId,
        rowSnapshot(row),
        {
          ...rowSnapshot(row),
          status: "published",
          publishedAt: input.audit.occurredAt.toISOString(),
          lockVersion
        }
      );
      return { status: "published" as const, lockVersion };
    });
  }

  private async write<TResult>(
    work: (connection: SqlConnection) => Promise<TResult>
  ): Promise<TResult> {
    const connection = await this.pool.connect();
    try {
      await connection.query("begin");
      try {
        const result = await work(connection);
        await connection.query("commit");
        return result;
      } catch (error) {
        await connection.query("rollback");
        throw error;
      }
    } finally {
      connection.release();
    }
  }
}

export function createAdminEventManagementPersistence(
  pool: SqlConnectionPool
): AdminEventManagementRepository {
  return new PostgresAdminEventManagementRepository(pool);
}

function eventValues(
  eventId: string,
  event: AdminEventGeneralRecord,
  occurredAt: Date
): readonly unknown[] {
  return [
    eventId,
    event.slug,
    event.title,
    event.description,
    event.timezone,
    event.startsAt,
    event.endsAt,
    event.salesStartsAt,
    event.salesEndsAt,
    event.locationName,
    event.locationAddress,
    event.supportContact,
    event.capacity,
    event.reservationTtlMinutes,
    event.phoneRequiredForPurchase,
    event.offerRequired,
    occurredAt
  ];
}

async function lockSlug(
  connection: SqlConnection,
  slug: string
): Promise<void> {
  await connection.query(
    "select pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`event-slug:${slug}`]
  );
}

async function lockEventSales(
  connection: SqlConnection,
  eventId: string
): Promise<void> {
  await connection.query(
    "select pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`event-sales:${eventId}`]
  );
}

async function slugExists(
  connection: SqlConnection,
  slug: string,
  exceptEventId: string | null
): Promise<boolean> {
  const result = await connection.query<{ readonly exists: boolean }>(
    `select exists(
       select 1 from public.events
       where slug = $1 and ($2::uuid is null or id <> $2::uuid)
     ) as exists`,
    [slug, exceptEventId]
  );
  return result.rows[0]?.exists === true;
}

async function appendAudit(
  connection: SqlConnection,
  audit: AdminEventAuditContext,
  action: string,
  eventId: string,
  before: Readonly<Record<string, unknown>> | null,
  after: Readonly<Record<string, unknown>>
): Promise<void> {
  await connection.query(
    `insert into public.audit_log (
       id, actor_admin_id, actor_role, action, target_type, target_id,
       reason, before_masked, after_masked, request_id,
       ip_address, user_agent, created_at
     ) values (
       $1, $2, $3, $4, 'event', $5,
       $6, $7::jsonb, $8::jsonb, $9,
       $10, $11, $12
     )`,
    [
      audit.auditId,
      audit.actorAdminId,
      audit.actorRole,
      action,
      eventId,
      audit.reason,
      before === null ? null : JSON.stringify(before),
      JSON.stringify(after),
      audit.requestId,
      audit.ipAddress,
      audit.userAgent,
      audit.occurredAt
    ]
  );
}

function eventSnapshot(
  event: AdminEventGeneralRecord,
  status: string,
  lockVersion: number
): Readonly<Record<string, unknown>> {
  return {
    slug: event.slug,
    title: event.title,
    description: event.description,
    timezone: event.timezone,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt?.toISOString() ?? null,
    salesStartsAt: event.salesStartsAt?.toISOString() ?? null,
    salesEndsAt: event.salesEndsAt?.toISOString() ?? null,
    locationName: event.locationName,
    locationAddress: event.locationAddress,
    supportContact: event.supportContact,
    status,
    capacity: event.capacity,
    reservationTtlMinutes: event.reservationTtlMinutes,
    phoneRequiredForPurchase: event.phoneRequiredForPurchase,
    offerRequired: event.offerRequired,
    lockVersion
  };
}

function rowSnapshot(row: EventGeneralRow): Readonly<Record<string, unknown>> {
  return {
    slug: row.slug,
    title: row.title,
    description: row.description,
    timezone: row.timezone,
    startsAt: toIso(row.starts_at),
    endsAt: toNullableIso(row.ends_at),
    salesStartsAt: toNullableIso(row.sales_starts_at),
    salesEndsAt: toNullableIso(row.sales_ends_at),
    locationName: row.location_name,
    locationAddress: row.location_address,
    supportContact: row.support_contact,
    status: row.status,
    capacity: row.capacity,
    reservationTtlMinutes: row.reservation_ttl_minutes,
    phoneRequiredForPurchase: row.phone_required_for_purchase,
    offerRequired: row.offer_required,
    activeOfferVersionId: row.active_offer_version_id,
    publishedScenarioVersionId: row.published_scenario_version_id,
    lockVersion: row.lock_version
  };
}

function publicationIssues(
  event: EventGeneralRow,
  catalog: EventPublicationCatalogRow | undefined
): readonly AdminEventPublicationIssue[] {
  const issues: AdminEventPublicationIssue[] = [];
  if (!event.title.trim()) {
    issues.push("missing_title");
  }
  if (Number.isNaN(new Date(event.starts_at).getTime())) {
    issues.push("missing_start");
  }
  if (!event.support_contact?.trim()) {
    issues.push("missing_support_contact");
  }
  const activeProductCount = Number(catalog?.active_product_count ?? 0);
  if (activeProductCount < 1) {
    issues.push("missing_active_product");
  }
  if (Number(catalog?.unpriced_active_product_count ?? 0) > 0) {
    issues.push("active_product_without_price");
  }
  if (event.offer_required && event.active_offer_version_id === null) {
    issues.push("missing_active_offer");
  }
  if (event.published_scenario_version_id === null) {
    issues.push("missing_published_scenario");
  }
  return issues;
}

function toIso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function toNullableIso(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}

const EVENT_GENERAL_SELECT = `
  select id, slug, title, description, timezone, starts_at, ends_at,
         sales_starts_at, sales_ends_at, location_name, location_address,
         support_contact, status, capacity, reservation_ttl_minutes,
         phone_required_for_purchase, offer_required, active_offer_version_id,
         published_scenario_version_id, lock_version
  from public.events`;
