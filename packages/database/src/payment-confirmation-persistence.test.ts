import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CompleteInternalOrderService,
  ConfirmPaymentService,
  HmacTicketReferenceGenerator,
  type IdGenerator
} from "@ticket-platform/application";
import { createPaymentConfirmationPersistence } from "./payment-confirmation-persistence.js";
import type {
  SqlConnection,
  SqlConnectionPool,
  SqlQueryResult
} from "./postgres.js";

interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

describe("PostgreSQL payment confirmation persistence", () => {
  it("atomically confirms payment, captures wallet, consumes inventory, and issues tickets", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.payment_attempts attempt")) {
        return rows([]);
      }
      if (text.includes("from public.orders") && text.includes("for update")) {
        return rows([orderRow]);
      }
      if (text.includes("from public.order_items item")) {
        return rows([orderItemRow]);
      }
      if (text.includes("from public.wallet_holds hold")) {
        return rows([walletHoldRow]);
      }
      if (text.includes("from public.wallet_hold_entries allocation")) {
        return rows([walletAllocationRow]);
      }
      return affected();
    });
    const idGenerator = sequenceIdGenerator(20);
    const persistence = createPaymentConfirmationPersistence(
      new FakePool(connection),
      idGenerator
    );
    const service = new ConfirmPaymentService(
      persistence.paymentConfirmationRepository,
      persistence.outboxWriter,
      persistence.unitOfWork,
      idGenerator,
      new HmacTicketReferenceGenerator("s".repeat(32))
    );

    const result = await service.execute({
      orderId: orderRow.id,
      idempotencyKey: "manual:payment:1",
      source: "manual",
      amountKopecks: "239000",
      currency: "RUB",
      confirmedAt,
      actor: { type: "admin", adminId: "admin-1" },
      manualEvidence: {
        method: "bank_transfer",
        externalReference: "bank-reference-1",
        reason: "Payment verified by sales manager",
        requestId: "request-1"
      }
    });

    assert.equal(result.status, "paid");
    assert.equal(result.ticketCount, 2);
    assert.equal(result.walletCapturedKopecks, "10000");
    assert.match(
      findQuery(connection, "pg_advisory_xact_lock").text,
      /hashtextextended/
    );
    assert.equal(
      findQuery(connection, "insert into public.payment_attempts").values[5],
      "manual:payment:1"
    );
    assert.equal(
      findQuery(connection, "insert into public.manual_payments").values[3],
      "admin-1"
    );
    assert.equal(findQuery(connection, "update public.orders").values[0], orderRow.id);
    assert.equal(
      findQuery(connection, "update public.inventory_reservations").values[0],
      orderRow.id
    );
    assert.equal(
      findQuery(connection, "insert into public.wallet_transactions").values[2],
      `order_capture:${orderRow.id}`
    );
    assert.equal(
      findQuery(connection, "insert into public.wallet_entries").values[3],
      "10000"
    );
    assert.equal(findQueries(connection, "insert into public.tickets").length, 2);
    assert.equal(
      findQuery(connection, "insert into public.order_status_history").values[2],
      "awaiting_payment"
    );
    assert.equal(
      findQuery(connection, "insert into public.audit_log").values[1],
      "admin-1"
    );
    assert.equal(findQueries(connection, "insert into public.outbox_events").length, 3);
    assert.equal(connection.queries.at(-1)?.text, "commit");
  });

  it("confirms the existing T-Bank attempt with webhook evidence in the same transaction", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.payment_attempts attempt")) {
        return rows([]);
      }
      if (text.includes("from public.orders") && text.includes("for update")) {
        return rows([orderRow]);
      }
      if (text.includes("from public.order_items item")) {
        return rows([orderItemRow]);
      }
      if (text.includes("from public.wallet_holds hold")) {
        return rows([walletHoldRow]);
      }
      if (text.includes("from public.wallet_hold_entries allocation")) {
        return rows([walletAllocationRow]);
      }
      return affected();
    });
    const idGenerator = sequenceIdGenerator(20);
    const persistence = createPaymentConfirmationPersistence(
      new FakePool(connection),
      idGenerator
    );
    const service = new ConfirmPaymentService(
      persistence.paymentConfirmationRepository,
      persistence.outboxWriter,
      persistence.unitOfWork,
      idGenerator,
      new HmacTicketReferenceGenerator("s".repeat(32))
    );
    const paymentAttemptId = "019c0123-4567-789a-bcde-000000000100";

    await service.execute({
      orderId: orderRow.id,
      idempotencyKey: `tbank_init:${orderRow.id}:1`,
      source: "tbank",
      amountKopecks: "239000",
      currency: "RUB",
      confirmedAt,
      actor: { type: "payment_provider" },
      providerEvidence: {
        origin: "webhook",
        paymentAttemptId,
        eventRecordId: "019c0123-4567-789a-bcde-000000000101",
        eventKey: "b".repeat(64),
        providerPaymentId: "1234567890",
        merchantOrderId: "tb_019c01234567789abcdef0123456789a_1",
        providerStatus: "CONFIRMED",
        providerErrorCode: "0",
        payloadHash: "a".repeat(64)
      }
    });

    assert.equal(findQueries(connection, "insert into public.payment_attempts").length, 0);
    assert.equal(
      findQuery(connection, "update public.payment_attempts").values[0],
      paymentAttemptId
    );
    assert.equal(
      findQuery(connection, "insert into public.payment_provider_events").values[2],
      "b".repeat(64)
    );
    assert.equal(findQueries(connection, "insert into public.tickets").length, 2);
    assert.equal(connection.queries.at(-1)?.text, "commit");
  });

  it("internally confirms a wallet-only order and captures its hold", async () => {
    const internalOrderRow = {
      ...orderRow,
      user_id: "00000000-0000-4000-8000-000000000031",
      event_id: "00000000-0000-4000-8000-000000000032",
      wallet_applied_kopecks: "249000",
      external_due_kopecks: "0"
    };
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.payment_attempts attempt")) {
        return rows([]);
      }
      if (text.includes("from public.orders") && text.includes("for update")) {
        return rows([internalOrderRow]);
      }
      if (text.includes("from public.order_items item")) {
        return rows([orderItemRow]);
      }
      if (text.includes("from public.wallet_holds hold")) {
        return rows([{
          ...walletHoldRow,
          amount_kopecks: "249000",
          cached_held_kopecks: "249000"
        }]);
      }
      if (text.includes("from public.wallet_hold_entries allocation")) {
        return rows([{ ...walletAllocationRow, amount_kopecks: "249000" }]);
      }
      return affected();
    });
    const idGenerator = sequenceIdGenerator(20);
    const persistence = createPaymentConfirmationPersistence(
      new FakePool(connection),
      idGenerator
    );
    const confirmation = new ConfirmPaymentService(
      persistence.paymentConfirmationRepository,
      persistence.outboxWriter,
      persistence.unitOfWork,
      idGenerator,
      new HmacTicketReferenceGenerator("s".repeat(32))
    );

    const result = await new CompleteInternalOrderService(confirmation).execute({
      orderId: internalOrderRow.id,
      userId: internalOrderRow.user_id,
      eventId: internalOrderRow.event_id,
      currency: "RUB",
      idempotencyKey: `scenario_internal:${internalOrderRow.id}`,
      completedAt: confirmedAt
    });

    assert.equal(result.amountKopecks, "0");
    assert.equal(result.walletCapturedKopecks, "249000");
    assert.equal(
      findQuery(connection, "insert into public.payment_attempts").values[2],
      "internal"
    );
    assert.deepEqual(
      JSON.parse(String(
        findQuery(connection, "insert into public.payment_attempts").values[8]
      )),
      {
        schemaVersion: 1,
        actorType: "system",
        reason: "zero_external_due",
        userId: internalOrderRow.user_id,
        eventId: internalOrderRow.event_id
      }
    );
    assert.equal(
      findQuery(connection, "insert into public.wallet_transactions").values[2],
      `order_capture:${internalOrderRow.id}`
    );
    assert.equal(findQueries(connection, "insert into public.tickets").length, 2);
  });

  it("internally confirms a free order without creating wallet ledger rows", async () => {
    const freeOrderRow = {
      ...orderRow,
      user_id: "00000000-0000-4000-8000-000000000041",
      event_id: "00000000-0000-4000-8000-000000000042",
      total_kopecks: "0",
      wallet_applied_kopecks: "0",
      external_due_kopecks: "0"
    };
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.payment_attempts attempt")) {
        return rows([]);
      }
      if (text.includes("from public.orders") && text.includes("for update")) {
        return rows([freeOrderRow]);
      }
      if (text.includes("from public.order_items item")) {
        return rows([orderItemRow]);
      }
      if (text.includes("from public.wallet_holds hold")) {
        return rows([]);
      }
      return affected();
    });
    const idGenerator = sequenceIdGenerator(20);
    const persistence = createPaymentConfirmationPersistence(
      new FakePool(connection),
      idGenerator
    );
    const confirmation = new ConfirmPaymentService(
      persistence.paymentConfirmationRepository,
      persistence.outboxWriter,
      persistence.unitOfWork,
      idGenerator,
      new HmacTicketReferenceGenerator("s".repeat(32))
    );

    const result = await new CompleteInternalOrderService(confirmation).execute({
      orderId: freeOrderRow.id,
      userId: freeOrderRow.user_id,
      eventId: freeOrderRow.event_id,
      currency: "RUB",
      idempotencyKey: `scenario_internal:${freeOrderRow.id}`,
      completedAt: confirmedAt
    });

    assert.equal(result.amountKopecks, "0");
    assert.equal(result.walletCapturedKopecks, "0");
    assert.equal(findQueries(connection, "insert into public.wallet_transactions").length, 0);
    assert.equal(findQueries(connection, "insert into public.wallet_entries").length, 0);
    assert.equal(findQueries(connection, "insert into public.tickets").length, 2);
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

function sequenceIdGenerator(count: number): IdGenerator {
  let index = 0;
  return {
    newId() {
      index += 1;
      if (index > count) {
        throw new Error("No generated ID left in test fixture");
      }
      return `019c0123-4567-789a-bcde-${index.toString().padStart(12, "0")}`;
    }
  };
}

const confirmedAt = new Date("2026-07-24T12:20:00.000Z");

const orderRow = {
  id: "019c0123-4567-789a-bcde-f0123456789a",
  number: "BP-20260724-4567789ABCDEF0123456789A",
  user_id: "user-1",
  event_id: "event-1",
  status: "awaiting_payment",
  currency: "RUB",
  total_kopecks: "249000",
  wallet_applied_kopecks: "10000",
  external_due_kopecks: "239000",
  offer_version_id: "offer-1",
  offer_accepted_at: new Date("2026-07-24T12:10:00.000Z"),
  expires_at: new Date("2026-07-24T12:30:00.000Z")
} as const;

const orderItemRow = {
  id: "item-1",
  quantity: 2,
  reservation_status: "active",
  reservation_expires_at: new Date("2026-07-24T12:30:00.000Z")
} as const;

const walletHoldRow = {
  id: "hold-1",
  wallet_account_id: "wallet-1",
  amount_kopecks: "10000",
  cached_held_kopecks: "10000"
} as const;

const walletAllocationRow = {
  source_entry_id: "credit-1",
  amount_kopecks: "10000",
  bucket: "bonus"
} as const;
