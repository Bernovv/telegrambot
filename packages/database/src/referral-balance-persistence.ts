import type {
  ChannelIdentity,
  ReferralBalanceRepository,
  ReferralBalanceSnapshot
} from "@ticket-platform/application";
import type { ReferralTierConfig } from "@ticket-platform/domain";
import type { SqlConnectionPool } from "./postgres.js";

interface IdentityRow {
  readonly user_id: string;
}

interface WalletRow {
  readonly cached_available_kopecks: string;
  readonly currency: string;
}

interface CountRow {
  readonly count: string;
}

interface TierRow {
  readonly tier_number: number;
  readonly min_referrals: number;
  readonly max_referrals: number | null;
  readonly percent_basis_points: number;
}

/** Read-only "Мои бонусы" lookup — no transaction needed, mirrors ticket-access-persistence.ts. */
export class PostgresReferralBalanceRepository implements ReferralBalanceRepository {
  constructor(private readonly pool: SqlConnectionPool) {}

  async getBalance(identity: ChannelIdentity): Promise<ReferralBalanceSnapshot | null> {
    const connection = await this.pool.connect();

    try {
      const identityResult = await connection.query<IdentityRow>(
        `select identity.user_id
         from public.messenger_identities identity
         join public.users users on users.id = identity.user_id
         where identity.channel = $2::text
           and identity.external_user_id = $1
           and users.is_deleted = false`,
        [identity.externalUserId, identity.channel]
      );
      const userId = identityResult.rows[0]?.user_id;
      if (!userId) {
        return null;
      }

      const walletResult = await connection.query<WalletRow>(
        `select cached_available_kopecks::text, currency
         from public.wallet_accounts
         where user_id = $1 and currency = 'RUB'`,
        [userId]
      );
      const countResult = await connection.query<CountRow>(
        `select count(*)::text as count
         from public.referral_attributions
         where referrer_user_id = $1 and qualified_at is not null`,
        [userId]
      );

      return {
        userId,
        availableKopecks: walletResult.rows[0]?.cached_available_kopecks ?? "0",
        currency: walletResult.rows[0]?.currency ?? "RUB",
        qualifyingReferrals: Number(countResult.rows[0]?.count ?? "0")
      };
    } finally {
      connection.release();
    }
  }

  async getActiveTiers(): Promise<readonly ReferralTierConfig[]> {
    const connection = await this.pool.connect();

    try {
      const result = await connection.query<TierRow>(
        `select tier_number, min_referrals, max_referrals, percent_basis_points
         from public.referral_tier_configs
         where is_active = true
         order by tier_number`
      );

      return result.rows.map((row) => ({
        tierNumber: row.tier_number,
        minReferrals: row.min_referrals,
        maxReferrals: row.max_referrals,
        percentBasisPoints: row.percent_basis_points
      }));
    } finally {
      connection.release();
    }
  }
}

export function createReferralBalancePersistence(pool: SqlConnectionPool) {
  return {
    referralBalanceRepository: new PostgresReferralBalanceRepository(pool)
  } as const;
}
