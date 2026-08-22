import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DomainEvent } from "@ticket-platform/domain";
import type {
  IdGenerator,
  IdempotencyRepository,
  OutboxWriter,
  UnitOfWork
} from "./identity.js";
import {
  HandleTelegramContactService,
  type PhoneBonusRepository,
  type PhoneNormalizer,
  type PhoneVerificationRepository,
  type TelegramUserResolver
} from "./phone.js";

describe("HandleTelegramContactService", () => {
  it("rejects a third-party contact without side effects", async () => {
    const fixture = createFixture();

    const result = await fixture.service.execute({
      channel: "telegram" as const, updateId: "2001",
      senderExternalUserId: "777",
      contact: { externalUserId: "888", phoneNumber: "+79990000000" },
      receivedAt: new Date("2026-07-22T08:00:00.000Z")
    });

    assert.deepEqual(result, { accepted: false, reason: "third_party_contact" });
    assert.equal(fixture.transactions, 0);
    assert.equal(fixture.events.length, 0);
  });

  it("verifies an owned contact and credits the configured bonus once", async () => {
    const fixture = createFixture();

    const result = await fixture.service.execute({
      channel: "telegram" as const, updateId: "2001",
      senderExternalUserId: "777",
      contact: { externalUserId: "777", phoneNumber: "8 999 000-00-00" },
      receivedAt: new Date("2026-07-22T08:00:00.000Z")
    });

    assert.deepEqual(result, {
      accepted: true,
      phoneNewlyVerified: true,
      bonusCredited: true,
      bonusReason: "credited",
      bonusAmountKopecks: "10000",
      availableBalanceKopecks: "10000"
    });
    assert.equal(fixture.verifiedPhones[0], "+79990000000");
    assert.equal(fixture.bonusKeys[0], "phone_bonus:user-1");
    assert.deepEqual(fixture.events.map((event) => event.eventType), [
      "PhoneVerified",
      "PhoneBonusCredited"
    ]);
    assert.deepEqual(fixture.processedKeys, ["telegram_update:2001"]);
  });

  it("does not repeat outbox effects for a duplicate Telegram update", async () => {
    const fixture = createFixture({
      shouldProcess: false,
      newlyVerified: false,
      bonusCredited: false,
      bonusReason: "already_credited"
    });

    const result = await fixture.service.execute({
      channel: "telegram" as const, updateId: "2001",
      senderExternalUserId: "777",
      contact: { externalUserId: "777", phoneNumber: "+79990000000" },
      receivedAt: new Date("2026-07-22T08:00:00.000Z")
    });

    assert.equal(result.accepted, true);
    if (result.accepted) {
      assert.equal(result.bonusReason, "already_credited");
      assert.equal(result.phoneNewlyVerified, false);
    }
    assert.equal(fixture.events.length, 0);
    assert.equal(fixture.processedKeys.length, 0);
  });
});

function createFixture(options: {
  readonly shouldProcess?: boolean;
  readonly newlyVerified?: boolean;
  readonly bonusCredited?: boolean;
  readonly bonusReason?: "credited" | "already_credited" | "campaign_inactive";
} = {}) {
  const events: DomainEvent[] = [];
  const verifiedPhones: string[] = [];
  const bonusKeys: string[] = [];
  const processedKeys: string[] = [];
  let transactions = 0;
  let idSequence = 0;

  const phoneNormalizer: PhoneNormalizer = {
    normalize() {
      return "+79990000000";
    }
  };
  const telegramUserResolver: TelegramUserResolver = {
    async resolveUserId() {
      return "user-1";
    }
  };
  const phoneRepository: PhoneVerificationRepository = {
    async verifyPhone(input) {
      verifiedPhones.push(input.phoneE164);
      return { newlyVerified: options.newlyVerified ?? true };
    }
  };
  const phoneBonusRepository: PhoneBonusRepository = {
    async creditPhoneBonus(input) {
      bonusKeys.push(input.idempotencyKey);
      return {
        credited: options.bonusCredited ?? true,
        reason: options.bonusReason ?? "credited",
        amount: 10_000n,
        availableBalance: 10_000n,
        currency: "RUB"
      };
    }
  };
  const idempotencyRepository: IdempotencyRepository = {
    async tryBegin() {
      return options.shouldProcess ?? true;
    },
    async markProcessed(key) {
      processedKeys.push(key);
    }
  };
  const outboxWriter: OutboxWriter = {
    async append(event) {
      events.push(event);
    }
  };
  const unitOfWork: UnitOfWork = {
    async transact(work) {
      transactions += 1;
      return work();
    }
  };
  const idGenerator: IdGenerator = {
    newId() {
      idSequence += 1;
      return `event-${idSequence}`;
    }
  };

  return {
    service: new HandleTelegramContactService(
      phoneNormalizer,
      telegramUserResolver,
      phoneRepository,
      phoneBonusRepository,
      idempotencyRepository,
      outboxWriter,
      unitOfWork,
      idGenerator
    ),
    events,
    verifiedPhones,
    bonusKeys,
    processedKeys,
    get transactions() {
      return transactions;
    }
  };
}
