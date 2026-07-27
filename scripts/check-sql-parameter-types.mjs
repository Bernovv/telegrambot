// Ищет запросы, где один и тот же параметр подставляется в колонки разных типов.
//
// Postgres выводит тип параметра один раз на весь запрос. Если $1 сравнивается и с колонкой
// uuid, и с текстом, запрос отвергается целиком — `operator does not exist: text = uuid` — ещё
// на разборе, до выполнения. За один вечер это случилось дважды: в завершении сценария после
// оплаты (событие PaymentConfirmed падало на каждой покупке) и в записи аудита при создании
// первого администратора.
//
// Обычные тесты такое не ловят: настоящей базы в них нет, запросы разбирает подставной
// коннектор, которому всё равно, какого типа значение. Поэтому проверка статическая — по тексту
// запросов и типам колонок из миграций.

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = process.cwd();
const migrationDir = join(root, "supabase", "migrations");
const sourceDirs = ["packages", "apps", "scripts"];

const TYPE_FAMILIES = {
  uuid: "uuid",
  text: "text",
  jsonb: "jsonb",
  timestamptz: "timestamptz",
  inet: "inet",
  boolean: "boolean",
  bigint: "number",
  integer: "number",
  smallint: "number",
  numeric: "number"
};
const COLUMN_TYPES = Object.keys(TYPE_FAMILIES).join("|");
// $1, но не $11 и не $1::uuid — явный каст означает, что тип уже задан вручную.
const PARAMETER = /\$(\d+)(?![\d:])/g;

const columnTypes = await readColumnTypes();
const violations = [];

for (const directory of sourceDirs) {
  for (const file of await collectTypeScriptFiles(join(root, directory))) {
    const source = await readFile(file, "utf8");
    for (const query of extractQueries(source)) {
      for (const [parameter, families] of inferParameterTypes(query.sql)) {
        if (families.size > 1) {
          violations.push({
            file: relative(root, file),
            line: query.line,
            parameter,
            families: [...families].sort()
          });
        }
      }
    }
  }
}

if (violations.length > 0) {
  console.error("Один параметр подставляется в колонки разных типов:");
  for (const violation of violations) {
    console.error(
      `- ${violation.file}:${violation.line} — $${violation.parameter} `
      + `используется как ${violation.families.join(" и как ")}`
    );
  }
  console.error(
    "\nPostgres выводит тип параметра один раз на весь запрос и отвергнет такой запрос "
    + "целиком. Подставьте значение отдельными параметрами."
  );
  process.exit(1);
}

console.log("SQL parameter types are consistent.");

async function readColumnTypes() {
  const tables = new Map();
  const files = (await readdir(migrationDir)).filter((file) => file.endsWith(".sql")).sort();

  for (const file of files) {
    const sql = await readFile(join(migrationDir, file), "utf8");

    const createPattern = /create table (?:if not exists )?public\.(\w+)\s*\(([\s\S]*?)\n\);/gi;
    for (const match of sql.matchAll(createPattern)) {
      const table = match[1];
      const columns = tables.get(table) ?? new Map();
      for (const rawLine of match[2].split("\n")) {
        const line = rawLine.trim().replace(/,$/, "");
        const column = new RegExp(`^(\\w+)\\s+(${COLUMN_TYPES})\\b`, "i").exec(line);
        if (column && !isReservedWord(column[1])) {
          columns.set(column[1].toLowerCase(), TYPE_FAMILIES[column[2].toLowerCase()]);
        }
      }
      tables.set(table, columns);
    }

    const alterPattern = new RegExp(
      `alter table (?:only )?public\\.(\\w+)\\s+add column (?:if not exists )?(\\w+)\\s+(${COLUMN_TYPES})\\b`,
      "gi"
    );
    for (const match of sql.matchAll(alterPattern)) {
      const columns = tables.get(match[1]) ?? new Map();
      columns.set(match[2].toLowerCase(), TYPE_FAMILIES[match[3].toLowerCase()]);
      tables.set(match[1], columns);
    }
  }

  return tables;
}

function isReservedWord(word) {
  return ["constraint", "primary", "unique", "check", "foreign"].includes(word.toLowerCase());
}

async function collectTypeScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "dist") {
        continue;
      }
      files.push(...await collectTypeScriptFiles(path));
      continue;
    }
    if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      files.push(path);
    }
  }

  return files;
}

function extractQueries(source) {
  const queries = [];
  for (const match of source.matchAll(/`([^`]*?)`/gs)) {
    const sql = match[1];
    if (!sql.includes("$1") || !/\b(select|insert|update|delete)\b/i.test(sql)) {
      continue;
    }
    queries.push({
      sql,
      line: source.slice(0, match.index).split("\n").length
    });
  }
  return queries;
}

function inferParameterTypes(sql) {
  const lowered = sql.toLowerCase();
  const aliases = readTableAliases(lowered);
  const parameters = new Map();

  const add = (parameter, family) => {
    if (!family) {
      return;
    }
    const families = parameters.get(parameter) ?? new Set();
    families.add(family);
    parameters.set(parameter, families);
  };

  for (const [parameter, family] of readInsertColumnTypes(lowered)) {
    add(parameter, family);
  }

  for (const match of lowered.matchAll(/(?:(\w+)\.)?(\w+)\s*(?:=|<|>|<=|>=)\s*\$(\d+)(?![\d:])/g)) {
    const [, alias, column, parameter] = match;
    const candidates = alias
      ? [aliases.get(alias)]
      : [...new Set(aliases.values())];
    for (const table of candidates) {
      const family = columnTypes.get(table)?.get(column);
      if (family) {
        add(parameter, family);
        break;
      }
    }
  }

  // Извлечение из jsonb всегда даёт text, каким бы ни было содержимое.
  for (const match of lowered.matchAll(/(?:#>>|->>)\s*'[^']*'\s*=\s*\$(\d+)(?![\d:])/g)) {
    add(match[1], "text");
  }

  return parameters;
}

function readTableAliases(lowered) {
  const aliases = new Map();
  const pattern = /(?:from|join|into|update)\s+public\.(\w+)(?:\s+(?:as\s+)?(\w+))?/g;
  const keywords = ["set", "on", "where", "values", "select", "using", "as", "returning"];

  for (const match of lowered.matchAll(pattern)) {
    const [, table, alias] = match;
    aliases.set(table, table);
    if (alias && !keywords.includes(alias)) {
      aliases.set(alias, table);
    }
  }

  return aliases;
}

function readInsertColumnTypes(lowered) {
  const found = [];
  const insert = /insert\s+into\s+public\.(\w+)\s*\(([^)]*)\)\s*values\s*\(([\s\S]*?)\)\s*(?:on\s+conflict|returning|$)/
    .exec(lowered);
  if (!insert) {
    return found;
  }

  const [, table, rawColumns, rawValues] = insert;
  const columns = rawColumns.split(",").map((column) => column.trim());
  const values = splitTopLevel(rawValues);

  for (const [index, column] of columns.entries()) {
    const value = values[index];
    const parameter = value === undefined ? null : /^\s*\$(\d+)\s*$/.exec(value);
    if (parameter) {
      found.push([parameter[1], columnTypes.get(table)?.get(column)]);
    }
  }

  return found;
}

function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let current = "";

  for (const character of text) {
    if (character === "(") {
      depth += 1;
    }
    if (character === ")") {
      depth -= 1;
    }
    if (character === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  parts.push(current);

  return parts;
}
