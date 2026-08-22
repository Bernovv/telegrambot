import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RequestTelegramTicketRedeliveryService,
  type IdGenerator
} from "@ticket-platform/application";
import {
  createTelegramTicketAccessPersistence,
  PostgresTelegramTicketAccessRepository
} from "./ticket-access-persistence.js";
import {
  TransactionSession,
  type SqlConnection,
  type SqlConnectionPool,
  type SqlQueryResult
} from "./postgres.js";

interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

describe("PostgreSQL Telegram ticket access persistence", () => {
  it("lists tickets by the resolved Telegram owner", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("select identity.user_id")) {
        return rows([{ user_id: ownerUserId }]);
      }
      if (text.includes("from public.tickets tickets")) {
        return rows([ticketSummaryRow]);
      }
      return affected();
    });
    const repository = new PostgresTelegramTicketAccessRepository(
      new FakePool(connection),
      new TransactionSession()
    );

    const result = await repository.listForTelegramUser({ channel: "telegram", externalUserId: "123456789" });

    assert.deepEqual(result, [{
      ticketId,
      ticketNumber: "BP-ORDER-T001",
      orderNumber: "BP-ORDER",
      eventTitle: "Business Picnic",
      status: "issued",
      issuedAt: "2026-07-24T12:00:00.000Z"
    }]);
    assert.deepEqual(
      findQuery(connection, "select identity.user_id").values,
      ["123456789", "telegram"]
    );
    assert.deepEqual(
      findQuery(connection, "order by tickets.issued_at").values,
      [ownerUserId]
    );
    assert.equal(connection.released, true);
  });

  it("locks the owned ticket and commits idempotency plus outbox atomically", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("for update of tickets")) {
        return rows([redeliverableRow]);
      }
      if (text.includes("insert into public.idempotency_keys")) {
        return rows([{ key: "telegram_update:9001" }]);
      }
      return affected();
    });
    const persistence = createTelegramTicketAccessPersistence(new FakePool(connection));
    const service = new RequestTelegramTicketRedeliveryService(
      persistence.ticketAccessRepository,
      persistence.idempotencyRepository,
      persistence.outboxWriter,
      persistence.unitOfWork,
      fixedIdGenerator(eventId)
    );

    const result = await service.execute({
      channel: "telegram" as const,
      ticketId,
      senderExternalUserId: "123456789",
      updateId: "9001",
      requestedAt: new Date("2026-07-24T14:00:00.000Z")
    });

    assert.equal(result.accepted, true);
    assert.match(findQuery(connection, "for update of tickets").text, /identity\.external_user_id = \$2/);
    assert.deepEqual(
      findQuery(connection, "for update of tickets").values,
      [ticketId, "123456789", "telegram"]
    );
    const outbox = findQuery(connection, "insert into public.outbox_events");
    assert.equal(outbox.values[0], eventId);
    assert.equal(outbox.values[3], "TicketRedeliveryRequested");
    assert.deepEqual(JSON.parse(String(outbox.values[5])), {
      orderId,
      ownerUserId,
      ticketIds: [ticketId]
    });
    assert.equal(connection.queries.at(-1)?.text, "commit");
    assert.equal(connection.released, true);
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
  released = false;

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

  release(): void {
    this.released = true;
  }
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

function fixedIdGenerator(id: string): IdGenerator {
  return { newId() { return id; } };
}

const ticketId = "019c0123-4567-789a-bcde-f0123456789a";
const orderId = "019c0123-4567-789a-bcde-f0123456789b";
const ownerUserId = "019c0123-4567-789a-bcde-f0123456789c";
const eventId = "019c0123-4567-789a-bcde-f0123456789d";

const ticketSummaryRow = {
  ticket_id: ticketId,
  ticket_number: "BP-ORDER-T001",
  order_number: "BP-ORDER",
  event_title: "Business Picnic",
  status: "issued",
  issued_at: new Date("2026-07-24T12:00:00.000Z")
} as const;

const redeliverableRow = {
  ticket_id: ticketId,
  ticket_number: "BP-ORDER-T001",
  order_id: orderId,
  owner_user_id: ownerUserId,
  status: "issued"
} as const;
