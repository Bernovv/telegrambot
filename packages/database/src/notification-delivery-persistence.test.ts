import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PostgresNotificationContextRepository,
  PostgresNotificationDeliveryLedger
} from "./notification-delivery-persistence.js";
import type {
  SqlConnection,
  SqlConnectionPool,
  SqlQueryResult
} from "./postgres.js";

interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

describe("PostgreSQL notification delivery persistence", () => {
  it("loads paid ticket and administrator contexts through the order owner", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("(select count(*)::text")) {
        return rows([adminContextRow]);
      }
      if (text.includes("from public.orders orders")) {
        return rows([ticketOrderContextRow]);
      }
      if (text.includes("from public.tickets")) {
        return rows(ticketRows);
      }
      if (text.includes("from public.users users")) {
        return rows([{
          recipient_external_user_id: "123456789",
          recipient_blocked: false
        }]);
      }
      return affected();
    });
    const repository = new PostgresNotificationContextRepository(
      new FakePool(connection)
    );

    const tickets = await repository.getTicketDeliveryContext(
      orderId,
      ticketRows.map((ticket) => ticket.id),
      ownerUserId
    );
    const admin = await repository.getAdminPurchaseContext(orderId);
    const scenario = await repository.getScenarioDeliveryContext(ownerUserId);

    assert.equal(tickets?.recipientExternalUserId, "123456789");
    assert.equal(tickets?.tickets.length, 2);
    assert.equal(admin?.username, "buyer");
    assert.equal(admin?.ticketCount, 2);
    assert.equal(admin?.totalKopecks, 249_000n);
    assert.equal(scenario?.recipientExternalUserId, "123456789");
    assert.match(
      findQuery(connection, "from public.orders orders").text,
      /orders\.status in \('paid', 'partially_refunded'\)/
    );
    assert.match(
      findQuery(connection, "from public.tickets").text,
      /owner_user_id = \$3/
    );
    assert.match(
      findQuery(connection, "from public.users users").text,
      /channel = 'telegram'/
    );
  });

  it("loads the questionnaire intro context for a paid order, or null when the order is not paid", async () => {
    const found = new FakeConnection(() => rows([{
      event_title: "Business Picnic",
      recipient_external_user_id: "123456789",
      recipient_blocked: false
    }]));
    const repository = new PostgresNotificationContextRepository(new FakePool(found));

    const context = await repository.getQuestionnaireIntroContext(orderId);

    assert.deepEqual(context, {
      eventTitle: "Business Picnic",
      recipientExternalUserId: "123456789",
      recipientBlocked: false
    });
    assert.match(
      findQuery(found, "from public.orders orders").text,
      /orders\.status in \('paid', 'partially_refunded'\)/
    );

    const notFound = new FakeConnection(() => rows([]));
    const missingRepository = new PostgresNotificationContextRepository(new FakePool(notFound));
    assert.equal(await missingRepository.getQuestionnaireIntroContext(orderId), null);
  });

  it("loads the reminder recipient context by user and event, or null when the event is unknown", async () => {
    const found = new FakeConnection(() => rows([{
      event_title: "Business Picnic",
      recipient_external_user_id: "123456789",
      recipient_blocked: false
    }]));
    const repository = new PostgresNotificationContextRepository(new FakePool(found));

    const context = await repository.getReminderContext(ownerUserId, "event-1");

    assert.deepEqual(context, {
      eventTitle: "Business Picnic",
      recipientExternalUserId: "123456789",
      recipientBlocked: false
    });
    assert.match(findQuery(found, "from public.events e").text, /left join lateral/);

    const notFound = new FakeConnection(() => rows([]));
    const missingRepository = new PostgresNotificationContextRepository(new FakePool(notFound));
    assert.equal(await missingRepository.getReminderContext(ownerUserId, "unknown-event"), null);
  });

  it("loads a broadcast's message and its distinct reachable recipients, or null when unknown", async () => {
    const found = new FakeConnection((text) => {
      if (text.includes("from public.admin_broadcasts")) {
        return rows([{
          message_text: "Скоро старт!",
          is_test: false,
          target_event_id: "event-1",
          target_order_status: "paid"
        }]);
      }
      return rows([
        { user_id: "user-1", recipient_external_user_id: "201" },
        { user_id: "user-2", recipient_external_user_id: "202" }
      ]);
    });
    const repository = new PostgresNotificationContextRepository(new FakePool(found));

    const context = await repository.getBroadcastContext(broadcastId);

    assert.deepEqual(context, {
      messageText: "Скоро старт!",
      isTest: false,
      recipients: [
        { userId: "user-1", recipientExternalUserId: "201" },
        { userId: "user-2", recipientExternalUserId: "202" }
      ]
    });
    const audience = findQuery(found, "from public.orders o");
    assert.match(audience.text, /is_bot_blocked = false/);
    // Фильтры приходят параметрами, а не подзапросом по кампании: тот же запрос считает
    // получателей в админке до отправки.
    assert.deepEqual(audience.values, ["event-1", "paid"]);

    const notFound = new FakeConnection(() => rows([]));
    const missingRepository = new PostgresNotificationContextRepository(new FakePool(notFound));
    assert.equal(await missingRepository.getBroadcastContext(broadcastId), null);
  });

  it("не ходит за аудиторией для пробной рассылки: получателей подставит воркер", async () => {
    const connection = new FakeConnection(() => rows([{
      message_text: "Проверка",
      is_test: true,
      target_event_id: null,
      target_order_status: null
    }]));
    const repository = new PostgresNotificationContextRepository(new FakePool(connection));

    const context = await repository.getBroadcastContext(broadcastId);

    assert.deepEqual(context, { messageText: "Проверка", isTest: true, recipients: [] });
    assert.equal(connection.queries.filter((query) => query.text.includes("from public.orders o")).length, 0);
  });

  it("помечает заблокировавшего бота, чтобы следующая рассылка его не трогала", async () => {
    const connection = new FakeConnection(() => affected());
    const repository = new PostgresNotificationContextRepository(new FakePool(connection));

    await repository.markRecipientBlocked("user-1");

    const update = findQuery(connection, "set is_bot_blocked = true");
    assert.match(update.text, /channel = 'telegram' and is_bot_blocked = false/);
    assert.deepEqual(update.values, ["user-1"]);
  });

  it("transitions a broadcast from pending to sending, then to completed with final counts", async () => {
    const connection = new FakeConnection(() => affected());
    const repository = new PostgresNotificationContextRepository(new FakePool(connection));
    const at = new Date("2026-07-27T10:05:00.000Z");

    await repository.markBroadcastSending(broadcastId, at);
    await repository.markBroadcastCompleted(broadcastId, 2, 0, at);

    const sendingUpdate = findQuery(connection, "status = 'sending', started_at");
    assert.match(sendingUpdate.text, /where id = \$1 and status = 'pending'/);
    assert.deepEqual(sendingUpdate.values, [broadcastId, at]);

    const completedUpdate = findQuery(connection, "status = 'completed'");
    assert.match(completedUpdate.text, /where id = \$1 and status = 'sending'/);
    assert.deepEqual(completedUpdate.values, [broadcastId, 2, 0, at]);
  });

  it("claims with a lease and marks sent only for the lease owner", async () => {
    const connection = new FakeConnection((text) => {
      if (
        text.includes("update public.notification_deliveries")
        && text.includes("returning id, status")
      ) {
        return rows([{ id: "delivery-1", status: "sending" }]);
      }
      return affected();
    });
    const ledger = new PostgresNotificationDeliveryLedger(new FakePool(connection));
    const claimedAt = new Date("2026-07-24T12:21:00.000Z");

    const claim = await ledger.claim({
      deliveryId: "delivery-1",
      idempotencyKey: "telegram:ticket:ticket-1",
      sourceEventId: "019c0123-4567-789a-bcde-f01234567890",
      kind: "ticket_user",
      aggregateId: "ticket-1",
      recipientId: "123456789",
      workerId: "worker-1",
      claimedAt,
      leaseSeconds: 60
    });
    await ledger.markSent("delivery-1", "worker-1", "telegram-message-1", claimedAt);

    assert.deepEqual(claim, { state: "claimed", deliveryId: "delivery-1" });
    assert.equal(connection.queries[0]?.text, "begin");
    assert.match(
      findQuery(connection, "on conflict (idempotency_key)").text,
      /do nothing/
    );
    assert.match(
      findQuery(connection, "returning id, status").text,
      /lease_expires_at/
    );
    assert.equal(
      findQuery(connection, "provider_message_id = $3").values[1],
      "worker-1"
    );
    assert.ok(connection.queries.some((query) => query.text === "commit"));
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

const orderId = "019c0123-4567-789a-bcde-f0123456789a";
const ownerUserId = "019c0123-4567-789a-bcde-f0123456789d";
const broadcastId = "019c0123-4567-789a-bcde-f0123456789e";

const ticketOrderContextRow = {
  order_id: orderId,
  order_number: "BP-ORDER",
  event_title: "Business Picnic",
  recipient_external_user_id: "123456789",
  recipient_blocked: false
} as const;

const ticketRows = [
  {
    id: "019c0123-4567-789a-bcde-f0123456789b",
    ticket_number: "BP-ORDER-T001"
  },
  {
    id: "019c0123-4567-789a-bcde-f0123456789c",
    ticket_number: "BP-ORDER-T002"
  }
] as const;

const adminContextRow = {
  order_id: orderId,
  order_number: "BP-ORDER",
  user_id: ownerUserId,
  event_title: "Business Picnic",
  username: "buyer",
  ticket_count: "2",
  total_kopecks: "249000",
  wallet_applied_kopecks: "10000",
  external_due_kopecks: "239000"
} as const;
