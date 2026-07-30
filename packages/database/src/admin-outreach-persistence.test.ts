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

  it("reports stage_in_use instead of throwing when a stage delete violates the contacts foreign key", async () => {
    const connection = new ForeignKeyViolationOnDeleteConnection();
    const repository = new PostgresAdminOutreachRepository(pool(connection));

    const result = await repository.updatePipelineColumns({
      campaignId: "00000000-0000-4000-8000-000000000101",
      columns: [
        { stage: "new", label: "Новые", position: 1, outcome: "open" }
      ],
      now: new Date("2026-07-30T12:00:00.000Z")
    });

    assert.equal(result, "stage_in_use");
    assert.equal(connection.queries.at(-1)?.text, "rollback");
  });

  it("reports not_found when the campaign row is missing", async () => {
    const connection = new RecordingConnection();
    const repository = new PostgresAdminOutreachRepository(pool(connection));

    const result = await repository.updatePipelineColumns({
      campaignId: "00000000-0000-4000-8000-000000000101",
      columns: [
        { stage: "new", label: "Новые", position: 1, outcome: "open" },
        { stage: "s_abc123", label: "Новая", position: 2, outcome: "won" }
      ],
      now: new Date("2026-07-30T12:00:00.000Z")
    });

    assert.equal(result, "not_found");
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

// Simulates a campaign that has one existing column ("new") plus a second,
// unlisted column ("legacy") that still has contacts in it, so the delete
// step in updatePipelineColumns hits the not-deferrable foreign key and the
// database raises a foreign key violation (SQLSTATE 23503).
class ForeignKeyViolationOnDeleteConnection implements SqlConnection {
  readonly queries: RecordedQuery[] = [];
  released = false;

  async query<TRow>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<SqlQueryResult<TRow>> {
    this.queries.push({ text, values });
    if (text.trim().startsWith("select id")) {
      return { rows: [{ id: values[0] }] as TRow[], rowCount: 1 };
    }
    if (text.trim().startsWith("select stage")) {
      return { rows: [{ stage: "legacy" }] as TRow[], rowCount: 1 };
    }
    if (text.trim().startsWith("delete from public.outreach_pipeline_columns")) {
      throw Object.assign(new Error("foreign key violation"), { code: "23503" });
    }
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
