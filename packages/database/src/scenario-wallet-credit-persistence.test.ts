import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PersistScenarioWalletCreditInput } from "@ticket-platform/application";
import {
  PostgresUnitOfWork,
  TransactionSession,
  type SqlConnection,
  type SqlConnectionPool,
  type SqlQueryResult
} from "./postgres.js";
import { PostgresScenarioWalletCreditRepository } from "./scenario-wallet-credit-persistence.js";

describe("PostgresScenarioWalletCreditRepository", () => {
  it("posts an append-only bonus entry and updates the cached balance", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.wallet_accounts") && text.includes("for update")) {
        return rows([]);
      }
      if (text.includes("insert into public.wallet_accounts")) {
        return rows([{ id: accountId, status: "active" }]);
      }
      if (text.includes("returning cached_available_kopecks")) {
        return rows([{ cached_available_kopecks: "35000" }]);
      }
      return affected();
    });
    const session = new TransactionSession();
    const repository = new PostgresScenarioWalletCreditRepository(
      session,
      { newId() { return accountId; } }
    );

    const result = await new PostgresUnitOfWork(
      new FakePool(connection),
      session
    ).transact(() => repository.persistCredit(input()));

    assert.equal(result.availableBalance, 35_000n);
    assert.equal(
      findQuery(connection, "insert into public.wallet_transactions").values[2],
      input().command.idempotencyKey
    );
    assert.equal(
      findQuery(connection, "insert into public.wallet_entries").values[3],
      "10000"
    );
    assert.equal(
      findQuery(connection, "insert into public.wallet_accounts").values[0],
      accountId
    );
    assert.equal(connection.queries.at(-1)?.text, "commit");
  });

  it("loads exact idempotency evidence independently of transaction type", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.wallet_transactions wallet_transaction")) {
        return rows([{
          id: transactionId,
          transaction_type: "SCENARIO_CREDIT",
          status: "posted",
          request_hash: "a".repeat(64),
          user_id: userId,
          amount_kopecks: "10000",
          currency: "RUB",
          cached_available_kopecks: "35000"
        }]);
      }
      return affected();
    });
    const session = new TransactionSession();
    const repository = new PostgresScenarioWalletCreditRepository(
      session,
      { newId() { return accountId; } }
    );

    const result = await new PostgresUnitOfWork(
      new FakePool(connection),
      session
    ).transact(() => repository.findByIdempotencyKey(input().command.idempotencyKey));

    assert.equal(result?.transactionId, transactionId);
    assert.equal(result?.amount, 10_000n);
    assert.equal(result?.availableBalance, 35_000n);
  });
});

class FakePool implements SqlConnectionPool {
  constructor(private readonly connection: SqlConnection) {}

  async connect(): Promise<SqlConnection> {
    return this.connection;
  }
}

class FakeConnection implements SqlConnection {
  readonly queries: RecordedQuery[] = [];

  constructor(
    private readonly respond: (
      text: string,
      values: readonly unknown[]
    ) => SqlQueryResult<unknown>
  ) {}

  async query<TRow>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<SqlQueryResult<TRow>> {
    this.queries.push({ text, values });
    return this.respond(text, values) as SqlQueryResult<TRow>;
  }

  release(): void {}
}

interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

function affected(): SqlQueryResult<never> {
  return { rows: [], rowCount: 1 };
}

function rows<TRow>(resultRows: readonly TRow[]): SqlQueryResult<TRow> {
  return { rows: resultRows, rowCount: resultRows.length };
}

function findQuery(connection: FakeConnection, fragment: string): RecordedQuery {
  const query = connection.queries.find((candidate) =>
    candidate.text.includes(fragment)
  );
  assert.ok(query, `Expected query containing: ${fragment}`);
  return query;
}

function input(): PersistScenarioWalletCreditInput {
  return {
    transactionId,
    entryId,
    requestHash: "a".repeat(64),
    amount: 10_000n,
    command: {
      userId,
      eventId,
      scenarioSessionId,
      scenarioVersionId,
      nodeId,
      amountKopecks: "10000",
      currency: "RUB",
      idempotencyKey: `scenario_credit:welcome:${userId}:${eventId}`,
      reason: "Приветственный бонус сценария",
      creditedAt: new Date("2026-07-28T15:00:00.000Z")
    }
  };
}

const accountId = "00000000-0000-4000-8000-000000000100";
const userId = "00000000-0000-4000-8000-000000000101";
const eventId = "00000000-0000-4000-8000-000000000102";
const scenarioSessionId = "00000000-0000-4000-8000-000000000103";
const scenarioVersionId = "00000000-0000-4000-8000-000000000104";
const nodeId = "00000000-0000-4000-8000-000000000105";
const transactionId = "00000000-0000-4000-8000-000000000106";
const entryId = "00000000-0000-4000-8000-000000000107";
