import assert from "node:assert/strict";
import test from "node:test";
import {
  createAdminEventScenarioManagementPersistence
} from "./admin-event-scenario-management-persistence.js";
import type {
  SqlConnection,
  SqlConnectionPool,
  SqlQueryResult
} from "./postgres.js";

const eventId = "00000000-0000-4000-8000-000000000101";
const scenarioId = "00000000-0000-4000-8000-000000000102";
const versionId = "00000000-0000-4000-8000-000000000103";
const startId = "00000000-0000-4000-8000-000000000104";
const endId = "00000000-0000-4000-8000-000000000105";

test("loads a draft graph and atomically publishes it for the event", async () => {
  const read = new FakeConnection(respond);
  const write = new FakeConnection(respond);
  const repository = createAdminEventScenarioManagementPersistence(
    new QueuePool(read, write)
  );

  const loaded = await repository.loadDraft({
    eventId,
    scenarioVersionId: versionId,
    expectedLockVersion: 7
  });
  const published = await repository.publishDraft({
    eventId,
    scenarioVersionId: versionId,
    expectedLockVersion: 7,
    validationIssues: [],
    audit: {
      auditId: "00000000-0000-4000-8000-000000000106",
      actorAdminId: "00000000-0000-4000-8000-000000000107",
      actorRole: "owner",
      reason: "Сценарий проверен",
      requestId: "request-123",
      ipAddress: null,
      userAgent: null,
      occurredAt: new Date("2026-07-26T10:00:00.000Z")
    }
  });

  assert.equal(loaded.status, "ready");
  if (loaded.status === "ready") {
    assert.equal(loaded.graph.nodes.length, 2);
    assert.equal(loaded.graph.edges[0]?.toNodeId, endId);
  }
  assert.deepEqual(published, { status: "published", lockVersion: 8 });
  assert.ok(findQuery(write, "set status = 'published'"));
  assert.equal(
    findQuery(write, "set published_scenario_version_id").values[1],
    versionId
  );
  assert.equal(
    findQuery(write, "'scenario_version'").values[3],
    "event.scenario_version_published"
  );
  assert.equal(write.queries.at(-1)?.text, "commit");
});

class QueuePool implements SqlConnectionPool {
  private index = 0;
  private readonly connections: readonly SqlConnection[];

  constructor(...connections: readonly SqlConnection[]) {
    this.connections = connections;
  }

  async connect(): Promise<SqlConnection> {
    const connection = this.connections[this.index];
    this.index += 1;
    if (!connection) {
      throw new Error("Unexpected connection request");
    }
    return connection;
  }
}

interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

class FakeConnection implements SqlConnection {
  readonly queries: RecordedQuery[] = [];

  constructor(
    private readonly responder: (
      text: string,
      values: readonly unknown[]
    ) => SqlQueryResult<unknown>
  ) {}

  async query<TRow>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<SqlQueryResult<TRow>> {
    this.queries.push({ text, values });
    return this.responder(text, values) as SqlQueryResult<TRow>;
  }

  release(): void {}
}

function respond(text: string): SqlQueryResult<unknown> {
  if (text.includes("from public.events") && text.includes("lock_version")) {
    return rows([{ id: eventId, status: "draft", lock_version: 7 }]);
  }
  if (
    text.includes("from public.scenario_versions versions")
    && text.includes("join public.scenarios")
  ) {
    return rows([{
      id: versionId,
      scenario_id: scenarioId,
      status: "draft",
      schema_version: 1
    }]);
  }
  if (text.includes("from public.scenario_nodes")) {
    return rows([
      {
        id: startId,
        node_type: "start",
        schema_version: 1,
        payload: {}
      },
      {
        id: endId,
        node_type: "end",
        schema_version: 1,
        payload: {}
      }
    ]);
  }
  if (text.includes("from public.scenario_edges")) {
    return rows([{
      id: "00000000-0000-4000-8000-000000000108",
      from_node_id: startId,
      to_node_id: endId,
      label: null,
      priority: 0,
      condition: {}
    }]);
  }
  if (text.includes("returning lock_version")) {
    return rows([{ lock_version: 8 }]);
  }
  return affected();
}

function rows<TRow>(resultRows: readonly TRow[]): SqlQueryResult<TRow> {
  return { rows: resultRows, rowCount: resultRows.length };
}

function affected(): SqlQueryResult<never> {
  return { rows: [], rowCount: 1 };
}

function findQuery(connection: FakeConnection, fragment: string): RecordedQuery {
  const query = connection.queries.find((candidate) =>
    candidate.text.includes(fragment)
  );
  assert.ok(query, `Expected query containing: ${fragment}`);
  return query;
}
