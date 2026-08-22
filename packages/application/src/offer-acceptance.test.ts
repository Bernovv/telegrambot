import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import type { DomainEvent } from "@ticket-platform/domain";
import {
  AcceptTelegramOfferService,
  type OfferAcceptanceOrder,
  type OfferAcceptanceRepository,
  type RecordTelegramOfferAcceptanceInput
} from "./offer-acceptance.js";

const token = "a".repeat(43);
const acceptedAt = new Date("2026-07-24T12:05:00.000Z");

describe("AcceptTelegramOfferService", () => {
  it("records immutable Telegram evidence and emits OfferAccepted once", async () => {
    const fixture = createFixture();

    const result = await fixture.service.execute(command());

    assert.equal(result.accepted, true);
    if (result.accepted) {
      assert.equal(result.newlyAccepted, true);
      assert.equal(result.externalDueKopecks, "239000");
    }
    assert.equal(
      fixture.lookedUpHashes[0],
      createHash("sha256").update(token).digest("hex")
    );
    assert.equal(fixture.records[0]?.callbackQueryId, "callback-1");
    assert.equal(fixture.records[0]?.order.offerDisplayTextSnapshot, "Я принимаю оферту");
    assert.deepEqual(fixture.events.map((event) => event.eventType), ["OfferAccepted"]);
  });

  it("returns an accepted duplicate without another write or outbox event", async () => {
    const fixture = createFixture({
      order: {
        ...order,
        status: "awaiting_payment",
        offerAcceptedAt: new Date("2026-07-24T12:04:00.000Z")
      }
    });

    const result = await fixture.service.execute(command());

    assert.equal(result.accepted, true);
    if (result.accepted) {
      assert.equal(result.newlyAccepted, false);
    }
    assert.equal(fixture.records.length, 0);
    assert.equal(fixture.events.length, 0);
  });

  it("hides foreign or malformed tokens and rejects expired orders", async () => {
    const hidden = createFixture({ order: null });
    const expired = createFixture({
      order: { ...order, expiresAt: acceptedAt }
    });

    assert.deepEqual(
      await hidden.service.execute(command()),
      { accepted: false, reason: "order_not_found" }
    );
    assert.deepEqual(
      await hidden.service.execute({ ...command(), publicOrderToken: "invalid" }),
      { accepted: false, reason: "order_not_found" }
    );
    assert.deepEqual(
      await expired.service.execute(command()),
      { accepted: false, reason: "order_expired" }
    );
  });
});

function createFixture(options: { readonly order?: OfferAcceptanceOrder | null } = {}) {
  const selectedOrder = options.order === undefined ? order : options.order;
  const lookedUpHashes: string[] = [];
  const records: RecordTelegramOfferAcceptanceInput[] = [];
  const events: DomainEvent[] = [];
  let id = 0;

  const repository: OfferAcceptanceRepository = {
    async lockForTelegramAcceptance(publicTokenHash) {
      lookedUpHashes.push(publicTokenHash);
      return selectedOrder;
    },
    async recordTelegramAcceptance(input) {
      records.push(input);
    }
  };

  return {
    service: new AcceptTelegramOfferService(
      repository,
      { async append(event) { events.push(event); } },
      { async transact(work) { return work(); } },
      { newId() { id += 1; return `id-${id}`; } }
    ),
    lookedUpHashes,
    records,
    events
  };
}

function command() {
  return {
    channel: "telegram" as const, publicOrderToken: token,
    senderExternalUserId: "777",
    updateId: "1003",
    callbackQueryId: "callback-1",
    messageId: "42",
    acceptedAt
  };
}

const order: OfferAcceptanceOrder = {
  id: "order-1",
  number: "BP-000001",
  userId: "user-1",
  messengerIdentityId: "identity-1",
  eventId: "event-1",
  status: "awaiting_offer",
  currency: "RUB",
  total: 249_000n,
  walletApplied: 10_000n,
  externalDue: 239_000n,
  offerVersionId: "offer-version-1",
  offerDisplayTextSnapshot: "Я принимаю оферту",
  offerAcceptedAt: null,
  expiresAt: new Date("2026-07-24T12:30:00.000Z")
};
