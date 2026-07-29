import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PostgresSegmentAudienceSnapshotRepository
} from "./segment-audience-snapshot-persistence.js";
import {
  TransactionSession,
  type SqlConnection,
  type SqlConnectionPool,
  type SqlQueryResult
} from "./postgres.js";

describe("PostgresSegmentAudienceSnapshotRepository", () => {
  it("materializes immutable members with parameterized predicates", async () => {
    const session = new TransactionSession();
    const connection = new FakeConnection((text) => {
      if (text.includes("select snapshots.id")) {
        return rows([{
          id: snapshotId,
          segment_id: segmentId,
          segment_version_id: versionId,
          expression
        }]);
      }
      if (text.includes("with inserted as")) {
        return rows([{ total_count: "2" }]);
      }
      if (text.includes("update public.segment_audience_snapshots")) {
        return affected();
      }
      return affected();
    });
    const repository = new PostgresSegmentAudienceSnapshotRepository(
      new FakePool(connection),
      session
    );

    const result = await session.run(connection, async () => {
      const claimed = await repository.claimPending(1);
      assert.equal(claimed.length, 1);
      const snapshot = claimed[0];
      assert.ok(snapshot);
      return repository.materialize({
        snapshot,
        capturedAt
      });
    });

    assert.equal(result, "2");
    const insert = connection.queries.find((query) =>
      query.text.includes("with inserted as")
    );
    assert.ok(insert);
    assert.equal(insert.text.includes("paid"), false);
    assert.deepEqual(insert.values, [
      snapshotId,
      capturedAt,
      ["paid"],
      ["vip"]
    ]);
    assert.match(insert.text, /not exists/);
    assert.match(insert.text, /on conflict \(snapshot_id, user_id\) do nothing/);
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

function rows<TRow>(values: readonly TRow[]): SqlQueryResult<TRow> {
  return { rows: values, rowCount: values.length };
}

function affected(): SqlQueryResult<never> {
  return { rows: [], rowCount: 1 };
}

const expression = {
  operator: "and",
  groups: [{
    operator: "and",
    conditions: [{
      kind: "status",
      mode: "any",
      codes: ["paid"]
    }, {
      kind: "category",
      mode: "none",
      codes: ["vip"]
    }]
  }]
};

const segmentId = "00000000-0000-4000-8000-000000000501";
const versionId = "00000000-0000-4000-8000-000000000502";
const snapshotId = "00000000-0000-4000-8000-000000000503";
const capturedAt = new Date("2026-07-29T12:00:00.000Z");
