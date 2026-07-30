import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrations as migrationDescriptors } from "../src/migrations.js";
import {
  applyMigrationsToDatabase,
  readMigrationFiles,
  type MigrationFile
} from "./migration-runner.js";
import { applyDemoSeed } from "./seed.js";

const { Client } = pg;
const databasePrefix = "ticket_platform_migration_";
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const migrationDirectory = join(projectRoot, "supabase", "migrations");

async function main(): Promise<void> {
  const adminUrl = validateAdminUrl();
  const migrations = await readMigrationFiles(migrationDirectory, migrationDescriptors);
  const seedSql = await readFile(join(projectRoot, "supabase", "seed.sql"), "utf8");

  if (migrations.length < 2) {
    throw new Error("Migration upgrade test requires at least two migrations");
  }

  const suffix = String(process.pid);
  const cleanDatabase = `${databasePrefix}clean_${suffix}`;
  const upgradeDatabase = `${databasePrefix}upgrade_${suffix}`;

  await withEphemeralDatabase(adminUrl, cleanDatabase, async (databaseUrl) => {
    await applyMigrationsToDatabase(databaseUrl, migrations);
    await verifyMigrations(databaseUrl, migrations);
    const firstSeed = await applyDemoSeed(databaseUrl, seedSql);
    if (!firstSeed.eventCreated || !firstSeed.userCreated) {
      throw new Error("Fresh migration database did not create the complete local demo seed");
    }
    const repeatedSeed = await applyDemoSeed(databaseUrl, seedSql);
    if (repeatedSeed.eventCreated || repeatedSeed.userCreated) {
      throw new Error("Repeated local demo seed was not an idempotent no-op");
    }
  });

  await withEphemeralDatabase(adminUrl, upgradeDatabase, async (databaseUrl) => {
    const previousMigrations = migrations.slice(0, -1);
    await applyMigrationsToDatabase(databaseUrl, previousMigrations);
    await verifyMigrations(databaseUrl, previousMigrations);
    await applyMigrationsToDatabase(databaseUrl, migrations);
    await verifyMigrations(databaseUrl, migrations);
  });

  process.stdout.write(
    `Migration smoke tests passed: fresh ${migrations.length} with idempotent demo seed, `
      + `upgrade ${migrations.length - 1}->${migrations.length}\n`
  );
}

function validateAdminUrl(): URL {
  if (process.env.APP_ENV !== "test") {
    throw new Error("Migration tests require APP_ENV=test");
  }
  if (process.env.MIGRATION_TEST_ALLOW_EPHEMERAL_DATABASES !== "true") {
    throw new Error("Migration tests require explicit ephemeral database confirmation");
  }

  const rawUrl = process.env.MIGRATION_TEST_DATABASE_URL;
  if (!rawUrl) {
    throw new Error("Missing MIGRATION_TEST_DATABASE_URL");
  }

  const url = new URL(rawUrl);
  const allowedHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));

  if (
    (url.protocol !== "postgres:" && url.protocol !== "postgresql:")
    || !allowedHosts.has(url.hostname)
    || databaseName !== "postgres"
  ) {
    throw new Error("Migration tests are restricted to a loopback PostgreSQL postgres database");
  }

  return url;
}

async function withEphemeralDatabase(
  adminUrl: URL,
  databaseName: string,
  work: (databaseUrl: string) => Promise<void>
): Promise<void> {
  assertEphemeralDatabaseName(databaseName);
  const admin = new Client({ connectionString: adminUrl.toString() });

  await admin.connect();
  try {
    await dropDatabase(admin, databaseName);
    await admin.query(`create database ${quoteIdentifier(databaseName)}`);

    const databaseUrl = new URL(adminUrl);
    databaseUrl.pathname = `/${databaseName}`;
    await work(databaseUrl.toString());
  } finally {
    try {
      await dropDatabase(admin, databaseName);
    } finally {
      await admin.end();
    }
  }
}

async function dropDatabase(client: pg.Client, databaseName: string): Promise<void> {
  assertEphemeralDatabaseName(databaseName);
  await client.query(
    `select pg_terminate_backend(pid)
       from pg_stat_activity
      where datname = $1
        and pid <> pg_backend_pid()`,
    [databaseName]
  );
  await client.query(`drop database if exists ${quoteIdentifier(databaseName)}`);
}

async function verifyMigrations(
  databaseUrl: string,
  expectedMigrations: readonly MigrationFile[]
): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });

  await client.connect();
  try {
    const versions = await client.query<{ readonly version: string }>(
      `select version
         from supabase_migrations.schema_migrations
        order by version`
    );
    const expectedVersions = expectedMigrations.map((migration) => migration.version);

    if (JSON.stringify(versions.rows.map((row) => row.version)) !== JSON.stringify(expectedVersions)) {
      throw new Error("Applied migration versions do not match the expected sequence");
    }

    const schema = await client.query<{
      readonly users: string | null;
      readonly outbox_events: string | null;
      readonly admin_accounts: string | null;
      readonly events: string | null;
      readonly orders: string | null;
      readonly offer_acceptances: string | null;
      readonly payment_attempts: string | null;
      readonly manual_payments: string | null;
      readonly notification_deliveries: string | null;
      readonly scenarios: string | null;
      readonly scenario_versions: string | null;
      readonly scenario_sessions: string | null;
      readonly scenario_events: string | null;
      readonly broadcasts: string | null;
      readonly broadcast_deliveries: string | null;
      readonly broadcast_delivery_rate_gate: string | null;
      readonly broadcast_cancelled_at: boolean;
      readonly broadcast_test_deliveries: string | null;
      readonly broadcast_personalization_v2: boolean;
      readonly broadcast_media_v3: boolean;
      readonly user_import_batches: string | null;
      readonly user_import_match_analyses: string | null;
      readonly user_import_row_decisions: string | null;
      readonly pgboss_version: string | null;
    }>(
      `select
         to_regclass('public.users')::text as users,
         to_regclass('public.outbox_events')::text as outbox_events,
         to_regclass('public.admin_accounts')::text as admin_accounts,
         to_regclass('public.events')::text as events,
         to_regclass('public.orders')::text as orders,
         to_regclass('public.offer_acceptances')::text as offer_acceptances,
         to_regclass('public.payment_attempts')::text as payment_attempts,
         to_regclass('public.manual_payments')::text as manual_payments,
         to_regclass('public.notification_deliveries')::text as notification_deliveries,
         to_regclass('public.scenarios')::text as scenarios,
         to_regclass('public.scenario_versions')::text as scenario_versions,
         to_regclass('public.scenario_sessions')::text as scenario_sessions,
         to_regclass('public.scenario_events')::text as scenario_events,
         to_regclass('public.broadcasts')::text as broadcasts,
         to_regclass('public.broadcast_deliveries')::text as broadcast_deliveries,
         to_regclass('public.broadcast_delivery_rate_gate')::text
           as broadcast_delivery_rate_gate,
         exists (
           select 1 from information_schema.columns
           where table_schema = 'public'
             and table_name = 'broadcasts'
             and column_name = 'cancelled_at'
         ) as broadcast_cancelled_at,
         to_regclass('public.broadcast_test_deliveries')::text
           as broadcast_test_deliveries,
         (
           exists (
             select 1 from information_schema.columns
             where table_schema = 'public'
               and table_name = 'broadcast_deliveries'
               and column_name = 'personalization_context'
           )
           and exists (
             select 1 from information_schema.columns
             where table_schema = 'public'
               and table_name = 'broadcast_test_deliveries'
               and column_name = 'schema_version'
           )
         ) as broadcast_personalization_v2,
         (
           exists (
             select 1
             from pg_constraint
             where conname = 'broadcast_versions_schema_check'
               and position('3' in pg_get_constraintdef(oid)) > 0
           )
           and exists (
             select 1
             from pg_constraint
             where conname = 'broadcast_test_deliveries_schema_check'
               and position('3' in pg_get_constraintdef(oid)) > 0
           )
         ) as broadcast_media_v3,
         to_regclass('public.user_import_batches')::text
           as user_import_batches,
         to_regclass('public.user_import_match_analyses')::text
           as user_import_match_analyses,
         to_regclass('public.user_import_row_decisions')::text
           as user_import_row_decisions,
         to_regclass('pgboss.version')::text as pgboss_version`
    );
    const row = schema.rows[0];

    if (!row?.users || !row.outbox_events || !row.pgboss_version) {
      throw new Error("Foundation schema verification failed");
    }

    const includesAdminRbac = expectedVersions.includes("20260723223000");
    if (includesAdminRbac !== Boolean(row.admin_accounts)) {
      throw new Error("Admin RBAC schema presence does not match the migration sequence");
    }

    const includesEventSales = expectedVersions.includes("20260724120000");
    if (
      includesEventSales
      !== Boolean(row.events && row.orders && row.offer_acceptances)
    ) {
      throw new Error("Event sales schema presence does not match the migration sequence");
    }

    const includesPaymentConfirmation = expectedVersions.includes("20260724170000");
    if (
      includesPaymentConfirmation
      !== Boolean(row.payment_attempts && row.manual_payments)
    ) {
      throw new Error("Payment confirmation schema presence does not match the migration sequence");
    }

    const includesNotificationDelivery = expectedVersions.includes("20260724190000");
    if (includesNotificationDelivery !== Boolean(row.notification_deliveries)) {
      throw new Error("Notification delivery schema presence does not match the migration sequence");
    }

    const includesScenarios = expectedVersions.includes("20260726120000");
    if (includesScenarios !== Boolean(row.scenarios && row.scenario_versions)) {
      throw new Error("Scenario schema presence does not match the migration sequence");
    }

    const includesScenarioRuntime = expectedVersions.includes("20260726160000");
    if (
      includesScenarioRuntime
      !== Boolean(row.scenario_sessions && row.scenario_events)
    ) {
      throw new Error("Scenario runtime schema presence does not match the migration sequence");
    }

    const includesBroadcasts = expectedVersions.includes("20260729200000");
    if (includesBroadcasts !== Boolean(row.broadcasts)) {
      throw new Error("Broadcast version schema presence does not match the migration sequence");
    }

    const includesBroadcastDelivery = expectedVersions.includes("20260730120000");
    if (includesBroadcastDelivery !== Boolean(row.broadcast_deliveries)) {
      throw new Error("Broadcast delivery schema presence does not match the migration sequence");
    }

    const includesBroadcastExecution = expectedVersions.includes("20260730160000");
    if (
      includesBroadcastExecution
      !== Boolean(row.broadcast_delivery_rate_gate)
    ) {
      throw new Error("Broadcast execution schema presence does not match the migration sequence");
    }

    const includesBroadcastControl = expectedVersions.includes("20260730200000");
    if (includesBroadcastControl !== row.broadcast_cancelled_at) {
      throw new Error("Broadcast control schema presence does not match the migration sequence");
    }

    const includesBroadcastTests = expectedVersions.includes("20260730220000");
    if (
      includesBroadcastTests
      !== Boolean(row.broadcast_test_deliveries)
    ) {
      throw new Error("Broadcast test delivery schema presence does not match the migration sequence");
    }

    const includesBroadcastPersonalization =
      expectedVersions.includes("20260731000000");
    if (
      includesBroadcastPersonalization
      !== row.broadcast_personalization_v2
    ) {
      throw new Error("Broadcast personalization schema presence does not match the migration sequence");
    }

    const includesBroadcastMedia =
      expectedVersions.includes("20260731040000");
    if (includesBroadcastMedia !== row.broadcast_media_v3) {
      throw new Error("Broadcast media schema presence does not match the migration sequence");
    }

    const includesUserImportStaging =
      expectedVersions.includes("20260731100000");
    if (
      includesUserImportStaging
      !== Boolean(row.user_import_batches)
    ) {
      throw new Error("User import staging schema presence does not match the migration sequence");
    }

    const includesUserImportMatching =
      expectedVersions.includes("20260731160000");
    if (
      includesUserImportMatching
      !== Boolean(row.user_import_match_analyses)
    ) {
      throw new Error("User import matching schema presence does not match the migration sequence");
    }

    const includesUserImportDecisions =
      expectedVersions.includes("20260731200000");
    if (
      includesUserImportDecisions
      !== Boolean(row.user_import_row_decisions)
    ) {
      throw new Error("User import decision schema presence does not match the migration sequence");
    }
  } finally {
    await client.end();
  }
}

function assertEphemeralDatabaseName(databaseName: string): void {
  if (!/^ticket_platform_migration_(clean|upgrade)_\d+$/.test(databaseName)) {
    throw new Error("Refusing to manage a database outside the migration-test namespace");
  }
}

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(identifier)) {
    throw new Error("Unsafe PostgreSQL identifier");
  }

  return `"${identifier}"`;
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `Migration smoke tests failed: ${error instanceof Error ? error.message : "Unknown error"}\n`
  );
  process.exitCode = 1;
});
