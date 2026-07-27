import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { IdGenerator, QuestionnaireDraft } from "@ticket-platform/application";
import {
  createParticipantQuestionnairePersistence,
  PostgresQuestionnaireDraftRepository,
  PostgresQuestionnaireResponseRepository
} from "./participant-questionnaire-persistence.js";
import type { SqlConnection, SqlConnectionPool, SqlQueryResult } from "./postgres.js";

describe("PostgreSQL participant questionnaire draft persistence", () => {
  it("returns null when the user has no in-progress draft", async () => {
    const connection = new FakeConnection(() => empty());
    const repository = new PostgresQuestionnaireDraftRepository(new FakePool(connection));

    const draft = await repository.getDraft("user-1");

    assert.equal(draft, null);
    assert.equal(connection.released, true);
  });

  it("reads back a draft written earlier", async () => {
    const connection = new FakeConnection(() =>
      rows([{
        order_id: "order-1",
        event_id: "event-1",
        step: "awaiting_stage",
        name: "Аня",
        city: "СПб",
        niche: "Маркетинг",
        stage: null,
        wish: null,
        focus_area: null,
        started_at: "2026-07-28T10:00:00.000Z"
      }])
    );
    const repository = new PostgresQuestionnaireDraftRepository(new FakePool(connection));

    const draft = await repository.getDraft("user-1");

    assert.deepEqual(draft, {
      orderId: "order-1",
      eventId: "event-1",
      step: "awaiting_stage",
      name: "Аня",
      city: "СПб",
      niche: "Маркетинг",
      stage: null,
      wish: null,
      focusArea: null,
      startedAt: "2026-07-28T10:00:00.000Z"
    });
  });

  it("writes the draft as a single jsonb_set update and releases the connection", async () => {
    const connection = new FakeConnection(() => affected());
    const repository = new PostgresQuestionnaireDraftRepository(new FakePool(connection));
    const draft: QuestionnaireDraft = {
      orderId: "order-1",
      eventId: "event-1",
      step: "awaiting_name",
      name: null,
      city: null,
      niche: null,
      stage: null,
      wish: null,
      focusArea: null,
      startedAt: "2026-07-28T10:00:00.000Z"
    };

    await repository.setDraft("user-1", draft);

    const update = findQuery(connection, "jsonb_set");
    assert.match(update.text, /participantQuestionnaireDraft/);
    assert.deepEqual(update.values, ["user-1", JSON.stringify(draft)]);
    assert.equal(connection.released, true);
  });

  it("clears the draft key without touching the rest of metadata", async () => {
    const connection = new FakeConnection(() => affected());
    const repository = new PostgresQuestionnaireDraftRepository(new FakePool(connection));

    await repository.clearDraft("user-1");

    const update = findQuery(connection, "metadata - 'participantQuestionnaireDraft'");
    assert.deepEqual(update.values, ["user-1"]);
  });
});

describe("PostgreSQL participant questionnaire response persistence", () => {
  it("inserts the completed response once, tolerating a conflicting retry", async () => {
    const connection = new FakeConnection(() => affected());
    const idGenerator = fixedIdGenerator("response-1");
    const repository = new PostgresQuestionnaireResponseRepository(new FakePool(connection), idGenerator);

    await repository.saveResponse({
      orderId: "order-1",
      userId: "user-1",
      eventId: "event-1",
      name: "Аня",
      city: "СПб",
      niche: "Маркетинг",
      stage: "have_clients_want_structure",
      wish: "Найти партнёров",
      focusArea: "positioning",
      joinChat: true,
      completedAt: new Date("2026-07-28T11:00:00.000Z")
    });

    const insert = findQuery(connection, "insert into public.participant_questionnaire_responses");
    assert.match(insert.text, /on conflict \(order_id\) do nothing/);
    assert.deepEqual(insert.values, [
      "response-1",
      "order-1",
      "user-1",
      "event-1",
      "Аня",
      "СПб",
      "Маркетинг",
      "have_clients_want_structure",
      "Найти партнёров",
      "positioning",
      true,
      new Date("2026-07-28T11:00:00.000Z")
    ]);
  });

  it("wires both repositories against the same pool", () => {
    const connection = new FakeConnection(() => empty());
    const persistence = createParticipantQuestionnairePersistence(
      new FakePool(connection),
      fixedIdGenerator("id-1")
    );

    assert.ok(persistence.questionnaireDraftRepository instanceof PostgresQuestionnaireDraftRepository);
    assert.ok(persistence.questionnaireResponseRepository instanceof PostgresQuestionnaireResponseRepository);
  });
});

class FakePool implements SqlConnectionPool {
  constructor(private readonly connection: SqlConnection) {}

  async connect(): Promise<SqlConnection> {
    return this.connection;
  }
}

class FakeConnection implements SqlConnection {
  readonly queries: { readonly text: string; readonly values: readonly unknown[] }[] = [];
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

function empty(): SqlQueryResult<unknown> {
  return { rows: [], rowCount: 0 };
}

function affected(): SqlQueryResult<unknown> {
  return { rows: [], rowCount: 1 };
}

function rows<TRow>(resultRows: readonly TRow[]): SqlQueryResult<TRow> {
  return { rows: resultRows, rowCount: resultRows.length } as SqlQueryResult<unknown> as SqlQueryResult<TRow>;
}

function findQuery(
  connection: FakeConnection,
  fragment: string
): { readonly text: string; readonly values: readonly unknown[] } {
  const query = connection.queries.find((candidate) => candidate.text.includes(fragment));
  assert.ok(query, `Expected query containing: ${fragment}`);
  return query;
}

function fixedIdGenerator(id: string): IdGenerator {
  return { newId() { return id; } };
}
