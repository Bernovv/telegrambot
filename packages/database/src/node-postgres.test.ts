import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type pg from "pg";
import { NodePostgresPool } from "./node-postgres.js";

describe("NodePostgresPool", () => {
  it("adapts query results and releases checked-out clients", async () => {
    const calls: { readonly text: string; readonly values?: unknown[] }[] = [];
    let released = false;
    const client = {
      async query(text: string, values?: unknown[]) {
        calls.push({ text, ...(values ? { values } : {}) });
        return { rows: [{ value: "ok" }], rowCount: null };
      },
      release() {
        released = true;
      }
    };
    const pool = new NodePostgresPool({
      async connect() {
        return client;
      }
    } as unknown as pg.Pool);
    const connection = await pool.connect();

    const result = await connection.query<{ readonly value: string }>("select $1", ["value"]);
    connection.release();

    assert.deepEqual(result, { rows: [{ value: "ok" }], rowCount: 1 });
    assert.deepEqual(calls, [{ text: "select $1", values: ["value"] }]);
    assert.equal(released, true);
  });

  it("pings and closes the underlying pool", async () => {
    const calls: string[] = [];
    const pool = new NodePostgresPool({
      async query(text: string) {
        calls.push(text);
        return { rows: [], rowCount: 0 };
      },
      async end() {
        calls.push("end");
      }
    } as unknown as pg.Pool);

    await pool.ping();
    await pool.close();

    assert.deepEqual(calls, ["select 1", "end"]);
  });
});
