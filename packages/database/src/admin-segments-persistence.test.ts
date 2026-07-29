import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  SqlConnection,
  SqlConnectionPool,
  SqlQueryResult
} from "./postgres.js";
import { PostgresAdminSegmentPreviewRepository } from "./admin-segments-persistence.js";

describe("PostgresAdminSegmentPreviewRepository", () => {
  it("uses bounded parameterized classification predicates in one snapshot", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.user_statuses")) {
        return rows([{ code: "paid" }]);
      }
      if (text.includes("count(*)::text as total_count")) {
        return rows([{ total_count: "1" }]);
      }
      if (text.includes("from public.users users")) {
        return rows([{
          id: userId,
          display_name: "Иван",
          telegram_username: "ivan",
          registered_at: new Date("2026-07-29T08:00:00.000Z"),
          status_codes: ["paid"],
          category_codes: []
        }]);
      }
      return affected();
    });
    const repository = new PostgresAdminSegmentPreviewRepository(
      new FakePool(connection)
    );

    assert.deepEqual(
      await repository.findUnavailableClassificationCodes({
        statusCodes: ["paid"],
        categoryCodes: []
      }),
      { statusCodes: [], categoryCodes: [] }
    );
    const result = await repository.preview({
      operator: "and",
      groups: [{
        operator: "and",
        conditions: [{
          kind: "status",
          mode: "all",
          codes: ["paid"]
        }, {
          kind: "category",
          mode: "none",
          codes: ["vip"]
        }]
      }],
      sampleLimit: 10
    });

    assert.equal(result.totalCount, "1");
    assert.equal(result.sampleUsers[0]?.telegramUsername, "ivan");
    const countQuery = connection.queries.find((query) =>
      query.text.includes("total_count")
    );
    assert.ok(countQuery);
    assert.deepEqual(countQuery.values, [["paid"], ["vip"]]);
    assert.equal(countQuery.text.includes("vip"), false);
    assert.match(countQuery.text, /cardinality\(\$1::text\[\]\)/);
    assert.match(countQuery.text, /not exists/);
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

function rows<TRow>(values: readonly TRow[]): SqlQueryResult<TRow> {
  return { rows: values, rowCount: values.length };
}

function affected(): SqlQueryResult<never> {
  return { rows: [], rowCount: 1 };
}

const userId = "00000000-0000-4000-8000-000000000201";
