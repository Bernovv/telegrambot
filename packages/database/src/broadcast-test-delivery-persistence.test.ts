import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ClaimedBroadcastTestDelivery } from "@ticket-platform/application";
import {
  PostgresBroadcastTestDeliveryRepository,
  type BroadcastTestDeliveryRow
} from "./broadcast-test-delivery-persistence.js";
import type {
  SqlConnection,
  SqlConnectionPool,
  SqlQueryResult
} from "./postgres.js";

describe("PostgresBroadcastTestDeliveryRepository", () => {
  it("queues the exact saved content with audit and outbox", async () => {
    const connection = new FakeConnection((text) => {
      if (
        text.includes("from public.broadcasts")
        && text.includes("for update")
      ) {
        return rows([{
          id: broadcastId,
          lock_version: 4,
          published_version_id: null
        }]);
      }
      if (text.includes("from public.broadcast_versions")) {
        return rows([{
          id: versionId,
          version_number: 2,
          schema_version: 2,
          content
        }]);
      }
      if (text.includes("from public.messenger_identities")) {
        return rows([{
          id: identityId,
          external_user_id: "123456789",
          first_name: "Иван",
          last_name: "Петров",
          display_name: "Иван Петров",
          username: "ivan_petrov"
        }]);
      }
      if (text.includes("insert into public.broadcast_test_deliveries")) {
        return rows([deliveryRow("queued")]);
      }
      return affected();
    });
    const repository = new PostgresBroadcastTestDeliveryRepository(
      new FakePool(connection)
    );

    const result = await repository.request({
      deliveryId,
      broadcastId,
      expectedLockVersion: 4,
      recipientTelegramUserId: "123456789",
      requestedEventId,
      audit
    });

    assert.equal(result.status, "queued");
    if (result.status !== "queued") {
      return;
    }
    assert.equal(result.value.versionNumber, 2);
    assert.equal(result.value.status, "queued");
    const insert = connection.queries.find(({ text }) =>
      text.includes("insert into public.broadcast_test_deliveries")
    );
    assert.deepEqual(JSON.parse(String(insert?.values[7])), content);
    assert.equal(insert?.values[8], 2);
    assert.deepEqual(
      JSON.parse(String(insert?.values[9])),
      personalizationContext
    );
    assert.ok(connection.queries.some(({ text }) =>
      text.includes("'broadcast.test_send_requested'")
    ));
    const event = connection.queries.find(({ text }) =>
      text.includes("insert into public.outbox_events")
    );
    assert.equal(event?.values[0], requestedEventId);
    assert.equal(event?.values[2], "BroadcastTestSendRequested");
    assert.equal(connection.queries.at(-1)?.text, "commit");
  });

  it("marks one expired lease uncertain before claiming the next test", async () => {
    const connection = new FakeConnection((text) => {
      if (
        text.includes("status = 'sending'")
        && text.includes("for update skip locked")
      ) {
        return rows([deliveryRow("sending", expiredDeliveryId)]);
      }
      if (
        text.includes("status = 'queued'")
        && text.includes("for update skip locked")
      ) {
        return rows([deliveryRow("queued")]);
      }
      if (
        text.includes("update public.broadcast_test_deliveries")
        && text.includes("returning")
      ) {
        return rows([deliveryRow("sending")]);
      }
      if (text.includes("from public.broadcast_delivery_rate_gate")) {
        return rows([{ next_delivery_at: null }]);
      }
      return affected();
    });
    const repository = new PostgresBroadcastTestDeliveryRepository(
      new FakePool(connection)
    );

    const result = await repository.claimNext({
      workerId: "worker-1",
      claimedAt,
      leaseSeconds: 60,
      uncertainEventId
    });

    assert.deepEqual(result, claimed);
    assert.ok(connection.queries.some(({ text }) =>
      text.includes("error_code = 'WorkerLeaseExpired'")
    ));
    const event = connection.queries.find(({ values }) =>
      values[0] === uncertainEventId
    );
    assert.equal(event?.values[2], "BroadcastTestSendUncertain");
    const gate = connection.queries.find(({ text }) =>
      text.includes("update public.broadcast_delivery_rate_gate")
    );
    assert.equal(
      (gate?.values[0] as Date).toISOString(),
      "2026-07-30T20:00:00.040Z"
    );
  });

  it("defers a queued test while the shared Telegram rate gate is closed", async () => {
    const connection = new FakeConnection((text) => {
      if (
        text.includes("status = 'sending'")
        && text.includes("for update skip locked")
      ) {
        return rows([]);
      }
      if (
        text.includes("status = 'queued'")
        && text.includes("for update skip locked")
      ) {
        return rows([deliveryRow("queued")]);
      }
      if (text.includes("from public.broadcast_delivery_rate_gate")) {
        return rows([{
          next_delivery_at: new Date(claimedAt.getTime() + 20)
        }]);
      }
      return affected();
    });
    const repository = new PostgresBroadcastTestDeliveryRepository(
      new FakePool(connection)
    );

    const result = await repository.claimNext({
      workerId: "worker-1",
      claimedAt,
      leaseSeconds: 60,
      uncertainEventId
    });

    assert.equal(result, null);
    assert.equal(
      connection.queries.some(({ text }) =>
        text.includes("attempt_count = 1")
      ),
      false
    );
  });

  it("finishes a leased test and appends its result event atomically", async () => {
    const connection = new FakeConnection(() => affected());
    const repository = new PostgresBroadcastTestDeliveryRepository(
      new FakePool(connection)
    );

    await repository.markSent({
      delivery: claimed,
      workerId: "worker-1",
      providerMessageId: "77",
      sentAt: claimedAt,
      lifecycleEventId
    });

    const update = connection.queries.find(({ text }) =>
      text.includes("update public.broadcast_test_deliveries")
    );
    assert.equal(update?.values[2], "sent");
    assert.equal(update?.values[3], "77");
    const event = connection.queries.find(({ text }) =>
      text.includes("insert into public.outbox_events")
    );
    assert.equal(event?.values[0], lifecycleEventId);
    assert.equal(event?.values[2], "BroadcastTestSendSent");
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
  readonly queries: { text: string; values: readonly unknown[] }[] = [];
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

function rows<TRow>(values: readonly TRow[]): SqlQueryResult<TRow> {
  return { rows: values, rowCount: values.length };
}

function affected(): SqlQueryResult<never> {
  return { rows: [], rowCount: 1 };
}

function deliveryRow(
  status: "queued" | "sending",
  id = deliveryId
): BroadcastTestDeliveryRow {
  return {
    id,
    broadcast_id: broadcastId,
    broadcast_version_id: versionId,
    version_number: 2,
    schema_version: 2,
    recipient_external_user_id: "123456789",
    content,
    personalization_context: personalizationContext,
    status,
    provider_message_id: null,
    error_code: null,
    requested_at: claimedAt,
    started_at: status === "sending" ? claimedAt : null,
    finished_at: null
  };
}

const claimedAt = new Date("2026-07-30T20:00:00.000Z");
const broadcastId = "00000000-0000-4000-8000-000000000801";
const versionId = "00000000-0000-4000-8000-000000000802";
const deliveryId = "00000000-0000-4000-8000-000000000803";
const expiredDeliveryId = "00000000-0000-4000-8000-000000000804";
const identityId = "00000000-0000-4000-8000-000000000805";
const requestedEventId = "00000000-0000-4000-8000-000000000806";
const uncertainEventId = "00000000-0000-4000-8000-000000000807";
const lifecycleEventId = "00000000-0000-4000-8000-000000000808";
const audit = {
  auditId: "00000000-0000-4000-8000-000000000809",
  actorAdminId: "00000000-0000-4000-8000-000000000101",
  actorRole: "content_manager",
  reason: "Проверка текста",
  requestId: "request-123",
  ipAddress: "127.0.0.1",
  userAgent: "test",
  occurredAt: claimedAt
};
const content = {
  text: "Тест",
  disableLinkPreview: true,
  buttons: []
};
const personalizationContext = {
  firstName: "Иван",
  lastName: "Петров",
  displayName: "Иван Петров",
  telegramUsername: "ivan_petrov"
};
const claimed: ClaimedBroadcastTestDelivery = {
  deliveryId,
  broadcastId,
  recipientId: "123456789",
  schemaVersion: 2,
  content,
  personalizationContext
};
