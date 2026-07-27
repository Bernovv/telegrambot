import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateCommissionKopecks,
  DEFAULT_REFERRAL_TIERS,
  resolveEffectivePercent,
  resolveTier
} from "./referral.js";

describe("referral tiers", () => {
  it("resolves tier 1 (7%) for 0 to 9 qualifying referrals", () => {
    assert.equal(resolveTier(0).percentBasisPoints, 700);
    assert.equal(resolveTier(9).percentBasisPoints, 700);
    assert.equal(resolveTier(0).tierNumber, 1);
  });

  it("resolves tier 2 (10%) for 10 to 29 qualifying referrals", () => {
    assert.equal(resolveTier(10).percentBasisPoints, 1000);
    assert.equal(resolveTier(29).percentBasisPoints, 1000);
  });

  it("resolves tier 3 (15%) for 30+ qualifying referrals with no next tier", () => {
    const resolution = resolveTier(30);
    assert.equal(resolution.percentBasisPoints, 1500);
    assert.equal(resolution.tierNumber, 3);
    assert.equal(resolution.referralsToNextTier, null);
  });

  it("counts down referrals remaining until the next tier", () => {
    assert.equal(resolveTier(7).referralsToNextTier, 3);
    assert.equal(resolveTier(20).referralsToNextTier, 10);
  });

  it("throws on an empty tier list instead of silently picking a default", () => {
    assert.throws(() => resolveTier(0, []), /empty/);
  });

  it("falls back to the calculated tier when no override is active", () => {
    const result = resolveEffectivePercent(0, DEFAULT_REFERRAL_TIERS, null, new Date("2026-07-27"));
    assert.deepEqual(result, { percentBasisPoints: 700, tierNumber: 1, source: "calculated" });
  });

  it("prefers an active fixed-percent override over the calculated tier", () => {
    const result = resolveEffectivePercent(
      0,
      DEFAULT_REFERRAL_TIERS,
      {
        fixedPercentBasisPoints: 2000,
        tierOverride: null,
        validFrom: new Date("2026-07-01"),
        validUntil: null
      },
      new Date("2026-07-27")
    );
    assert.deepEqual(result, { percentBasisPoints: 2000, tierNumber: 1, source: "fixed_percent" });
  });

  it("prefers an active tier override over the calculated tier when no fixed percent is set", () => {
    const result = resolveEffectivePercent(
      0,
      DEFAULT_REFERRAL_TIERS,
      {
        fixedPercentBasisPoints: null,
        tierOverride: 3,
        validFrom: new Date("2026-07-01"),
        validUntil: null
      },
      new Date("2026-07-27")
    );
    assert.deepEqual(result, { percentBasisPoints: 1500, tierNumber: 3, source: "tier_override" });
  });

  it("ignores an override outside its valid window", () => {
    const result = resolveEffectivePercent(
      0,
      DEFAULT_REFERRAL_TIERS,
      {
        fixedPercentBasisPoints: 2000,
        tierOverride: null,
        validFrom: new Date("2026-08-01"),
        validUntil: null
      },
      new Date("2026-07-27")
    );
    assert.deepEqual(result, { percentBasisPoints: 700, tierNumber: 1, source: "calculated" });
  });

  it("computes commission as base times percent, rounded down to the kopeck", () => {
    assert.equal(calculateCommissionKopecks(199000n, 700), 13930n);
    assert.equal(calculateCommissionKopecks(1n, 700), 0n);
    assert.equal(calculateCommissionKopecks(0n, 1500), 0n);
  });

  it("rejects a negative base amount or an out-of-range percent", () => {
    assert.throws(() => calculateCommissionKopecks(-1n, 700), /negative/);
    assert.throws(() => calculateCommissionKopecks(100n, -1), /basis points/);
    assert.throws(() => calculateCommissionKopecks(100n, 10_001), /basis points/);
  });
});
