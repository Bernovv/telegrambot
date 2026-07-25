import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTBankRefundPersistence } from "./tbank-refund-persistence.js";
import type {
  SqlConnection,
  SqlConnectionPool,
  SqlQueryResult
} from "./postgres.js";

interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

describe("PostgreSQL T-Bank refund persistence", () => {
  it("atomically prepares an immutable full-refund intent and audit record", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("where refund.idempotency_key")) {
        return rows([]);
      }
      if (text.includes("from public.orders orders")) {
        return rows([orderRow]);
      }
      if (text.includes("from public.payment_attempts") && text.includes("order_id")) {
        return rows([attemptRow]);
      }
      if (text.includes("from public.payment_refund_requests") && text.includes("status in")) {
        return rows([]);
      }
      return affected();
    });
    const repository = createTBankRefundPersistence(new FakePool(connection));

    const result = await repository.prepare(prepareInput);

    assert.equal(result.status, "created");
    assert.equal(result.refund.refundRequestId, REFUND_ID);
    assert.equal(connection.queries[0]?.text, "begin");
    assert.equal(
      findQuery(connection, "insert into public.payment_refund_requests").values[0],
      REFUND_ID
    );
    assert.equal(
      findQuery(connection, "insert into public.audit_log").values[0],
      AUDIT_ID
    );
    assert.ok(
      queryIndex(connection, "pg_advisory_xact_lock")
        < queryIndex(connection, "from public.orders orders")
    );
    assert.equal(connection.queries.at(-1)?.text, "commit");
  });

  it("refuses a refund when any ticket has already been checked in", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("where refund.idempotency_key")) {
        return rows([]);
      }
      if (text.includes("from public.orders orders")) {
        return rows([{ ...orderRow, checked_in_ticket_count: "1" }]);
      }
      return affected();
    });
    const repository = createTBankRefundPersistence(new FakePool(connection));

    const result = await repository.prepare(prepareInput);

    assert.deepEqual(result, { status: "unavailable" });
    assert.equal(
      connection.queries.some((query) =>
        query.text.includes("insert into public.payment_refund_requests")
      ),
      false
    );
  });

  it("finalizes order, payment, every ticket, and wallet reversal in one transaction", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("where refund.id = $1")) {
        return rows([lockedRefundRow]);
      }
      if (text.includes("from public.orders orders")) {
        return rows([orderRow]);
      }
      if (text.includes("from public.payment_attempts") && text.includes("where id = $1")) {
        return rows([attemptRow]);
      }
      if (text.includes("from public.wallet_accounts account")) {
        return rows([{
          wallet_account_id: "00000000-0000-4000-8000-000000000020",
          capture_transaction_id: "00000000-0000-4000-8000-000000000021"
        }]);
      }
      if (text.includes("update public.tickets")) {
        return { rows: [], rowCount: 2 };
      }
      return affected();
    });
    const repository = createTBankRefundPersistence(new FakePool(connection));

    const result = await repository.finalize({
      refund,
      evidence: {
        eventId: EVENT_ID,
        eventKey: "b".repeat(64),
        origin: "webhook",
        providerStatus: "REFUNDED",
        responseHash: "c".repeat(64),
        observedAt: at
      },
      historyId: HISTORY_ID,
      walletTransactionId: WALLET_TRANSACTION_ID,
      walletEntryId: WALLET_ENTRY_ID,
      auditId: COMPLETE_AUDIT_ID
    });

    assert.equal(result, "completed");
    assert.match(findQuery(connection, "update public.tickets").text, /status = 'issued'/);
    const walletTransaction = findQuery(
      connection,
      "insert into public.wallet_transactions"
    );
    assert.equal(walletTransaction.values[0], WALLET_TRANSACTION_ID);
    assert.equal(
      walletTransaction.values[6],
      "00000000-0000-4000-8000-000000000021"
    );
    assert.equal(
      findQuery(connection, "insert into public.wallet_entries").values[3],
      refund.walletAmountKopecks
    );
    assert.equal(
      findQuery(connection, "insert into public.audit_log").values[0],
      COMPLETE_AUDIT_ID
    );
    assert.equal(connection.queries.at(-1)?.text, "commit");
  });

  it("claims refunds with SKIP LOCKED and guards result writes by lease owner", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("with candidates as")) {
        return rows([{
          ...lockedRefundRow,
          reconciliation_locked_by: "worker:test",
          reconciliation_attempt_count: 4
        }]);
      }
      return affected();
    });
    const repository = createTBankRefundPersistence(new FakePool(connection));

    const claims = await repository.claimReconciliationBatch({
      workerId: "worker:test",
      at,
      batchSize: 10,
      leaseSeconds: 120
    });
    const claimed = claims[0];
    assert.ok(claimed);
    await repository.recordProviderResult({
      refund: claimed,
      eventId: EVENT_ID,
      resultStatus: "submitted",
      resultCode: "STATUS:REFUNDING",
      origin: "reconciliation",
      eventKey: null,
      providerStatus: "REFUNDING",
      responseHash: "c".repeat(64),
      observedAt: at,
      nextAttemptAt: new Date("2026-07-25T14:01:00.000Z"),
      leaseOwner: "worker:test"
    });

    assert.match(findQuery(connection, "with candidates as").text, /skip locked/);
    assert.equal(claims[0]?.attemptCount, 4);
    const update = findQuery(connection, "set status = $2");
    assert.match(update.text, /reconciliation_locked_by = \$8/);
    assert.equal(update.values[7], "worker:test");
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

function queryIndex(connection: FakeConnection, fragment: string): number {
  const index = connection.queries.findIndex((candidate) =>
    candidate.text.includes(fragment)
  );
  assert.notEqual(index, -1, `Expected query containing: ${fragment}`);
  return index;
}

const at = new Date("2026-07-25T14:00:00.000Z");
const REFUND_ID = "00000000-0000-4000-8000-000000000001";
const AUDIT_ID = "00000000-0000-4000-8000-000000000002";
const EVENT_ID = "00000000-0000-4000-8000-000000000003";
const HISTORY_ID = "00000000-0000-4000-8000-000000000004";
const WALLET_TRANSACTION_ID = "00000000-0000-4000-8000-000000000005";
const WALLET_ENTRY_ID = "00000000-0000-4000-8000-000000000006";
const COMPLETE_AUDIT_ID = "00000000-0000-4000-8000-000000000007";

const orderRow = {
  id: "00000000-0000-4000-8000-000000000010",
  user_id: "00000000-0000-4000-8000-000000000011",
  status: "paid",
  currency: "RUB",
  external_due_kopecks: "239000",
  wallet_applied_kopecks: "10000",
  ticket_count: "2",
  checked_in_ticket_count: "0"
};

const attemptRow = {
  id: "00000000-0000-4000-8000-000000000012",
  status: "succeeded",
  provider_payment_id: "1234567890",
  merchant_order_id: "tb_order_1",
  amount_kopecks: "239000",
  currency: "RUB"
};

const lockedRefundRow = {
  refund_request_id: REFUND_ID,
  order_id: orderRow.id,
  payment_attempt_id: attemptRow.id,
  provider_payment_id: attemptRow.provider_payment_id,
  merchant_order_id: attemptRow.merchant_order_id,
  external_request_id: "7c4934c2-95e8-4a96-a28a-73b7762e3112",
  external_amount_kopecks: orderRow.external_due_kopecks,
  wallet_amount_kopecks: orderRow.wallet_applied_kopecks,
  currency: orderRow.currency,
  request_hash: "a".repeat(64),
  status: "submitted",
  requested_by_admin_id: "00000000-0000-4000-8000-000000000013",
  reason: "Customer requested cancellation"
} as const;

const refund = {
  refundRequestId: lockedRefundRow.refund_request_id,
  orderId: lockedRefundRow.order_id,
  paymentAttemptId: lockedRefundRow.payment_attempt_id,
  providerPaymentId: lockedRefundRow.provider_payment_id,
  merchantOrderId: lockedRefundRow.merchant_order_id,
  externalRequestId: lockedRefundRow.external_request_id,
  externalAmountKopecks: lockedRefundRow.external_amount_kopecks,
  walletAmountKopecks: lockedRefundRow.wallet_amount_kopecks,
  currency: lockedRefundRow.currency,
  requestHash: lockedRefundRow.request_hash,
  status: "submitted"
} as const;

const prepareInput = {
  refundRequestId: REFUND_ID,
  auditId: AUDIT_ID,
  externalRequestId: lockedRefundRow.external_request_id,
  orderId: orderRow.id,
  idempotencyKey: "refund:order-1:full",
  requestHash: lockedRefundRow.request_hash,
  reason: lockedRefundRow.reason,
  requestedByAdminId: lockedRefundRow.requested_by_admin_id,
  requestedAt: at
};
