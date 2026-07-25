import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DomainEvent } from "@ticket-platform/domain";
import {
  HandleTelegramStartService,
  type IdentityRepository,
  type IdGenerator,
  type IdempotencyRepository,
  type OutboxWriter,
  type RecordTouchpointInput,
  type UnitOfWork,
  type UpsertTelegramIdentityInput,
  type UpsertTelegramIdentityResult
} from "./identity.js";

describe("HandleTelegramStartService", () => {
  it("upserts identity, records attribution, emits UserRegistered, and requires phone", async () => {
    const fixture = createFixture({
      isNewUser: true,
      phoneStatus: "unknown",
      alreadyProcessed: false
    });

    const result = await fixture.service.execute({
      updateId: "1001",
      receivedAt: new Date("2026-07-21T12:00:00.000Z"),
      startPayload: "event_business_picnic__partner_partner42",
      user: {
        externalUserId: "777",
        username: "@Owner",
        firstName: "Oleg",
        lastName: null,
        languageCode: "ru"
      }
    });

    assert.equal(result.userId, "user-1");
    assert.equal(result.messengerIdentityId, "identity-1");
    assert.equal(result.isNewUser, true);
    assert.equal(result.phoneRequired, true);
    assert.equal(result.selectedEventSlug, "business_picnic");
    assert.equal(fixture.upserts[0]?.usernameNormalized, "owner");
    assert.equal(fixture.touchpoints[0]?.payload.partnerCode, "partner42");
    assert.equal(fixture.events[0]?.eventType, "UserRegistered");
    assert.equal(fixture.events[0]?.eventId, "018fd8c1-1111-7111-8111-111111111111");
    assert.deepEqual(fixture.processedKeys, ["telegram_update:1001"]);
  });

  it("does not repeat side effects for duplicate updates", async () => {
    const fixture = createFixture({
      isNewUser: true,
      phoneStatus: "verified",
      alreadyProcessed: true
    });

    const result = await fixture.service.execute({
      updateId: "1001",
      receivedAt: new Date("2026-07-21T12:00:00.000Z"),
      startPayload: "partner_partner42",
      user: {
        externalUserId: "777"
      }
    });

    assert.equal(result.phoneRequired, false);
    assert.equal(fixture.touchpoints.length, 0);
    assert.equal(fixture.events.length, 0);
    assert.equal(fixture.processedKeys.length, 0);
  });
});

function createFixture(options: {
  readonly isNewUser: boolean;
  readonly phoneStatus: "unknown" | "imported" | "verified" | "rejected";
  readonly alreadyProcessed: boolean;
}): {
  readonly service: HandleTelegramStartService;
  readonly upserts: UpsertTelegramIdentityInput[];
  readonly touchpoints: RecordTouchpointInput[];
  readonly events: DomainEvent[];
  readonly processedKeys: string[];
} {
  const upserts: UpsertTelegramIdentityInput[] = [];
  const touchpoints: RecordTouchpointInput[] = [];
  const events: DomainEvent[] = [];
  const processedKeys: string[] = [];

  const identityRepository: IdentityRepository = {
    async upsertTelegramIdentity(input): Promise<UpsertTelegramIdentityResult> {
      upserts.push(input);
      return {
        isNewUser: options.isNewUser,
        user: {
          id: "user-1",
          phoneStatus: options.phoneStatus
        },
        messengerIdentity: {
          id: "identity-1",
          userId: "user-1"
        }
      };
    },
    async recordTouchpoint(input) {
      touchpoints.push(input);
    }
  };

  const idempotencyRepository: IdempotencyRepository = {
    async tryBegin() {
      return !options.alreadyProcessed;
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
      return work();
    }
  };

  const idGenerator: IdGenerator = {
    newId() {
      return "018fd8c1-1111-7111-8111-111111111111";
    }
  };

  return {
    service: new HandleTelegramStartService(
      identityRepository,
      idempotencyRepository,
      outboxWriter,
      unitOfWork,
      idGenerator
    ),
    upserts,
    touchpoints,
    events,
    processedKeys
  };
}
