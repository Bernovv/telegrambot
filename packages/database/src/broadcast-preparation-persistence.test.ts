import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PostgresBroadcastPreparationRepository } from "./broadcast-preparation-persistence.js";
import {
  TransactionSession,
  type SqlConnection,
  type SqlQueryResult
} from "./postgres.js";

describe("PostgresBroadcastPreparationRepository", () => {
  it("materializes each snapshot member once and records bounded counts", async () => {
    const session = new TransactionSession();
    const connection = new FakeConnection((text) => {
      if (text.includes("select broadcasts.id as broadcast_id")) {
        return rows([{
          broadcast_id: broadcastId,
          broadcast_version_id: versionId,
          audience_snapshot_id: snapshotId,
          scheduled_at: scheduledAt
        }]);
      }
      if (text.includes("count(*)::text as planned")) {
        return rows([{ planned: "3", reachable: "2", skipped: "1" }]);
      }
      return affected();
    });
    const repository = new PostgresBroadcastPreparationRepository(session);

    const result = await session.run(connection, async () => {
      const claimed = await repository.claimDue({
        at: preparedAt,
        batchSize: 1
      });
      assert.equal(claimed.length, 1);
      const broadcast = claimed[0];
      assert.ok(broadcast);
      return repository.materialize({ broadcast, preparedAt });
    });

    assert.deepEqual(result, {
      planned: "3",
      reachable: "2",
      skipped: "1"
    });
    const insert = connection.queries.find((query) =>
      query.text.includes("insert into public.broadcast_deliveries")
    );
    assert.ok(insert);
    assert.match(insert.text, /segment_audience_snapshot_members/);
    assert.match(insert.text, /on conflict \(broadcast_id, user_id\) do nothing/);
    assert.match(insert.text, /RecipientBlocked/);
    assert.deepEqual(insert.values, [
      broadcastId,
      versionId,
      snapshotId,
      scheduledAt,
      preparedAt
    ]);
    assert.ok(connection.queries.some((query) =>
      query.text.includes("lifecycle_status = 'preparing'")
    ));
  });
});

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

const broadcastId = "00000000-0000-4000-8000-000000000801";
const versionId = "00000000-0000-4000-8000-000000000802";
const snapshotId = "00000000-0000-4000-8000-000000000804";
const scheduledAt = new Date("2026-07-30T10:00:00.000Z");
const preparedAt = new Date("2026-07-30T10:00:01.000Z");
