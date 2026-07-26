import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import type { MigrationDescriptor } from "../src/migrations.js";

const { Client } = pg;

const CHECKSUM_MIGRATION_VERSION = "20260726200000";
const MIGRATION_LOCK_NAME = "ticket-platform:application-migrations";
const PRODUCTION_CONFIRMATION = "apply-production-migrations";

export interface MigrationFile {
  readonly fileName: string;
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly sql: string;
  readonly checksumSha256: string;
}

export interface AppliedMigration {
  readonly version: string;
  readonly name: string | null;
  readonly checksumSha256: string | null;
}

export interface MigrationPlan {
  readonly pending: readonly MigrationFile[];
  readonly establishesChecksumBaseline: boolean;
}

export type MigrationCommandMode = "local" | "deploy";

export interface MigrationCommandConfig {
  readonly appEnvironment: "local" | "test" | "staging" | "production";
  readonly connectionString: string;
}

export async function readMigrationFiles(
  migrationDirectory: string,
  descriptors: readonly MigrationDescriptor[]
): Promise<readonly MigrationFile[]> {
  const fileNames = (await readdir(migrationDirectory))
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort();
  const expectedFileNames = descriptors.map((descriptor) => `${descriptor.id}.sql`);

  if (JSON.stringify(fileNames) !== JSON.stringify(expectedFileNames)) {
    throw new Error("Migration files do not exactly match the ordered migration manifest");
  }

  const files = await Promise.all(fileNames.map(async (fileName) => {
    const id = fileName.slice(0, -4);
    const separator = id.indexOf("_");

    if (separator !== 14 || !/^\d{14}_[a-z0-9_]+$/.test(id)) {
      throw new Error(`Invalid migration file name: ${fileName}`);
    }

    const sql = await readFile(join(migrationDirectory, fileName), "utf8");
    if (sql.trim().length === 0) {
      throw new Error(`Migration file is empty: ${fileName}`);
    }

    return {
      fileName,
      id,
      version: id.slice(0, separator),
      name: id.slice(separator + 1),
      sql,
      checksumSha256: sha256(sql)
    };
  }));

  assertUniqueVersions(files);
  return files;
}

export function createMigrationPlan(
  files: readonly MigrationFile[],
  applied: readonly AppliedMigration[],
  checksumTableExists: boolean
): MigrationPlan {
  assertUniqueVersions(files);
  const filesByVersion = new Map(files.map((file) => [file.version, file]));

  for (const row of applied) {
    const file = filesByVersion.get(row.version);
    if (!file) {
      throw new Error(`Database contains unknown migration version ${row.version}`);
    }
    if (row.name !== null && row.name !== file.name) {
      throw new Error(`Applied migration name differs for version ${row.version}`);
    }
  }

  const expectedApplied = files.slice(0, applied.length).map((file) => file.version);
  const actualApplied = applied.map((row) => row.version);
  if (JSON.stringify(actualApplied) !== JSON.stringify(expectedApplied)) {
    throw new Error("Applied migrations are not an exact prefix of the local migration sequence");
  }

  if (checksumTableExists) {
    for (const row of applied) {
      const file = filesByVersion.get(row.version);
      if (!row.checksumSha256) {
        throw new Error(`Missing checksum evidence for applied migration ${row.version}`);
      }
      if (file?.checksumSha256 !== row.checksumSha256) {
        throw new Error(`Checksum mismatch for applied migration ${row.version}`);
      }
    }
  } else if (applied.some((row) => row.version === CHECKSUM_MIGRATION_VERSION)) {
    throw new Error("Checksum migration is recorded but its evidence table is missing");
  }

  const pending = files.slice(applied.length);
  return {
    pending,
    establishesChecksumBaseline: !checksumTableExists
      && pending.some((file) => file.version === CHECKSUM_MIGRATION_VERSION)
  };
}

export function validateMigrationCommand(
  mode: MigrationCommandMode,
  env: NodeJS.ProcessEnv
): MigrationCommandConfig {
  const appEnvironment = env.APP_ENV;
  if (
    appEnvironment !== "local"
    && appEnvironment !== "test"
    && appEnvironment !== "staging"
    && appEnvironment !== "production"
  ) {
    throw new Error("APP_ENV must explicitly be local, test, staging, or production");
  }

  if (mode === "local" && appEnvironment !== "local" && appEnvironment !== "test") {
    throw new Error("db:migrate is restricted to local and test environments");
  }
  if (mode === "deploy" && appEnvironment !== "staging" && appEnvironment !== "production") {
    throw new Error("db:migrate:deploy is restricted to staging and production environments");
  }

  if (appEnvironment === "production") {
    if (env.DATABASE_MIGRATION_CONFIRM !== PRODUCTION_CONFIRMATION) {
      throw new Error("Production migrations require the exact confirmation phrase");
    }
    if (env.DATABASE_BACKUP_CONFIRMED !== "true") {
      throw new Error("Production migrations require a confirmed database backup");
    }
    if (env.DATABASE_ROLLBACK_PLAN_CONFIRMED !== "true") {
      throw new Error("Production migrations require a confirmed rollback plan");
    }
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

export async function applyMigrationsToDatabase(
  connectionString: string,
  files: readonly MigrationFile[]
): Promise<readonly MigrationFile[]> {
  const client = new Client({
    connectionString,
    application_name: "ticket-platform-migration-runner"
  });
  let connected = false;
  let locked = false;

  try {
    await client.connect();
    connected = true;

    const lockResult = await client.query<{ readonly locked: boolean }>(
      "select pg_try_advisory_lock(hashtextextended($1, 0)) as locked",
      [MIGRATION_LOCK_NAME]
    );
    locked = lockResult.rows[0]?.locked === true;
    if (!locked) {
      throw new Error("Another application migration runner currently holds the database lock");
    }

    await ensureSupabaseMigrationLedger(client);
    const initialState = await readAppliedMigrations(client);
    const plan = createMigrationPlan(
      files,
      initialState.applied,
      initialState.checksumTableExists
    );

    for (const migration of plan.pending) {
      await applyOneMigration(client, files, migration);
    }

    const finalState = await readAppliedMigrations(client);
    const finalPlan = createMigrationPlan(
      files,
      finalState.applied,
      finalState.checksumTableExists
    );
    if (finalPlan.pending.length > 0) {
      throw new Error("Migration runner finished with unapplied migrations");
    }

    return plan.pending;
  } finally {
    try {
      if (locked) {
        await client.query(
          "select pg_advisory_unlock(hashtextextended($1, 0))",
          [MIGRATION_LOCK_NAME]
        );
      }
    } finally {
      if (connected) {
        await client.end();
      }
    }
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function assertUniqueVersions(files: readonly MigrationFile[]): void {
  const versions = files.map((file) => file.version);
  if (new Set(versions).size !== versions.length) {
    throw new Error("Migration versions must be unique");
  }

  const sorted = [...versions].sort();
  if (JSON.stringify(versions) !== JSON.stringify(sorted)) {
    throw new Error("Migration files must be ordered by version");
  }
}

async function ensureSupabaseMigrationLedger(client: pg.Client): Promise<void> {
  await client.query("create schema if not exists supabase_migrations");
  await client.query(
    `create table if not exists supabase_migrations.schema_migrations (
       version text primary key,
       statements text[] not null default array[]::text[],
       name text
     )`
  );
}

async function readAppliedMigrations(client: pg.Client): Promise<{
  readonly applied: readonly AppliedMigration[];
  readonly checksumTableExists: boolean;
}> {
  const relation = await client.query<{ readonly relation_name: string | null }>(
    "select to_regclass('public.application_migration_checksums')::text as relation_name"
  );
  const checksumTableExists = relation.rows[0]?.relation_name !== null
    && relation.rows[0]?.relation_name !== undefined;

  if (!checksumTableExists) {
    const result = await client.query<{
      readonly version: string;
      readonly name: string | null;
    }>(
      `select version, name
         from supabase_migrations.schema_migrations
        order by version`
    );

    return {
      checksumTableExists,
      applied: result.rows.map((row) => ({ ...row, checksumSha256: null }))
    };
  }

  const result = await client.query<{
    readonly version: string;
    readonly name: string | null;
    readonly checksum_sha256: string | null;
  }>(
    `select migrations.version,
            migrations.name,
            checksums.checksum_sha256
       from supabase_migrations.schema_migrations as migrations
       left join public.application_migration_checksums as checksums
         on checksums.version = migrations.version
      order by migrations.version`
  );

  return {
    checksumTableExists,
    applied: result.rows.map((row) => ({
      version: row.version,
      name: row.name,
      checksumSha256: row.checksum_sha256
    }))
  };
}

async function applyOneMigration(
  client: pg.Client,
  allFiles: readonly MigrationFile[],
  migration: MigrationFile
): Promise<void> {
  await client.query("begin");
  try {
    await client.query(migration.sql);
    await client.query(
      `insert into supabase_migrations.schema_migrations (version, name)
       values ($1, $2)`,
      [migration.version, migration.name]
    );

    if (migration.version === CHECKSUM_MIGRATION_VERSION) {
      const baseline = allFiles.slice(
        0,
        allFiles.findIndex((file) => file.version === migration.version) + 1
      );
      for (const file of baseline) {
        await recordChecksum(client, file);
      }
    } else {
      const relation = await client.query<{ readonly exists: boolean }>(
        `select to_regclass('public.application_migration_checksums') is not null as exists`
      );
      if (relation.rows[0]?.exists === true) {
        await recordChecksum(client, migration);
      }
    }

    await client.query("commit");
  } catch (error: unknown) {
    await client.query("rollback");
    throw error;
  }
}

async function recordChecksum(client: pg.Client, migration: MigrationFile): Promise<void> {
  await client.query(
    `insert into public.application_migration_checksums (
       version,
       name,
       checksum_sha256
     )
     values ($1, $2, $3)`,
    [migration.version, migration.name, migration.checksumSha256]
  );
}
