import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DomainEvent } from "@ticket-platform/domain";
import {
  PrepareBroadcastDeliveriesBatchService,
  type BroadcastPreparationRepository
} from "./broadcast-preparation.js";

describe("broadcast delivery preparation", () => {
  it("materializes due campaigns and appends compact prepared events", async () => {
    const events: DomainEvent[] = [];
    const service = new PrepareBroadcastDeliveriesBatchService(
      repository,
      { async transact(work) { return work(); } },
      { async append(event) { events.push(event); } },
      { newId: () => eventId }
    );

    const result = await service.execute({ at: preparedAt, batchSize: 2 });

    assert.deepEqual(result, {
      claimed: 1,
      prepared: 1,
      plannedRecipients: "42",
      reachableRecipients: "40",
      skippedRecipients: "2"
    });
    assert.equal(events.length, 1);
    assert.deepEqual(events[0]?.payload, {
      broadcastId,
      broadcastVersionId,
      audienceSnapshotId,
      plannedRecipientCount: "42",
      reachableRecipientCount: "40",
      skippedRecipientCount: "2"
    });
    assert.equal(events[0]?.eventType, "BroadcastPrepared");
  });
});

const repository: BroadcastPreparationRepository = {
  async claimDue(input) {
    assert.equal(input.batchSize, 2);
    assert.equal(input.at, preparedAt);
    return [{
      broadcastId,
      broadcastVersionId,
      audienceSnapshotId,
      scheduledAt
    }];
  },
  async materialize(input) {
    assert.equal(input.broadcast.broadcastId, broadcastId);
    assert.equal(input.preparedAt, preparedAt);
    return { planned: "42", reachable: "40", skipped: "2" };
  }
};

const broadcastId = "00000000-0000-4000-8000-000000000801";
const broadcastVersionId = "00000000-0000-4000-8000-000000000802";
const audienceSnapshotId = "00000000-0000-4000-8000-000000000804";
const eventId = "00000000-0000-4000-8000-000000000809";
const scheduledAt = new Date("2026-07-30T10:00:00.000Z");
const preparedAt = new Date("2026-07-30T10:00:01.000Z");
