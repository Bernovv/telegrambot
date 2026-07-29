import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertSafeDemoSeedSource,
  validateDemoSeedEnvironment
} from "./seed.js";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const seedFile = join(projectRoot, "supabase", "seed.sql");

test("repository demo seed contains no mutation or destructive statements", async () => {
  const sql = await readFile(seedFile, "utf8");

  assert.doesNotThrow(() => assertSafeDemoSeedSource(sql));
});

test("demo seed rejects staging and production before reading the database URL", () => {
  for (const appEnvironment of ["staging", "production"]) {
    assert.throws(
      () => validateDemoSeedEnvironment({
        APP_ENV: appEnvironment,
        DATABASE_SEED_CONFIRM: "seed-local-demo-data",
        DATABASE_DIRECT_URL: "postgresql://secret:password@production/db"
      }),
      /restricted to local and test/
    );
  }
});

test("demo seed requires an exact confirmation phrase", () => {
  assert.throws(
    () => validateDemoSeedEnvironment({
      APP_ENV: "local",
      DATABASE_DIRECT_URL: "postgresql://postgres:postgres@localhost:54322/postgres"
    }),
    /exact confirmation phrase/
  );
});

test("demo seed accepts local and test PostgreSQL URLs", () => {
  for (const appEnvironment of ["local", "test"]) {
    const config = validateDemoSeedEnvironment({
      APP_ENV: appEnvironment,
      DATABASE_SEED_CONFIRM: "seed-local-demo-data",
      DATABASE_DIRECT_URL: "postgresql://postgres:postgres@localhost:54322/postgres"
    });

    assert.equal(config.appEnvironment, appEnvironment);
  }
});

test("invalid seed URL does not expose its value", () => {
  const secretValue = "invalid url with secret-password";

  assert.throws(
    () => validateDemoSeedEnvironment({
      APP_ENV: "local",
      DATABASE_SEED_CONFIRM: "seed-local-demo-data",
      DATABASE_DIRECT_URL: secretValue
    }),
    (error: unknown) => error instanceof Error
      && error.message === "DATABASE_DIRECT_URL must be a valid PostgreSQL URL"
      && !error.message.includes(secretValue)
  );
});

test("demo seed source guard rejects updates and destructive SQL", () => {
  for (const sql of [
    "update public.events set title = 'changed'",
    "delete from public.events",
    "truncate public.events",
    "drop table public.events",
    "alter table public.events add column unsafe text"
  ]) {
    assert.throws(() => assertSafeDemoSeedSource(sql), /forbidden statement/);
  }
});
