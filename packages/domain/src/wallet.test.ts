import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  captureWalletHold,
  createWalletHold,
  creditWallet,
  releaseWalletHold
} from "./wallet.js";

describe("wallet balance invariants", () => {
  it("credits phone bonus kopecks without using floating point", () => {
    assert.deepEqual(creditWallet({ available: 0n, held: 0n }, 10_000n), {
      available: 10_000n,
      held: 0n
    });
  });

  it("holds and captures the wallet-funded part of an order", () => {
    const held = createWalletHold({ available: 10_000n, held: 0n }, 10_000n);

    assert.deepEqual(held, { available: 0n, held: 10_000n });
    assert.deepEqual(captureWalletHold(held, 10_000n), { available: 0n, held: 0n });
  });

  it("returns held funds to available balance on release", () => {
    assert.deepEqual(releaseWalletHold({ available: 5_000n, held: 10_000n }, 10_000n), {
      available: 15_000n,
      held: 0n
    });
  });

  it("rejects overspending, over-capture, and non-positive operations", () => {
    assert.throws(
      () => createWalletHold({ available: 9_999n, held: 0n }, 10_000n),
      /exceeds available/
    );
    assert.throws(
      () => captureWalletHold({ available: 0n, held: 9_999n }, 10_000n),
      /exceeds held/
    );
    assert.throws(() => creditWallet({ available: 0n, held: 0n }, 0n), /greater than zero/);
  });
});
