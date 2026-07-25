import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DomainEventJobV1 } from "@ticket-platform/contracts";
import type { QueueResult, SendOptions } from "pg-boss";
import {
  assertPgBossQueuesProvisioned,
  OUTBOX_DISPATCH_DEAD_LETTER_QUEUE,
  OUTBOX_DISPATCH_QUEUE,
  PgBossOutboxPublisher,
  type PgBossPublisherClient
} from "./pgboss.js";

describe("PgBossOutboxPublisher", () => {
  it("uses the outbox event UUID as the pg-boss job UUID", async () => {
    const sends: { readonly name: string; readonly data: object | null; readonly options?: SendOptions }[] = [];
    const boss = fakeBoss({
      async send(name, data, options) {
        sends.push({ name, data, ...(options ? { options } : {}) });
        return null;
      }
    });
    const publisher = new PgBossOutboxPublisher(boss);

    await publisher.publish("018fd8c1-1111-7111-8111-111111111111", job());

    assert.equal(sends[0]?.name, OUTBOX_DISPATCH_QUEUE);
    assert.equal(sends[0]?.options?.id, "018fd8c1-1111-7111-8111-111111111111");
    assert.deepEqual(sends[0]?.data, job());
  });

  it("accepts a null send result as an already-published duplicate", async () => {
    const publisher = new PgBossOutboxPublisher(fakeBoss({
      async send() {
        return null;
      }
    }));

    await assert.doesNotReject(
      () => publisher.publish("018fd8c1-1111-7111-8111-111111111111", job())
    );
  });
});

describe("assertPgBossQueuesProvisioned", () => {
  it("requires the dispatch queue and its dead-letter queue", async () => {
    const boss = fakeBoss({
      async getQueue(name) {
        return queue(name, name === OUTBOX_DISPATCH_QUEUE
          ? OUTBOX_DISPATCH_DEAD_LETTER_QUEUE
          : undefined);
      }
    });

    await assert.doesNotReject(() => assertPgBossQueuesProvisioned(boss));
    await assert.rejects(
      () => assertPgBossQueuesProvisioned(fakeBoss({ async getQueue() { return null; } })),
      /not provisioned/
    );
  });
});

function fakeBoss(overrides: Partial<PgBossPublisherClient>): PgBossPublisherClient {
  return {
    async send() {
      return "job-id";
    },
    async getQueue(name) {
      return queue(name);
    },
    ...overrides
  };
}

function queue(name: string, deadLetter?: string): QueueResult {
  return {
    name,
    policy: "standard",
    partition: false,
    ...(deadLetter ? { deadLetter } : {}),
    deferredCount: 0,
    queuedCount: 0,
    readyCount: 0,
    activeCount: 0,
    failedCount: 0,
    totalCount: 0,
    table: "job_common",
    createdOn: new Date(),
    updatedOn: new Date(),
    singletonsActive: null
  };
}

function job(): DomainEventJobV1 {
  return {
    jobType: "domain-event",
    schemaVersion: 1,
    entity: { type: "user", id: "user-1" },
    idempotencyKey: "outbox:018fd8c1-1111-7111-8111-111111111111",
    correlationId: "018fd8c1-1111-7111-8111-111111111111",
    actor: null,
    attempt: 1,
    createdAt: "2026-07-22T10:00:00.000Z",
    event: {
      type: "UserRegistered",
      schemaVersion: 1,
      payload: { userId: "user-1" }
    }
  };
}
