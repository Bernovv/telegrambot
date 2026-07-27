import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DomainEvent } from "@ticket-platform/domain";
import {
  SendEventRemindersBatchService,
  type DueReminder,
  type EventReminderRepository
} from "./event-reminders.js";

const at = new Date("2026-07-29T09:00:00.000Z");

describe("SendEventRemindersBatchService", () => {
  it("claims due reminders and appends one EventReminderDue event per claim", async () => {
    const due: DueReminder[] = [
      { orderId: "order-1", eventId: "event-1", userId: "user-1", cadenceStep: "10d" },
      { orderId: "order-2", eventId: "event-1", userId: "user-2", cadenceStep: "day_of" }
    ];
    const events: DomainEvent[] = [];
    const service = createService({
      async claimDueReminders() {
        return due;
      }
    }, events);

    const result = await service.execute({ at, batchSize: 50 });

    assert.deepEqual(result, { claimed: 2 });
    assert.equal(events.length, 2);
    assert.equal(events[0]?.eventType, "EventReminderDue");
    assert.equal(events[0]?.aggregateId, "order-1");
    assert.deepEqual(events[0]?.payload, {
      orderId: "order-1",
      eventId: "event-1",
      userId: "user-1",
      cadenceStep: "10d"
    });
    assert.deepEqual(events[1]?.payload, {
      orderId: "order-2",
      eventId: "event-1",
      userId: "user-2",
      cadenceStep: "day_of"
    });
  });

  it("does nothing and appends no events when nothing is due", async () => {
    const events: DomainEvent[] = [];
    const service = createService({
      async claimDueReminders() {
        return [];
      }
    }, events);

    const result = await service.execute({ at, batchSize: 50 });

    assert.deepEqual(result, { claimed: 0 });
    assert.equal(events.length, 0);
  });

  it("rejects an invalid sweep time or an out-of-range batch size", async () => {
    const service = createService({ async claimDueReminders() { return []; } }, []);

    await assert.rejects(
      service.execute({ at: new Date(Number.NaN), batchSize: 50 }),
      /sweep time/
    );
    await assert.rejects(service.execute({ at, batchSize: 0 }), /batch size/);
    await assert.rejects(service.execute({ at, batchSize: 501 }), /batch size/);
  });
});

function createService(
  repository: EventReminderRepository,
  events: DomainEvent[]
): SendEventRemindersBatchService {
  let id = 0;

  return new SendEventRemindersBatchService(
    repository,
    { async append(event) { events.push(event); } },
    { async transact(work) { return work(); } },
    { newId() { id += 1; return `id-${id}`; } }
  );
}
