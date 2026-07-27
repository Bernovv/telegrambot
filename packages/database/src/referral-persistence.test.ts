import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { IdGenerator } from "@ticket-platform/application";
import { createReferralCommissionPersistence } from "./referral-persistence.js";
import {
  type SqlConnection,
  type SqlConnectionPool,
  type SqlQueryResult
} from "./postgres.js";

interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

const confirmedAt = new Date("2026-07-27T10:00:00.000Z");

describe("PostgreSQL referral commission persistence", () => {
  it("does nothing when the buyer has no partner-code touchpoint", async () => {
    const connection = new FakeConnection([
      { match: "from public.referral_attributions where referred_user_id", responses: [empty()] },
      { match: "from public.user_touchpoints", responses: [empty()] }
    ]);
    const persistence = createReferralCommissionPersistence(new FakePool(connection), sequenceIdGenerator([]));

    const result = await persistence.unitOfWork.transact(() =>
      persistence.referralCommissionRepository.settleForOrder({
        orderId: "order-1",
        buyerUserId: "buyer-1",
        totalKopecks: 199_000n,
        currency: "RUB",
        confirmedAt
      })
    );

    assert.deepEqual(result, { settled: false });
    assert.equal(connection.queries.some((q) => q.text.includes("insert into public.wallet_transactions")), false);
  });

  it("resolves the referrer lazily from the buyer's partner-code touchpoint, credits tier-1 commission, and marks the referral qualified", async () => {
    const connection = new FakeConnection([
      {
        match: "from public.referral_attributions where referred_user_id",
        responses: [empty(), rows([{ referrer_user_id: "referrer-1", qualified_at: null }])]
      },
      {
        match: "from public.user_touchpoints",
        responses: [rows([{ partner_code: "555", channel: "telegram" }])]
      },
      {
        match: "from public.messenger_identities",
        responses: [rows([{ user_id: "referrer-1" }])]
      },
      { match: "insert into public.referral_attributions", responses: [affected()] },
      { match: "select pg_advisory_xact_lock", responses: [affected(), affected()] },
      {
        match: "count(*)::text as count",
        responses: [rows([{ count: "0" }])]
      },
      { match: "from public.referral_tier_configs", responses: [empty()] },
      {
        match: "select id, status from public.wallet_accounts",
        responses: [empty(), rows([{ id: "wallet-1", status: "active" }])]
      },
      { match: "insert into public.wallet_accounts", responses: [affected()] },
      { match: "insert into public.wallet_transactions", responses: [affected()] },
      { match: "insert into public.wallet_entries", responses: [affected()] },
      { match: "update public.wallet_accounts", responses: [affected()] },
      { match: "update public.wallet_transactions", responses: [affected()] },
      { match: "update public.referral_attributions", responses: [affected()] }
    ]);
    const idGenerator = sequenceIdGenerator([
      "attribution-id",
      "wallet-account-id",
      "wallet-transaction-id",
      "wallet-entry-id"
    ]);
    const persistence = createReferralCommissionPersistence(new FakePool(connection), idGenerator);

    const result = await persistence.unitOfWork.transact(() =>
      persistence.referralCommissionRepository.settleForOrder({
        orderId: "order-1",
        buyerUserId: "buyer-1",
        totalKopecks: 199_000n,
        currency: "RUB",
        confirmedAt
      })
    );

    assert.deepEqual(result, {
      settled: true,
      referrerUserId: "referrer-1",
      tierNumber: 1,
      percentBasisPoints: 700,
      commissionKopecks: 13_930n
    });

    const attributionInsert = findQuery(connection, "insert into public.referral_attributions");
    assert.deepEqual(attributionInsert.values, ["attribution-id", "buyer-1", "referrer-1", "555", confirmedAt]);

    const walletTransactionInsert = findQuery(connection, "insert into public.wallet_transactions");
    assert.equal(walletTransactionInsert.values[0], "wallet-transaction-id");
    assert.equal(walletTransactionInsert.values[1], "wallet-1");
    assert.equal(walletTransactionInsert.values[2], "referral-reward:order-1");
    assert.equal(walletTransactionInsert.values[3], "order-1");
    assert.deepEqual(JSON.parse(String(walletTransactionInsert.values[4])), {
      referredUserId: "buyer-1",
      tierNumber: 1,
      percentBasisPoints: 700
    });

    const walletEntryInsert = findQuery(connection, "insert into public.wallet_entries");
    assert.equal(walletEntryInsert.values[3], "13930");

    const qualifiedUpdate = findQuery(connection, "update public.referral_attributions");
    assert.deepEqual(qualifiedUpdate.values, ["buyer-1", confirmedAt]);

    assert.equal(connection.queries.at(-1)?.text, "commit");
    assert.equal(connection.released, true);
  });

  it("counts the referrer's other qualified referrals, excluding the current buyer, to pick a higher tier", async () => {
    const connection = new FakeConnection([
      {
        match: "from public.referral_attributions where referred_user_id",
        responses: [rows([{ referrer_user_id: "referrer-1", qualified_at: confirmedAt }])]
      },
      { match: "select pg_advisory_xact_lock", responses: [affected(), affected()] },
      { match: "count(*)::text as count", responses: [rows([{ count: "10" }])] },
      { match: "from public.referral_tier_configs", responses: [empty()] },
      {
        match: "select id, status from public.wallet_accounts",
        responses: [rows([{ id: "wallet-1", status: "active" }])]
      },
      { match: "insert into public.wallet_transactions", responses: [affected()] },
      { match: "insert into public.wallet_entries", responses: [affected()] },
      { match: "update public.wallet_accounts", responses: [affected()] },
      { match: "update public.wallet_transactions", responses: [affected()] }
    ]);
    const persistence = createReferralCommissionPersistence(
      new FakePool(connection),
      sequenceIdGenerator(["wallet-transaction-id", "wallet-entry-id"])
    );

    const result = await persistence.unitOfWork.transact(() =>
      persistence.referralCommissionRepository.settleForOrder({
        orderId: "order-2",
        buyerUserId: "buyer-1",
        totalKopecks: 100_000n,
        currency: "RUB",
        confirmedAt
      })
    );

    assert.deepEqual(result, {
      settled: true,
      referrerUserId: "referrer-1",
      tierNumber: 2,
      percentBasisPoints: 1000,
      commissionKopecks: 10_000n
    });
    // Already-qualified referral: no second write to referral_attributions.qualified_at.
    assert.equal(connection.queries.some((q) => q.text.includes("update public.referral_attributions")), false);
  });

  it("throws instead of crediting a blocked wallet account", async () => {
    const connection = new FakeConnection([
      {
        match: "from public.referral_attributions where referred_user_id",
        responses: [rows([{ referrer_user_id: "referrer-1", qualified_at: confirmedAt }])]
      },
      { match: "select pg_advisory_xact_lock", responses: [affected(), affected()] },
      { match: "count(*)::text as count", responses: [rows([{ count: "0" }])] },
      { match: "from public.referral_tier_configs", responses: [empty()] },
      {
        match: "select id, status from public.wallet_accounts",
        responses: [rows([{ id: "wallet-1", status: "blocked" }])]
      }
    ]);
    const persistence = createReferralCommissionPersistence(new FakePool(connection), sequenceIdGenerator([]));

    await assert.rejects(
      persistence.unitOfWork.transact(() =>
        persistence.referralCommissionRepository.settleForOrder({
          orderId: "order-3",
          buyerUserId: "buyer-1",
          totalKopecks: 100_000n,
          currency: "RUB",
          confirmedAt
        })
      ),
      /not active/
    );
  });
});

class FakePool implements SqlConnectionPool {
  constructor(private readonly connection: SqlConnection) {}

  async connect(): Promise<SqlConnection> {
    return this.connection;
  }
}

interface Stub {
  readonly match: string;
  readonly responses: SqlQueryResult<unknown>[];
}

class FakeConnection implements SqlConnection {
  readonly queries: RecordedQuery[] = [];
  released = false;
  private readonly callCounts = new Map<string, number>();

  constructor(private readonly stubs: readonly Stub[]) {}

  async query<TRow>(text: string, values: readonly unknown[] = []): Promise<SqlQueryResult<TRow>> {
    this.queries.push({ text, values });

    if (text === "begin" || text === "commit" || text === "rollback") {
      return { rows: [], rowCount: 0 } as SqlQueryResult<TRow>;
    }

    const stub = this.stubs.find((candidate) => text.includes(candidate.match));
    if (!stub) {
      return { rows: [], rowCount: 0 } as SqlQueryResult<TRow>;
    }

    const count = this.callCounts.get(stub.match) ?? 0;
    this.callCounts.set(stub.match, count + 1);
    const response = stub.responses[Math.min(count, stub.responses.length - 1)];
    return response as SqlQueryResult<TRow>;
  }

  release(): void {
    this.released = true;
  }
}

function empty(): SqlQueryResult<unknown> {
  return { rows: [], rowCount: 0 };
}

function affected(): SqlQueryResult<unknown> {
  return { rows: [], rowCount: 1 };
}

function rows<TRow>(resultRows: readonly TRow[]): SqlQueryResult<TRow> {
  return { rows: resultRows, rowCount: resultRows.length } as SqlQueryResult<unknown> as SqlQueryResult<TRow>;
}

function findQuery(connection: FakeConnection, fragment: string): RecordedQuery {
  const query = connection.queries.find((candidate) => candidate.text.includes(fragment));
  assert.ok(query, `Expected query containing: ${fragment}`);
  return query;
}

function sequenceIdGenerator(ids: readonly string[]): IdGenerator {
  let index = 0;

  return {
    newId() {
      const id = ids[index];
      index += 1;

      if (!id) {
        throw new Error("No generated ID left in test fixture");
      }

      return id;
    }
  };
}
