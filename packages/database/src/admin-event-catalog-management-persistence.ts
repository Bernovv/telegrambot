import type {
  AdminEventAuditContext,
  AdminEventCatalogManagementRepository,
  AdminEventPricingRuleRecord,
  AdminEventProductRecord
} from "@ticket-platform/application";
import type {
  SqlConnection,
  SqlConnectionPool
} from "./postgres.js";

interface EventGateRow {
  readonly id: string;
  readonly status: string;
  readonly lock_version: number;
}

interface ProductRow {
  readonly id: string;
  readonly event_id: string;
  readonly code: string;
  readonly product_type: string;
  readonly title: string;
  readonly description: string;
  readonly currency: string;
  readonly bundle_composition: unknown;
  readonly inventory_units_per_item: number;
  readonly capacity: number | null;
  readonly maximum_quantity_per_order: number;
  readonly is_active: boolean;
  readonly sort_order: number;
}

interface PricingRuleRow {
  readonly id: string;
  readonly product_id: string;
  readonly currency: string;
  readonly minimum_quantity: number;
  readonly maximum_quantity: number | null;
  readonly unit_price_kopecks: string;
  readonly priority: number;
  readonly specificity: number;
  readonly valid_from: Date | string | null;
  readonly valid_until: Date | string | null;
  readonly conditions: unknown;
  readonly explanation: string;
  readonly is_active: boolean;
}

type EventGate =
  | { readonly status: "ready" }
  | {
      readonly status:
        | "event_not_found"
        | "not_draft"
        | "version_conflict";
    };

export class PostgresAdminEventCatalogManagementRepository
implements AdminEventCatalogManagementRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  createProduct(
    input: Parameters<AdminEventCatalogManagementRepository["createProduct"]>[0]
  ) {
    return this.write(async (connection) => {
      const gate = await lockDraftEvent(
        connection,
        input.eventId,
        input.expectedLockVersion
      );
      if (gate.status !== "ready") {
        return gate;
      }
      if (
        await productCodeExists(
          connection,
          input.eventId,
          input.product.code,
          null
        )
      ) {
        return { status: "product_code_conflict" as const };
      }
      await connection.query(
        `insert into public.ticket_products (
           id, event_id, code, product_type, title, description, currency,
           bundle_schema_version, bundle_composition,
           inventory_units_per_item, capacity, maximum_quantity_per_order,
           is_active, sort_order, created_at, updated_at
         ) values (
           $1, $2, $3, $4, $5, $6, $7,
           1, $8::jsonb,
           $9, $10, $11,
           $12, $13, $14, $14
         )`,
        productValues(
          input.productId,
          input.eventId,
          input.product,
          input.audit.occurredAt
        )
      );
      const lockVersion = await bumpEventVersion(
        connection,
        input.eventId,
        input.audit.occurredAt
      );
      await appendCatalogAudit(
        connection,
        input.audit,
        "event.product_created",
        "ticket_product",
        input.productId,
        null,
        productSnapshot(input.eventId, input.product, lockVersion)
      );
      return { status: "created" as const, lockVersion };
    });
  }

  updateProduct(
    input: Parameters<AdminEventCatalogManagementRepository["updateProduct"]>[0]
  ) {
    return this.write(async (connection) => {
      const gate = await lockDraftEvent(
        connection,
        input.eventId,
        input.expectedLockVersion
      );
      if (gate.status !== "ready") {
        return gate;
      }
      const existing = await connection.query<ProductRow>(
        `${PRODUCT_SELECT}
         where id = $1 and event_id = $2
         for update`,
        [input.productId, input.eventId]
      );
      const row = existing.rows[0];
      if (!row) {
        return { status: "product_not_found" as const };
      }
      if (
        await productCodeExists(
          connection,
          input.eventId,
          input.product.code,
          input.productId
        )
      ) {
        return { status: "product_code_conflict" as const };
      }
      if (
        await pricingRuleCurrencyConflictExists(
          connection,
          input.productId,
          input.product.currency
        )
      ) {
        return { status: "currency_mismatch" as const };
      }
      await connection.query(
        `update public.ticket_products
         set code = $3,
             product_type = $4,
             title = $5,
             description = $6,
             currency = $7,
             bundle_schema_version = 1,
             bundle_composition = $8::jsonb,
             inventory_units_per_item = $9,
             capacity = $10,
             maximum_quantity_per_order = $11,
             is_active = $12,
             sort_order = $13,
             updated_at = $14
         where id = $1 and event_id = $2`,
        productValues(
          input.productId,
          input.eventId,
          input.product,
          input.audit.occurredAt
        )
      );
      const lockVersion = await bumpEventVersion(
        connection,
        input.eventId,
        input.audit.occurredAt
      );
      await appendCatalogAudit(
        connection,
        input.audit,
        "event.product_updated",
        "ticket_product",
        input.productId,
        productRowSnapshot(row, input.expectedLockVersion),
        productSnapshot(input.eventId, input.product, lockVersion)
      );
      return { status: "updated" as const, lockVersion };
    });
  }

  createPricingRule(
    input: Parameters<
      AdminEventCatalogManagementRepository["createPricingRule"]
    >[0]
  ) {
    return this.write(async (connection) => {
      const gate = await lockDraftEvent(
        connection,
        input.eventId,
        input.expectedLockVersion
      );
      if (gate.status !== "ready") {
        return gate;
      }
      const product = await connection.query<{
        readonly id: string;
        readonly currency: string;
      }>(
        `select id, currency
         from public.ticket_products
         where id = $1 and event_id = $2
         for update`,
        [input.productId, input.eventId]
      );
      const productRow = product.rows[0];
      if (!productRow) {
        return { status: "product_not_found" as const };
      }
      if (productRow.currency !== input.pricingRule.currency) {
        return { status: "currency_mismatch" as const };
      }
      await connection.query(
        `insert into public.pricing_rules (
           id, product_id, currency, minimum_quantity, maximum_quantity,
           unit_price_kopecks, priority, specificity,
           valid_from, valid_until, condition_schema_version, conditions,
           explanation, is_active, created_at, updated_at
         ) values (
           $1, $2, $3, $4, $5,
           $6::bigint, $7, $8,
           $9, $10, 1, $11::jsonb,
           $12, $13, $14, $14
         )`,
        pricingRuleValues(
          input.pricingRuleId,
          input.productId,
          input.pricingRule,
          input.audit.occurredAt
        )
      );
      const lockVersion = await bumpEventVersion(
        connection,
        input.eventId,
        input.audit.occurredAt
      );
      await appendCatalogAudit(
        connection,
        input.audit,
        "event.pricing_rule_created",
        "pricing_rule",
        input.pricingRuleId,
        null,
        pricingRuleSnapshot(
          input.eventId,
          input.productId,
          input.pricingRule,
          lockVersion
        )
      );
      return { status: "created" as const, lockVersion };
    });
  }

  updatePricingRule(
    input: Parameters<
      AdminEventCatalogManagementRepository["updatePricingRule"]
    >[0]
  ) {
    return this.write(async (connection) => {
      const gate = await lockDraftEvent(
        connection,
        input.eventId,
        input.expectedLockVersion
      );
      if (gate.status !== "ready") {
        return gate;
      }
      const product = await connection.query<{
        readonly id: string;
        readonly currency: string;
      }>(
        `select id, currency
         from public.ticket_products
         where id = $1 and event_id = $2
         for update`,
        [input.productId, input.eventId]
      );
      const productRow = product.rows[0];
      if (!productRow) {
        return { status: "product_not_found" as const };
      }
      if (productRow.currency !== input.pricingRule.currency) {
        return { status: "currency_mismatch" as const };
      }
      const existing = await connection.query<PricingRuleRow>(
        `${PRICING_RULE_SELECT}
         where id = $1 and product_id = $2
         for update`,
        [input.pricingRuleId, input.productId]
      );
      const row = existing.rows[0];
      if (!row) {
        return { status: "pricing_rule_not_found" as const };
      }
      await connection.query(
        `update public.pricing_rules
         set currency = $3,
             minimum_quantity = $4,
             maximum_quantity = $5,
             unit_price_kopecks = $6::bigint,
             priority = $7,
             specificity = $8,
             valid_from = $9,
             valid_until = $10,
             condition_schema_version = 1,
             conditions = $11::jsonb,
             explanation = $12,
             is_active = $13,
             updated_at = $14
         where id = $1 and product_id = $2`,
        pricingRuleValues(
          input.pricingRuleId,
          input.productId,
          input.pricingRule,
          input.audit.occurredAt
        )
      );
      const lockVersion = await bumpEventVersion(
        connection,
        input.eventId,
        input.audit.occurredAt
      );
      await appendCatalogAudit(
        connection,
        input.audit,
        "event.pricing_rule_updated",
        "pricing_rule",
        input.pricingRuleId,
        pricingRuleRowSnapshot(
          input.eventId,
          row,
          input.expectedLockVersion
        ),
        pricingRuleSnapshot(
          input.eventId,
          input.productId,
          input.pricingRule,
          lockVersion
        )
      );
      return { status: "updated" as const, lockVersion };
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

export function createAdminEventCatalogManagementPersistence(
  pool: SqlConnectionPool
): AdminEventCatalogManagementRepository {
  return new PostgresAdminEventCatalogManagementRepository(pool);
}

async function lockDraftEvent(
  connection: SqlConnection,
  eventId: string,
  expectedLockVersion: number
): Promise<EventGate> {
  await connection.query(
    "select pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`event-sales:${eventId}`]
  );
  const event = await connection.query<EventGateRow>(
    `select id, status, lock_version
     from public.events
     where id = $1
     for update`,
    [eventId]
  );
  const row = event.rows[0];
  if (!row) {
    return { status: "event_not_found" };
  }
  if (row.status !== "draft") {
    return { status: "not_draft" };
  }
  if (row.lock_version !== expectedLockVersion) {
    return { status: "version_conflict" };
  }
  return { status: "ready" };
}

async function productCodeExists(
  connection: SqlConnection,
  eventId: string,
  code: string,
  exceptProductId: string | null
): Promise<boolean> {
  const result = await connection.query<{ readonly exists: boolean }>(
    `select exists(
       select 1 from public.ticket_products
       where event_id = $1
         and code = $2
         and ($3::uuid is null or id <> $3::uuid)
     ) as exists`,
    [eventId, code, exceptProductId]
  );
  return result.rows[0]?.exists === true;
}

async function pricingRuleCurrencyConflictExists(
  connection: SqlConnection,
  productId: string,
  currency: string
): Promise<boolean> {
  const result = await connection.query<{ readonly exists: boolean }>(
    `select exists(
       select 1 from public.pricing_rules
       where product_id = $1
         and currency <> $2
     ) as exists`,
    [productId, currency]
  );
  return result.rows[0]?.exists === true;
}

async function bumpEventVersion(
  connection: SqlConnection,
  eventId: string,
  occurredAt: Date
): Promise<number> {
  const result = await connection.query<{ readonly lock_version: number }>(
    `update public.events
     set lock_version = lock_version + 1,
         updated_at = $2
     where id = $1
     returning lock_version`,
    [eventId, occurredAt]
  );
  const lockVersion = result.rows[0]?.lock_version;
  if (!lockVersion) {
    throw new Error("Administrator event catalog update lost its locked event");
  }
  return lockVersion;
}

async function appendCatalogAudit(
  connection: SqlConnection,
  audit: AdminEventAuditContext,
  action: string,
  targetType: string,
  targetId: string,
  before: Readonly<Record<string, unknown>> | null,
  after: Readonly<Record<string, unknown>>
): Promise<void> {
  await connection.query(
    `insert into public.audit_log (
       id, actor_admin_id, actor_role, action, target_type, target_id,
       reason, before_masked, after_masked, request_id,
       ip_address, user_agent, created_at
     ) values (
       $1, $2, $3, $4, $5, $6,
       $7, $8::jsonb, $9::jsonb, $10,
       $11, $12, $13
     )`,
    [
      audit.auditId,
      audit.actorAdminId,
      audit.actorRole,
      action,
      targetType,
      targetId,
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

function productValues(
  productId: string,
  eventId: string,
  product: AdminEventProductRecord,
  occurredAt: Date
): readonly unknown[] {
  return [
    productId,
    eventId,
    product.code,
    product.productType,
    product.title,
    product.description,
    product.currency,
    JSON.stringify(product.bundleComposition),
    product.inventoryUnitsPerItem,
    product.capacity,
    product.maximumQuantityPerOrder,
    product.isActive,
    product.sortOrder,
    occurredAt
  ];
}

function pricingRuleValues(
  pricingRuleId: string,
  productId: string,
  rule: AdminEventPricingRuleRecord,
  occurredAt: Date
): readonly unknown[] {
  return [
    pricingRuleId,
    productId,
    rule.currency,
    rule.minimumQuantity,
    rule.maximumQuantity,
    rule.unitPriceKopecks,
    rule.priority,
    rule.specificity,
    rule.validFrom,
    rule.validUntil,
    JSON.stringify(rule.conditions),
    rule.explanation,
    rule.isActive,
    occurredAt
  ];
}

function productSnapshot(
  eventId: string,
  product: AdminEventProductRecord,
  eventLockVersion: number
): Readonly<Record<string, unknown>> {
  return {
    eventId,
    code: product.code,
    productType: product.productType,
    title: product.title,
    description: product.description,
    currency: product.currency,
    bundleComposition: product.bundleComposition,
    inventoryUnitsPerItem: product.inventoryUnitsPerItem,
    capacity: product.capacity,
    maximumQuantityPerOrder: product.maximumQuantityPerOrder,
    isActive: product.isActive,
    sortOrder: product.sortOrder,
    eventLockVersion
  };
}

function productRowSnapshot(
  row: ProductRow,
  eventLockVersion: number
): Readonly<Record<string, unknown>> {
  return {
    eventId: row.event_id,
    code: row.code,
    productType: row.product_type,
    title: row.title,
    description: row.description,
    currency: row.currency,
    bundleComposition: readJson(row.bundle_composition),
    inventoryUnitsPerItem: row.inventory_units_per_item,
    capacity: row.capacity,
    maximumQuantityPerOrder: row.maximum_quantity_per_order,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    eventLockVersion
  };
}

function pricingRuleSnapshot(
  eventId: string,
  productId: string,
  rule: AdminEventPricingRuleRecord,
  eventLockVersion: number
): Readonly<Record<string, unknown>> {
  return {
    eventId,
    productId,
    currency: rule.currency,
    minimumQuantity: rule.minimumQuantity,
    maximumQuantity: rule.maximumQuantity,
    unitPriceKopecks: rule.unitPriceKopecks,
    priority: rule.priority,
    specificity: rule.specificity,
    validFrom: rule.validFrom?.toISOString() ?? null,
    validUntil: rule.validUntil?.toISOString() ?? null,
    conditions: rule.conditions,
    explanation: rule.explanation,
    isActive: rule.isActive,
    eventLockVersion
  };
}

function pricingRuleRowSnapshot(
  eventId: string,
  row: PricingRuleRow,
  eventLockVersion: number
): Readonly<Record<string, unknown>> {
  return {
    eventId,
    productId: row.product_id,
    currency: row.currency,
    minimumQuantity: row.minimum_quantity,
    maximumQuantity: row.maximum_quantity,
    unitPriceKopecks: row.unit_price_kopecks,
    priority: row.priority,
    specificity: row.specificity,
    validFrom: toNullableIso(row.valid_from),
    validUntil: toNullableIso(row.valid_until),
    conditions: readJson(row.conditions),
    explanation: row.explanation,
    isActive: row.is_active,
    eventLockVersion
  };
}

function readJson(value: unknown): unknown {
  return typeof value === "string" ? JSON.parse(value) as unknown : value;
}

function toNullableIso(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

const PRODUCT_SELECT = `
  select id, event_id, code, product_type, title, description, currency,
         bundle_composition, inventory_units_per_item, capacity,
         maximum_quantity_per_order, is_active, sort_order
  from public.ticket_products`;

const PRICING_RULE_SELECT = `
  select id, product_id, currency, minimum_quantity, maximum_quantity,
         unit_price_kopecks::text, priority, specificity,
         valid_from, valid_until, conditions, explanation, is_active
  from public.pricing_rules`;
