import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationPath = join(
  projectRoot,
  "supabase",
  "migrations",
  "20260722230000_pgboss_v37_outbox_queues.sql"
);
const requireFromWorker = createRequire(join(projectRoot, "apps", "worker", "package.json"));
const pgBossEntryPath = requireFromWorker.resolve("pg-boss");
const pgBoss = await import(pathToFileURL(pgBossEntryPath).href);
const plans = await import(new URL("./plans.js", pathToFileURL(pgBossEntryPath)).href);

const schemaSql = pgBoss.getConstructionPlans("pgboss").trim();
const deadLetterQueueSql = plans.createQueue(
  "pgboss",
  "outbox-dispatch-dead-letter",
  {
    policy: "standard",
    retryLimit: 0,
    deleteAfterSeconds: 2_592_000
  },
  false
).trim();
const dispatchQueueSql = plans.createQueue(
  "pgboss",
  "outbox-dispatch",
  {
    policy: "standard",
    retryLimit: 5,
    retryDelay: 5,
    retryBackoff: true,
    retryDelayMax: 300,
    deadLetter: "outbox-dispatch-dead-letter",
    heartbeatSeconds: 60
  },
  false
).trim();
const migration = [
  "-- Generated from pg-boss 12.26.2, schema version 37.",
  "-- Do not edit manually; run pnpm db:pgboss:generate.",
  "-- ADR: docs/adr/0004-pgboss-schema-management.md",
  "-- User approved the vendor delete_queue function on 2026-07-22.",
  "",
  schemaSql,
  "",
  deadLetterQueueSql,
  "",
  dispatchQueueSql,
  ""
].join("\n");

if (process.argv.includes("--check")) {
  const existing = await readFile(migrationPath, "utf8");
  if (existing !== migration) {
    console.error("pg-boss migration differs from the pinned generator output");
    process.exit(1);
  }

  console.log("pg-boss migration matches pg-boss 12.26.2 schema v37");
} else {
  await writeFile(migrationPath, migration, "utf8");
  console.log(`Generated ${migrationPath}`);
}
