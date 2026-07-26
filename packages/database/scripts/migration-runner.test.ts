import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  migrations,
  type MigrationDescriptor
} from "../src/migrations.js";
import {
  createMigrationPlan,
  readMigrationFiles,
  validateMigrationCommand,
  type AppliedMigration,
  type MigrationFile
} from "./migration-runner.js";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const migrationDirectory = join(projectRoot, "supabase", "migrations");
const firstMigration = migration("20260726160000_scenario_runtime", "first");
const checksumMigration = migration(
  "20260726200000_application_migration_checksums",
  "second"
);
const laterMigration = migration("20260726210000_after_checksums", "third");
const files: readonly MigrationFile[] = [
  firstMigration,
  checksumMigration,
  laterMigration
];

test("repository migration files exactly match the ordered manifest", async () => {
  const repositoryFiles = await readMigrationFiles(migrationDirectory, migrations);

  assert.equal(repositoryFiles.length, migrations.length);
  assert.deepEqual(
    repositoryFiles.map((file) => file.id),
    migrations.map((descriptor) => descriptor.id)
  );
});

test("fresh database receives every migration and establishes checksum baseline", () => {
  const plan = createMigrationPlan(files, [], false);

  assert.deepEqual(plan.pending, files);
  assert.equal(plan.establishesChecksumBaseline, true);
});

test("current database has no pending migrations", () => {
  const applied = files.map(appliedMigration);
  const plan = createMigrationPlan(files, applied, true);

  assert.deepEqual(plan.pending, []);
  assert.equal(plan.establishesChecksumBaseline, false);
});

test("rejects unknown and out-of-order applied migrations", () => {
  assert.throws(
    () => createMigrationPlan(files, [{
      version: "20260725000000",
      name: "unknown",
      checksumSha256: null
    }], false),
    /unknown migration version/
  );
  assert.throws(
    () => createMigrationPlan(files, [appliedMigration(checksumMigration)], false),
    /exact prefix/
  );
});

test("rejects missing and changed checksum evidence", () => {
  assert.throws(
    () => createMigrationPlan(files, [{
      ...appliedMigration(firstMigration),
      checksumSha256: null
    }], true),
    /Missing checksum evidence/
  );
  assert.throws(
    () => createMigrationPlan(files, [{
      ...appliedMigration(firstMigration),
      checksumSha256: "f".repeat(64)
    }], true),
    /Checksum mismatch/
  );
});

test("rejects a recorded checksum migration when its table is absent", () => {
  assert.throws(
    () => createMigrationPlan(files, files.slice(0, 2).map(appliedMigration), false),
    /evidence table is missing/
  );
});

test("local command rejects staging and production", () => {
  assert.throws(
    () => validateMigrationCommand("local", environment("staging")),
    /restricted to local and test/
  );
  assert.throws(
    () => validateMigrationCommand("local", environment("production")),
    /restricted to local and test/
  );
});

test("deploy command requires production confirmations", () => {
  const production = environment("production");
  assert.throws(
    () => validateMigrationCommand("deploy", production),
    /exact confirmation phrase/
  );

  const config = validateMigrationCommand("deploy", {
    ...production,
    DATABASE_MIGRATION_CONFIRM: "apply-production-migrations",
    DATABASE_BACKUP_CONFIRMED: "true",
    DATABASE_ROLLBACK_PLAN_CONFIRMED: "true"
  });
  assert.equal(config.appEnvironment, "production");
  assert.equal(config.connectionString, production.DATABASE_DIRECT_URL);
});

test("staging deploy does not need production confirmations", () => {
  const config = validateMigrationCommand("deploy", environment("staging"));

  assert.equal(config.appEnvironment, "staging");
});

test("invalid database URL does not expose its value", () => {
  const secretValue = "not a url with secret-password";

  assert.throws(
    () => validateMigrationCommand("local", {
      APP_ENV: "local",
      DATABASE_DIRECT_URL: secretValue
    }),
    (error: unknown) => error instanceof Error
      && error.message === "DATABASE_DIRECT_URL must be a valid PostgreSQL URL"
      && !error.message.includes(secretValue)
  );
});

function migration(id: string, sql: string): MigrationFile {
  const descriptor: MigrationDescriptor = {
    id,
    description: id,
    destructive: false
  };
  const separator = descriptor.id.indexOf("_");

  return {
    fileName: `${descriptor.id}.sql`,
    id: descriptor.id,
    version: descriptor.id.slice(0, separator),
    name: descriptor.id.slice(separator + 1),
    sql,
    checksumSha256: sql.padEnd(64, "0").slice(0, 64)
  };
}

function appliedMigration(file: MigrationFile): AppliedMigration {
  return {
    version: file.version,
    name: file.name,
    checksumSha256: file.checksumSha256
  };
}

function environment(appEnvironment: string): NodeJS.ProcessEnv {
  return {
    APP_ENV: appEnvironment,
    DATABASE_DIRECT_URL: "postgresql://postgres:postgres@localhost:54322/postgres"
  };
}
