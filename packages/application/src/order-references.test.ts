import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HmacOrderReferenceGenerator } from "./order-references.js";

describe("HmacOrderReferenceGenerator", () => {
  it("generates deterministic opaque tokens and database-safe references", () => {
    const generator = new HmacOrderReferenceGenerator("s".repeat(32), "BP");
    const orderId = "019c0123-4567-789a-bcde-f0123456789a";

    const first = generator.publicToken(orderId);
    const second = generator.publicToken(orderId);

    assert.deepEqual(first, second);
    assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
    assert.match(first.sha256, /^[a-f0-9]{64}$/);
    assert.equal(
      generator.orderNumber(orderId, new Date("2026-07-24T12:00:00.000Z")),
      "BP-20260724-4567789ABCDEF0123456789A"
    );
  });

  it("rejects weak secrets and unsafe prefixes", () => {
    assert.throws(
      () => new HmacOrderReferenceGenerator("short", "BP"),
      /at least 32 bytes/
    );
    assert.throws(
      () => new HmacOrderReferenceGenerator("s".repeat(32), "bp"),
      /prefix/
    );
  });
});
