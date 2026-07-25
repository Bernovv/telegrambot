import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeTelegramUsername, parseStartPayload } from "./messenger.js";

describe("normalizeTelegramUsername", () => {
  it("normalizes Telegram usernames for matching", () => {
    assert.equal(normalizeTelegramUsername("@User_Name"), "user_name");
    assert.equal(normalizeTelegramUsername("  @MixedCase  "), "mixedcase");
    assert.equal(normalizeTelegramUsername(null), null);
  });
});

describe("parseStartPayload", () => {
  it("parses source, event, and partner payload parts", () => {
    assert.deepEqual(parseStartPayload("event_picnic__partner_abc123__source_instagram_story"), {
      rawPayload: "event_picnic__partner_abc123__source_instagram_story",
      source: "instagram_story",
      campaign: "instagram_story",
      partnerCode: "abc123",
      eventSlug: "picnic"
    });
  });

  it("returns empty attribution for missing payload", () => {
    assert.deepEqual(parseStartPayload(" "), {
      rawPayload: null,
      source: null,
      campaign: null,
      partnerCode: null,
      eventSlug: null
    });
  });
});
