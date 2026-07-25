import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTBankReconciliationPersistence } from "./tbank-reconciliation-persistence.js";
import type {
  SqlConnection,
  SqlConnectionPool,
  SqlQueryResult
} from "./postgres.js";

interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

describe("PostgreSQL T-Bank reconciliation persistence", () => {
  it("claims a bounded batch using an expiring SKIP LOCKED lease", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("with candidates as")) {
        return rows([claimRow]);
      }
      return affected();
    });
    const repository = createTBankReconciliationPersistence(
      new FakePool(connection)
    );

    const claims = await repository.claimBatch({
      workerId: "worker:test",
      at,
      olderThan: new Date("2026-07-25T11:59:00.000Z"),
      batchSize: 10,
      leaseSeconds: 60
    });

    assert.equal(claims.length, 1);
    assert.equal(claims[0]?.reconciliationAttemptCount, 3);
    assert.equal(claims[0]?.leaseOwner, "worker:test");
    const query = findQuery(connection, "with candidates as");
    assert.match(query.text, /for update of attempt skip locked/);
    assert.deepEqual(query.values.slice(3), [10, 60]);
  });

  it("releases the order only when the repeated-empty threshold is reached", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("reconciliation_empty_count = reconciliation_empty_count + 1")) {
        return rows([{
          order_id: claimRow.order_id,
          reconciliation_empty_count: 3
        }]);
      }
      return affected();
    });
    const repository = createTBankReconciliationPersistence(
      new FakePool(connection)
    );

    const outcome = await repository.recordEmpty({
      claim,
      eventId: EVENT_ID,
      responseHash: "a".repeat(64),
      observedAt: at,
      nextAttemptAt: new Date("2026-07-25T12:05:00.000Z"),
      releaseAfterCount: 3,
      historyId: HISTORY_ID
    });

    assert.equal(outcome, "released");
    assert.equal(
      findQuery(connection, "insert into public.payment_reconciliation_events").values[2],
      "empty"
    );
    assert.equal(findQuery(connection, "update public.orders").values[0], claim.orderId);
    assert.equal(
      findQuery(connection, "insert into public.order_status_history").values[2],
      "tbank_reconciliation_empty"
    );
  });

  it("binds an observed terminal payment and returns the order to payment", async () => {
    const connection = new FakeConnection((text) => {
      if (
        text.includes("update public.payment_attempts")
        && text.includes("provider_payment_id = coalesce")
      ) {
        return rows([{
          order_id: claimRow.order_id,
          reconciliation_empty_count: 0
        }]);
      }
      return affected();
    });
    const repository = createTBankReconciliationPersistence(
      new FakePool(connection)
    );

    await repository.recordObserved({
      claim,
      eventId: EVENT_ID,
      eventKey: "b".repeat(64),
      responseHash: "a".repeat(64),
      payment: {
        providerPaymentId: "1234567890",
        amountKopecks: 239000n,
        status: "CANCELED",
        success: false,
        errorCode: "0"
      },
      observedAt: at,
      nextAttemptAt: null,
      historyId: HISTORY_ID
    });

    const update = findQuery(connection, "provider_payment_id = coalesce");
    assert.equal(update.values[2], "1234567890");
    assert.equal(update.values[4], "cancelled");
    assert.equal(findQueries(connection, "update public.orders").length, 1);
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
  const query = connection.queries.find((candidate) =>
    candidate.text.includes(fragment)
  );
  assert.ok(query, `Expected query containing: ${fragment}`);
  return query;
}

function findQueries(
  connection: FakeConnection,
  fragment: string
): readonly RecordedQuery[] {
  return connection.queries.filter((candidate) =>
    candidate.text.includes(fragment)
  );
}

const at = new Date("2026-07-25T12:00:00.000Z");
const EVENT_ID = "00000000-0000-4000-8000-000000000010";
const HISTORY_ID = "00000000-0000-4000-8000-000000000011";

const claimRow = {
  payment_attempt_id: "00000000-0000-4000-8000-000000000001",
  order_id: "00000000-0000-4000-8000-000000000002",
  idempotency_key: "tbank_init:order-1:1",
  merchant_order_id: "tb_order_1",
  amount_kopecks: "239000",
  currency: "RUB",
  reconciliation_attempt_count: 3,
  reconciliation_empty_count: 2,
  reconciliation_locked_by: "worker:test"
};

const claim = {
  paymentAttemptId: claimRow.payment_attempt_id,
  orderId: claimRow.order_id,
  idempotencyKey: claimRow.idempotency_key,
  merchantOrderId: claimRow.merchant_order_id,
  amountKopecks: claimRow.amount_kopecks,
  currency: claimRow.currency,
  reconciliationAttemptCount: claimRow.reconciliation_attempt_count,
  emptyObservationCount: claimRow.reconciliation_empty_count,
  leaseOwner: claimRow.reconciliation_locked_by
};
