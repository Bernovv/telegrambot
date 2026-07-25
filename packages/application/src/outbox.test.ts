import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DispatchOutboxBatchService,
  toDomainEventJob,
  type ClaimedOutboxEvent,
  type OutboxDispatchRepository,
  type OutboxJobPublisher
} from "./outbox.js";

describe("DispatchOutboxBatchService", () => {
  it("publishes versioned jobs and marks claimed events processed", async () => {
    const fixture = createFixture([event()]);
    const service = new DispatchOutboxBatchService(fixture.repository, fixture.publisher);

    const result = await service.execute(options());

    assert.deepEqual(result, { claimed: 1, published: 1, failed: 0 });
    assert.deepEqual(fixture.published[0], {
      eventId: "018fd8c1-1111-7111-8111-111111111111",
      idempotencyKey: "outbox:018fd8c1-1111-7111-8111-111111111111",
      attempt: 1
    });
    assert.deepEqual(fixture.completed, ["018fd8c1-1111-7111-8111-111111111111"]);
  });

  it("records only the error type and leaves other events dispatchable", async () => {
    const fixture = createFixture([event(), event({
      eventId: "018fd8c1-2222-7222-8222-222222222222",
      eventType: "PhoneVerified"
    })], "018fd8c1-1111-7111-8111-111111111111");
    const service = new DispatchOutboxBatchService(fixture.repository, fixture.publisher);

    const result = await service.execute(options());

    assert.deepEqual(result, { claimed: 2, published: 1, failed: 1 });
    assert.deepEqual(fixture.failures, [{
      eventId: "018fd8c1-1111-7111-8111-111111111111",
      errorType: "DependencyUnavailableError"
    }]);
    assert.deepEqual(fixture.completed, ["018fd8c1-2222-7222-8222-222222222222"]);
  });

  it("builds a compact immutable job contract from an outbox event", () => {
    const job = toDomainEventJob(event({ retryCount: 2 }));

    assert.equal(job.jobType, "domain-event");
    assert.equal(job.schemaVersion, 1);
    assert.equal(job.entity.type, "user");
    assert.equal(job.entity.id, "user-1");
    assert.equal(job.attempt, 3);
    assert.equal(job.createdAt, "2026-07-22T10:00:00.000Z");
    assert.deepEqual(job.event.payload, { userId: "user-1" });
  });
});

function createFixture(events: readonly ClaimedOutboxEvent[], failingEventId?: string) {
  const completed: string[] = [];
  const failures: { readonly eventId: string; readonly errorType: string }[] = [];
  const published: {
    readonly eventId: string;
    readonly idempotencyKey: string;
    readonly attempt: number;
  }[] = [];
  const repository: OutboxDispatchRepository = {
    async claimBatch() {
      return events;
    },
    async markPublished(eventId) {
      completed.push(eventId);
    },
    async markFailed(eventId, _workerId, errorType) {
      failures.push({ eventId, errorType });
    }
  };
  const publisher: OutboxJobPublisher = {
    async publish(eventId, job) {
      if (eventId === failingEventId) {
        const error = new Error("connection string and payload must not be persisted");
        error.name = "DependencyUnavailableError";
        throw error;
      }

      published.push({ eventId, idempotencyKey: job.idempotencyKey, attempt: job.attempt });
    }
  };

  return { repository, publisher, completed, failures, published };
}

function event(overrides: Partial<ClaimedOutboxEvent> = {}): ClaimedOutboxEvent {
  return {
    eventId: "018fd8c1-1111-7111-8111-111111111111",
    aggregateType: "user",
    aggregateId: "user-1",
    eventType: "UserRegistered",
    schemaVersion: 1,
    payload: { userId: "user-1" },
    occurredAt: new Date("2026-07-22T10:00:00.000Z"),
    retryCount: 0,
    ...overrides
  };
}

function options() {
  return {
    workerId: "worker-1",
    batchSize: 20,
    lockLeaseSeconds: 60,
    retryBaseSeconds: 5,
    retryMaxSeconds: 300
  };
}
