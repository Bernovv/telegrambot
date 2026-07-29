import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  SqlConnection,
  SqlConnectionPool,
  SqlQueryResult
} from "./postgres.js";
import { PostgresAdminSavedSegmentRepository } from "./admin-saved-segments-persistence.js";

describe("PostgresAdminSavedSegmentRepository", () => {
  it("publishes a locked draft after rechecking active classifications", async () => {
    const connection = new FakeConnection((text) => {
      if (
        text.includes("from public.segments")
        && text.includes("for update")
      ) {
        return rows([segmentRow(null, 1)]);
      }
      if (
        text.includes("from public.segment_versions")
        && text.includes("status = 'draft'")
        && text.includes("for update")
      ) {
        return rows([versionRow("draft", null)]);
      }
      if (text.includes("from public.user_statuses")) {
        return rows([{ code: "paid" }]);
      }
      if (text.includes("from public.user_categories")) {
        return rows([{ code: "vip" }]);
      }
      if (text.includes("returning lock_version")) {
        return rows([{ lock_version: 2 }]);
      }
      if (text.includes("from public.segments")) {
        return rows([segmentRow(versionId, 2)]);
      }
      if (
        text.includes("from public.segment_versions")
        && text.includes("or id = $2")
      ) {
        return rows([
          versionRow("published", new Date("2026-07-29T09:00:00.000Z"))
        ]);
      }
      return affected();
    });
    const repository = new PostgresAdminSavedSegmentRepository(
      new FakePool(connection)
    );

    const result = await repository.publishDraft({
      segmentId,
      expectedLockVersion: 1,
      statusCodes: ["paid"],
      categoryCodes: ["vip"],
      audit
    });

    assert.equal(result.status, "published");
    if (result.status !== "published") {
      return;
    }
    assert.equal(result.value.lockVersion, 2);
    assert.equal(result.value.published?.versionNumber, 1);
    const statusQuery = connection.queries.find((query) =>
      query.text.includes("from public.user_statuses")
    );
    assert.deepEqual(statusQuery?.values, [["paid"]]);
    const publicationIndex = connection.queries.findIndex((query) =>
      query.text.includes("set status = 'published'")
    );
    const classificationIndex = connection.queries.findIndex((query) =>
      query.text.includes("from public.user_categories")
    );
    assert.ok(classificationIndex >= 0);
    assert.ok(publicationIndex > classificationIndex);
    assert.ok(connection.queries.some((query) =>
      query.text.includes("'segment', $5")
    ));
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

function segmentRow(
  publishedVersionId: string | null,
  lockVersion: number
) {
  return {
    id: segmentId,
    name: "Покупатели",
    description: null,
    lock_version: lockVersion,
    published_version_id: publishedVersionId,
    updated_at: new Date("2026-07-29T09:00:00.000Z")
  };
}

function versionRow(status: "draft" | "published", publishedAt: Date | null) {
  return {
    id: versionId,
    segment_id: segmentId,
    version_number: 1,
    status,
    schema_version: 1,
    name: "Покупатели",
    description: null,
    expression: {
      operator: "and",
      groups: [{
        operator: "and",
        conditions: [{
          kind: "status",
          mode: "any",
          codes: ["paid"]
        }, {
          kind: "category",
          mode: "all",
          codes: ["vip"]
        }]
      }]
    },
    created_at: new Date("2026-07-29T08:00:00.000Z"),
    updated_at: new Date("2026-07-29T09:00:00.000Z"),
    published_at: publishedAt
  };
}

function rows<TRow>(values: readonly TRow[]): SqlQueryResult<TRow> {
  return { rows: values, rowCount: values.length };
}

function affected(): SqlQueryResult<never> {
  return { rows: [], rowCount: 1 };
}

const audit = {
  auditId: "00000000-0000-4000-8000-000000000503",
  actorAdminId: "00000000-0000-4000-8000-000000000101",
  actorRole: "content_manager",
  reason: "Публикация",
  requestId: "request-123",
  ipAddress: "127.0.0.1",
  userAgent: "test",
  occurredAt: new Date("2026-07-29T09:00:00.000Z")
};

const segmentId = "00000000-0000-4000-8000-000000000501";
const versionId = "00000000-0000-4000-8000-000000000502";
