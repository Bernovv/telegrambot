import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;
const databasePrefix = "ticket_platform_migration_";
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const migrationDirectory = join(projectRoot, "supabase", "migrations");

interface MigrationFile {
  readonly fileName: string;
  readonly version: string;
  readonly name: string;
  readonly sql: string;
}

async function main(): Promise<void> {
  const adminUrl = validateAdminUrl();
  const migrations = await readMigrations();

  if (migrations.length < 2) {
    throw new Error("Migration upgrade test requires at least two migrations");
  }

  const suffix = String(process.pid);
  const cleanDatabase = `${databasePrefix}clean_${suffix}`;
  const upgradeDatabase = `${databasePrefix}upgrade_${suffix}`;

  await withEphemeralDatabase(adminUrl, cleanDatabase, async (databaseUrl) => {
    await applyMigrations(databaseUrl, migrations);
    await verifyMigrations(databaseUrl, migrations);
  });

  await withEphemeralDatabase(adminUrl, upgradeDatabase, async (databaseUrl) => {
    const previousMigrations = migrations.slice(0, -1);
    await applyMigrations(databaseUrl, previousMigrations);
    await verifyMigrations(databaseUrl, previousMigrations);
    await applyMigrations(databaseUrl, migrations.slice(-1));
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

async function readMigrations(): Promise<readonly MigrationFile[]> {
  const fileNames = (await readdir(migrationDirectory))
    .filter((fileName) => /^\d{14}_[a-z0-9_]+\.sql$/.test(fileName))
    .sort();

  return Promise.all(fileNames.map(async (fileName) => {
    const migrationName = fileName.slice(0, -4);
    const separator = migrationName.indexOf("_");

    return {
      fileName,
      version: migrationName.slice(0, separator),
      name: migrationName.slice(separator + 1),
      sql: await readFile(join(migrationDirectory, fileName), "utf8")
    };
  }));
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

async function applyMigrations(
  databaseUrl: string,
  migrations: readonly MigrationFile[]
): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });

  await client.connect();
  try {
    await client.query("create schema if not exists supabase_migrations");
    await client.query(
      `create table if not exists supabase_migrations.schema_migrations (
         version text primary key,
         statements text[] not null default array[]::text[],
         name text
       )`
    );

    for (const migration of migrations) {
      const applied = await client.query<{ readonly exists: boolean }>(
        `select exists(
           select 1
             from supabase_migrations.schema_migrations
            where version = $1
         ) as exists`,
        [migration.version]
      );

      if (applied.rows[0]?.exists === true) {
        continue;
      }

      await client.query(migration.sql);
      await client.query(
        `insert into supabase_migrations.schema_migrations (version, name)
         values ($1, $2)`,
        [migration.version, migration.name]
      );
    }
  } finally {
    await client.end();
  }
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
