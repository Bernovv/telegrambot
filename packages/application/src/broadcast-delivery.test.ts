import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminBroadcastContent } from "@ticket-platform/contracts";
import {
  BroadcastDeliverySendError,
  SendNextBroadcastDeliveryService,
  type BroadcastDeliveryRepository,
  type ClaimedBroadcastDelivery
} from "./broadcast-delivery.js";

const at = new Date("2026-07-30T12:00:00.000Z");
const content: AdminBroadcastContent = {
  text: "Новости мероприятия",
  disableLinkPreview: true,
  buttons: [{ label: "Открыть", url: "https://example.com/event" }]
};
const claimed: ClaimedBroadcastDelivery = {
  deliveryId: "019d0000-0000-7000-8000-000000000001",
  broadcastId: "019d0000-0000-7000-8000-000000000002",
  userId: "019d0000-0000-7000-8000-000000000003",
  telegramIdentityId: "019d0000-0000-7000-8000-000000000004",
  recipientId: "123456789",
  content,
  attemptCount: 1
};
const policy = {
  leaseSeconds: 60,
  maxAttempts: 5,
  retryBaseSeconds: 5,
  retryMaxSeconds: 300,
  autoPauseMinimumAttempts: 20,
  autoPauseFailurePercent: 30
};
let generatedId = 0;
const idGenerator = {
  newId() {
    generatedId += 1;
    return `00000000-0000-4000-8000-${generatedId.toString().padStart(12, "0")}`;
  }
};

describe("SendNextBroadcastDeliveryService", () => {
  it("claims and marks a successful delivery", async () => {
    const calls: unknown[] = [];
    const repository = repositoryStub(calls);
    const service = new SendNextBroadcastDeliveryService(repository, {
      async sendBroadcastMessage(recipientId, actualContent) {
        calls.push(["send", recipientId, actualContent]);
        return { providerMessageId: "777" };
      }
    }, idGenerator, policy);

    const result = await service.execute({ workerId: "worker-1", at });

    assert.equal(result.state, "sent");
    assert.deepEqual(calls[0], ["claim", "worker-1", at, 60]);
    assert.deepEqual(calls[1], ["send", claimed.recipientId, content]);
    assert.equal((calls[2] as { providerMessageId: string }).providerMessageId, "777");
  });

  it("honors Telegram retry_after and schedules a retry", async () => {
    const calls: unknown[] = [];
    const repository = repositoryStub(calls);
    const service = new SendNextBroadcastDeliveryService(repository, {
      async sendBroadcastMessage() {
        throw new BroadcastDeliverySendError("rate_limit", "TelegramRateLimited", 42);
      }
    }, idGenerator, policy);

    const result = await service.execute({ workerId: "worker-1", at });

    assert.equal(result.state, "retry_scheduled");
    const failure = calls[1] as { retryAt: Date; errorCode: string };
    assert.equal(failure.errorCode, "TelegramRateLimited");
    assert.equal(failure.retryAt.toISOString(), "2026-07-30T12:00:42.000Z");
  });

  it("marks blocked recipients permanently without retry", async () => {
    const calls: unknown[] = [];
    const repository = repositoryStub(calls);
    const service = new SendNextBroadcastDeliveryService(repository, {
      async sendBroadcastMessage() {
        throw new BroadcastDeliverySendError("blocked", "TelegramRecipientBlocked");
      }
    }, idGenerator, policy);

    const result = await service.execute({ workerId: "worker-1", at });

    assert.equal(result.state, "failed");
    const failure = calls[1] as { retryAt: Date | null; blocked: boolean };
    assert.equal(failure.retryAt, null);
    assert.equal(failure.blocked, true);
  });

  it("stops retrying after the configured attempt limit", async () => {
    const calls: unknown[] = [];
    const repository = repositoryStub(calls, { ...claimed, attemptCount: 5 });
    const service = new SendNextBroadcastDeliveryService(repository, {
      async sendBroadcastMessage() {
        throw new Error("connection reset");
      }
    }, idGenerator, policy);

    const result = await service.execute({ workerId: "worker-1", at });

    assert.equal(result.state, "failed");
    assert.equal((calls[1] as { retryAt: Date | null }).retryAt, null);
  });

  it("does not reinterpret a ledger commit failure as a Telegram failure", async () => {
    let failedMarks = 0;
    const repository = repositoryStub([]);
    repository.markSent = async () => {
      throw new Error("database unavailable");
    };
    repository.markFailed = async () => {
      failedMarks += 1;
      return { broadcastStatus: "sending" };
    };
    const service = new SendNextBroadcastDeliveryService(repository, {
      async sendBroadcastMessage() {
        return { providerMessageId: "778" };
      }
    }, idGenerator, policy);

    await assert.rejects(
      service.execute({ workerId: "worker-1", at }),
      /database unavailable/
    );
    assert.equal(failedMarks, 0);
  });
});

function repositoryStub(
  calls: unknown[],
  delivery: ClaimedBroadcastDelivery = claimed
): BroadcastDeliveryRepository {
  return {
    async claimNext(input) {
      calls.push(["claim", input.workerId, input.claimedAt, input.leaseSeconds]);
      return delivery;
    },
    async markSent(input) {
      calls.push(input);
      return { broadcastStatus: "sending" };
    },
    async markFailed(input) {
      calls.push(input);
      return { broadcastStatus: "sending" };
    }
  };
}
