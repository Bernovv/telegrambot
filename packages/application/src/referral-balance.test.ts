import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GetTelegramReferralBalanceService,
  type ReferralBalanceRepository,
  type ReferralBalanceSnapshot
} from "./referral-balance.js";

describe("GetTelegramReferralBalanceService", () => {
  it("rejects an invalid external user ID without querying persistence", async () => {
    let queried = false;
    const service = new GetTelegramReferralBalanceService({
      async getBalance() {
        queried = true;
        return null;
      },
      async getActiveTiers() {
        return [];
      }
    });

    const result = await service.execute({ channel: "telegram" as const, externalUserId: "not-a-number" });

    assert.deepEqual(result, { identityFound: false });
    assert.equal(queried, false);
  });

  it("reports no identity when the Telegram user has never opened the bot", async () => {
    const service = new GetTelegramReferralBalanceService({
      async getBalance() {
        return null;
      },
      async getActiveTiers() {
        return [];
      }
    });

    const result = await service.execute({ channel: "telegram" as const, externalUserId: "123456789" });
    assert.deepEqual(result, { identityFound: false });
  });

  it("resolves the tier from the qualifying referral count using the default tiers when none are configured", async () => {
    const snapshot: ReferralBalanceSnapshot = {
      userId: "user-1",
      availableKopecks: "50000",
      currency: "RUB",
      qualifyingReferrals: 12
    };
    const repository: ReferralBalanceRepository = {
      async getBalance() {
        return snapshot;
      },
      async getActiveTiers() {
        return [];
      }
    };
    const service = new GetTelegramReferralBalanceService(repository);

    const result = await service.execute({ channel: "telegram" as const, externalUserId: "123456789" });

    assert.deepEqual(result, {
      identityFound: true,
      availableKopecks: "50000",
      currency: "RUB",
      qualifyingReferrals: 12,
      tierNumber: 2,
      percentBasisPoints: 1000,
      referralsToNextTier: 18
    });
  });

  it("uses admin-configured tiers instead of the defaults when they are present", async () => {
    const repository: ReferralBalanceRepository = {
      async getBalance() {
        return {
          userId: "user-1",
          availableKopecks: "0",
          currency: "RUB",
          qualifyingReferrals: 1
        };
      },
      async getActiveTiers() {
        return [{ tierNumber: 1, minReferrals: 0, maxReferrals: null, percentBasisPoints: 500 }];
      }
    };
    const service = new GetTelegramReferralBalanceService(repository);

    const result = await service.execute({ channel: "telegram" as const, externalUserId: "123456789" });

    assert.deepEqual(result, {
      identityFound: true,
      availableKopecks: "0",
      currency: "RUB",
      qualifyingReferrals: 1,
      tierNumber: 1,
      percentBasisPoints: 500,
      referralsToNextTier: null
    });
  });
});
