import type {
  CreditPhoneBonusInput,
  CreditPhoneBonusResult,
  IdGenerator,
  PhoneBonusRepository,
  PhoneVerificationRepository,
  TelegramUserResolver,
  VerifyPhoneInput
} from "@ticket-platform/application";
import {
  PostgresIdempotencyRepository,
  PostgresOutboxWriter
} from "./telegram-start-persistence.js";
import {
  PostgresUnitOfWork,
  TransactionSession,
  type SqlConnectionPool
} from "./postgres.js";

interface ContactRow {
  readonly contact_id: string | null;
  readonly verification_status: "unverified" | "imported" | "verified" | "rejected" | null;
}

interface CampaignRow {
  readonly id: string;
  readonly amount_kopecks: string;
  readonly currency: string;
  readonly credit_expires_at: Date | null;
}

interface WalletAccountRow {
  readonly id: string;
  readonly status: "active" | "blocked" | "closed";
  readonly cached_available_kopecks: string;
}

interface ExistingBonusRow {
  readonly status: "pending" | "posted" | "failed";
  readonly amount_kopecks: string | null;
  readonly cached_available_kopecks: string;
  readonly currency: string;
}

export class PostgresTelegramUserResolver implements TelegramUserResolver {
  constructor(private readonly session: TransactionSession) {}

  async resolveUserId(externalUserId: string): Promise<string> {
    const result = await this.session.query<{ readonly user_id: string }>(
      `select user_id
       from public.messenger_identities
       where channel = 'telegram' and external_user_id = $1`,
      [externalUserId]
    );
    const userId = result.rows[0]?.user_id;

    if (!userId) {
      throw new Error(`Telegram identity not found: ${externalUserId}`);
    }

    return userId;
  }
}

export class PostgresPhoneVerificationRepository implements PhoneVerificationRepository {
  constructor(
    private readonly session: TransactionSession,
    private readonly idGenerator: IdGenerator
  ) {}

  async verifyPhone(input: VerifyPhoneInput): Promise<{ readonly newlyVerified: boolean }> {
    await this.lock(`phone-user:${input.userId}`);
    await this.lock(`phone-value:${input.phoneE164}`);

    const existing = await this.session.query<ContactRow>(
      `select
         c.id as contact_id,
         c.verification_status
       from public.users u
       left join public.user_contacts c
         on c.user_id = u.id
        and c.contact_type = 'phone'
        and c.value_normalized = $2
       where u.id = $1`,
      [input.userId, input.phoneE164]
    );
    const row = existing.rows[0];

    if (!row) {
      throw new Error(`User not found while verifying phone: ${input.userId}`);
    }

    await this.session.query(
      `update public.user_contacts
       set is_primary = false, updated_at = $2
       where user_id = $1 and contact_type = 'phone' and is_primary = true`,
      [input.userId, input.verifiedAt]
    );

    if (row.contact_id) {
      await this.session.query(
        `update public.user_contacts
         set source = $2,
             verification_status = 'verified',
             is_primary = true,
             verified_at = coalesce(verified_at, $3),
             updated_at = $3
         where id = $1`,
        [row.contact_id, input.source, input.verifiedAt]
      );
    } else {
      await this.session.query(
        `insert into public.user_contacts (
           id, user_id, contact_type, value_normalized, source, verification_status,
           is_primary, verified_at, created_at, updated_at
         ) values ($1, $2, 'phone', $3, $4, 'verified', true, $5, $5, $5)`,
        [this.idGenerator.newId(), input.userId, input.phoneE164, input.source, input.verifiedAt]
      );
    }

    await this.session.query(
      `update public.users
       set phone_status = 'verified', updated_at = greatest(updated_at, $2)
       where id = $1`,
      [input.userId, input.verifiedAt]
    );

    return { newlyVerified: row.verification_status !== "verified" };
  }

  private async lock(key: string): Promise<void> {
    await this.session.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
  }
}

export class PostgresPhoneBonusRepository implements PhoneBonusRepository {
  constructor(
    private readonly session: TransactionSession,
    private readonly idGenerator: IdGenerator
  ) {}

  async creditPhoneBonus(input: CreditPhoneBonusInput): Promise<CreditPhoneBonusResult> {
    await this.session.query(
      "select pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`wallet-user:${input.userId}`]
    );

    const existingBonus = await this.findExistingBonus(input.userId, input.idempotencyKey);
    if (existingBonus) {
      if (existingBonus.status !== "posted") {
        throw new Error(`Phone bonus transaction requires reconciliation: ${input.idempotencyKey}`);
      }

      return {
        credited: false,
        reason: "already_credited",
        amount: BigInt(existingBonus.amount_kopecks ?? "0"),
        availableBalance: BigInt(existingBonus.cached_available_kopecks),
        currency: existingBonus.currency
      };
    }

    const campaign = await this.findCampaign(input.occurredAt);
    if (!campaign) {
      return this.inactiveCampaignResult(input.userId);
    }

    const account = await this.findOrCreateAccount(input.userId, campaign.currency, input.occurredAt);
    if (account.status !== "active") {
      throw new Error(`Wallet account is not active: ${account.id}`);
    }

    const transactionId = this.idGenerator.newId();
    const amount = BigInt(campaign.amount_kopecks);

    await this.session.query(
      `insert into public.wallet_transactions (
         id, wallet_account_id, transaction_type, status, idempotency_key,
         reference_type, reference_id, actor_type, created_at
       ) values ($1, $2, 'PHONE_BONUS', 'pending', $3,
         'wallet_credit_campaign', $4, 'system', $5)`,
      [transactionId, account.id, input.idempotencyKey, campaign.id, input.occurredAt]
    );
    await this.session.query(
      `insert into public.wallet_entries (
         id, wallet_account_id, wallet_transaction_id, direction, amount_kopecks,
         bucket, effective_at, expires_at, created_at
       ) values ($1, $2, $3, 'credit', $4, 'bonus', $5, $6, $5)`,
      [
        this.idGenerator.newId(),
        account.id,
        transactionId,
        amount.toString(),
        input.occurredAt,
        campaign.credit_expires_at
      ]
    );
    const updated = await this.session.query<{ readonly cached_available_kopecks: string }>(
      `update public.wallet_accounts
       set cached_available_kopecks = cached_available_kopecks + $2,
           balance_version = balance_version + 1,
           updated_at = $3
       where id = $1
       returning cached_available_kopecks::text`,
      [account.id, amount.toString(), input.occurredAt]
    );
    const posted = await this.session.query(
      `update public.wallet_transactions
       set status = 'posted', posted_at = $2
       where id = $1 and status = 'pending'`,
      [transactionId, input.occurredAt]
    );

    if (posted.rowCount !== 1) {
      throw new Error(`Failed to post phone bonus transaction: ${transactionId}`);
    }

    const available = updated.rows[0]?.cached_available_kopecks;
    if (!available) {
      throw new Error(`Wallet account disappeared while crediting bonus: ${account.id}`);
    }

    return {
      credited: true,
      reason: "credited",
      amount,
      availableBalance: BigInt(available),
      currency: campaign.currency
    };
  }

  private async findCampaign(occurredAt: Date): Promise<CampaignRow | undefined> {
    const result = await this.session.query<CampaignRow>(
      `select
         id,
         amount_kopecks::text,
         currency,
         case
           when credit_expires_after is null then null
           else $1::timestamptz + credit_expires_after
         end as credit_expires_at
       from public.wallet_credit_campaigns
       where transaction_type = 'PHONE_BONUS'
         and is_active = true
         and (starts_at is null or starts_at <= $1)
         and (ends_at is null or ends_at > $1)
       limit 1`,
      [occurredAt]
    );

    return result.rows[0];
  }

  private async findExistingBonus(
    userId: string,
    idempotencyKey: string
  ): Promise<ExistingBonusRow | undefined> {
    const result = await this.session.query<ExistingBonusRow>(
      `select
         wt.status,
         we.amount_kopecks::text,
         wa.cached_available_kopecks::text,
         wa.currency
       from public.wallet_accounts wa
       join public.wallet_transactions wt on wt.wallet_account_id = wa.id
       left join public.wallet_entries we
         on we.wallet_transaction_id = wt.id and we.direction = 'credit'
       where wa.user_id = $1
         and (wt.idempotency_key = $2 or wt.transaction_type = 'PHONE_BONUS')
       order by wt.created_at
       limit 1`,
      [userId, idempotencyKey]
    );

    return result.rows[0];
  }

  private async findOrCreateAccount(
    userId: string,
    currency: string,
    occurredAt: Date
  ): Promise<WalletAccountRow> {
    const existing = await this.session.query<WalletAccountRow>(
      `select id, status, cached_available_kopecks::text
       from public.wallet_accounts
       where user_id = $1 and currency = $2
       for update`,
      [userId, currency]
    );
    const account = existing.rows[0];
    if (account) {
      return account;
    }

    const created = await this.session.query<WalletAccountRow>(
      `insert into public.wallet_accounts (
         id, user_id, currency, created_at, updated_at
       ) values ($1, $2, $3, $4, $4)
       returning id, status, cached_available_kopecks::text`,
      [this.idGenerator.newId(), userId, currency, occurredAt]
    );
    const newAccount = created.rows[0];

    if (!newAccount) {
      throw new Error(`Failed to create wallet account for user: ${userId}`);
    }

    return newAccount;
  }

  private async inactiveCampaignResult(userId: string): Promise<CreditPhoneBonusResult> {
    const account = await this.session.query<{ readonly cached_available_kopecks: string }>(
      `select cached_available_kopecks::text
       from public.wallet_accounts
       where user_id = $1 and currency = 'RUB'`,
      [userId]
    );

    return {
      credited: false,
      reason: "campaign_inactive",
      amount: 0n,
      availableBalance: BigInt(account.rows[0]?.cached_available_kopecks ?? "0"),
      currency: "RUB"
    };
  }
}

export function createPhonePersistence(pool: SqlConnectionPool, idGenerator: IdGenerator) {
  const session = new TransactionSession();

  return {
    telegramUserResolver: new PostgresTelegramUserResolver(session),
    phoneRepository: new PostgresPhoneVerificationRepository(session, idGenerator),
    phoneBonusRepository: new PostgresPhoneBonusRepository(session, idGenerator),
    idempotencyRepository: new PostgresIdempotencyRepository(session),
    outboxWriter: new PostgresOutboxWriter(session),
    unitOfWork: new PostgresUnitOfWork(pool, session)
  } as const;
}
