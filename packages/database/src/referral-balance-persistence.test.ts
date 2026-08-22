import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createReferralBalancePersistence } from "./referral-balance-persistence.js";
import type { SqlConnection, SqlConnectionPool, SqlQueryResult } from "./postgres.js";

describe("PostgreSQL referral balance persistence", () => {
  it("returns null when the Telegram user has never opened the bot", async () => {
    const connection = new FakeConnection(() => empty());
    const persistence = createReferralBalancePersistence(new FakePool(connection));

    const result = await persistence.referralBalanceRepository.getBalance({ channel: "telegram", externalUserId: "999" });

    assert.equal(result, null);
    assert.equal(connection.released, true);
  });

  it("reports available balance and qualifying referral count, defaulting to zero balance with no wallet account", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.messenger_identities")) {
        return rows([{ user_id: "user-1" }]);
      }
      if (text.includes("from public.wallet_accounts")) {
        return empty();
      }
      if (text.includes("from public.referral_attributions")) {
        return rows([{ count: "12" }]);
      }
      return empty();
    });
    const persistence = createReferralBalancePersistence(new FakePool(connection));

    const result = await persistence.referralBalanceRepository.getBalance({ channel: "telegram", externalUserId: "123456789" });

    assert.deepEqual(result, {
      userId: "user-1",
      availableKopecks: "0",
      currency: "RUB",
      qualifyingReferrals: 12
    });
  });

  it("reports the actual wallet balance when an account exists", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.messenger_identities")) {
        return rows([{ user_id: "user-1" }]);
      }
      if (text.includes("from public.wallet_accounts")) {
        return rows([{ cached_available_kopecks: "50000", currency: "RUB" }]);
      }
      if (text.includes("from public.referral_attributions")) {
        return rows([{ count: "3" }]);
      }
      return empty();
    });
    const persistence = createReferralBalancePersistence(new FakePool(connection));

    const result = await persistence.referralBalanceRepository.getBalance({ channel: "telegram", externalUserId: "123456789" });

    assert.deepEqual(result, {
      userId: "user-1",
      availableKopecks: "50000",
      currency: "RUB",
      qualifyingReferrals: 3
    });
  });

  it("reads active tier configuration ordered by tier number", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.referral_tier_configs")) {
        return rows([
          { tier_number: 1, min_referrals: 0, max_referrals: 9, percent_basis_points: 700 },
          { tier_number: 2, min_referrals: 10, max_referrals: null, percent_basis_points: 1200 }
        ]);
      }
      return empty();
    });
    const persistence = createReferralBalancePersistence(new FakePool(connection));

    const tiers = await persistence.referralBalanceRepository.getActiveTiers();

    assert.deepEqual(tiers, [
      { tierNumber: 1, minReferrals: 0, maxReferrals: 9, percentBasisPoints: 700 },
      { tierNumber: 2, minReferrals: 10, maxReferrals: null, percentBasisPoints: 1200 }
    ]);
  });
});

class FakePool implements SqlConnectionPool {
  constructor(private readonly connection: SqlConnection) {}

  async connect(): Promise<SqlConnection> {
    return this.connection;
  }
}

class FakeConnection implements SqlConnection {
  released = false;

  constructor(
    private readonly respond: (text: string, values: readonly unknown[]) => SqlQueryResult<unknown>
  ) {}

  async query<TRow>(text: string, values: readonly unknown[] = []): Promise<SqlQueryResult<TRow>> {
    return this.respond(text, values) as SqlQueryResult<TRow>;
  }

  release(): void {
    this.released = true;
  }
}

function empty(): SqlQueryResult<unknown> {
  return { rows: [], rowCount: 0 };
}

function rows<TRow>(resultRows: readonly TRow[]): SqlQueryResult<TRow> {
  return { rows: resultRows, rowCount: resultRows.length } as SqlQueryResult<unknown> as SqlQueryResult<TRow>;
}
