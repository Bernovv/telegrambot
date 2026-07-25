import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AcceptTelegramOfferService,
  type IdGenerator
} from "@ticket-platform/application";
import { createOfferAcceptancePersistence } from "./offer-acceptance-persistence.js";
import type {
  SqlConnection,
  SqlConnectionPool,
  SqlQueryResult
} from "./postgres.js";

interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

describe("PostgreSQL offer acceptance persistence", () => {
  it("locks the owned order and commits evidence, transition history, and outbox atomically", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.orders o")) {
        return rows([acceptanceRow]);
      }
      return affected();
    });
    const idGenerator = sequenceIdGenerator([
      "acceptance-1",
      "history-1",
      "outbox-1"
    ]);
    const persistence = createOfferAcceptancePersistence(new FakePool(connection));
    const service = new AcceptTelegramOfferService(
      persistence.offerAcceptanceRepository,
      persistence.outboxWriter,
      persistence.unitOfWork,
      idGenerator
    );

    const result = await service.execute({
      publicOrderToken: "a".repeat(43),
      senderExternalUserId: "777",
      updateId: "1003",
      callbackQueryId: "callback-1",
      messageId: "42",
      acceptedAt: new Date("2026-07-24T12:05:00.000Z")
    });

    assert.equal(result.accepted, true);
    assert.match(findQuery(connection, "from public.orders o").text, /for update of o/);
    assert.equal(findQuery(connection, "update public.orders").values[0], "order-1");
    assert.deepEqual(
      findQuery(connection, "insert into public.offer_acceptances").values.slice(0, 4),
      ["acceptance-1", "user-1", "order-1", "offer-version-1"]
    );
    assert.equal(
      findQuery(connection, "insert into public.order_status_history").values[0],
      "history-1"
    );
    assert.equal(findQuery(connection, "insert into public.outbox_events").values[0], "outbox-1");
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

const acceptanceRow = {
  id: "order-1",
  number: "BP-000001",
  user_id: "user-1",
  messenger_identity_id: "identity-1",
  event_id: "event-1",
  status: "awaiting_offer",
  currency: "RUB",
  total_kopecks: "249000",
  wallet_applied_kopecks: "10000",
  external_due_kopecks: "239000",
  offer_version_id: "offer-version-1",
  display_text_snapshot: "Я принимаю оферту",
  offer_accepted_at: null,
  expires_at: new Date("2026-07-24T12:30:00.000Z")
} as const;
