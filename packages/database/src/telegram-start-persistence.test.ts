import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HandleTelegramStartService, type IdGenerator } from "@ticket-platform/application";
import {
  PostgresUnitOfWork,
  TransactionSession,
  type SqlConnection,
  type SqlConnectionPool,
  type SqlQueryResult
} from "./postgres.js";
import { createTelegramStartPersistence } from "./telegram-start-persistence.js";

interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

describe("PostgresUnitOfWork", () => {
  it("commits work on one connection and releases it", async () => {
    const connection = new FakeConnection();
    const session = new TransactionSession();
    const unitOfWork = new PostgresUnitOfWork(new FakePool(connection), session);

    const result = await unitOfWork.transact(async () => {
      await session.query("select 1");
      return "done";
    });

    assert.equal(result, "done");
    assert.deepEqual(connection.queries.map((query) => query.text), ["begin", "select 1", "commit"]);
    assert.equal(connection.released, true);
  });

  it("rolls back and releases the connection when work fails", async () => {
    const connection = new FakeConnection();
    const session = new TransactionSession();
    const unitOfWork = new PostgresUnitOfWork(new FakePool(connection), session);

    await assert.rejects(
      unitOfWork.transact(async () => {
        await session.query("select fails");
        throw new Error("failed work");
      }),
      /failed work/
    );

    assert.deepEqual(connection.queries.map((query) => query.text), ["begin", "select fails", "rollback"]);
    assert.equal(connection.released, true);
  });
});

describe("Telegram start PostgreSQL persistence", () => {
  it("stores a new identity, attribution, outbox event, and idempotency key atomically", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("returning key")) {
        return rows([{ key: "telegram_update:1001" }]);
      }

      if (text.includes("from public.messenger_identities")) {
        return rows([]);
      }

      if (text.includes("update public.idempotency_keys")) {
        return affected();
      }

      return empty();
    });
    const idGenerator = sequenceIdGenerator([
      "user-id",
      "identity-id",
      "username-history-id",
      "touchpoint-id",
      "event-id"
    ]);
    const persistence = createTelegramStartPersistence(new FakePool(connection), idGenerator);
    const service = new HandleTelegramStartService(
      persistence.identityRepository,
      persistence.idempotencyRepository,
      persistence.outboxWriter,
      persistence.unitOfWork,
      idGenerator
    );

    const result = await service.execute({
      channel: "telegram" as const,
      updateId: "1001",
      receivedAt: new Date("2026-07-21T12:00:00.000Z"),
      startPayload: "event_business_picnic__partner_partner42",
      user: {
        externalUserId: "777",
        username: "@Owner",
        firstName: "Oleg",
        languageCode: "ru"
      }
    });

    assert.deepEqual(result, {
      userId: "user-id",
      messengerIdentityId: "identity-id",
      isNewUser: true,
      phoneRequired: true,
      selectedEventSlug: "business_picnic"
    });
    assert.equal(connection.released, true);
    assert.equal(findQuery(connection, "insert into public.users").values[0], "user-id");
    assert.equal(findQuery(connection, "insert into public.user_touchpoints").values[6], "partner42");
    assert.equal(findQuery(connection, "insert into public.outbox_events").values[0], "event-id");
    assert.deepEqual(findQuery(connection, "insert into public.idempotency_keys").values, [
      "telegram_update:1001",
      "telegram_update",
      new Date("2026-07-21T12:00:00.000Z")
    ]);
    assert.equal(connection.queries.at(-1)?.text, "commit");
  });

  it("does not repeat attribution or outbox effects for an acquired key conflict", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("returning key")) {
        return empty();
      }

      if (text.includes("from public.messenger_identities")) {
        return rows([
          {
            messenger_identity_id: "identity-id",
            user_id: "user-id",
            phone_status: "verified",
            username: "owner",
            username_normalized: "owner"
          }
        ]);
      }

      return empty();
    });
    const idGenerator = sequenceIdGenerator([]);
    const persistence = createTelegramStartPersistence(new FakePool(connection), idGenerator);
    const service = new HandleTelegramStartService(
      persistence.identityRepository,
      persistence.idempotencyRepository,
      persistence.outboxWriter,
      persistence.unitOfWork,
      idGenerator
    );

    const result = await service.execute({
      channel: "telegram" as const,
      updateId: "1001",
      receivedAt: new Date("2026-07-21T12:00:00.000Z"),
      startPayload: "partner_partner42",
      user: { externalUserId: "777", username: "owner" }
    });

    assert.equal(result.phoneRequired, false);
    assert.equal(connection.queries.some((query) => query.text.includes("user_touchpoints")), false);
    assert.equal(connection.queries.some((query) => query.text.includes("outbox_events")), false);
    assert.equal(connection.queries.some((query) => query.text.includes("update public.idempotency_keys")), false);
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
    private readonly respond: (text: string, values: readonly unknown[]) => SqlQueryResult<unknown> = empty
  ) {}

  async query<TRow>(text: string, values: readonly unknown[] = []): Promise<SqlQueryResult<TRow>> {
    this.queries.push({ text, values });
    return this.respond(text, values) as SqlQueryResult<TRow>;
  }

  release(): void {
    this.released = true;
  }
}

function empty(): SqlQueryResult<never> {
  return { rows: [], rowCount: 0 };
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
