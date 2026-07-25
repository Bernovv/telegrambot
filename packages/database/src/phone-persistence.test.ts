import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HandleTelegramContactService,
  type IdGenerator,
  type PhoneNormalizer
} from "@ticket-platform/application";
import {
  type SqlConnection,
  type SqlConnectionPool,
  type SqlQueryResult
} from "./postgres.js";
import { createPhonePersistence } from "./phone-persistence.js";

interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

describe("phone verification PostgreSQL persistence", () => {
  it("commits contact verification, one bonus credit, and outbox events together", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("insert into public.idempotency_keys")) {
        return rows([{ key: "telegram_update:2001" }]);
      }

      if (text.includes("from public.messenger_identities")) {
        return rows([{ user_id: "user-id" }]);
      }

      if (text.includes("c.id as contact_id")) {
        return rows([{ contact_id: null, verification_status: null }]);
      }

      if (text.includes("from public.wallet_accounts wa")) {
        return empty();
      }

      if (text.includes("from public.wallet_credit_campaigns")) {
        return rows([
          {
            id: "campaign-id",
            amount_kopecks: "10000",
            currency: "RUB",
            credit_expires_at: null
          }
        ]);
      }

      if (text.includes("from public.wallet_accounts") && text.includes("for update")) {
        return empty();
      }

      if (text.includes("insert into public.wallet_accounts")) {
        return rows([{ id: "wallet-id", status: "active", cached_available_kopecks: "0" }]);
      }

      if (text.includes("update public.wallet_accounts")) {
        return rows([{ cached_available_kopecks: "10000" }]);
      }

      if (text.includes("update public.wallet_transactions")) {
        return affected();
      }

      if (text.includes("update public.idempotency_keys")) {
        return affected();
      }

      return empty();
    });
    const idGenerator = sequenceIdGenerator([
      "contact-id",
      "wallet-id",
      "wallet-transaction-id",
      "wallet-entry-id",
      "phone-event-id",
      "bonus-event-id"
    ]);
    const persistence = createPhonePersistence(new FakePool(connection), idGenerator);
    const phoneNormalizer: PhoneNormalizer = {
      normalize() {
        return "+79990000000";
      }
    };
    const service = new HandleTelegramContactService(
      phoneNormalizer,
      persistence.telegramUserResolver,
      persistence.phoneRepository,
      persistence.phoneBonusRepository,
      persistence.idempotencyRepository,
      persistence.outboxWriter,
      persistence.unitOfWork,
      idGenerator
    );

    const result = await service.execute({
      updateId: "2001",
      senderExternalUserId: "777",
      contact: { externalUserId: "777", phoneNumber: "8 999 000-00-00" },
      receivedAt: new Date("2026-07-22T08:00:00.000Z")
    });

    assert.deepEqual(result, {
      accepted: true,
      phoneNewlyVerified: true,
      bonusCredited: true,
      bonusReason: "credited",
      bonusAmountKopecks: "10000",
      availableBalanceKopecks: "10000"
    });
    assert.equal(findQuery(connection, "insert into public.user_contacts").values[0], "contact-id");
    assert.deepEqual(findQuery(connection, "insert into public.wallet_entries").values.slice(0, 4), [
      "wallet-entry-id",
      "wallet-id",
      "wallet-transaction-id",
      "10000"
    ]);
    assert.equal(
      connection.queries.filter((query) => query.text.includes("insert into public.outbox_events")).length,
      2
    );
    assert.equal(connection.queries.at(-1)?.text, "commit");
    assert.equal(connection.released, true);
  });

  it("returns an existing posted bonus before looking up an active campaign", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.wallet_accounts wa")) {
        return rows([
          {
            status: "posted",
            amount_kopecks: "10000",
            cached_available_kopecks: "12500",
            currency: "RUB"
          }
        ]);
      }

      return empty();
    });
    const idGenerator = sequenceIdGenerator([]);
    const persistence = createPhonePersistence(new FakePool(connection), idGenerator);

    const result = await persistence.unitOfWork.transact(() =>
      persistence.phoneBonusRepository.creditPhoneBonus({
        userId: "user-id",
        idempotencyKey: "phone_bonus:user-id",
        occurredAt: new Date("2026-07-22T08:00:00.000Z")
      })
    );

    assert.deepEqual(result, {
      credited: false,
      reason: "already_credited",
      amount: 10_000n,
      availableBalance: 12_500n,
      currency: "RUB"
    });
    assert.equal(
      connection.queries.some((query) => query.text.includes("wallet_credit_campaigns")),
      false
    );
    assert.equal(
      connection.queries.some((query) => query.text.includes("insert into public.wallet_entries")),
      false
    );
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
    private readonly respond: (text: string, values: readonly unknown[]) => SqlQueryResult<unknown>
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
