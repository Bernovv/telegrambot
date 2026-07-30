import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  AdminBroadcastTestDelivery,
  AdminRequestActor
} from "@ticket-platform/contracts";
import {
  AdminBroadcastTestRecipientUnavailableError,
  RequestAdminBroadcastTestSendService,
  SendNextBroadcastTestDeliveryService,
  type BroadcastTestDeliveryRepository,
  type ClaimedBroadcastTestDelivery
} from "./broadcast-test-delivery.js";

describe("broadcast test delivery services", () => {
  it("queues an audited snapshot for an available Telegram recipient", async () => {
    let received: Parameters<BroadcastTestDeliveryRepository["request"]>[0]
      | undefined;
    const repository = fakeRepository({
      async request(input) {
        received = input;
        return { status: "queued", value: queued };
      }
    });
    const service = new RequestAdminBroadcastTestSendService(
      repository,
      sequenceIds(deliveryId, eventId, auditId)
    );

    const result = await service.execute({
      actor,
      broadcastId,
      request: {
        expectedLockVersion: 4,
        recipientTelegramUserId: "123456789",
        reason: " Проверка текста "
      },
      metadata
    });

    assert.deepEqual(result, queued);
    assert.equal(received?.deliveryId, deliveryId);
    assert.equal(received?.requestedEventId, eventId);
    assert.equal(received?.audit.auditId, auditId);
    assert.equal(received?.audit.reason, "Проверка текста");
  });

  it("rejects a Telegram identity unavailable to the bot", async () => {
    const service = new RequestAdminBroadcastTestSendService(
      fakeRepository({
        async request() {
          return { status: "recipient_unavailable" };
        }
      }),
      sequenceIds(deliveryId, eventId, auditId)
    );

    await assert.rejects(
      service.execute({
        actor,
        broadcastId,
        request: {
          expectedLockVersion: 4,
          recipientTelegramUserId: "123456789",
          reason: "Проверка"
        },
        metadata
      }),
      AdminBroadcastTestRecipientUnavailableError
    );
  });

  it("sends one claimed test delivery and records the provider id", async () => {
    let marked: Parameters<BroadcastTestDeliveryRepository["markSent"]>[0]
      | undefined;
    const repository = fakeRepository({
      async claimNext() {
        return claimed;
      },
      async markSent(input) {
        marked = input;
      }
    });
    const service = new SendNextBroadcastTestDeliveryService(
      repository,
      {
        async sendBroadcastMessage(recipientId, content) {
          assert.equal(recipientId, "123456789");
          assert.equal(content.text, "Тест");
          return { providerMessageId: "77" };
        }
      },
      sequenceIds(eventId, resultEventId),
      60
    );

    const result = await service.execute({
      workerId: "worker-1",
      at
    });

    assert.deepEqual(result, {
      state: "sent",
      broadcastId,
      deliveryId
    });
    assert.equal(marked?.providerMessageId, "77");
    assert.equal(marked?.lifecycleEventId, resultEventId);
  });

  it("records a safe terminal error without scheduling a retry", async () => {
    let marked: Parameters<BroadcastTestDeliveryRepository["markFailed"]>[0]
      | undefined;
    const repository = fakeRepository({
      async claimNext() {
        return claimed;
      },
      async markFailed(input) {
        marked = input;
      }
    });
    const service = new SendNextBroadcastTestDeliveryService(
      repository,
      {
        async sendBroadcastMessage() {
          throw { code: "TelegramRateLimited", secret: "not logged" };
        }
      },
      sequenceIds(eventId, resultEventId),
      60
    );

    const result = await service.execute({
      workerId: "worker-1",
      at
    });

    assert.equal(result.state, "failed");
    assert.equal(marked?.errorCode, "TelegramRateLimited");
    assert.equal(marked?.lifecycleEventId, resultEventId);
  });
});

function fakeRepository(
  overrides: Partial<BroadcastTestDeliveryRepository> = {}
): BroadcastTestDeliveryRepository {
  return {
    async request() {
      return { status: "queued", value: queued };
    },
    async claimNext() {
      return null;
    },
    async markSent() {},
    async markFailed() {},
    ...overrides
  };
}

function sequenceIds(...ids: readonly string[]) {
  let index = 0;
  return {
    newId() {
      const value = ids[index++];
      if (!value) {
        throw new Error("Unexpected id request");
      }
      return value;
    }
  };
}

const broadcastId = "00000000-0000-4000-8000-000000000801";
const versionId = "00000000-0000-4000-8000-000000000802";
const deliveryId = "00000000-0000-4000-8000-000000000803";
const eventId = "00000000-0000-4000-8000-000000000804";
const auditId = "00000000-0000-4000-8000-000000000805";
const resultEventId = "00000000-0000-4000-8000-000000000806";
const at = new Date("2026-07-30T20:00:00.000Z");

const actor: AdminRequestActor = {
  adminId: "00000000-0000-4000-8000-000000000101",
  authSubject: "auth-1",
  roleCodes: ["content_manager"],
  permission: "broadcasts.send"
};

const metadata = {
  requestId: "request-123",
  ipAddress: "127.0.0.1",
  userAgent: "test",
  occurredAt: at
};

const queued: AdminBroadcastTestDelivery = {
  id: deliveryId,
  broadcastVersionId: versionId,
  versionNumber: 2,
  recipientTelegramUserId: "123456789",
  status: "queued",
  providerMessageId: null,
  errorCode: null,
  requestedAt: at.toISOString(),
  startedAt: null,
  finishedAt: null
};

const claimed: ClaimedBroadcastTestDelivery = {
  deliveryId,
  broadcastId,
  recipientId: "123456789",
  schemaVersion: 1,
  content: {
    text: "Тест",
    disableLinkPreview: true,
    buttons: []
  },
  personalizationContext: {
    firstName: null,
    lastName: null,
    displayName: null,
    telegramUsername: null
  }
};
