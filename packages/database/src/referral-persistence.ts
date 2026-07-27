import {
  calculateCommissionKopecks,
  DEFAULT_REFERRAL_TIERS,
  resolveEffectivePercent,
  type ReferralTierConfig
} from "@ticket-platform/domain";
import type {
  IdGenerator,
  ReferralCommissionSettlement,
  ReferralCommissionSettlementRepository,
  SettleReferralCommissionInput
} from "@ticket-platform/application";
import {
  PostgresUnitOfWork,
  TransactionSession,
  type SqlConnectionPool
} from "./postgres.js";

interface AttributionRow {
  readonly referrer_user_id: string;
  readonly qualified_at: Date | null;
}

interface TierRow {
  readonly tier_number: number;
  readonly min_referrals: number;
  readonly max_referrals: number | null;
  readonly percent_basis_points: number;
}

interface WalletAccountRow {
  readonly id: string;
  readonly status: string;
}

/**
 * Resolves who referred the paying user (packages/messenger-telegram's partnerLinkReply: the
 * referrer's own Telegram numeric user ID doubles as the partner code recorded on
 * user_touchpoints by HandleTelegramStartService), computes their current commission tier from
 * DEFAULT_REFERRAL_TIERS/referral_tier_configs (packages/domain/src/referral.ts,
 * ported from max-bot/src/domain/referralTiers.ts), and credits the referrer's wallet
 * (transaction_type 'REFERRAL_REWARD', bucket 'referral') — all within the SAME transaction
 * ConfirmPaymentService already runs order persistence in, via the shared TransactionSession.
 */
export class PostgresReferralCommissionRepository
implements ReferralCommissionSettlementRepository {
  constructor(
    private readonly session: TransactionSession,
    private readonly idGenerator: IdGenerator
  ) {}

  async settleForOrder(input: SettleReferralCommissionInput): Promise<ReferralCommissionSettlement> {
    const attribution = await this.findOrCreateAttribution(input.buyerUserId, input.confirmedAt);
    if (!attribution) {
      return { settled: false };
    }

    await this.session.query(
      "select pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`referral-referrer:${attribution.referrerUserId}`]
    );

    const qualifyingCount = await this.countQualifyingReferrals(
      attribution.referrerUserId,
      input.buyerUserId
    );
    const tiers = await this.loadActiveTiers();
    const { percentBasisPoints, tierNumber } = resolveEffectivePercent(
      qualifyingCount,
      tiers,
      null,
      input.confirmedAt
    );
    const commissionKopecks = calculateCommissionKopecks(input.totalKopecks, percentBasisPoints);

    if (commissionKopecks > 0n) {
      await this.creditWallet(attribution.referrerUserId, commissionKopecks, tierNumber, percentBasisPoints, input);
    }

    if (attribution.qualifiedAt === null) {
      await this.session.query(
        `update public.referral_attributions
         set qualified_at = $2
         where referred_user_id = $1 and qualified_at is null`,
        [input.buyerUserId, input.confirmedAt]
      );
    }

    if (commissionKopecks <= 0n) {
      return { settled: false };
    }

    return {
      settled: true,
      referrerUserId: attribution.referrerUserId,
      tierNumber,
      percentBasisPoints,
      commissionKopecks
    };
  }

  private async findOrCreateAttribution(
    referredUserId: string,
    now: Date
  ): Promise<{ readonly referrerUserId: string; readonly qualifiedAt: Date | null } | null> {
    const existing = await this.session.query<AttributionRow>(
      "select referrer_user_id, qualified_at from public.referral_attributions where referred_user_id = $1",
      [referredUserId]
    );
    const existingRow = existing.rows[0];
    if (existingRow) {
      return { referrerUserId: existingRow.referrer_user_id, qualifiedAt: existingRow.qualified_at };
    }

    const touchpoint = await this.session.query<{ readonly partner_code: string; readonly channel: string }>(
      `select partner_code, channel
       from public.user_touchpoints
       where user_id = $1 and partner_code is not null
       order by occurred_at asc
       limit 1`,
      [referredUserId]
    );
    const partnerCode = touchpoint.rows[0]?.partner_code;
    const channel = touchpoint.rows[0]?.channel;
    if (!partnerCode || !channel) {
      return null;
    }

    const owner = await this.session.query<{ readonly user_id: string }>(
      "select user_id from public.messenger_identities where channel = $1 and external_user_id = $2",
      [channel, partnerCode]
    );
    const referrerUserId = owner.rows[0]?.user_id;
    if (!referrerUserId || referrerUserId === referredUserId) {
      return null;
    }

    await this.session.query(
      `insert into public.referral_attributions (id, referred_user_id, referrer_user_id, partner_code, attributed_at)
       values ($1, $2, $3, $4, $5)
       on conflict (referred_user_id) do nothing`,
      [this.idGenerator.newId(), referredUserId, referrerUserId, partnerCode, now]
    );

    const inserted = await this.session.query<AttributionRow>(
      "select referrer_user_id, qualified_at from public.referral_attributions where referred_user_id = $1",
      [referredUserId]
    );
    const row = inserted.rows[0];
    if (!row) {
      return null;
    }

    return { referrerUserId: row.referrer_user_id, qualifiedAt: row.qualified_at };
  }

  private async countQualifyingReferrals(
    referrerUserId: string,
    excludingReferredUserId: string
  ): Promise<number> {
    const result = await this.session.query<{ readonly count: string }>(
      `select count(*)::text as count
       from public.referral_attributions
       where referrer_user_id = $1 and qualified_at is not null and referred_user_id <> $2`,
      [referrerUserId, excludingReferredUserId]
    );

    return Number(result.rows[0]?.count ?? "0");
  }

  private async loadActiveTiers(): Promise<readonly ReferralTierConfig[]> {
    const result = await this.session.query<TierRow>(
      `select tier_number, min_referrals, max_referrals, percent_basis_points
       from public.referral_tier_configs
       where is_active = true
       order by tier_number`
    );

    if (result.rows.length === 0) {
      return DEFAULT_REFERRAL_TIERS;
    }

    return result.rows.map((row) => ({
      tierNumber: row.tier_number,
      minReferrals: row.min_referrals,
      maxReferrals: row.max_referrals,
      percentBasisPoints: row.percent_basis_points
    }));
  }

  private async creditWallet(
    referrerUserId: string,
    amount: bigint,
    tierNumber: number,
    percentBasisPoints: number,
    input: SettleReferralCommissionInput
  ): Promise<void> {
    await this.session.query(
      "select pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`wallet-user:${referrerUserId}`]
    );

    const account = await this.findOrCreateAccount(referrerUserId, input.currency, input.confirmedAt);
    if (account.status !== "active") {
      throw new Error(`Wallet account is not active: ${account.id}`);
    }

    const transactionId = this.idGenerator.newId();
    await this.session.query(
      `insert into public.wallet_transactions (
         id, wallet_account_id, transaction_type, status, idempotency_key,
         reference_type, reference_id, actor_type, metadata, created_at
       ) values ($1, $2, 'REFERRAL_REWARD', 'pending', $3, 'order', $4, 'system', $5::jsonb, $6)`,
      [
        transactionId,
        account.id,
        `referral-reward:${input.orderId}`,
        input.orderId,
        JSON.stringify({
          referredUserId: input.buyerUserId,
          tierNumber,
          percentBasisPoints
        }),
        input.confirmedAt
      ]
    );
    await this.session.query(
      `insert into public.wallet_entries (
         id, wallet_account_id, wallet_transaction_id, direction, amount_kopecks,
         bucket, effective_at, created_at
       ) values ($1, $2, $3, 'credit', $4, 'referral', $5, $5)`,
      [this.idGenerator.newId(), account.id, transactionId, amount.toString(), input.confirmedAt]
    );
    await this.session.query(
      `update public.wallet_accounts
       set cached_available_kopecks = cached_available_kopecks + $2,
           balance_version = balance_version + 1,
           updated_at = $3
       where id = $1`,
      [account.id, amount.toString(), input.confirmedAt]
    );
    const posted = await this.session.query(
      `update public.wallet_transactions
       set status = 'posted', posted_at = $2
       where id = $1 and status = 'pending'`,
      [transactionId, input.confirmedAt]
    );

    if (posted.rowCount !== 1) {
      throw new Error(`Failed to post referral reward transaction: ${transactionId}`);
    }
  }

  private async findOrCreateAccount(
    userId: string,
    currency: string,
    now: Date
  ): Promise<WalletAccountRow> {
    const existing = await this.session.query<WalletAccountRow>(
      "select id, status from public.wallet_accounts where user_id = $1 and currency = $2",
      [userId, currency]
    );
    const existingRow = existing.rows[0];
    if (existingRow) {
      return existingRow;
    }

    await this.session.query(
      `insert into public.wallet_accounts (id, user_id, currency, created_at, updated_at)
       values ($1, $2, $3, $4, $4)
       on conflict (user_id, currency) do nothing`,
      [this.idGenerator.newId(), userId, currency, now]
    );

    const inserted = await this.session.query<WalletAccountRow>(
      "select id, status from public.wallet_accounts where user_id = $1 and currency = $2",
      [userId, currency]
    );
    const row = inserted.rows[0];
    if (!row) {
      throw new Error(`Failed to create wallet account for user: ${userId}`);
    }

    return row;
  }
}

export function createReferralCommissionPersistence(
  pool: SqlConnectionPool,
  idGenerator: IdGenerator
) {
  const session = new TransactionSession();

  return {
    referralCommissionRepository: new PostgresReferralCommissionRepository(session, idGenerator),
    unitOfWork: new PostgresUnitOfWork(pool, session)
  } as const;
}
