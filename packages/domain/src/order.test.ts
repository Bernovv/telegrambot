import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertOrderTransition,
  canTransitionOrder,
  isOrderCompositionMutable
} from "./order.js";

describe("order state machine", () => {
  it("allows the purchase and refund paths", () => {
    assert.equal(canTransitionOrder("draft", "awaiting_offer"), true);
    assert.equal(canTransitionOrder("awaiting_offer", "awaiting_payment"), true);
    assert.equal(canTransitionOrder("awaiting_payment", "payment_processing"), true);
    assert.equal(canTransitionOrder("payment_processing", "paid"), true);
    assert.equal(canTransitionOrder("paid", "partially_refunded"), true);
    assert.equal(canTransitionOrder("partially_refunded", "refunded"), true);
  });

  it("rejects direct and terminal-state transitions", () => {
    assert.throws(
      () => assertOrderTransition("awaiting_offer", "paid"),
      /cannot transition/
    );
    assert.equal(canTransitionOrder("cancelled", "awaiting_payment"), false);
    assert.equal(canTransitionOrder("refunded", "paid"), false);
  });

  it("freezes composition after offer acceptance", () => {
    assert.equal(isOrderCompositionMutable("draft", null), true);
    assert.equal(isOrderCompositionMutable("awaiting_offer", null), true);
    assert.equal(isOrderCompositionMutable("awaiting_offer", new Date()), false);
    assert.equal(isOrderCompositionMutable("awaiting_payment", null), false);
  });
});
