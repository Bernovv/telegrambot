import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrations as migrationDescriptors } from "../src/migrations.js";
import {
  applyMigrationsToDatabase,
  readMigrationFiles,
  type MigrationFile
} from "./migration-runner.js";

const { Client } = pg;
const databasePrefix = "ticket_platform_migration_";
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const migrationDirectory = join(projectRoot, "supabase", "migrations");

async function main(): Promise<void> {
  const adminUrl = validateAdminUrl();
  const migrations = await readMigrationFiles(migrationDirectory, migrationDescriptors);

  if (migrations.length < 2) {
    throw new Error("Migration upgrade test requires at least two migrations");
  }

  const suffix = String(process.pid);
  const cleanDatabase = `${databasePrefix}clean_${suffix}`;
  const upgradeDatabase = `${databasePrefix}upgrade_${suffix}`;

  await withEphemeralDatabase(adminUrl, cleanDatabase, async (databaseUrl) => {
    await applyMigrationsToDatabase(databaseUrl, migrations);
    await verifyMigrations(databaseUrl, migrations);
  });

  await withEphemeralDatabase(adminUrl, upgradeDatabase, async (databaseUrl) => {
    const previousMigrations = migrations.slice(0, -1);
    await applyMigrationsToDatabase(databaseUrl, previousMigrations);
    await verifyMigrations(databaseUrl, previousMigrations);
    await applyMigrationsToDatabase(databaseUrl, migrations);
    await verifyMigrations(databaseUrl, migrations);
  });

  process.stdout.write(
    `Migration smoke tests passed: fresh ${migrations.length}, upgrade ${migrations.length - 1}->${migrations.length}\n`
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
