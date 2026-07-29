import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  SqlConnection,
  SqlConnectionPool,
  SqlQueryResult
} from "./postgres.js";
import { PostgresAdminOutreachRepository } from "./admin-outreach-persistence.js";

describe("PostgreSQL administrator outreach persistence", () => {
  it("casts the repeated campaign timestamp parameter consistently", async () => {
    const connection = new RecordingConnection();
    const repository = new PostgresAdminOutreachRepository(pool(connection));

    await repository.createCampaign({
      id: "00000000-0000-4000-8000-000000000101",
      name: "Не оплатили",
      description: "Июль",
      status: "active",
      createdByAdminId: "00000000-0000-4000-8000-000000000001",
      now: new Date("2026-07-29T12:00:00.000Z")
    });

    const insert = connection.queries.find((query) =>
      query.text.includes("insert into public.outreach_campaigns")
    );
    assert.ok(insert);
    assert.equal(
      insert.text.match(/\$6::timestamptz/g)?.length,
      3
    );
    assert.match(insert.text, /\$4::text = 'completed'/);
    assert.equal(connection.queries[0]?.text, "begin");
    assert.equal(connection.queries.at(-1)?.text, "commit");
    assert.equal(connection.released, true);
  });
});

interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

class RecordingConnection implements SqlConnection {
  readonly queries: RecordedQuery[] = [];
  released = false;

  async query<TRow>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<SqlQueryResult<TRow>> {
    this.queries.push({ text, values });
    return { rows: [], rowCount: 0 };
  }

  release(): void {
    this.released = true;
  }
}

function pool(connection: SqlConnection): SqlConnectionPool {
  return {
    async connect() {
      return connection;
    }
  };
}
