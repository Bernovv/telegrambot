import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ExpireOrdersBatchService,
  type IdGenerator
} from "@ticket-platform/application";
import { createOrderExpiryPersistence } from "./order-expiry-persistence.js";
import type {
  SqlConnection,
  SqlConnectionPool,
  SqlQueryResult
} from "./postgres.js";

interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

describe("PostgreSQL order expiry persistence", () => {
  it("claims with SKIP LOCKED and atomically releases inventory, wallet, history, and outbox", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.orders")) {
        return rows([expiredOrderRow]);
      }
      if (text.includes("from public.wallet_holds hold")) {
        return rows([walletHoldRow]);
      }
      return affected();
    });
    const idGenerator = sequenceIdGenerator([
      "history-1",
      "wallet-transaction-1",
      "outbox-1"
    ]);
    const persistence = createOrderExpiryPersistence(new FakePool(connection));
    const service = new ExpireOrdersBatchService(
      persistence.orderExpiryRepository,
      persistence.outboxWriter,
      persistence.unitOfWork,
      idGenerator
    );

    const result = await service.execute({
      at: new Date("2026-07-24T12:30:00.000Z"),
      batchSize: 50
    });

    assert.deepEqual(result, {
      claimed: 1,
      expired: 1,
      walletReleasedKopecks: "10000"
    });
    assert.match(findQuery(connection, "from public.orders").text, /for update skip locked/);
    assert.equal(
      findQuery(connection, "update public.inventory_reservations").values[0],
      "order-1"
    );
    assert.equal(
      findQuery(connection, "insert into public.wallet_transactions").values[0],
      "wallet-transaction-1"
    );
    assert.deepEqual(
      findQuery(connection, "update public.wallet_accounts").values.slice(0, 2),
      ["wallet-1", "10000"]
    );
    assert.equal(
      findQuery(connection, "insert into public.order_status_history").values[0],
      "history-1"
    );
    assert.equal(findQuery(connection, "insert into public.outbox_events").values[0], "outbox-1");
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
  readonly queries: RecordedQuery[] = [];

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

function affected(): SqlQueryResult<never> {
  return { rows: [], rowCount: 1 };
}

function rows<TRow>(resultRows: readonly TRow[]): SqlQueryResult<TRow> {
  return { rows: resultRows, rowCount: resultRows.length };
}

function findQuery(connection: FakeConnection, fragment: string): RecordedQuery {
  const query = connection.queries.find((candidate) => candidate.text.includes(fragment));
  assert.ok(query, `Expected query containing: ${fragment}`);
  return query;
}

function sequenceIdGenerator(ids: readonly string[]): IdGenerator {
  let index = 0;
  return {
    newId() {
      const id = ids[index];
      index += 1;
      if (!id) {
        throw new Error("No generated ID left in test fixture");
      }
      return id;
    }
  };
}

const expiredOrderRow = {
  id: "order-1",
  user_id: "user-1",
  event_id: "event-1",
  status: "awaiting_payment",
  expires_at: new Date("2026-07-24T12:29:00.000Z"),
  wallet_applied_kopecks: "10000"
} as const;

const walletHoldRow = {
  id: "hold-1",
  wallet_account_id: "wallet-1",
  amount_kopecks: "10000",
  cached_held_kopecks: "10000"
} as const;
