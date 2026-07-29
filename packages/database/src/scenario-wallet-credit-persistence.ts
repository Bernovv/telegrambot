import type {
  ExistingScenarioWalletCredit,
  IdGenerator,
  PersistScenarioWalletCreditInput,
  ScenarioWalletCreditRepository
} from "@ticket-platform/application";
import type { TransactionSession } from "./postgres.js";

interface ExistingCreditRow {
  readonly id: string;
  readonly transaction_type: string;
  readonly status: string;
  readonly request_hash: string | null;
  readonly user_id: string;
  readonly amount_kopecks: string | null;
  readonly currency: string;
  readonly cached_available_kopecks: string;
}

interface WalletAccountRow {
  readonly id: string;
  readonly status: string;
}

export class PostgresScenarioWalletCreditRepository
implements ScenarioWalletCreditRepository {
  constructor(
    private readonly session: TransactionSession,
    private readonly idGenerator: IdGenerator
  ) {}

  async lockIdempotencyKey(idempotencyKey: string): Promise<void> {
    await this.session.query(
      "select pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`scenario-wallet-credit:${idempotencyKey}`]
    );
  }

  async findByIdempotencyKey(
    idempotencyKey: string
  ): Promise<ExistingScenarioWalletCredit | null> {
    const result = await this.session.query<ExistingCreditRow>(
      `select
         wallet_transaction.id,
         wallet_transaction.transaction_type,
         wallet_transaction.status,
         wallet_transaction.metadata ->> 'requestHash' as request_hash,
         account.user_id,
         entry.amount_kopecks::text,
         account.currency,
         account.cached_available_kopecks::text
       from public.wallet_transactions wallet_transaction
       join public.wallet_accounts account
         on account.id = wallet_transaction.wallet_account_id
       left join public.wallet_entries entry
         on entry.wallet_transaction_id = wallet_transaction.id
        and entry.direction = 'credit'
       where wallet_transaction.idempotency_key = $1
       limit 1`,
      [idempotencyKey]
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return {
      transactionId: row.id,
      transactionType: row.transaction_type,
      status: row.status,
      requestHash: row.request_hash,
      userId: row.user_id,
      amount: BigInt(row.amount_kopecks ?? "0"),
      currency: row.currency,
      availableBalance: BigInt(row.cached_available_kopecks)
    };
  }

  async persistCredit(input: PersistScenarioWalletCreditInput): Promise<{
    readonly availableBalance: bigint;
  }> {
    await this.session.query(
      "select pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`wallet-user:${input.command.userId}`]
    );
    const account = await this.findOrCreateAccount(input);
    if (account.status !== "active") {
      throw new Error(`Wallet account is not active: ${account.id}`);
    }

    await this.session.query(
      `insert into public.wallet_transactions (
         id, wallet_account_id, transaction_type, status, idempotency_key,
         reference_type, reference_id, actor_type, reason, metadata, created_at
       ) values (
         $1, $2, 'SCENARIO_CREDIT', 'pending', $3,
         'scenario_session', $4, 'system', $5, $6::jsonb, $7
       )`,
      [
        input.transactionId,
        account.id,
        input.command.idempotencyKey,
        input.command.scenarioSessionId,
        input.command.reason.trim(),
        JSON.stringify({
          schemaVersion: 1,
          requestHash: input.requestHash,
          eventId: input.command.eventId,
          scenarioVersionId: input.command.scenarioVersionId,
          nodeId: input.command.nodeId
        }),
        input.command.creditedAt
      ]
    );
    await this.session.query(
      `insert into public.wallet_entries (
         id, wallet_account_id, wallet_transaction_id, direction,
         amount_kopecks, bucket, effective_at, created_at
       ) values ($1, $2, $3, 'credit', $4, 'bonus', $5, $5)`,
      [
        input.entryId,
        account.id,
        input.transactionId,
        input.amount.toString(),
        input.command.creditedAt
      ]
    );
    const updated = await this.session.query<{
      readonly cached_available_kopecks: string;
    }>(
      `update public.wallet_accounts
       set cached_available_kopecks = cached_available_kopecks + $2,
           balance_version = balance_version + 1,
           updated_at = $3
       where id = $1
         and status = 'active'
       returning cached_available_kopecks::text`,
      [account.id, input.amount.toString(), input.command.creditedAt]
    );
    const posted = await this.session.query(
      `update public.wallet_transactions
       set status = 'posted', posted_at = $2
       where id = $1 and status = 'pending'`,
      [input.transactionId, input.command.creditedAt]
    );
    const availableBalance = updated.rows[0]?.cached_available_kopecks;
    if (!availableBalance || posted.rowCount !== 1) {
      throw new Error(
        `Failed to post scenario wallet credit: ${input.transactionId}`
      );
    }
    return { availableBalance: BigInt(availableBalance) };
  }

  private async findOrCreateAccount(
    input: PersistScenarioWalletCreditInput
  ): Promise<WalletAccountRow> {
    const existing = await this.session.query<WalletAccountRow>(
      `select id, status
       from public.wallet_accounts
       where user_id = $1 and currency = $2
       for update`,
      [input.command.userId, input.command.currency]
    );
    if (existing.rows[0]) {
      return existing.rows[0];
    }
    const created = await this.session.query<WalletAccountRow>(
      `insert into public.wallet_accounts (
         id, user_id, currency, created_at, updated_at
       ) values ($1, $2, $3, $4, $4)
       returning id, status`,
      [
        this.idGenerator.newId(),
        input.command.userId,
        input.command.currency,
        input.command.creditedAt
      ]
    );
    const account = created.rows[0];
    if (!account) {
      throw new Error(
        `Failed to create wallet account for user: ${input.command.userId}`
      );
    }
    return account;
  }
}
