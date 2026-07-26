import assert from "node:assert/strict";
import test from "node:test";
import { buildAdminApiPath } from "./admin-api";

test("builds a stable encoded user list path", () => {
  assert.equal(
    buildAdminApiPath("users", {
      search: "Иван +7",
      blocked: false,
      cursor: "opaque_cursor",
      limit: 25
    }),
    "users?search=%D0%98%D0%B2%D0%B0%D0%BD+%2B7&blocked=false&cursor=opaque_cursor&limit=25"
  );
});

test("omits undefined and empty filters", () => {
  assert.equal(
    buildAdminApiPath("orders", {
      search: "",
      status: undefined,
      limit: 50
    }),
    "orders?limit=50"
  );
});

test("builds an encoded event catalog path", () => {
  assert.equal(
    buildAdminApiPath("events", {
      search: "Лекция",
      status: "published",
      limit: 25
    }),
    "events?search=%D0%9B%D0%B5%D0%BA%D1%86%D0%B8%D1%8F&status=published&limit=25"
  );
});
