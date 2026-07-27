import { DEFAULT_REFERRAL_TIERS, resolveTier, type ReferralTierConfig } from "@ticket-platform/domain";

/**
 * Read-only "Мои бонусы" query: wallet balance plus the referrer's current commission tier,
 * matching the MAX bot's bonus summary screen (max-bot/src/domain/flow.ts bonusSummary-equivalent
 * reply). No writes here — commission crediting itself happens in payment-confirmation.ts.
 */
export interface ReferralBalanceQuery {
  readonly externalUserId: string;
}

export interface ReferralBalanceSnapshot {
  readonly userId: string;
  readonly availableKopecks: string;
  readonly currency: string;
  readonly qualifyingReferrals: number;
}

export interface ReferralBalanceRepository {
  getBalance(externalUserId: string): Promise<ReferralBalanceSnapshot | null>;
  getActiveTiers(): Promise<readonly ReferralTierConfig[]>;
}

export type ReferralBalanceResult =
  | { readonly identityFound: false }
  | {
      readonly identityFound: true;
      readonly availableKopecks: string;
      readonly currency: string;
      readonly qualifyingReferrals: number;
      readonly tierNumber: number;
      readonly percentBasisPoints: number;
      readonly referralsToNextTier: number | null;
    };

export class GetTelegramReferralBalanceService {
  constructor(private readonly repository: ReferralBalanceRepository) {}

  async execute(query: ReferralBalanceQuery): Promise<ReferralBalanceResult> {
    if (!/^-?\d{1,20}$/.test(query.externalUserId)) {
      return { identityFound: false };
    }

    const balance = await this.repository.getBalance(query.externalUserId);
    if (!balance) {
      return { identityFound: false };
    }

    const configuredTiers = await this.repository.getActiveTiers();
    const tiers = configuredTiers.length > 0 ? configuredTiers : DEFAULT_REFERRAL_TIERS;
    const resolution = resolveTier(balance.qualifyingReferrals, tiers);

    return {
      identityFound: true,
      availableKopecks: balance.availableKopecks,
      currency: balance.currency,
      qualifyingReferrals: balance.qualifyingReferrals,
      tierNumber: resolution.tierNumber,
      percentBasisPoints: resolution.percentBasisPoints,
      referralsToNextTier: resolution.referralsToNextTier
    };
  }
}
