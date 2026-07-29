import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  SegmentAudienceSnapshotRepository
} from "./segment-audience-snapshots.js";
import {
  BuildSegmentAudienceSnapshotsBatchService,
  RequestAdminSegmentAudienceSnapshotService
} from "./segment-audience-snapshots.js";

describe("segment audience snapshots", () => {
  it("requests an audited snapshot for an exact published version", async () => {
    let received: unknown;
    const service = new RequestAdminSegmentAudienceSnapshotService(
      repository({
        async request(input) {
          received = input;
          return { status: "created", value: summary };
        }
      }),
      sequence([auditId, snapshotId])
    );

    const result = await service.execute({
      actor,
      segmentId,
      request: {
        segmentVersionId: versionId,
        reason: "  Юридически значимая рассылка  "
      },
      metadata
    });

    assert.equal(result.id, snapshotId);
    assert.equal(
      (received as { readonly audit: { readonly reason: string } }).audit.reason,
      "Юридически значимая рассылка"
    );
    assert.equal(
      (received as { readonly segmentVersionId: string }).segmentVersionId,
      versionId
    );
  });

  it("materializes claimed snapshots and appends a ready event atomically", async () => {
    const events: unknown[] = [];
    let transactions = 0;
    const service = new BuildSegmentAudienceSnapshotsBatchService(
      repository({
        async claimPending() {
          return [pending];
        },
        async materialize() {
          return "125";
        }
      }),
      {
        async transact(work) {
          transactions += 1;
          return work();
        }
      },
      {
        async append(event) {
          events.push(event);
        }
      },
      sequence([eventId])
    );

    const result = await service.execute({
      at: new Date("2026-07-29T12:00:00.000Z"),
      batchSize: 1
    });

    assert.deepEqual(result, {
      claimed: 1,
      completed: 1,
      capturedMembers: "125"
    });
    assert.equal(transactions, 1);
    assert.equal(
      (events[0] as { readonly eventType: string }).eventType,
      "SegmentAudienceSnapshotReady"
    );
  });
});

function repository(
  overrides: Partial<SegmentAudienceSnapshotRepository>
): SegmentAudienceSnapshotRepository {
  return {
    async list() {
      return [];
    },
    async get() {
      return null;
    },
    async request() {
      return { status: "created", value: summary };
    },
    async claimPending() {
      return [];
    },
    async materialize() {
      return "0";
    },
    ...overrides
  };
}

function sequence(values: string[]) {
  return { newId: () => values.shift() ?? eventId };
}

const segmentId = "00000000-0000-4000-8000-000000000501";
const versionId = "00000000-0000-4000-8000-000000000502";
const snapshotId = "00000000-0000-4000-8000-000000000503";
const auditId = "00000000-0000-4000-8000-000000000504";
const eventId = "00000000-0000-4000-8000-000000000505";

const expression = {
  operator: "and",
  groups: [{
    operator: "and",
    conditions: [{
      kind: "status",
      mode: "any",
      codes: ["paid"]
    }]
  }]
} as const;

const pending = {
  id: snapshotId,
  segmentId,
  segmentVersionId: versionId,
  expression
};

const summary = {
  id: snapshotId,
  segmentId,
  segmentVersionId: versionId,
  segmentVersionNumber: 2,
  status: "pending" as const,
  totalCount: null,
  requestedAt: "2026-07-29T11:00:00.000Z",
  completedAt: null
};

const actor = {
  adminId: "00000000-0000-4000-8000-000000000101",
  authSubject: "auth-1",
  roleCodes: ["content_manager"],
  permission: "broadcasts.send"
} as const;

const metadata = {
  requestId: "request-123",
  ipAddress: "127.0.0.1",
  userAgent: "test",
  occurredAt: new Date("2026-07-29T11:00:00.000Z")
};
