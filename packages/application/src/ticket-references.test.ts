import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HmacTicketReferenceGenerator } from "./ticket-references.js";

describe("HmacTicketReferenceGenerator", () => {
  it("creates deterministic opaque ticket references", () => {
    const generator = new HmacTicketReferenceGenerator("s".repeat(32));
    const ticketId = "019c0123-4567-789a-bcde-f0123456789a";

    assert.equal(
      generator.ticketNumber("BP-20260724-4567789ABCDEF0123456789D", 2),
      "BP-20260724-4567789ABCDEF0123456789D-T002"
    );
    assert.deepEqual(generator.publicToken(ticketId), generator.publicToken(ticketId));
    assert.match(generator.publicToken(ticketId).token, /^[A-Za-z0-9_-]{43}$/);
    assert.match(generator.publicToken(ticketId).sha256, /^[a-f0-9]{64}$/);
  });

  it("rejects weak secrets and unsafe ticket ordinals", () => {
    assert.throws(() => new HmacTicketReferenceGenerator("short"), /at least 32 bytes/);
    const generator = new HmacTicketReferenceGenerator("s".repeat(32));
    assert.throws(() => generator.ticketNumber("BP-ORDER", 0), /ordinal/);
  });
});
