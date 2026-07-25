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
  console.error("Potential destructive migration statements found:");
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
