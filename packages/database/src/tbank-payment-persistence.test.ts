import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { IdGenerator } from "@ticket-platform/application";
import { createTBankPaymentPersistence } from "./tbank-payment-persistence.js";
import type {
  SqlConnection,
  SqlConnectionPool,
  SqlQueryResult
} from "./postgres.js";

interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

describe("PostgreSQL T-Bank payment persistence", () => {
  it("locks an owner-bound payable order and creates one initializing attempt", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.orders orders")) {
        return rows([orderRow]);
      }
      if (text.includes("from public.payment_attempts") && text.includes("limit 1")) {
        return rows([]);
      }
      return affected();
    });
    const persistence = createTBankPaymentPersistence(
      new FakePool(connection),
      idGenerator
    );

    const prepared = await persistence.initializationRepository.prepare({
      publicOrderTokenHash: "a".repeat(64),
      senderExternalUserId: "777",
      requestedAt
    });

    assert.equal(prepared.status, "created");
    if (prepared.status === "created") {
      assert.equal(prepared.attempt.merchantOrderId, "tb_019c01234567789abcdef0123456789a_1");
      assert.equal(prepared.attempt.amountKopecks, "239000");
    }
    assert.match(findQuery(connection, "from public.orders orders").text, /for update of orders/);
    assert.equal(
      findQuery(connection, "insert into public.payment_attempts").values[5],
      `tbank_init:${orderRow.id}:1`
    );
    assert.equal(findQuery(connection, "update public.orders").values[0], orderRow.id);
    assert.equal(
      findQuery(connection, "insert into public.order_status_history").values[2],
      `tbank_payment_started:${ATTEMPT_ID}`
    );
    assert.equal(connection.queries.at(-1)?.text, "commit");
  });

  it("reuses a pending URL while the order remains in payment processing", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.orders orders")) {
        return rows([{ ...orderRow, status: "payment_processing" }]);
      }
      if (text.includes("from public.payment_attempts") && text.includes("limit 1")) {
        return rows([pendingAttemptRow]);
      }
      return affected();
    });
    const persistence = createTBankPaymentPersistence(
      new FakePool(connection),
      idGenerator
    );

    const prepared = await persistence.initializationRepository.prepare({
      publicOrderTokenHash: "a".repeat(64),
      senderExternalUserId: "777",
      requestedAt
    });

    assert.equal(prepared.status, "pending");
    assert.equal(findQueries(connection, "insert into public.payment_attempts").length, 0);
    assert.equal(findQueries(connection, "update public.orders").length, 0);
  });

  it("stores a provider status once and does not repeat its transition", async () => {
    let eventInsertCount = 0;
    const connection = new FakeConnection((text) => {
      if (text.includes("insert into public.payment_provider_events")) {
        eventInsertCount += 1;
        return eventInsertCount === 1
          ? rows([{ id: EVENT_ID }])
          : rows([]);
      }
      return affected();
    });
    const persistence = createTBankPaymentPersistence(
      new FakePool(connection),
      idGenerator
    );
    const input = {
      eventRecordId: EVENT_ID,
      attempt: webhookAttempt,
      event: webhookEvent,
      internalStatus: "authorized" as const,
      outcome: "processed" as const,
      receivedAt: requestedAt
    };

    assert.equal(
      await persistence.webhookRepository.recordStatusEvent(input),
      "recorded"
    );
    assert.equal(
      await persistence.webhookRepository.recordStatusEvent(input),
      "duplicate"
    );
    assert.equal(findQueries(connection, "update public.payment_attempts").length, 1);
  });

  it("returns a cancelled provider payment to awaiting payment with history", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("insert into public.payment_provider_events")) {
        return rows([{ id: EVENT_ID }]);
      }
      return affected();
    });
    const persistence = createTBankPaymentPersistence(
      new FakePool(connection),
      idGenerator
    );

    await persistence.webhookRepository.recordStatusEvent({
      eventRecordId: EVENT_ID,
      attempt: webhookAttempt,
      event: { ...webhookEvent, status: "CANCELED", success: false },
      internalStatus: "cancelled",
      outcome: "processed",
      receivedAt: requestedAt
    });

    assert.equal(findQueries(connection, "update public.orders").length, 1);
    assert.equal(findQueries(connection, "insert into public.order_status_history").length, 1);
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

function findQueries(connection: FakeConnection, fragment: string): readonly RecordedQuery[] {
  return connection.queries.filter((candidate) => candidate.text.includes(fragment));
}

const ATTEMPT_ID = "019c0123-4567-789a-bcde-000000000001";
const EVENT_ID = "019c0123-4567-789a-bcde-000000000002";
const requestedAt = new Date("2026-07-24T13:00:00.000Z");

const idGenerator: IdGenerator = {
  newId() {
    return ATTEMPT_ID;
  }
};

const orderRow = {
  id: "019c0123-4567-789a-bcde-f0123456789a",
  number: "BP-20260724-001",
  status: "awaiting_payment",
  currency: "RUB",
  external_due_kopecks: "239000",
  offer_accepted_at: new Date("2026-07-24T12:10:00.000Z"),
  expires_at: new Date("2026-07-24T13:30:00.000Z"),
  item_count: "1",
  active_reservation_count: "1",
  unexpired_reservation_count: "1"
};

const webhookAttempt = {
  paymentAttemptId: ATTEMPT_ID,
  orderId: orderRow.id,
  idempotencyKey: `tbank_init:${orderRow.id}:1`,
  providerPaymentId: "1234567890",
  merchantOrderId: "tb_019c01234567789abcdef0123456789a_1",
  amountKopecks: "239000",
  currency: "RUB"
};

const webhookEvent = {
  providerPaymentId: "1234567890",
  merchantOrderId: webhookAttempt.merchantOrderId,
  status: "AUTHORIZED" as const,
  success: true,
  errorCode: "0",
  amountKopecks: 239000n,
  payloadHash: "a".repeat(64),
  eventKey: "b".repeat(64)
};

const pendingAttemptRow = {
  id: ATTEMPT_ID,
  order_id: orderRow.id,
  attempt_number: 1,
  status: "pending",
  amount_kopecks: "239000",
  currency: "RUB",
  idempotency_key: `tbank_init:${orderRow.id}:1`,
  merchant_order_id: webhookAttempt.merchantOrderId,
  provider_payment_id: "1234567890",
  payment_url: "https://securepay.tinkoff.ru/payment"
};
