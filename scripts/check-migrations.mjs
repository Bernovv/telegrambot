import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const migrationDir = join(process.cwd(), "supabase", "migrations");
const approvedVendorDestructiveStatements = {
  file: "20260722230000_pgboss_v37_outbox_queues.sql",
  statements: [
    "EXECUTE format('DROP TABLE IF EXISTS pgboss.%I', v_table);",
    "EXECUTE format('DELETE FROM pgboss.%I WHERE name = %L', v_table, queue_name);",
    "DELETE FROM pgboss.queue WHERE name = queue_name;"
  ]
};
const destructivePatterns = [
  /\bdrop\s+column\b/i,
  /\bdrop\s+table\b/i,
  /\btruncate\b/i,
  /\balter\s+type\b.*\bdrop\s+value\b/i,
  /\bdelete\s+from\b/i
];

const files = (await readdir(migrationDir)).filter((file) => file.endsWith(".sql")).sort();
const violations = [];

// Манифест обязан совпадать с папкой файл в файл: по нему выкладка и решает, что
// применять. Забытая в манифесте миграция не применяется вовсе — выкладка падает с
// «files do not exactly match the ordered migration manifest», и это выясняется на
// сервере, а не здесь.
const manifestSource = await readFile(
  join(process.cwd(), "packages", "database", "src", "migrations.ts"),
  "utf8"
);
const manifestIds = [...manifestSource.matchAll(/^\s*id:\s*"([^"]+)"/gm)]
  .map((match) => match[1]);
const fileIds = files.map((file) => file.slice(0, -4));

for (const missing of fileIds.filter((id) => !manifestIds.includes(id))) {
  violations.push(`${missing}.sql: миграции нет в манифесте packages/database/src/migrations.ts`);
}
for (const extra of manifestIds.filter((id) => !fileIds.includes(id))) {
  violations.push(`${extra}: в манифесте есть, а файла миграции нет`);
}
if (
  violations.length === 0
  && JSON.stringify(manifestIds) !== JSON.stringify(fileIds)
) {
  violations.push("порядок миграций в манифесте не совпадает с порядком файлов");
}

for (const file of files) {
  const content = await readFile(join(migrationDir, file), "utf8");
  const stripped = stripApprovedVendorStatements(file, stripSqlComments(content));

  for (const pattern of destructivePatterns) {
    if (pattern.test(stripped)) {
      violations.push(`${file}: ${pattern}`);
    }
  }
}

if (violations.length > 0) {
  console.error("Миграции не в порядке:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log(`Checked ${files.length} migration(s): no unapproved destructive statements found.`);

function stripSqlComments(sql) {
  return sql
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function stripApprovedVendorStatements(file, sql) {
  if (file !== approvedVendorDestructiveStatements.file) {
    return sql;
  }

  let stripped = sql;
  for (const statement of approvedVendorDestructiveStatements.statements) {
    const occurrences = stripped.split(statement).length - 1;
    if (occurrences !== 1) {
      violations.push(
        `${file}: approved pg-boss vendor statement count is ${occurrences}, expected 1: ${statement}`
      );
      continue;
    }

    stripped = stripped.replace(statement, "RAISE EXCEPTION 'queue deletion disabled by policy';");
  }

  return stripped;
}
