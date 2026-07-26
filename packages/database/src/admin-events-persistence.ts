import type {
  AdminEventsRepository
} from "@ticket-platform/application";
import {
  ADMIN_EVENT_CONTENT_BLOCK_TYPES,
  type AdminEventContentBlock,
  type AdminEventDetail,
  type AdminEventOfferVersion,
  type AdminEventPricingRule,
  type AdminEventProduct,
  type AdminEventScenarioVersion,
  type AdminScenarioNodeType,
  type AdminScenarioValidationIssue,
  type AdminEventSummary
} from "@ticket-platform/contracts";
import type {
  SqlConnection,
  SqlConnectionPool
} from "./postgres.js";

interface EventSummaryRow {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly status: AdminEventSummary["status"];
  readonly timezone: string;
  readonly starts_at: Date | string;
  readonly ends_at: Date | string | null;
  readonly sales_starts_at: Date | string | null;
  readonly sales_ends_at: Date | string | null;
  readonly location_name: string | null;
  readonly capacity: number;
  readonly product_count: string;
  readonly active_product_count: string;
  readonly order_count: string;
  readonly paid_order_count: string;
  readonly ticket_count: string;
  readonly reserved_inventory_units: string;
  readonly consumed_inventory_units: string;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

interface EventDetailRow extends EventSummaryRow {
  readonly description: string;
  readonly location_address: string | null;
  readonly support_contact: string | null;
  readonly reservation_ttl_minutes: number;
  readonly phone_required_for_purchase: boolean;
  readonly offer_required: boolean;
  readonly published_scenario_version_id: string | null;
  readonly active_offer_version_id: string | null;
  readonly published_at: Date | string | null;
  readonly lock_version: number;
}

interface ContentBlockRow {
  readonly id: string;
  readonly block_type: string;
  readonly title: string | null;
  readonly content_schema_version: number;
  readonly content: unknown;
  readonly sort_order: number;
  readonly is_visible: boolean;
}

interface ProductRow {
  readonly id: string;
  readonly code: string;
  readonly product_type: AdminEventProduct["productType"];
  readonly title: string;
  readonly description: string;
  readonly currency: string;
  readonly bundle_composition: unknown;
  readonly inventory_units_per_item: number;
  readonly capacity: number | null;
  readonly maximum_quantity_per_order: number;
  readonly is_active: boolean;
  readonly sort_order: number;
  readonly reserved_inventory_units: string;
  readonly consumed_inventory_units: string;
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

interface OfferVersionRow {
  readonly id: string;
  readonly offer_document_id: string;
  readonly document_title: string;
  readonly source_type: string;
  readonly source_url: string | null;
  readonly version_number: number;
  readonly public_url: string;
  readonly storage_path: string;
  readonly content_type: string;
  readonly sha256: string;
  readonly published_at: Date | string;
  readonly published_by_admin_id: string | null;
  readonly is_active: boolean;
  readonly source_revision_id: string | null;
  readonly display_text_snapshot: string;
  readonly acceptance_count: string;
}

interface ScenarioVersionRow {
  readonly id: string;
  readonly scenario_id: string;
  readonly scenario_title: string;
  readonly version_number: number;
  readonly status: AdminEventScenarioVersion["status"];
  readonly schema_version: number;
  readonly validation_issues: unknown;
  readonly created_by_admin_id: string | null;
  readonly published_by_admin_id: string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
  readonly published_at: Date | string | null;
}

interface ScenarioNodeRow {
  readonly scenario_version_id: string;
  readonly id: string;
  readonly node_type: AdminScenarioNodeType;
  readonly schema_version: number;
  readonly payload: unknown;
}

interface ScenarioEdgeRow {
  readonly scenario_version_id: string;
  readonly id: string;
  readonly from_node_id: string;
  readonly to_node_id: string;
  readonly label: string | null;
  readonly priority: number;
  readonly condition: unknown;
}

export class PostgresAdminEventsRepository implements AdminEventsRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  listEvents(
    input: Parameters<AdminEventsRepository["listEvents"]>[0]
  ): Promise<readonly AdminEventSummary[]> {
    return this.read(async (connection) => {
      const result = await connection.query<EventSummaryRow>(
        `${EVENT_SUMMARY_SELECT}
         where ($1::text is null or (
           events.title ilike $1 escape '\\'
           or events.slug ilike $1 escape '\\'
           or coalesce(events.location_name, '') ilike $1 escape '\\'
         ))
           and ($2::text is null or events.status = $2)
           and (
             $3::timestamptz is null
             or (events.created_at, events.id) < ($3, $4::uuid)
           )
         order by events.created_at desc, events.id desc
         limit $5`,
        [
          input.search ? `%${escapeLike(input.search.toLowerCase())}%` : null,
          input.status,
          input.cursor?.occurredAt ?? null,
          input.cursor?.id ?? null,
          input.limit
        ]
      );
      return result.rows.map(mapEventSummary);
    });
  }

  getEvent(eventId: string): Promise<AdminEventDetail | null> {
    return this.read(async (connection) => {
      const eventResult = await connection.query<EventDetailRow>(
        `${EVENT_SUMMARY_SELECT}
         where events.id = $1`,
        [eventId]
      );
      const event = eventResult.rows[0];
      if (!event) {
        return null;
      }

      const [
        content,
        products,
        rules,
        offers,
        scenarioVersionsResult,
        scenarioNodes,
        scenarioEdges
      ] = await Promise.all([
        connection.query<ContentBlockRow>(
          `select id, block_type, title, content_schema_version, content,
                  sort_order, is_visible
           from public.event_content_blocks
           where event_id = $1
           order by sort_order, id`,
          [eventId]
        ),
        connection.query<ProductRow>(
          `select products.id, products.code, products.product_type,
                  products.title, products.description, products.currency,
                  products.bundle_composition,
                  products.inventory_units_per_item, products.capacity,
                  products.maximum_quantity_per_order, products.is_active,
                  products.sort_order,
                  coalesce(reservations.reserved_units, 0)::text
                    as reserved_inventory_units,
                  coalesce(reservations.consumed_units, 0)::text
                    as consumed_inventory_units
           from public.ticket_products products
           left join lateral (
             select
               coalesce(sum(reservation.inventory_units) filter (
                 where reservation.status = 'active'
                   and reservation.expires_at > now()
               ), 0) as reserved_units,
               coalesce(sum(reservation.inventory_units) filter (
                 where reservation.status = 'consumed'
               ), 0) as consumed_units
             from public.inventory_reservations reservation
             where reservation.product_id = products.id
           ) reservations on true
           where products.event_id = $1
           order by products.sort_order, products.id`,
          [eventId]
        ),
        connection.query<PricingRuleRow>(
          `select rules.id, rules.product_id, rules.currency,
                  rules.minimum_quantity, rules.maximum_quantity,
                  rules.unit_price_kopecks::text, rules.priority,
                  rules.specificity, rules.valid_from, rules.valid_until,
                  rules.conditions, rules.explanation, rules.is_active
           from public.pricing_rules rules
           join public.ticket_products products on products.id = rules.product_id
           where products.event_id = $1
           order by products.sort_order, rules.priority desc,
                    rules.specificity desc, rules.valid_from desc, rules.id`,
          [eventId]
        ),
        connection.query<OfferVersionRow>(
          `select versions.id,
                  versions.offer_document_id,
                  documents.title as document_title,
                  documents.source_type, documents.source_url,
                  versions.version_number, versions.public_url,
                  versions.storage_path, versions.content_type,
                  versions.sha256, versions.published_at,
                  versions.published_by_admin_id, versions.is_active,
                  versions.source_revision_id,
                  versions.display_text_snapshot,
                  count(acceptances.id)::text as acceptance_count
           from public.offer_versions versions
           join public.offer_documents documents
             on documents.id = versions.offer_document_id
           left join public.offer_acceptances acceptances
             on acceptances.offer_version_id = versions.id
           where documents.event_id = $1
           group by versions.id, documents.id
           order by versions.version_number desc, versions.id desc`,
          [eventId]
        ),
        connection.query<ScenarioVersionRow>(
          `select versions.id, versions.scenario_id,
                  scenarios.title as scenario_title,
                  versions.version_number, versions.status,
                  versions.schema_version, versions.validation_issues,
                  versions.created_by_admin_id,
                  versions.published_by_admin_id,
                  versions.created_at, versions.updated_at,
                  versions.published_at
           from public.scenario_versions versions
           join public.scenarios scenarios
             on scenarios.id = versions.scenario_id
           where scenarios.event_id = $1
           order by versions.version_number desc, versions.id desc`,
          [eventId]
        ),
        connection.query<ScenarioNodeRow>(
          `select nodes.scenario_version_id, nodes.id, nodes.node_type,
                  nodes.schema_version, nodes.payload
           from public.scenario_nodes nodes
           join public.scenario_versions versions
             on versions.id = nodes.scenario_version_id
           join public.scenarios scenarios
             on scenarios.id = versions.scenario_id
           where scenarios.event_id = $1
           order by versions.version_number desc, nodes.sort_order, nodes.id`,
          [eventId]
        ),
        connection.query<ScenarioEdgeRow>(
          `select edges.scenario_version_id, edges.id,
                  edges.from_node_id, edges.to_node_id,
                  edges.label, edges.priority, edges.condition
           from public.scenario_edges edges
           join public.scenario_versions versions
             on versions.id = edges.scenario_version_id
           join public.scenarios scenarios
             on scenarios.id = versions.scenario_id
           where scenarios.event_id = $1
           order by versions.version_number desc, edges.priority desc, edges.id`,
          [eventId]
        )
      ]);

      const rulesByProduct = new Map<string, AdminEventPricingRule[]>();
      for (const rule of rules.rows) {
        const mapped = mapPricingRule(rule);
        const current = rulesByProduct.get(rule.product_id);
        if (current) {
          current.push(mapped);
        } else {
          rulesByProduct.set(rule.product_id, [mapped]);
        }
      }

      const offerVersions = offers.rows.map(mapOfferVersion);
      const offer = offerVersions.find(
        (version) =>
          version.id === event.active_offer_version_id && version.isActive
      );
      const nodesByVersion = new Map<
        string,
        AdminEventScenarioVersion["nodes"][number][]
      >();
      for (const node of scenarioNodes.rows) {
        const mapped = {
          id: node.id,
          type: node.node_type,
          schemaVersion: node.schema_version,
          payload: readJsonObject(node.payload)
        };
        const current = nodesByVersion.get(node.scenario_version_id);
        if (current) {
          current.push(mapped);
        } else {
          nodesByVersion.set(node.scenario_version_id, [mapped]);
        }
      }
      const edgesByVersion = new Map<
        string,
        AdminEventScenarioVersion["edges"][number][]
      >();
      for (const edge of scenarioEdges.rows) {
        const mapped = {
          id: edge.id,
          fromNodeId: edge.from_node_id,
          toNodeId: edge.to_node_id,
          label: edge.label,
          priority: edge.priority,
          condition: readJsonObject(edge.condition)
        };
        const current = edgesByVersion.get(edge.scenario_version_id);
        if (current) {
          current.push(mapped);
        } else {
          edgesByVersion.set(edge.scenario_version_id, [mapped]);
        }
      }
      const scenarioVersions: AdminEventScenarioVersion[] =
        scenarioVersionsResult.rows.map((version) => ({
          id: version.id,
          scenarioId: version.scenario_id,
          scenarioTitle: version.scenario_title,
          versionNumber: version.version_number,
          status: version.status,
          schemaVersion: version.schema_version,
          nodes: nodesByVersion.get(version.id) ?? [],
          edges: edgesByVersion.get(version.id) ?? [],
          validationIssues: readValidationIssues(version.validation_issues),
          createdByAdminId: version.created_by_admin_id,
          publishedByAdminId: version.published_by_admin_id,
          createdAt: toIso(version.created_at),
          updatedAt: toIso(version.updated_at),
          publishedAt: toNullableIso(version.published_at)
        }));
      return {
        ...mapEventSummary(event),
        description: event.description,
        locationAddress: event.location_address,
        supportContact: event.support_contact,
        reservationTtlMinutes: event.reservation_ttl_minutes,
        phoneRequiredForPurchase: event.phone_required_for_purchase,
        offerRequired: event.offer_required,
        publishedScenarioVersionId: event.published_scenario_version_id,
        activeOfferVersionId: event.active_offer_version_id,
        publishedAt: toNullableIso(event.published_at),
        lockVersion: event.lock_version,
        contentBlocks: content.rows.map((row) => ({
          id: row.id,
          blockType: toContentBlockType(row.block_type),
          title: row.title,
          contentSchemaVersion: row.content_schema_version,
          content: readJsonObject(row.content),
          sortOrder: row.sort_order,
          isVisible: row.is_visible
        })),
        products: products.rows.map((row) => ({
          id: row.id,
          code: row.code,
          productType: row.product_type,
          title: row.title,
          description: row.description,
          currency: row.currency,
          bundleComposition: readJsonObjectArray(row.bundle_composition),
          inventoryUnitsPerItem: row.inventory_units_per_item,
          capacity: row.capacity,
          maximumQuantityPerOrder: row.maximum_quantity_per_order,
          isActive: row.is_active,
          sortOrder: row.sort_order,
          reservedInventoryUnits: toCount(row.reserved_inventory_units),
          consumedInventoryUnits: toCount(row.consumed_inventory_units),
          pricingRules: rulesByProduct.get(row.id) ?? []
        })),
        offerVersions,
        scenarioVersions,
        activeOffer: offer
          ? {
              id: offer.id,
              documentTitle: offer.documentTitle,
              versionNumber: offer.versionNumber,
              publicUrl: offer.publicUrl,
              contentType: offer.contentType,
              sha256: offer.sha256,
              publishedAt: offer.publishedAt
            }
          : null
      };
    });
  }

  private async read<TResult>(
    work: (connection: SqlConnection) => Promise<TResult>
  ): Promise<TResult> {
    const connection = await this.pool.connect();
    try {
      await connection.query(
        "begin transaction isolation level repeatable read read only"
      );
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

export function createAdminEventsPersistence(
  pool: SqlConnectionPool
): AdminEventsRepository {
  return new PostgresAdminEventsRepository(pool);
}

function mapEventSummary(row: EventSummaryRow): AdminEventSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    status: row.status,
    timezone: row.timezone,
    startsAt: toIso(row.starts_at),
    endsAt: toNullableIso(row.ends_at),
    salesStartsAt: toNullableIso(row.sales_starts_at),
    salesEndsAt: toNullableIso(row.sales_ends_at),
    locationName: row.location_name,
    capacity: row.capacity,
    productCount: toCount(row.product_count),
    activeProductCount: toCount(row.active_product_count),
    orderCount: toCount(row.order_count),
    paidOrderCount: toCount(row.paid_order_count),
    ticketCount: toCount(row.ticket_count),
    reservedInventoryUnits: toCount(row.reserved_inventory_units),
    consumedInventoryUnits: toCount(row.consumed_inventory_units),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapPricingRule(row: PricingRuleRow): AdminEventPricingRule {
  return {
    id: row.id,
    currency: row.currency,
    minimumQuantity: row.minimum_quantity,
    maximumQuantity: row.maximum_quantity,
    unitPriceKopecks: row.unit_price_kopecks,
    priority: row.priority,
    specificity: row.specificity,
    validFrom: toNullableIso(row.valid_from),
    validUntil: toNullableIso(row.valid_until),
    conditions: readJsonObject(row.conditions),
    explanation: row.explanation,
    isActive: row.is_active
  };
}

function mapOfferVersion(row: OfferVersionRow): AdminEventOfferVersion {
  if (
    row.source_type !== "google_docs"
    && row.source_type !== "upload"
    && row.source_type !== "html"
  ) {
    throw new Error(
      "Administrator event read model contains an invalid offer source type"
    );
  }
  if (
    row.content_type !== "application/pdf"
    && row.content_type !== "text/html"
  ) {
    throw new Error(
      "Administrator event read model contains an invalid offer content type"
    );
  }
  return {
    id: row.id,
    offerDocumentId: row.offer_document_id,
    documentTitle: row.document_title,
    sourceType: row.source_type,
    sourceUrl: row.source_url,
    versionNumber: row.version_number,
    publicUrl: row.public_url,
    storagePath: row.storage_path,
    contentType: row.content_type,
    sha256: row.sha256,
    publishedAt: toIso(row.published_at),
    publishedByAdminId: row.published_by_admin_id,
    isActive: row.is_active,
    sourceRevisionId: row.source_revision_id,
    displayTextSnapshot: row.display_text_snapshot,
    acceptanceCount: toCount(row.acceptance_count)
  };
}

function toContentBlockType(
  value: string
): AdminEventContentBlock["blockType"] {
  const blockType = value as AdminEventContentBlock["blockType"];
  if (!ADMIN_EVENT_CONTENT_BLOCK_TYPES.includes(blockType)) {
    throw new Error(
      "Administrator event read model contains an invalid content block type"
    );
  }
  return blockType;
}

function toIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Administrator event read model contains an invalid timestamp");
  }
  return date.toISOString();
}

function toNullableIso(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}

function toCount(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("Administrator event read model contains an invalid count");
  }
  return parsed;
}

function readJsonObject(value: unknown): Readonly<Record<string, unknown>> {
  const parsed = parseJson(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Administrator event read model contains invalid JSON");
  }
  return parsed as Readonly<Record<string, unknown>>;
}

function readJsonObjectArray(
  value: unknown
): readonly Readonly<Record<string, unknown>>[] {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) {
    throw new Error("Administrator event read model contains invalid JSON");
  }
  return parsed.map(readJsonObject);
}

function readValidationIssues(
  value: unknown
): readonly AdminScenarioValidationIssue[] {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) {
    throw new Error("Administrator scenario issues contain invalid JSON");
  }
  return parsed.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error("Administrator scenario issue is invalid");
    }
    const record = item as Record<string, unknown>;
    if (
      typeof record.code !== "string"
      || typeof record.message !== "string"
      || (record.nodeId !== null && typeof record.nodeId !== "string")
      || (record.edgeId !== null && typeof record.edgeId !== "string")
    ) {
      throw new Error("Administrator scenario issue is invalid");
    }
    return {
      code: record.code,
      message: record.message,
      nodeId: record.nodeId,
      edgeId: record.edgeId
    };
  });
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error("Administrator event read model contains invalid JSON");
  }
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

const EVENT_SUMMARY_SELECT = `
  select events.id, events.slug, events.title, events.description,
         events.status, events.timezone, events.starts_at, events.ends_at,
         events.sales_starts_at, events.sales_ends_at, events.location_name,
         events.location_address, events.support_contact, events.capacity,
         events.reservation_ttl_minutes, events.phone_required_for_purchase,
         events.offer_required, events.published_scenario_version_id,
         events.active_offer_version_id, events.published_at,
         events.lock_version, events.created_at, events.updated_at,
         (
           select count(*)::text
           from public.ticket_products products
           where products.event_id = events.id
         ) as product_count,
         (
           select count(*)::text
           from public.ticket_products products
           where products.event_id = events.id and products.is_active
         ) as active_product_count,
         (
           select count(*)::text
           from public.orders orders
           where orders.event_id = events.id
         ) as order_count,
         (
           select count(*)::text
           from public.orders orders
           where orders.event_id = events.id
             and orders.status in ('paid', 'partially_refunded', 'refunded')
         ) as paid_order_count,
         (
           select count(*)::text
           from public.tickets tickets
           where tickets.event_id = events.id
         ) as ticket_count,
         (
           select coalesce(sum(reservation.inventory_units), 0)::text
           from public.inventory_reservations reservation
           where reservation.event_id = events.id
             and reservation.status = 'active'
             and reservation.expires_at > now()
         ) as reserved_inventory_units,
         (
           select coalesce(sum(reservation.inventory_units), 0)::text
           from public.inventory_reservations reservation
           where reservation.event_id = events.id
             and reservation.status = 'consumed'
         ) as consumed_inventory_units
  from public.events events`;
