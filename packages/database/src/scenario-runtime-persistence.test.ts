import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AdvanceTelegramScenarioService,
  ResumeTelegramScenarioAfterOfferService,
  ResumeTelegramScenarioAfterPaymentService,
  StartTelegramScenarioService,
  SubmitTelegramScenarioInputService,
  type IdGenerator
} from "@ticket-platform/application";
import {
  createScenarioRuntimePersistence
} from "./scenario-runtime-persistence.js";
import type {
  SqlConnection,
  SqlConnectionPool,
  SqlQueryResult
} from "./postgres.js";

describe("PostgreSQL scenario runtime persistence", () => {
  it("creates a session pinned to the event's published version", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.scenario_events")) {
        return rows([]);
      }
      if (text.includes("from public.events")) {
        return rows([{
          id: eventId,
          published_scenario_version_id: versionId
        }]);
      }
      if (
        text.includes("from public.scenario_sessions")
        && text.includes("user_id = $1")
      ) {
        return rows([]);
      }
      if (text.includes("from public.scenario_versions")) {
        return rows([{ id: versionId, schema_version: 1 }]);
      }
      if (text.includes("from public.scenario_nodes")) {
        return rows(nodeRows);
      }
      if (text.includes("from public.scenario_edges")) {
        return rows(edgeRows);
      }
      return affected();
    });
    const persistence = createScenarioRuntimePersistence(
      new FakePool(connection),
      sequentialIds()
    );
    const service = new StartTelegramScenarioService(
      persistence.repository,
      persistence.unitOfWork,
      fixedId(sessionId)
    );

    const result = await service.execute({
      userId,
      messengerIdentityId,
      eventSlug: "business-breakthrough",
      updateId: "5001",
      occurredAt
    });

    assert.equal(result.handled, true);
    const insert = findQuery(connection, "insert into public.scenario_sessions");
    assert.equal(insert.values[4], versionId);
    assert.equal(insert.values[5], startNodeId);
    assert.match(
      findQuery(connection, "pg_advisory_xact_lock").values[0] as string,
      new RegExp(`${userId}:${eventId}:telegram$`)
    );
    assert.equal(
      findQuery(connection, "idempotency_key, schema_version").values[5],
      "telegram_update:5001:scenario_start"
    );
    assert.equal(connection.queries.at(-1)?.text, "commit");
  });

  it("locks transitions through the owner identity and keeps the pinned version", async () => {
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.scenario_events")) {
        return rows([]);
      }
      if (text.includes("for update of sessions")) {
        return rows([{
          id: sessionId,
          scenario_version_id: versionId,
          current_node_id: menuNodeId,
          lock_version: 3,
          status: "waiting_input",
          expires_at: new Date("2026-07-27T12:00:00.000Z"),
          context: {}
        }]);
      }
      if (text.includes("from public.scenario_versions")) {
        return rows([{ id: versionId, schema_version: 1 }]);
      }
      if (text.includes("from public.scenario_nodes")) {
        return rows(nodeRows);
      }
      if (text.includes("from public.scenario_edges")) {
        return rows(edgeRows);
      }
      return affected();
    });
    const persistence = createScenarioRuntimePersistence(
      new FakePool(connection),
      sequentialIds()
    );
    const service = new AdvanceTelegramScenarioService(
      persistence.repository,
      persistence.unitOfWork
    );

    const result = await service.execute({
      sessionId,
      edgeId,
      senderExternalUserId: "777",
      updateId: "5002",
      callbackQueryId: "callback-1",
      occurredAt
    });

    assert.equal(result.accepted, true);
    const lock = findQuery(connection, "for update of sessions");
    assert.match(lock.text, /identity\.external_user_id = \$2/);
    assert.deepEqual(lock.values, [sessionId, "777"]);
    assert.deepEqual(
      findQuery(connection, "lock_version = $2").values.slice(0, 4),
      [sessionId, 3, endNodeId, "completed"]
    );
    assert.equal(connection.queries.at(-1)?.text, "commit");
  });

  it("locks typed input by owner and stores validated context atomically", async () => {
    const inputNodes = [
      {
        id: numberInputNodeId,
        node_type: "number_input",
        schema_version: 1,
        payload: {
          text: "How many tickets?",
          contextKey: "adultQuantity",
          minimum: 1,
          maximum: 5
        }
      },
      {
        id: endNodeId,
        node_type: "end",
        schema_version: 1,
        payload: { text: "Done" }
      }
    ] as const;
    const inputEdges = [{
      id: inputEdgeId,
      from_node_id: numberInputNodeId,
      to_node_id: endNodeId,
      label: null,
      priority: 0,
      condition: {}
    }] as const;
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.scenario_events")) {
        return rows([]);
      }
      if (
        text.includes("for update of sessions")
        && text.includes("node.node_type in")
      ) {
        return rows([{
          id: sessionId,
          scenario_version_id: versionId,
          current_node_id: numberInputNodeId,
          lock_version: 4,
          context: { eventSlug: "business-breakthrough" }
        }]);
      }
      if (text.includes("from public.scenario_versions")) {
        return rows([{ id: versionId, schema_version: 1 }]);
      }
      if (text.includes("from public.scenario_nodes")) {
        return rows(inputNodes);
      }
      if (text.includes("from public.scenario_edges")) {
        return rows(inputEdges);
      }
      return affected();
    });
    const persistence = createScenarioRuntimePersistence(
      new FakePool(connection),
      sequentialIds()
    );
    const service = new SubmitTelegramScenarioInputService(
      persistence.repository,
      persistence.unitOfWork
    );

    const result = await service.execute({
      senderExternalUserId: "777",
      updateId: "5003",
      text: "3",
      occurredAt
    });

    assert.equal(result.handled, true);
    assert.equal(result.handled && result.accepted, true);
    const lock = findQuery(connection, "node.node_type in");
    assert.match(lock.text, /identity\.external_user_id = \$1/);
    assert.match(lock.text, /limit 2/);
    assert.deepEqual(lock.values, ["777", occurredAt]);
    const update = findQuery(connection, "context = context || $9::jsonb");
    assert.deepEqual(update.values.slice(0, 4), [
      sessionId,
      4,
      endNodeId,
      "completed"
    ]);
    assert.deepEqual(JSON.parse(update.values[4] as string), {
      type: "input",
      contextKeys: ["adultQuantity"]
    });
    assert.deepEqual(JSON.parse(update.values[8] as string), {
      adultQuantity: 3
    });
    assert.equal(
      findQuery(connection, "idempotency_key, schema_version").values[5],
      "telegram_update:5003:scenario_input"
    );
    assert.equal(connection.queries.at(-1)?.text, "commit");
  });

  it("resumes only the owner session bound to the accepted order", async () => {
    const actionNodes = [
      {
        id: offerNodeId,
        node_type: "offer_acceptance",
        schema_version: 1,
        payload: {}
      },
      {
        id: paymentNodeId,
        node_type: "payment_start",
        schema_version: 1,
        payload: {}
      },
      {
        id: endNodeId,
        node_type: "end",
        schema_version: 1,
        payload: {}
      }
    ] as const;
    const actionEdges = [
      {
        id: offerEdgeId,
        from_node_id: offerNodeId,
        to_node_id: paymentNodeId,
        label: null,
        priority: 0,
        condition: {}
      },
      {
        id: paymentEdgeId,
        from_node_id: paymentNodeId,
        to_node_id: endNodeId,
        label: null,
        priority: 0,
        condition: {}
      }
    ] as const;
    const context = {
      order: {
        orderId,
        orderNumber: "BP-000001",
        publicToken: "a".repeat(43),
        offerPublicUrl: "https://example.test/offers/offer-version-1",
        status: "awaiting_offer",
        currency: "RUB",
        totalKopecks: "249000",
        walletAppliedKopecks: "0",
        externalDueKopecks: "249000",
        expiresAt: "2026-07-26T12:30:00.000Z"
      }
    };
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.scenario_events")) {
        return rows([]);
      }
      if (text.includes("context #>> '{order,orderId}'")) {
        return rows([{
          id: sessionId,
          user_id: userId,
          event_id: eventId,
          scenario_version_id: versionId,
          current_node_id: offerNodeId,
          lock_version: 5,
          context
        }]);
      }
      if (text.includes("from public.scenario_versions")) {
        return rows([{ id: versionId, schema_version: 1 }]);
      }
      if (text.includes("from public.scenario_nodes")) {
        return rows(actionNodes);
      }
      if (text.includes("from public.scenario_edges")) {
        return rows(actionEdges);
      }
      return affected();
    });
    const persistence = createScenarioRuntimePersistence(
      new FakePool(connection),
      sequentialIds()
    );
    const service = new ResumeTelegramScenarioAfterOfferService(
      persistence.repository,
      persistence.unitOfWork
    );

    const result = await service.execute({
      orderId,
      senderExternalUserId: "777",
      updateId: "5004",
      occurredAt
    });

    assert.equal(result.handled, true);
    const lock = findQuery(connection, "context #>> '{order,orderId}'");
    assert.deepEqual(lock.values, [
      orderId,
      "777",
      "offer_acceptance",
      occurredAt
    ]);
    assert.match(lock.text, /identity\.external_user_id = \$2/);
    assert.match(lock.text, /limit 2/);
    assert.deepEqual(
      findQuery(connection, "lock_version = $2").values.slice(0, 4),
      [sessionId, 5, paymentNodeId, "waiting_input"]
    );
    assert.equal(
      (
        JSON.parse(
          findQuery(connection, "lock_version = $2").values[8] as string
        ) as { order: { status: string } }
      ).order.status,
      "awaiting_payment"
    );
    assert.equal(connection.queries.at(-1)?.text, "commit");
  });

  it("continues only a paid order session and appends its presentation", async () => {
    const context = {
      order: {
        orderId,
        orderNumber: "BP-000001",
        publicToken: "a".repeat(43),
        offerPublicUrl: "https://example.test/offers/offer-version-1",
        status: "awaiting_payment",
        currency: "RUB",
        totalKopecks: "249000",
        walletAppliedKopecks: "0",
        externalDueKopecks: "249000",
        expiresAt: "2026-07-26T12:30:00.000Z"
      }
    };
    const connection = new FakeConnection((text) => {
      if (text.includes("from public.scenario_events")) {
        return rows([]);
      }
      if (text.includes("join public.orders orders")) {
        return rows([{
          id: sessionId,
          user_id: userId,
          event_id: eventId,
          scenario_version_id: versionId,
          current_node_id: paymentNodeId,
          lock_version: 6,
          context
        }]);
      }
      if (text.includes("from public.scenario_versions")) {
        return rows([{ id: versionId, schema_version: 1 }]);
      }
      if (text.includes("from public.scenario_nodes")) {
        return rows([
          {
            id: paymentNodeId,
            node_type: "payment_start",
            schema_version: 1,
            payload: {}
          },
          {
            id: endNodeId,
            node_type: "end",
            schema_version: 1,
            payload: { text: "Оплата подтверждена" }
          }
        ]);
      }
      if (text.includes("from public.scenario_edges")) {
        return rows([{
          id: paymentEdgeId,
          from_node_id: paymentNodeId,
          to_node_id: endNodeId,
          label: null,
          priority: 0,
          condition: {}
        }]);
      }
      return affected();
    });
    const persistence = createScenarioRuntimePersistence(
      new FakePool(connection),
      sequentialIds()
    );
    const service = new ResumeTelegramScenarioAfterPaymentService(
      persistence.repository,
      persistence.unitOfWork,
      persistence.outboxWriter,
      sequentialIds()
    );

    const result = await service.execute({
      orderId,
      sourceEventId,
      occurredAt
    });

    assert.equal(result.handled, true);
    const lock = findQuery(connection, "join public.orders orders");
    assert.deepEqual(lock.values, [orderId, occurredAt]);
    assert.match(lock.text, /orders\.user_id = sessions\.user_id/);
    assert.match(lock.text, /orders\.event_id = sessions\.event_id/);
    assert.match(lock.text, /orders\.status in \('paid', 'partially_refunded'\)/);
    const update = findQuery(connection, "lock_version = $2");
    assert.deepEqual(
      update.values.slice(0, 4),
      [sessionId, 6, endNodeId, "completed"]
    );
    assert.equal(
      (JSON.parse(update.values[8] as string) as { order: { status: string } })
        .order.status,
      "paid"
    );
    const outbox = findQuery(connection, "insert into public.outbox_events");
    assert.equal(outbox.values[3], "ScenarioPresentationRequested");
    assert.deepEqual(
      (JSON.parse(outbox.values[5] as string) as {
        presentations: unknown;
      }).presentations,
      [{ text: "Оплата подтверждена", buttons: [] }]
    );
    assert.equal(connection.queries.at(-1)?.text, "commit");
  });
});

interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

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

function rows<TRow>(resultRows: readonly TRow[]): SqlQueryResult<TRow> {
  return { rows: resultRows, rowCount: resultRows.length };
}

function affected(): SqlQueryResult<never> {
  return { rows: [], rowCount: 1 };
}

function findQuery(
  connection: FakeConnection,
  fragment: string
): RecordedQuery {
  const query = connection.queries.find((candidate) =>
    candidate.text.includes(fragment)
  );
  assert.ok(query, `Expected query containing: ${fragment}`);
  return query;
}

function sequentialIds(): IdGenerator {
  let next = 0;
  return {
    newId() {
      next += 1;
      return `00000000-0000-4000-8000-${String(next).padStart(12, "0")}`;
    }
  };
}

function fixedId(value: string): IdGenerator {
  return { newId() { return value; } };
}

const occurredAt = new Date("2026-07-26T12:00:00.000Z");
const userId = "00000000-0000-4000-8000-000000000101";
const messengerIdentityId = "00000000-0000-4000-8000-000000000102";
const eventId = "00000000-0000-4000-8000-000000000103";
const versionId = "00000000-0000-4000-8000-000000000104";
const sessionId = "00000000-0000-4000-8000-000000000105";
const startNodeId = "00000000-0000-4000-8000-000000000106";
const menuNodeId = "00000000-0000-4000-8000-000000000107";
const endNodeId = "00000000-0000-4000-8000-000000000108";
const edgeId = "00000000-0000-4000-8000-000000000110";
const numberInputNodeId = "00000000-0000-4000-8000-000000000111";
const inputEdgeId = "00000000-0000-4000-8000-000000000112";
const offerNodeId = "00000000-0000-4000-8000-000000000113";
const paymentNodeId = "00000000-0000-4000-8000-000000000114";
const offerEdgeId = "00000000-0000-4000-8000-000000000115";
const paymentEdgeId = "00000000-0000-4000-8000-000000000116";
const orderId = "00000000-0000-4000-8000-000000000117";
const sourceEventId = "00000000-0000-4000-8000-000000000118";

const nodeRows = [
  {
    id: startNodeId,
    node_type: "start",
    schema_version: 1,
    payload: {}
  },
  {
    id: menuNodeId,
    node_type: "menu",
    schema_version: 1,
    payload: { text: "Выберите действие" }
  },
  {
    id: endNodeId,
    node_type: "end",
    schema_version: 1,
    payload: { text: "Готово" }
  }
] as const;

const edgeRows = [
  {
    id: "00000000-0000-4000-8000-000000000109",
    from_node_id: startNodeId,
    to_node_id: menuNodeId,
    label: null,
    priority: 0,
    condition: {}
  },
  {
    id: edgeId,
    from_node_id: menuNodeId,
    to_node_id: endNodeId,
    label: "Завершить",
    priority: 0,
    condition: {}
  }
] as const;
