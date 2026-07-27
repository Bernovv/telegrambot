import type { MoneyKopecks } from "./index.js";

/**
 * Pure referral-tier math, ported from the MAX bot (max-bot/src/domain/referralTiers.ts,
 * docs/09-REFERRAL-SYSTEM.md there). No database access here — callers load the tier
 * configuration and the referrer's qualifying-referral count, this module only computes.
 */

export interface ReferralTierConfig {
  readonly tierNumber: number;
  readonly minReferrals: number;
  readonly maxReferrals: number | null;
  readonly percentBasisPoints: number;
}

export interface TierResolution {
  readonly tierNumber: number;
  readonly percentBasisPoints: number;
  /** How many more unique paying referrals until the next tier; null at the top tier. */
  readonly referralsToNextTier: number | null;
}

/** Default 7% / 10% / 15% tiers, used until admin-configured rows exist in referral_tier_configs. */
export const DEFAULT_REFERRAL_TIERS: readonly ReferralTierConfig[] = [
  { tierNumber: 1, minReferrals: 0, maxReferrals: 9, percentBasisPoints: 700 },
  { tierNumber: 2, minReferrals: 10, maxReferrals: 29, percentBasisPoints: 1000 },
  { tierNumber: 3, minReferrals: 30, maxReferrals: null, percentBasisPoints: 1500 }
];

/**
 * Tier for a referrer with `qualifyingCountBeforeThisOrder` unique paying referrals accumulated
 * strictly before the order currently being settled (the order that makes a referred user
 * "qualifying" for the first time is rated at the tier the referrer held *before* that order).
 */
export function resolveTier(
  qualifyingCountBeforeThisOrder: number,
  tiers: readonly ReferralTierConfig[] = DEFAULT_REFERRAL_TIERS
): TierResolution {
  if (tiers.length === 0) {
    throw new Error("resolveTier: tier configuration is empty");
  }

  const sorted = [...tiers].sort((a, b) => a.tierNumber - b.tierNumber);
  const match = sorted.find(
    (tier) =>
      qualifyingCountBeforeThisOrder >= tier.minReferrals
      && (tier.maxReferrals === null || qualifyingCountBeforeThisOrder <= tier.maxReferrals)
  ) ?? sorted[sorted.length - 1];

  if (!match) {
    throw new Error("resolveTier: tier configuration is empty");
  }

  const referralsToNextTier = match.maxReferrals === null
    ? null
    : Math.max(match.maxReferrals + 1 - qualifyingCountBeforeThisOrder, 0);

  return {
    tierNumber: match.tierNumber,
    percentBasisPoints: match.percentBasisPoints,
    referralsToNextTier
  };
}

export interface ReferralPercentOverride {
  readonly fixedPercentBasisPoints: number | null;
  readonly tierOverride: number | null;
  readonly validFrom: Date;
  readonly validUntil: Date | null;
}

export interface EffectivePercentResolution {
  readonly percentBasisPoints: number;
  readonly tierNumber: number;
  readonly source: "fixed_percent" | "tier_override" | "calculated";
}

/** Priority: active fixed percent > active tier override > calculated tier from the count. */
export function resolveEffectivePercent(
  qualifyingCountBeforeThisOrder: number,
  tiers: readonly ReferralTierConfig[],
  override: ReferralPercentOverride | null,
  now: Date
): EffectivePercentResolution {
  const isOverrideActive = override !== null
    && override.validFrom <= now
    && (!override.validUntil || override.validUntil > now);

  if (isOverrideActive && override && override.fixedPercentBasisPoints !== null) {
    const calculated = resolveTier(qualifyingCountBeforeThisOrder, tiers);
    return {
      percentBasisPoints: override.fixedPercentBasisPoints,
      tierNumber: calculated.tierNumber,
      source: "fixed_percent"
    };
  }

  if (isOverrideActive && override && override.tierOverride !== null) {
    const tier = tiers.find((candidate) => candidate.tierNumber === override.tierOverride);
    if (tier) {
      return {
        percentBasisPoints: tier.percentBasisPoints,
        tierNumber: tier.tierNumber,
        source: "tier_override"
      };
    }
  }

  const calculated = resolveTier(qualifyingCountBeforeThisOrder, tiers);
  return {
    percentBasisPoints: calculated.percentBasisPoints,
    tierNumber: calculated.tierNumber,
    source: "calculated"
  };
}

/** Commission = base * percentBasisPoints / 10000, rounded down to the kopeck. */
export function calculateCommissionKopecks(
  baseAmountKopecks: MoneyKopecks,
  percentBasisPoints: number
): MoneyKopecks {
  if (baseAmountKopecks < 0n) {
    throw new Error("Referral commission base amount cannot be negative");
  }
  if (!Number.isSafeInteger(percentBasisPoints) || percentBasisPoints < 0 || percentBasisPoints > 10_000) {
    throw new Error("Referral commission percent must be an integer between 0 and 10000 basis points");
  }

  return (baseAmountKopecks * BigInt(percentBasisPoints)) / 10_000n;
}
