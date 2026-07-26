import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrations } from "../src/migrations.js";
import {
  applyMigrationsToDatabase,
  readMigrationFiles,
  validateMigrationCommand,
  type MigrationCommandMode
} from "./migration-runner.js";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const migrationDirectory = join(projectRoot, "supabase", "migrations");

async function main(): Promise<void> {
  const mode = parseMode(process.argv[2]);
  const config = validateMigrationCommand(mode, process.env);
  const files = await readMigrationFiles(migrationDirectory, migrations);
  const applied = await applyMigrationsToDatabase(config.connectionString, files);

  if (applied.length === 0) {
    process.stdout.write("Database schema is current; no migrations were applied.\n");
    return;
  }

  process.stdout.write(
    `Applied ${applied.length} migration(s): ${applied.map((file) => file.id).join(", ")}\n`
  );
}

function parseMode(value: string | undefined): MigrationCommandMode {
  if (value === "local" || value === "deploy") {
    return value;
  }

  throw new Error("Migration command mode must be local or deploy");
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `Migration failed: ${error instanceof Error ? error.message : "Unknown error"}\n`
  );
  process.exitCode = 1;
});
