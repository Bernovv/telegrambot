import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ClaimedBroadcastDelivery } from "@ticket-platform/application";
import { PostgresBroadcastDeliveryRepository } from "./broadcast-delivery-persistence.js";
import type {
  SqlConnection,
  SqlConnectionPool,
  SqlQueryResult
} from "./postgres.js";

describe("PostgresBroadcastDeliveryRepository", () => {
  it("claims one due delivery under global and campaign rate locks", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.broadcast_delivery_rate_gate")) {
        return rows([{ next_delivery_at: null }]);
      }
      if (text.includes("join public.broadcast_versions")) {
        return rows([{
          id: broadcastId,
          rate_per_second: 10,
          next_delivery_at: null,
          schema_version: 2,
          content
        }]);
      }
      if (
        text.includes("from public.broadcast_deliveries")
        && text.includes("for update skip locked")
      ) {
        return rows([{
          id: deliveryId,
          user_id: userId,
          telegram_identity_id: identityId,
          recipient_external_user_id: "123456789",
          personalization_context: personalizationContext,
          attempt_count: 0
        }]);
      }
      if (
        text.includes("update public.broadcast_deliveries")
        && text.includes("returning id")
      ) {
        return rows([{
          id: deliveryId,
          user_id: userId,
          telegram_identity_id: identityId,
          recipient_external_user_id: "123456789",
          personalization_context: personalizationContext,
          attempt_count: 1
        }]);
      }
      return affected();
    });
    const repository = new PostgresBroadcastDeliveryRepository(
      new FakePool(connection)
    );

    const result = await repository.claimNext({
      workerId: "worker-1",
      claimedAt,
      leaseSeconds: 60,
      lifecycleEventId: eventId
    });

    assert.deepEqual(result, {
      deliveryId,
      broadcastId,
      userId,
      telegramIdentityId: identityId,
      recipientId: "123456789",
      schemaVersion: 2,
      content,
      personalizationContext,
      attemptCount: 1
    });
    assert.ok(connection.queries.some(({ text }) =>
      text.includes("for update of broadcasts skip locked")
    ));
    assert.ok(connection.queries.some(({ text }) =>
      text.includes("attempted_recipient_count")
    ));
    const gateUpdate = connection.queries.find(({ text }) =>
      text.includes("update public.broadcast_delivery_rate_gate")
    );
    assert.equal(
      (gateUpdate?.values[0] as Date).toISOString(),
      "2026-07-30T12:00:00.040Z"
    );
  });

  it("marks a blocked recipient and automatically pauses a failing campaign", async () => {
    const connection = new FakeConnection((text) => {
      if (
        text.includes("select lifecycle_status")
        && text.includes("from public.broadcasts")
        && text.includes("for update")
      ) {
        return rows([{ lifecycle_status: "sending" }]);
      }
      if (text.includes("returning attempted_recipient_count")) {
        return rows([{
          attempted_recipient_count: "20",
          failed_recipient_count: "6"
        }]);
      }
      return affected();
    });
    const repository = new PostgresBroadcastDeliveryRepository(
      new FakePool(connection)
    );

    const result = await repository.markFailed({
      delivery,
      workerId: "worker-1",
      failedAt: claimedAt,
      errorCode: "TelegramRecipientBlocked",
      retryAt: null,
      blocked: true,
      autoPauseMinimumAttempts: 20,
      autoPauseFailurePercent: 30,
      lifecycleEventId: eventId
    });

    assert.deepEqual(result, { broadcastStatus: "paused" });
    assert.ok(connection.queries.some(({ text }) =>
      text.includes("is_bot_blocked = true")
    ));
    assert.ok(connection.queries.some(({ text }) =>
      text.includes("auto_pause_reason = 'automatic_failure_rate'")
    ));
    assert.ok(connection.queries.some(({ text, values }) =>
      text.includes("insert into public.outbox_events")
      && values[2] === "BroadcastAutoPaused"
    ));
  });

  it("settles an in-flight failure after cancellation without another retry", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("select lifecycle_status")) {
        return rows([{ lifecycle_status: "cancelled" }]);
      }
      if (text.includes("returning attempted_recipient_count")) {
        return rows([{
          attempted_recipient_count: "1",
          failed_recipient_count: "1"
        }]);
      }
      if (
        text.includes("from public.broadcast_deliveries")
        && text.includes("status in")
      ) {
        return rows([]);
      }
      if (
        text.includes("update public.broadcasts")
        && text.includes("lifecycle_status = 'completed'")
      ) {
        return { rows: [], rowCount: 0 };
      }
      return affected();
    });
    const repository = new PostgresBroadcastDeliveryRepository(
      new FakePool(connection)
    );

    const result = await repository.markFailed({
      delivery,
      workerId: "worker-1",
      failedAt: claimedAt,
      errorCode: "TelegramTransportError",
      retryAt: new Date("2026-07-30T12:00:05.000Z"),
      blocked: false,
      autoPauseMinimumAttempts: 20,
      autoPauseFailurePercent: 30,
      lifecycleEventId: eventId
    });

    assert.deepEqual(result, { broadcastStatus: "cancelled" });
    const deliveryUpdate = connection.queries.find(({ text }) =>
      text.includes("update public.broadcast_deliveries")
    );
    assert.equal(deliveryUpdate?.values[3], null);
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

const claimedAt = new Date("2026-07-30T12:00:00.000Z");
const broadcastId = "00000000-0000-4000-8000-000000000901";
const deliveryId = "00000000-0000-4000-8000-000000000902";
const userId = "00000000-0000-4000-8000-000000000903";
const identityId = "00000000-0000-4000-8000-000000000904";
const eventId = "00000000-0000-4000-8000-000000000905";
const content = {
  text: "Новости мероприятия",
  disableLinkPreview: true,
  buttons: [{ label: "Открыть", url: "https://example.com/event" }]
};
const personalizationContext = {
  firstName: "Иван",
  lastName: "Петров",
  displayName: "Иван Петров",
  telegramUsername: "ivan_petrov"
};
const delivery: ClaimedBroadcastDelivery = {
  deliveryId,
  broadcastId,
  userId,
  telegramIdentityId: identityId,
  recipientId: "123456789",
  schemaVersion: 2,
  content,
  personalizationContext,
  attemptCount: 1
};
