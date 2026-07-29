import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  validateScenarioGraph,
  type ScenarioEdge,
  type ScenarioGraph,
  type ScenarioNode,
  type ScenarioNodeType
} from "@ticket-platform/scenario-engine";

const { Client } = pg;

const DEMO_EVENT_ID = "019d0000-0000-7000-8000-000000000100";
const DEMO_USER_ID = "019d0000-0000-7000-8000-000000000200";
const DEMO_SCENARIO_VERSION_ID = "019d0000-0000-7000-8000-000000000141";
const SEED_CONFIRMATION = "seed-local-demo-data";
const SEED_LOCK_NAME = "ticket-platform:local-demo-seed";
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const seedFile = join(projectRoot, "supabase", "seed.sql");

interface SeedVerificationRow {
  readonly campaign_exists: boolean;
  readonly user_exists: boolean;
  readonly event_exists: boolean;
  readonly product_count: number;
  readonly pricing_rule_count: number;
  readonly offer_document_count: number;
  readonly scenario_version_count: number;
}

interface ScenarioNodeRow {
  readonly id: string;
  readonly node_type: string;
  readonly schema_version: number;
  readonly payload: unknown;
}

interface ScenarioEdgeRow {
  readonly id: string;
  readonly from_node_id: string;
  readonly to_node_id: string;
  readonly label: string | null;
  readonly priority: number;
  readonly condition: unknown;
}

export interface DemoSeedConfig {
  readonly appEnvironment: "local" | "test";
  readonly connectionString: string;
}

export interface DemoSeedResult {
  readonly eventCreated: boolean;
  readonly userCreated: boolean;
}

export function validateDemoSeedEnvironment(
  env: NodeJS.ProcessEnv
): DemoSeedConfig {
  const appEnvironment = env.APP_ENV;
  if (appEnvironment !== "local" && appEnvironment !== "test") {
    throw new Error("Demo seed is restricted to local and test environments");
  }
  if (env.DATABASE_SEED_CONFIRM !== SEED_CONFIRMATION) {
    throw new Error("Demo seed requires the exact confirmation phrase");
  }

  const connectionString = env.DATABASE_DIRECT_URL;
  if (!connectionString) {
    throw new Error("Missing DATABASE_DIRECT_URL");
  }

  let databaseUrl: URL;
  try {
    databaseUrl = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_DIRECT_URL must be a valid PostgreSQL URL");
  }
  if (databaseUrl.protocol !== "postgres:" && databaseUrl.protocol !== "postgresql:") {
    throw new Error("DATABASE_DIRECT_URL must use the PostgreSQL protocol");
  }

  return { appEnvironment, connectionString };
}

export function assertSafeDemoSeedSource(sql: string): void {
  const source = stripSqlComments(sql);
  const forbidden = [
    /\bupdate\b/i,
    /\bdelete\s+from\b/i,
    /\btruncate\b/i,
    /\bdrop\s+(?:table|schema|column)\b/i,
    /\balter\s+table\b/i
  ];

  for (const pattern of forbidden) {
    if (pattern.test(source)) {
      throw new Error(`Demo seed contains a forbidden statement: ${pattern.source}`);
    }
  }
}

export async function applyDemoSeed(
  connectionString: string,
  sql: string
): Promise<DemoSeedResult> {
  assertSafeDemoSeedSource(sql);
  const client = new Client({
    connectionString,
    application_name: "ticket-platform-local-demo-seed"
  });
  let connected = false;
  let locked = false;

  try {
    await client.connect();
    connected = true;

    const lock = await client.query<{ readonly locked: boolean }>(
      "select pg_try_advisory_lock(hashtextextended($1, 0)) as locked",
      [SEED_LOCK_NAME]
    );
    locked = lock.rows[0]?.locked === true;
    if (!locked) {
      throw new Error("Another local demo seed process currently holds the database lock");
    }

    await client.query("begin");
    try {
      await client.query(sql);
      const creation = await client.query<{
        readonly event_created: boolean;
        readonly user_created: boolean;
      }>(
        `select
           exists(select 1 from local_seed_new_events) as event_created,
           exists(select 1 from local_seed_new_users) as user_created`
      );
      await verifySeedDataset(client);
      await verifySeedScenario(client);
      await client.query("commit");

      return {
        eventCreated: creation.rows[0]?.event_created === true,
        userCreated: creation.rows[0]?.user_created === true
      };
    } catch (error: unknown) {
      await client.query("rollback");
      throw error;
    }
  } finally {
    try {
      if (locked) {
        await client.query(
          "select pg_advisory_unlock(hashtextextended($1, 0))",
          [SEED_LOCK_NAME]
        );
      }
    } finally {
      if (connected) {
        await client.end();
      }
    }
  }
}

async function main(): Promise<void> {
  const config = validateDemoSeedEnvironment(process.env);
  const sql = await readFile(seedFile, "utf8");
  const result = await applyDemoSeed(config.connectionString, sql);

  if (!result.eventCreated && !result.userCreated) {
    process.stdout.write("Local demo data already exists and passed verification.\n");
    return;
  }

  process.stdout.write(
    `Local demo seed applied: event=${result.eventCreated ? "created" : "existing"}, `
      + `user=${result.userCreated ? "created" : "existing"}.\n`
  );
}

async function verifySeedDataset(client: pg.Client): Promise<void> {
  const result = await client.query<SeedVerificationRow>(
    `select
       exists(
         select 1 from public.wallet_credit_campaigns
          where code = 'phone-bonus-default'
            and amount_kopecks = 10000
            and currency = 'RUB'
       ) as campaign_exists,
       exists(
         select 1 from public.users
          where id = $1
            and metadata @> '{"synthetic":true,"seed":"local-demo-v1"}'::jsonb
       ) as user_exists,
       exists(
         select 1 from public.events
          where id = $2
            and slug = 'business-picnic-demo'
            and status = 'draft'
       ) as event_exists,
       (
         select count(*)::integer from public.ticket_products
          where event_id = $2
       ) as product_count,
       (
         select count(*)::integer
           from public.pricing_rules rules
           join public.ticket_products products on products.id = rules.product_id
          where products.event_id = $2
       ) as pricing_rule_count,
       (
         select count(*)::integer from public.offer_documents
          where event_id = $2 and status = 'draft'
       ) as offer_document_count,
       (
         select count(*)::integer
           from public.scenario_versions versions
           join public.scenarios scenarios on scenarios.id = versions.scenario_id
          where scenarios.event_id = $2
            and versions.id = $3
            and versions.status = 'draft'
       ) as scenario_version_count`,
    [DEMO_USER_ID, DEMO_EVENT_ID, DEMO_SCENARIO_VERSION_ID]
  );
  const row = result.rows[0];
  if (
    !row?.campaign_exists
    || !row.user_exists
    || !row.event_exists
    || row.product_count !== 3
    || row.pricing_rule_count !== 9
    || row.offer_document_count !== 1
    || row.scenario_version_count !== 1
  ) {
    throw new Error("Existing local demo data is missing or differs from seed version local-demo-v1");
  }
}

async function verifySeedScenario(client: pg.Client): Promise<void> {
  const [nodes, edges] = await Promise.all([
    client.query<ScenarioNodeRow>(
      `select id, node_type, schema_version, payload
         from public.scenario_nodes
        where scenario_version_id = $1
        order by sort_order`,
      [DEMO_SCENARIO_VERSION_ID]
    ),
    client.query<ScenarioEdgeRow>(
      `select id, from_node_id, to_node_id, label, priority, condition
         from public.scenario_edges
        where scenario_version_id = $1
        order by id`,
      [DEMO_SCENARIO_VERSION_ID]
    )
  ]);
  const graph: ScenarioGraph = {
    schemaVersion: 1,
    nodes: nodes.rows.map(mapScenarioNode),
    edges: edges.rows.map(mapScenarioEdge)
  };
  const validation = validateScenarioGraph(graph);
  if (!validation.valid) {
    throw new Error(
      `Local demo scenario is invalid: ${validation.issues.map((issue) => issue.code).join(",")}`
    );
  }
}

function mapScenarioNode(row: ScenarioNodeRow): ScenarioNode {
  return {
    id: row.id,
    type: row.node_type as ScenarioNodeType,
    schemaVersion: row.schema_version,
    payload: readJsonObject(row.payload)
  };
}

function mapScenarioEdge(row: ScenarioEdgeRow): ScenarioEdge {
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
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Local demo scenario JSON must be an object");
  }

  return value as Readonly<Record<string, unknown>>;
}

function stripSqlComments(sql: string): string {
  return sql
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((error: unknown) => {
    process.stderr.write(
      `Local demo seed failed: ${error instanceof Error ? error.message : "Unknown error"}\n`
    );
    process.exitCode = 1;
  });
}
