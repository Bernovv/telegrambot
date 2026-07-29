import type {
  AdminEventAuditContext,
  AdminEventScenarioManagementRepository
} from "@ticket-platform/application";
import type {
  ScenarioEdge,
  ScenarioGraph,
  ScenarioNode,
  ScenarioNodeType
} from "@ticket-platform/scenario-engine";
import type { SqlConnection, SqlConnectionPool } from "./postgres.js";

interface EventGateRow {
  readonly id: string;
  readonly status: string;
  readonly lock_version: number;
}

interface ScenarioRow {
  readonly id: string;
  readonly title: string;
}

interface VersionRow {
  readonly id: string;
  readonly scenario_id: string;
  readonly status: string;
  readonly schema_version: number;
}

interface NodeRow {
  readonly id: string;
  readonly node_type: string;
  readonly schema_version: number;
  readonly payload: unknown;
}

interface EdgeRow {
  readonly id: string;
  readonly from_node_id: string;
  readonly to_node_id: string;
  readonly label: string | null;
  readonly priority: number;
  readonly condition: unknown;
}

type EventGate =
  | { readonly status: "ready" }
  | {
      readonly status:
        | "event_not_found"
        | "not_draft"
        | "version_conflict";
    };

export class PostgresAdminEventScenarioManagementRepository
implements AdminEventScenarioManagementRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  findUnavailableUserClassificationCodes(input: {
    readonly statusCodes: readonly string[];
    readonly categoryCodes: readonly string[];
  }): Promise<{
    readonly statusCodes: readonly string[];
    readonly categoryCodes: readonly string[];
  }> {
    return this.read(async (connection) => {
      const statuses = input.statusCodes.length === 0
        ? { rows: [] as readonly { readonly code: string }[] }
        : await connection.query<{ readonly code: string }>(
            `select code
             from public.user_statuses
             where code = any($1::text[]) and is_active = true`,
            [input.statusCodes]
          );
      const categories = input.categoryCodes.length === 0
        ? { rows: [] as readonly { readonly code: string }[] }
        : await connection.query<{ readonly code: string }>(
            `select code
             from public.user_categories
             where code = any($1::text[]) and is_active = true`,
            [input.categoryCodes]
          );
      const availableStatuses = new Set(statuses.rows.map((row) => row.code));
      const availableCategories =
        new Set(categories.rows.map((row) => row.code));
      return {
        statusCodes: input.statusCodes.filter(
          (code) => !availableStatuses.has(code)
        ),
        categoryCodes: input.categoryCodes.filter(
          (code) => !availableCategories.has(code)
        )
      };
    });
  }

  saveDraft(
    input: Parameters<
      AdminEventScenarioManagementRepository["saveDraft"]
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

      const scenarioResult = await connection.query<ScenarioRow>(
        `select id, title
         from public.scenarios
         where event_id = $1
         for update`,
        [input.eventId]
      );
      const existingScenario = scenarioResult.rows[0];
      const scenarioId = existingScenario?.id ?? input.proposedScenarioId;
      if (existingScenario) {
        await connection.query(
          `update public.scenarios
           set title = $2, updated_at = $3
           where id = $1`,
          [scenarioId, input.title, input.audit.occurredAt]
        );
      } else {
        await connection.query(
          `insert into public.scenarios (
             id, event_id, title, created_at, updated_at
           ) values ($1, $2, $3, $4, $4)`,
          [scenarioId, input.eventId, input.title, input.audit.occurredAt]
        );
      }

      const draftResult = await connection.query<VersionRow>(
        `select id, scenario_id, status, schema_version
         from public.scenario_versions
         where scenario_id = $1 and status = 'draft'
         for update`,
        [scenarioId]
      );
      const existingDraft = draftResult.rows[0];
      const scenarioVersionId = existingDraft?.id ?? input.proposedVersionId;
      const issues = JSON.stringify(input.validationIssues);
      if (existingDraft) {
        await connection.query(
          `update public.scenario_versions
           set schema_version = $2,
               validation_issues = $3::jsonb,
               updated_at = $4
           where id = $1 and status = 'draft'`,
          [
            scenarioVersionId,
            input.graph.schemaVersion,
            issues,
            input.audit.occurredAt
          ]
        );
        await connection.query(
          `delete from public.scenario_edges
           where scenario_version_id = $1`,
          [scenarioVersionId]
        );
        await connection.query(
          `delete from public.scenario_nodes
           where scenario_version_id = $1`,
          [scenarioVersionId]
        );
      } else {
        const versionNumber = await nextVersionNumber(connection, scenarioId);
        await connection.query(
          `insert into public.scenario_versions (
             id, scenario_id, version_number, status, schema_version,
             validation_issues, created_by_admin_id, created_at, updated_at
           ) values (
             $1, $2, $3, 'draft', $4,
             $5::jsonb, $6, $7, $7
           )`,
          [
            scenarioVersionId,
            scenarioId,
            versionNumber,
            input.graph.schemaVersion,
            issues,
            input.audit.actorAdminId,
            input.audit.occurredAt
          ]
        );
      }

      await insertGraph(connection, scenarioVersionId, input.graph);
      const lockVersion = await bumpEventVersion(
        connection,
        input.eventId,
        input.audit.occurredAt
      );
      await appendScenarioAudit(
        connection,
        input.audit,
        existingDraft
          ? "event.scenario_draft_updated"
          : "event.scenario_draft_created",
        scenarioVersionId,
        {
          eventId: input.eventId,
          scenarioId,
          scenarioVersionId,
          nodeCount: input.graph.nodes.length,
          edgeCount: input.graph.edges.length,
          validationIssueCount: input.validationIssues.length,
          eventLockVersion: lockVersion
        }
      );
      return {
        status: "saved" as const,
        scenarioVersionId,
        lockVersion
      };
    });
  }

  loadDraft(
    input: Parameters<
      AdminEventScenarioManagementRepository["loadDraft"]
    >[0]
  ) {
    return this.read(async (connection) => {
      const event = await connection.query<EventGateRow>(
        `select id, status, lock_version
         from public.events
         where id = $1`,
        [input.eventId]
      );
      const row = event.rows[0];
      if (!row) {
        return { status: "event_not_found" as const };
      }
      if (row.status !== "draft") {
        return { status: "not_draft" as const };
      }
      if (row.lock_version !== input.expectedLockVersion) {
        return { status: "version_conflict" as const };
      }
      const version = await findEventVersion(
        connection,
        input.eventId,
        input.scenarioVersionId
      );
      if (!version) {
        return { status: "version_not_found" as const };
      }
      if (version.status !== "draft") {
        return { status: "version_not_draft" as const };
      }
      return {
        status: "ready" as const,
        graph: await readGraph(connection, version)
      };
    });
  }

  publishDraft(
    input: Parameters<
      AdminEventScenarioManagementRepository["publishDraft"]
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
      const version = await findEventVersion(
        connection,
        input.eventId,
        input.scenarioVersionId,
        true
      );
      if (!version) {
        return { status: "version_not_found" as const };
      }
      if (version.status !== "draft") {
        return { status: "version_not_draft" as const };
      }
      await connection.query(
        `update public.scenario_versions
         set status = 'published',
             validation_issues = $2::jsonb,
             published_by_admin_id = $3,
             published_at = $4,
             updated_at = $4
         where id = $1 and status = 'draft'`,
        [
          input.scenarioVersionId,
          JSON.stringify(input.validationIssues),
          input.audit.actorAdminId,
          input.audit.occurredAt
        ]
      );
      const event = await connection.query<{
        readonly lock_version: number;
      }>(
        `update public.events
         set published_scenario_version_id = $2,
             lock_version = lock_version + 1,
             updated_at = $3
         where id = $1
         returning lock_version`,
        [
          input.eventId,
          input.scenarioVersionId,
          input.audit.occurredAt
        ]
      );
      const lockVersion = event.rows[0]?.lock_version;
      if (!lockVersion) {
        throw new Error("Scenario publication lost its locked event");
      }
      await appendScenarioAudit(
        connection,
        input.audit,
        "event.scenario_version_published",
        input.scenarioVersionId,
        {
          eventId: input.eventId,
          scenarioVersionId: input.scenarioVersionId,
          status: "published",
          eventLockVersion: lockVersion
        }
      );
      return { status: "published" as const, lockVersion };
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

export function createAdminEventScenarioManagementPersistence(
  pool: SqlConnectionPool
): AdminEventScenarioManagementRepository {
  return new PostgresAdminEventScenarioManagementRepository(pool);
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
  const result = await connection.query<EventGateRow>(
    `select id, status, lock_version
     from public.events
     where id = $1
     for update`,
    [eventId]
  );
  const event = result.rows[0];
  if (!event) {
    return { status: "event_not_found" };
  }
  if (event.status !== "draft") {
    return { status: "not_draft" };
  }
  if (event.lock_version !== expectedLockVersion) {
    return { status: "version_conflict" };
  }
  return { status: "ready" };
}

async function nextVersionNumber(
  connection: SqlConnection,
  scenarioId: string
): Promise<number> {
  const result = await connection.query<{
    readonly next_version_number: number;
  }>(
    `select coalesce(max(version_number), 0) + 1 as next_version_number
     from public.scenario_versions
     where scenario_id = $1`,
    [scenarioId]
  );
  const value = result.rows[0]?.next_version_number;
  if (!Number.isSafeInteger(value) || !value || value < 1) {
    throw new Error("Scenario version sequence is invalid");
  }
  return value;
}

async function insertGraph(
  connection: SqlConnection,
  scenarioVersionId: string,
  graph: ScenarioGraph
): Promise<void> {
  for (const [sortOrder, node] of graph.nodes.entries()) {
    await connection.query(
      `insert into public.scenario_nodes (
         scenario_version_id, id, node_type, schema_version, payload, sort_order
       ) values ($1, $2, $3, $4, $5::jsonb, $6)`,
      [
        scenarioVersionId,
        node.id,
        node.type,
        node.schemaVersion,
        JSON.stringify(node.payload),
        sortOrder
      ]
    );
  }
  for (const edge of graph.edges) {
    await connection.query(
      `insert into public.scenario_edges (
         scenario_version_id, id, from_node_id, to_node_id,
         label, priority, condition_schema_version, condition
       ) values ($1, $2, $3, $4, $5, $6, 1, $7::jsonb)`,
      [
        scenarioVersionId,
        edge.id,
        edge.fromNodeId,
        edge.toNodeId,
        edge.label,
        edge.priority,
        JSON.stringify(edge.condition)
      ]
    );
  }
}

async function findEventVersion(
  connection: SqlConnection,
  eventId: string,
  scenarioVersionId: string,
  lock = false
): Promise<VersionRow | undefined> {
  const result = await connection.query<VersionRow>(
    `select versions.id, versions.scenario_id, versions.status,
            versions.schema_version
     from public.scenario_versions versions
     join public.scenarios scenarios on scenarios.id = versions.scenario_id
     where scenarios.event_id = $1 and versions.id = $2
     ${lock ? "for update of versions" : ""}`,
    [eventId, scenarioVersionId]
  );
  return result.rows[0];
}

async function readGraph(
  connection: SqlConnection,
  version: VersionRow
): Promise<ScenarioGraph> {
  const [nodes, edges] = await Promise.all([
    connection.query<NodeRow>(
      `select id, node_type, schema_version, payload
       from public.scenario_nodes
       where scenario_version_id = $1
       order by sort_order, id`,
      [version.id]
    ),
    connection.query<EdgeRow>(
      `select id, from_node_id, to_node_id, label, priority, condition
       from public.scenario_edges
       where scenario_version_id = $1
       order by priority desc, id`,
      [version.id]
    )
  ]);
  return {
    schemaVersion: version.schema_version,
    nodes: nodes.rows.map(mapNode),
    edges: edges.rows.map(mapEdge)
  };
}

function mapNode(row: NodeRow): ScenarioNode {
  return {
    id: row.id,
    type: row.node_type as ScenarioNodeType,
    schemaVersion: row.schema_version,
    payload: readJsonObject(row.payload)
  };
}

function mapEdge(row: EdgeRow): ScenarioEdge {
  return {
    id: row.id,
    fromNodeId: row.from_node_id,
    toNodeId: row.to_node_id,
    label: row.label,
    priority: row.priority,
    condition: readJsonObject(row.condition)
  };
}

function readJsonObject(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Readonly<Record<string, unknown>>;
  }
  if (typeof value === "string") {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Readonly<Record<string, unknown>>;
    }
  }
  throw new Error("Scenario JSON object is invalid");
}

async function bumpEventVersion(
  connection: SqlConnection,
  eventId: string,
  occurredAt: Date
): Promise<number> {
  const result = await connection.query<{ readonly lock_version: number }>(
    `update public.events
     set lock_version = lock_version + 1, updated_at = $2
     where id = $1
     returning lock_version`,
    [eventId, occurredAt]
  );
  const value = result.rows[0]?.lock_version;
  if (!value) {
    throw new Error("Scenario draft update lost its locked event");
  }
  return value;
}

async function appendScenarioAudit(
  connection: SqlConnection,
  audit: AdminEventAuditContext,
  action: string,
  scenarioVersionId: string,
  after: Readonly<Record<string, unknown>>
): Promise<void> {
  await connection.query(
    `insert into public.audit_log (
       id, actor_admin_id, actor_role, action, target_type, target_id,
       reason, before_masked, after_masked, request_id,
       ip_address, user_agent, created_at
     ) values (
       $1, $2, $3, $4, 'scenario_version', $5,
       $6, null, $7::jsonb, $8,
       $9, $10, $11
     )`,
    [
      audit.auditId,
      audit.actorAdminId,
      audit.actorRole,
      action,
      scenarioVersionId,
      audit.reason,
      JSON.stringify(after),
      audit.requestId,
      audit.ipAddress,
      audit.userAgent,
      audit.occurredAt
    ]
  );
}
