import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  SqlConnection,
  SqlConnectionPool,
  SqlQueryResult
} from "./postgres.js";
import { PostgresAdminBroadcastRepository } from "./admin-broadcast-persistence.js";

describe("PostgresAdminBroadcastRepository", () => {
  it("publishes audit and outbox with the locked ready snapshot", async () => {
    const connection = new FakeConnection((text) => {
      if (
        text.includes("from public.broadcasts")
        && text.includes("for update")
      ) {
        return rows([broadcastRow(null, 1)]);
      }
      if (
        text.includes("from public.broadcast_versions")
        && text.includes("status = 'draft'")
        && text.includes("for update")
      ) {
        return rows([versionRow("draft", null)]);
      }
      if (text.includes("returning lock_version")) {
        return rows([{ lock_version: 2 }]);
      }
      if (
        text.includes("from public.broadcasts")
        && !text.includes("for update")
      ) {
        return rows([broadcastRow(versionId, 2)]);
      }
      if (
        text.includes("from public.broadcast_versions")
        && text.includes("or versions.id = $2")
      ) {
        return rows([
          versionRow("published", new Date("2026-07-29T09:00:00.000Z"))
        ]);
      }
      return affected();
    });
    const repository = new PostgresAdminBroadcastRepository(
      new FakePool(connection)
    );

    const result = await repository.publishDraft({
      broadcastId,
      expectedLockVersion: 1,
      publicationEventId: eventId,
      audit
    });

    assert.equal(result.status, "published");
    if (result.status !== "published") {
      return;
    }
    assert.equal(result.value.lockVersion, 2);
    assert.equal(result.value.published?.audienceSnapshot.totalCount, "42");
    const auditIndex = connection.queries.findIndex((query) =>
      query.text.includes("insert into public.audit_log")
    );
    const outboxIndex = connection.queries.findIndex((query) =>
      query.text.includes("'BroadcastVersionPublished'")
    );
    assert.ok(auditIndex >= 0);
    assert.ok(outboxIndex > auditIndex);
    const outbox = connection.queries[outboxIndex];
    assert.equal(outbox?.values[0], eventId);
    assert.deepEqual(JSON.parse(String(outbox?.values[2])), {
      broadcastId,
      broadcastVersionId: versionId,
      audienceSnapshotId: snapshotId,
      audienceTotalCount: "42"
    });
    assert.equal(connection.queries.at(-1)?.text, "commit");
  });

  it("schedules the exact published version with audit and outbox", async () => {
    const connection = new FakeConnection((text) => {
      if (
        text.includes("from public.broadcasts")
        && text.includes("for update")
      ) {
        return rows([broadcastRow(versionId, 2)]);
      }
      if (
        text.includes("from public.broadcast_versions")
        && text.includes("status = 'draft'")
        && text.includes("for update")
      ) {
        return rows([]);
      }
      if (
        text.includes("from public.broadcast_versions")
        && text.includes("versions.status = 'published'")
      ) {
        return rows([
          versionRow("published", new Date("2026-07-29T09:00:00.000Z"))
        ]);
      }
      if (text.includes("returning lock_version")) {
        return rows([{ lock_version: 3 }]);
      }
      if (
        text.includes("from public.broadcasts")
        && !text.includes("for update")
      ) {
        return rows([scheduledBroadcastRow()]);
      }
      if (
        text.includes("from public.broadcast_versions")
        && text.includes("or versions.id = $2")
      ) {
        return rows([
          versionRow("published", new Date("2026-07-29T09:00:00.000Z"))
        ]);
      }
      return affected();
    });
    const repository = new PostgresAdminBroadcastRepository(
      new FakePool(connection)
    );

    const result = await repository.schedule({
      broadcastId,
      expectedLockVersion: 2,
      scheduledAt,
      timezone: "Europe/Moscow",
      ratePerSecond: 10,
      scheduleEventId,
      audit
    });

    assert.equal(result.status, "scheduled");
    if (result.status !== "scheduled") {
      return;
    }
    assert.equal(result.value.schedule?.scheduledVersionId, versionId);
    assert.equal(result.value.schedule?.ratePerSecond, 10);
    const outbox = connection.queries.find((query) =>
      query.text.includes("'BroadcastScheduled'")
    );
    assert.equal(outbox?.values[0], scheduleEventId);
    assert.deepEqual(JSON.parse(String(outbox?.values[2])), {
      broadcastId,
      broadcastVersionId: versionId,
      audienceSnapshotId: snapshotId,
      scheduledAt: scheduledAt.toISOString(),
      timezone: "Europe/Moscow",
      ratePerSecond: 10
    });
    assert.equal(connection.queries.at(-1)?.text, "commit");
  });
});

class FakePool implements SqlConnectionPool {
  constructor(private readonly connection: SqlConnection) {}
  async connect(): Promise<SqlConnection> {
    return this.connection;
  }
}

class FakeConnection implements SqlConnection {
  readonly queries: { text: string; values: readonly unknown[] }[] = [];
  constructor(
    private readonly respond: (
      text: string,
      values: readonly unknown[]
    ) => SqlQueryResult<unknown>
  ) {}
  async query<TRow>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<SqlQueryResult<TRow>> {
    this.queries.push({ text, values });
    return this.respond(text, values) as SqlQueryResult<TRow>;
  }
  release(): void {}
}

function broadcastRow(
  publishedVersionId: string | null,
  lockVersion: number
) {
  return {
    id: broadcastId,
    name: "Анонс встречи",
    lock_version: lockVersion,
    lifecycle_status: "draft",
    published_version_id: publishedVersionId,
    scheduled_version_id: null,
    scheduled_at: null,
    schedule_timezone: null,
    rate_per_second: null,
    prepared_at: null,
    send_started_at: null,
    completed_at: null,
    paused_at: null,
    auto_pause_reason: null,
    planned_recipient_count: null,
    reachable_recipient_count: null,
    skipped_recipient_count: null,
    attempted_recipient_count: "0",
    sent_recipient_count: "0",
    failed_recipient_count: "0",
    updated_at: new Date("2026-07-29T09:00:00.000Z")
  };
}

function versionRow(status: "draft" | "published", publishedAt: Date | null) {
  return {
    id: versionId,
    broadcast_id: broadcastId,
    version_number: 1,
    status,
    schema_version: 1,
    name: "Анонс встречи",
    audience_snapshot_id: snapshotId,
    content: {
      text: "Регистрация открыта",
      disableLinkPreview: true,
      buttons: []
    },
    created_at: new Date("2026-07-29T08:00:00.000Z"),
    updated_at: new Date("2026-07-29T09:00:00.000Z"),
    published_at: publishedAt,
    segment_id: segmentId,
    segment_version_id: segmentVersionId,
    segment_version_number: 1,
    snapshot_status: "ready",
    snapshot_total_count: "42",
    snapshot_requested_at: new Date("2026-07-29T08:00:00.000Z"),
    snapshot_completed_at: new Date("2026-07-29T08:01:00.000Z")
  };
}

function scheduledBroadcastRow() {
  return {
    ...broadcastRow(versionId, 3),
    lifecycle_status: "scheduled",
    scheduled_version_id: versionId,
    scheduled_at: scheduledAt,
    schedule_timezone: "Europe/Moscow",
    rate_per_second: 10
  };
}

function rows<TRow>(values: readonly TRow[]): SqlQueryResult<TRow> {
  return { rows: values, rowCount: values.length };
}

function affected(): SqlQueryResult<never> {
  return { rows: [], rowCount: 1 };
}

const broadcastId = "00000000-0000-4000-8000-000000000801";
const versionId = "00000000-0000-4000-8000-000000000802";
const snapshotId = "00000000-0000-4000-8000-000000000804";
const segmentId = "00000000-0000-4000-8000-000000000805";
const segmentVersionId = "00000000-0000-4000-8000-000000000806";
const eventId = "00000000-0000-4000-8000-000000000808";
const scheduleEventId = "00000000-0000-4000-8000-000000000809";
const scheduledAt = new Date("2026-07-30T10:00:00.000Z");

const audit = {
  auditId: "00000000-0000-4000-8000-000000000807",
  actorAdminId: "00000000-0000-4000-8000-000000000101",
  actorRole: "content_manager",
  reason: "Публикация",
  requestId: "request-123",
  ipAddress: "127.0.0.1",
  userAgent: "test",
  occurredAt: new Date("2026-07-29T09:00:00.000Z")
};
