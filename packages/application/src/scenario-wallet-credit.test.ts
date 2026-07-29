import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DomainEvent } from "@ticket-platform/domain";
import {
  CreditScenarioWalletService,
  type ExistingScenarioWalletCredit,
  type PersistScenarioWalletCreditInput,
  type ScenarioWalletCreditRepository
} from "./scenario-wallet-credit.js";

describe("CreditScenarioWalletService", () => {
  it("posts one bounded scenario credit and emits one event", async () => {
    const fixture = createFixture();

    const result = await fixture.service.execute(command());

    assert.deepEqual(result, {
      transactionId: "id-1",
      amountKopecks: "10000",
      currency: "RUB",
      availableBalanceKopecks: "35000",
      credited: true
    });
    assert.equal(fixture.persisted.length, 1);
    assert.equal(fixture.persisted[0]?.amount, 10_000n);
    assert.equal(fixture.events[0]?.eventType, "ScenarioWalletCredited");
  });

  it("returns an exact posted duplicate without another ledger write", async () => {
    const first = createFixture();
    const created = await first.service.execute(command());
    const persisted = first.persisted[0];
    assert.ok(persisted);
    const duplicate = createFixture({
      existing: {
        transactionId: created.transactionId,
        transactionType: "SCENARIO_CREDIT",
        status: "posted",
        requestHash: persisted.requestHash,
        userId,
        amount: persisted.amount,
        currency: "RUB",
        availableBalance: 35_000n
      }
    });

    const result = await duplicate.service.execute({
      ...command(),
      scenarioSessionId: "00000000-0000-4000-8000-000000000113",
      scenarioVersionId: "00000000-0000-4000-8000-000000000114",
      nodeId: "00000000-0000-4000-8000-000000000115",
      creditedAt: new Date("2026-07-29T15:00:00.000Z")
    });

    assert.equal(result.credited, false);
    assert.equal(result.availableBalanceKopecks, "35000");
    assert.equal(duplicate.persisted.length, 0);
    assert.equal(duplicate.events.length, 0);
  });

  it("rejects key reuse and unsafe financial payloads", async () => {
    const foreign = createFixture({
      existing: {
        transactionId: "existing",
        transactionType: "PHONE_BONUS",
        status: "posted",
        requestHash: null,
        userId,
        amount: 10_000n,
        currency: "RUB",
        availableBalance: 10_000n
      }
    });

    await assert.rejects(
      foreign.service.execute(command()),
      /already used for another operation/
    );
    const first = createFixture();
    const created = await first.service.execute(command());
    const persisted = first.persisted[0];
    assert.ok(persisted);
    const changedCampaign = createFixture({
      existing: {
        transactionId: created.transactionId,
        transactionType: "SCENARIO_CREDIT",
        status: "posted",
        requestHash: persisted.requestHash,
        userId,
        amount: persisted.amount,
        currency: "RUB",
        availableBalance: 35_000n
      }
    });
    await assert.rejects(
      changedCampaign.service.execute({
        ...command(),
        amountKopecks: "20000"
      }),
      /already used for another operation/
    );
    assert.throws(
      () => createFixture().service.execute({
        ...command(),
        amountKopecks: "1000001"
      }),
      /exceeds the per-node limit/
    );
    assert.throws(
      () => createFixture().service.execute({
        ...command(),
        reason: " "
      }),
      /reason is invalid/
    );
  });
});

function createFixture(options: {
  readonly existing?: ExistingScenarioWalletCredit | null;
} = {}) {
  const persisted: PersistScenarioWalletCreditInput[] = [];
  const events: DomainEvent[] = [];
  let id = 0;
  const repository: ScenarioWalletCreditRepository = {
    async lockIdempotencyKey() {},
    async findByIdempotencyKey() {
      return options.existing ?? null;
    },
    async persistCredit(input) {
      persisted.push(input);
      return { availableBalance: 35_000n };
    }
  };
  return {
    service: new CreditScenarioWalletService(
      repository,
      { async append(event) { events.push(event); } },
      { async transact(work) { return work(); } },
      { newId() { id += 1; return `id-${id}`; } }
    ),
    persisted,
    events
  };
}

function command() {
  return {
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
  };
}

const userId = "00000000-0000-4000-8000-000000000101";
const eventId = "00000000-0000-4000-8000-000000000102";
const scenarioSessionId = "00000000-0000-4000-8000-000000000103";
const scenarioVersionId = "00000000-0000-4000-8000-000000000104";
const nodeId = "00000000-0000-4000-8000-000000000105";
