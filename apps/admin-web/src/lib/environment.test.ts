import assert from "node:assert/strict";
import test from "node:test";
import { getAdminAppOrigin } from "./environment";

test("uses the configured public administrator origin behind a reverse proxy", () => {
  const previousValue = process.env.ADMIN_APP_URL;
  try {
    process.env.ADMIN_APP_URL = "https://admin.biz-day.ru/some/path";
    assert.equal(getAdminAppOrigin(), "https://admin.biz-day.ru");

    process.env.ADMIN_APP_URL = "file:///tmp/admin";
    assert.equal(getAdminAppOrigin(), null);
  } finally {
    if (previousValue === undefined) {
      delete process.env.ADMIN_APP_URL;
    } else {
      process.env.ADMIN_APP_URL = previousValue;
    }
  }
});
