import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { load } from "js-yaml";

const workflowDirectory = join(process.cwd(), ".github", "workflows");
const workflowFiles = (await readdir(workflowDirectory))
  .filter((fileName) => /\.ya?ml$/.test(fileName))
  .sort();
const violations = [];

if (workflowFiles.length === 0) {
  violations.push("No GitHub Actions workflows found");
}

for (const fileName of workflowFiles) {
  const content = await readFile(join(workflowDirectory, fileName), "utf8");

  try {
    load(content);
  } catch (error) {
    violations.push(`${fileName}: invalid YAML (${error instanceof Error ? error.message : "unknown"})`);
    continue;
  }

  if (/^\s*pull_request_target\s*:/m.test(content)) {
    violations.push(`${fileName}: pull_request_target is prohibited`);
  }

  for (const match of content.matchAll(/^\s*uses:\s*([^\s#]+).*$/gm)) {
    const reference = match[1];

    if (
      reference
      && !reference.startsWith("./")
      && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/.test(reference)
    ) {
      violations.push(`${fileName}: action is not pinned to a full commit SHA: ${reference}`);
    }
  }
}

const dependabotPath = join(process.cwd(), ".github", "dependabot.yml");
try {
  load(await readFile(dependabotPath, "utf8"));
} catch (error) {
  violations.push(
    `dependabot.yml: invalid or missing YAML (${error instanceof Error ? error.message : "unknown"})`
  );
}

if (violations.length > 0) {
  process.stderr.write(`CI configuration violations:\n${violations.map((item) => `- ${item}`).join("\n")}\n`);
  process.exit(1);
}

process.stdout.write(
  `Checked ${workflowFiles.length} workflow(s): YAML valid, external actions pinned, safe trigger policy.\n`
);
