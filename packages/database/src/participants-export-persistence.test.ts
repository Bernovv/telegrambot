import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PostgresParticipantsExportRepository } from "./participants-export-persistence.js";
import type {
  SqlConnection,
  SqlConnectionPool,
  SqlQueryResult
} from "./postgres.js";

describe("PostgreSQL participants export persistence", () => {
  it("lists paid, non-revoked tickets for an event with questionnaire answers attached", async () => {
    const connection = new FakeConnection(() => rows([fullRow, noQuestionnaireRow]));
    const repository = new PostgresParticipantsExportRepository(new FakePool(connection));

    const participants = await repository.listPaidParticipants(eventId);

    assert.equal(participants.length, 2);
    assert.deepEqual(participants[0], {
      orderNumber: "BP-0001",
      paidAt: new Date("2026-07-20T10:00:00.000Z").toISOString(),
      ticketNumber: "BP-0001-T001",
      ticketStatus: "issued",
      userDisplayName: "Ivan Ivanov",
      telegramUsername: "ivanov",
      phone: "+79001234567",
      questionnaire: {
        name: "Ivan",
        city: "Moscow",
        niche: "coaching",
        stage: "want_more_sales",
        wish: "More clients",
        focusArea: "sales",
        joinChat: true
      }
    });
    assert.equal(participants[1]?.questionnaire, null);

    const query = connection.queries[0];
    assert.ok(query);
    assert.match(query.text, /o\.event_id = \$1/);
    assert.match(query.text, /o\.paid_at is not null/);
    assert.match(query.text, /t\.status <> 'revoked'/);
    assert.equal(query.values[0], eventId);
  });

  it("returns an empty list when nothing is paid for the event", async () => {
    const connection = new FakeConnection(() => rows([]));
    const repository = new PostgresParticipantsExportRepository(new FakePool(connection));

    const participants = await repository.listPaidParticipants(eventId);

    assert.deepEqual(participants, []);
  });
});

class FakePool implements SqlConnectionPool {
  constructor(private readonly connection: SqlConnection) {}

  async connect(): Promise<SqlConnection> {
    return this.connection;
  }
}

interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
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

const eventId = "019c0123-4567-789a-bcde-f01234567801";

const fullRow = {
  order_number: "BP-0001",
  paid_at: "2026-07-20T10:00:00.000Z",
  ticket_number: "BP-0001-T001",
  ticket_status: "issued",
  user_display_name: "Ivan Ivanov",
  telegram_username: "ivanov",
  phone: "+79001234567",
  q_name: "Ivan",
  q_city: "Moscow",
  q_niche: "coaching",
  q_stage: "want_more_sales",
  q_wish: "More clients",
  q_focus_area: "sales",
  q_join_chat: true
} as const;

const noQuestionnaireRow = {
  order_number: "BP-0001",
  paid_at: "2026-07-20T10:00:00.000Z",
  ticket_number: "BP-0001-T002",
  ticket_status: "issued",
  user_display_name: "Second Buyer",
  telegram_username: null,
  phone: null,
  q_name: null,
  q_city: null,
  q_niche: null,
  q_stage: null,
  q_wish: null,
  q_focus_area: null,
  q_join_chat: null
} as const;
