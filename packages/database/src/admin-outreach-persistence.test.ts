import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  SqlConnection,
  SqlConnectionPool,
  SqlQueryResult
} from "./postgres.js";
import { PostgresAdminOutreachRepository } from "./admin-outreach-persistence.js";

describe("PostgreSQL administrator outreach persistence", () => {
  it("casts the repeated campaign timestamp parameter consistently", async () => {
    const connection = new RecordingConnection();
    const repository = new PostgresAdminOutreachRepository(pool(connection));

    await repository.createCampaign({
      id: "00000000-0000-4000-8000-000000000101",
      name: "Не оплатили",
      description: "Июль",
      status: "active",
      eventId: null,
      createdByAdminId: "00000000-0000-4000-8000-000000000001",
      now: new Date("2026-07-29T12:00:00.000Z")
    });

    const insert = connection.queries.find((query) =>
      query.text.includes("insert into public.outreach_campaigns")
    );
    assert.ok(insert);
    assert.equal(
      insert.text.match(/\$6::timestamptz/g)?.length,
      3
    );
    assert.match(insert.text, /\$4::text = 'completed'/);
    assert.equal(connection.queries[0]?.text, "begin");
    assert.equal(connection.queries.at(-1)?.text, "commit");
    assert.equal(connection.released, true);
  });

  it("reports stage_in_use instead of throwing when a stage delete violates the contacts foreign key", async () => {
    const connection = new ForeignKeyViolationOnDeleteConnection();
    const repository = new PostgresAdminOutreachRepository(pool(connection));

    const result = await repository.updatePipelineColumns({
      campaignId: "00000000-0000-4000-8000-000000000101",
      columns: [
        { stage: "new", label: "Новые", position: 1, outcome: "open" }
      ],
      now: new Date("2026-07-30T12:00:00.000Z")
    });

    assert.equal(result, "stage_in_use");
    assert.equal(connection.queries.at(-1)?.text, "rollback");
  });

  it("reports not_found when the campaign row is missing", async () => {
    const connection = new RecordingConnection();
    const repository = new PostgresAdminOutreachRepository(pool(connection));

    const result = await repository.updatePipelineColumns({
      campaignId: "00000000-0000-4000-8000-000000000101",
      columns: [
        { stage: "new", label: "Новые", position: 1, outcome: "open" },
        { stage: "s_abc123", label: "Новая", position: 2, outcome: "won" }
      ],
      now: new Date("2026-07-30T12:00:00.000Z")
    });

    assert.equal(result, "not_found");
  });

  it("hides archived people from every filter except the archive itself", async () => {
    // Убранный контакт, продолжающий висеть в общем списке, — это архив, которого нет.
    const connection = new RecordingConnection();
    const repository = new PostgresAdminOutreachRepository(pool(connection));

    await repository.listPeople({
      search: null,
      filter: "all",
      page: 1,
      limit: 50
    });

    // Запросы идут внутри транзакции, поэтому последний — это commit, а не наш select.
    const select = connection.queries.find((query) =>
      query.text.includes("from public.outreach_contacts contact")
    );
    assert.ok(select);
    assert.match(
      select.text,
      /case when \$2::text = 'archived'\s+then contact\.archived_at is not null\s+else contact\.archived_at is null end/
    );
  });

  it("searches the base by every identifier, email included", async () => {
    const connection = new RecordingConnection();
    const repository = new PostgresAdminOutreachRepository(pool(connection));

    await repository.listPeople({
      search: "иван",
      filter: "all",
      page: 2,
      limit: 25
    });

    // Запросы идут внутри транзакции, поэтому последний — это commit, а не наш select.
    const select = connection.queries.find((query) =>
      query.text.includes("from public.outreach_contacts contact")
    );
    assert.ok(select);
    for (const column of [
      "display_name",
      "phone_e164",
      "telegram_username_normalized",
      "max_identifier_normalized",
      "email_normalized"
    ]) {
      assert.ok(
        select.text.includes(column),
        `поиск не заглядывает в ${column}`
      );
    }
    // Смещение считается от номера страницы, а не приходит снаружи.
    assert.deepEqual(select.values, ["%иван%", "all", 25, 25]);
  });

  it("collects a person's history across campaigns, not within one", async () => {
    const connection = new PersonCardConnection();
    const repository = new PostgresAdminOutreachRepository(pool(connection));

    await repository.getPerson("00000000-0000-4000-8000-000000000301");

    const activities = connection.queries.find((query) =>
      query.text.includes("from public.outreach_activities")
    );
    assert.ok(activities);
    // Ключевое отличие от карточки в кампании: отбор по человеку, а не по строке участия.
    assert.match(activities.text, /where activity\.contact_id = \$1::uuid/);
  });
});

interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

class RecordingConnection implements SqlConnection {
  readonly queries: RecordedQuery[] = [];
  released = false;

  async query<TRow>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<SqlQueryResult<TRow>> {
    this.queries.push({ text, values });
    return { rows: [], rowCount: 0 };
  }

  release(): void {
    this.released = true;
  }
}

/**
 * Карточка человека выходит из базы за четыре запроса, и первый — сам контакт. Пустой ответ
 * на него означает «такого нет», и остальные три уже не выполняются, поэтому для проверки
 * ленты активностей контакт должен найтись.
 */
class PersonCardConnection implements SqlConnection {
  readonly queries: RecordedQuery[] = [];
  released = false;

  async query<TRow>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<SqlQueryResult<TRow>> {
    this.queries.push({ text, values });
    if (text.includes("from public.outreach_contacts contact")) {
      return {
        rows: [{
          contact_id: values[0],
          display_name: "Иван",
          phone_e164: null,
          telegram_username: null,
          max_identifier: null,
          email: null,
          source: null,
          note: null,
          linked_user_id: null,
          archived_at: null,
          created_at: new Date("2026-08-01T10:00:00.000Z"),
          updated_at: new Date("2026-08-01T10:00:00.000Z")
        } as TRow],
        rowCount: 1
      };
    }
    return { rows: [], rowCount: 0 };
  }

  release(): void {
    this.released = true;
  }
}

// Simulates a campaign that has one existing column ("new") plus a second,
// unlisted column ("legacy") that still has contacts in it, so the delete
// step in updatePipelineColumns hits the not-deferrable foreign key and the
// database raises a foreign key violation (SQLSTATE 23503).
class ForeignKeyViolationOnDeleteConnection implements SqlConnection {
  readonly queries: RecordedQuery[] = [];
  released = false;

  async query<TRow>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<SqlQueryResult<TRow>> {
    this.queries.push({ text, values });
    if (text.trim().startsWith("select id")) {
      return { rows: [{ id: values[0] }] as TRow[], rowCount: 1 };
    }
    if (text.trim().startsWith("select stage")) {
      return { rows: [{ stage: "legacy" }] as TRow[], rowCount: 1 };
    }
    if (text.trim().startsWith("delete from public.outreach_pipeline_columns")) {
      throw Object.assign(new Error("foreign key violation"), { code: "23503" });
    }
    return { rows: [], rowCount: 0 };
  }

  release(): void {
    this.released = true;
  }
}

function pool(connection: SqlConnection): SqlConnectionPool {
  return {
    async connect() {
      return connection;
    }
  };
}
