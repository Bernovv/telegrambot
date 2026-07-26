import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeScenarioCallback,
  encodeScenarioCallback
} from "./scenario-callback.js";

test("round-trips scenario UUIDs inside the Telegram callback limit", () => {
  const sessionId = "019c0123-4567-789a-bcde-f0123456789a";
  const edgeId = "019c0123-4567-789a-bcde-f0123456789b";

  const encoded = encodeScenarioCallback(sessionId, edgeId);

  assert.ok(Buffer.byteLength(encoded, "utf8") <= 64);
  assert.deepEqual(decodeScenarioCallback(encoded), { sessionId, edgeId });
  assert.equal(decodeScenarioCallback(`${encoded}x`), null);
});
