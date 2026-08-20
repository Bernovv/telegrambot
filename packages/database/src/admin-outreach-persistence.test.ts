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

  it("closes the open task when a touch is recorded without a next step", async () => {
    const connection = new CampaignContactConnection();
    const repository = new PostgresAdminOutreachRepository(pool(connection));

    await repository.recordActivities({
      activities: [{
        id: "00000000-0000-4000-8000-000000000301",
        campaignContactId: "00000000-0000-4000-8000-000000000201",
        stageHistoryId: null,
        taskId: null
      }],
      actorAdminId: "00000000-0000-4000-8000-000000000001",
      action: "call",
      channel: "phone",
      result: "answered",
      note: null,
      batchId: null,
      stage: null,
      lostReason: null,
      nextContactAt: null,
      occurredAt: new Date("2026-08-20T12:00:00.000Z")
    });

    const completion = connection.queries.find((query) =>
      query.text.includes("update public.outreach_tasks")
    );
    assert.ok(completion, "открытая задача должна закрываться и без следующего шага");
    assert.match(completion.text, /status = 'completed'/);
    assert.match(completion.text, /completed_by_admin_id = \$3::uuid/);
    assert.equal(
      connection.queries.some((query) =>
        query.text.includes("insert into public.outreach_tasks")),
      false,
      "следующей задачи не просили — заводить её нечего"
    );
  });

  it("clears the next contact time when a touch leaves no next step", async () => {
    const connection = new CampaignContactConnection();
    const repository = new PostgresAdminOutreachRepository(pool(connection));

    await repository.recordActivities({
      activities: [{
        id: "00000000-0000-4000-8000-000000000301",
        campaignContactId: "00000000-0000-4000-8000-000000000201",
        stageHistoryId: null,
        taskId: null
      }],
      actorAdminId: "00000000-0000-4000-8000-000000000001",
      action: "message",
      channel: "telegram",
      result: "sent",
      note: null,
      batchId: null,
      stage: null,
      lostReason: null,
      nextContactAt: null,
      occurredAt: new Date("2026-08-20T12:00:00.000Z")
    });

    const update = connection.queries.find((query) =>
      query.text.includes("update public.outreach_campaign_contacts"));
    assert.ok(update);
    // coalesce здесь оставлял бы срок уже закрытой задачи — карточка обещала бы звонок,
    // которого никто не планировал.
    assert.match(update.text, /next_contact_at = \$6::timestamptz/);
  });

  it("counts what a person paid without excluded and refunded orders", async () => {
    const connection = new RichPersonCardConnection();
    const repository = new PostgresAdminOutreachRepository(pool(connection));

    const card = await repository.getPerson(
      "00000000-0000-4000-8000-000000000401",
      "00000000-0000-4000-8000-000000000001"
    );

    // 120000 оплаченный + 50000 частично возвращённый + 30000 наличными мимо бота.
    // Исключённый из отчётов и полностью возвращённый в сумму не идут.
    assert.equal(card?.paidTotalKopecks, "200000");
  });

  it("groups questionnaire answers of one order into a single card entry", async () => {
    const connection = new RichPersonCardConnection();
    const repository = new PostgresAdminOutreachRepository(pool(connection));

    const card = await repository.getPerson(
      "00000000-0000-4000-8000-000000000401",
      "00000000-0000-4000-8000-000000000001"
    );

    const fromOrder = card?.questionnaires.filter(
      (questionnaire) => questionnaire.source === "order");
    assert.equal(fromOrder?.length, 1);
    assert.deepEqual(
      fromOrder?.[0]?.answers.map((answer) => answer.label),
      ["Город", "Ниша"]
    );
    // Анкету заполняют по частям — в карточке стоит время последней правки.
    assert.equal(fromOrder?.[0]?.filledAt, "2026-08-02T09:00:00.000Z");
  });

  it("finds the bot user through the whole chain of merged duplicates", async () => {
    const connection = new RichPersonCardConnection();
    const repository = new PostgresAdminOutreachRepository(pool(connection));

    const card = await repository.getPerson(
      "00000000-0000-4000-8000-000000000401",
      "00000000-0000-4000-8000-000000000001"
    );

    assert.equal(card?.bot?.userId, "00000000-0000-4000-8000-000000000501");
    assert.equal(card?.bot?.touchpoints.length, 1);
  });

  it("keeps campaign tasks alone when a task about the person is created", async () => {
    const connection = new ExistingContactConnection();
    const repository = new PostgresAdminOutreachRepository(pool(connection));

    await repository.createTask({
      id: "00000000-0000-4000-8000-000000000901",
      contactId: "00000000-0000-4000-8000-000000000401",
      campaignContactId: null,
      assignedAdminId: null,
      createdByAdminId: "00000000-0000-4000-8000-000000000001",
      type: "call",
      text: "Перезвонить после отпуска",
      dueAt: new Date("2026-09-01T09:00:00.000Z"),
      now: new Date("2026-08-21T09:00:00.000Z")
    });

    const cancel = connection.queries.find((query) =>
      query.text.includes("set status = 'cancelled'"));
    assert.ok(cancel);
    // Гасим только прежнюю задачу про человека вообще. Задачи по кампаниям — чужая
    // запланированная работа, и снимать её отсюда нельзя.
    assert.match(cancel.text, /campaign_contact_id is null/);
    const insert = connection.queries.find((query) =>
      query.text.includes("insert into public.outreach_tasks"));
    assert.ok(insert);
    assert.match(insert.text, /\$2::uuid, null,/);
  });

  it("takes the person and the assignee from the membership for a campaign task", async () => {
    const connection = new CampaignContactConnection();
    const repository = new PostgresAdminOutreachRepository(pool(connection));

    await repository.createTask({
      id: "00000000-0000-4000-8000-000000000901",
      contactId: null,
      campaignContactId: "00000000-0000-4000-8000-000000000201",
      assignedAdminId: null,
      createdByAdminId: "00000000-0000-4000-8000-000000000002",
      type: "call",
      text: "Позвонить",
      dueAt: new Date("2026-09-01T09:00:00.000Z"),
      now: new Date("2026-08-21T09:00:00.000Z")
    });

    const insert = connection.queries.find((query) =>
      query.text.includes("insert into public.outreach_tasks"));
    assert.ok(insert);
    // Человек берётся из строки участия, а не из запроса: иначе задача попала бы в воронку
    // одного, а в карточку другого.
    assert.equal(insert.values[1], "00000000-0000-4000-8000-000000000401");
    assert.equal(insert.values[2], "00000000-0000-4000-8000-000000000201");
  });

  it("lets only the author take their own note down", async () => {
    const connection = new RecordingConnection();
    const repository = new PostgresAdminOutreachRepository(pool(connection));

    await repository.deleteNote({
      noteId: "00000000-0000-4000-8000-000000000a01",
      actorAdminId: "00000000-0000-4000-8000-000000000001",
      now: new Date("2026-08-21T09:00:00.000Z")
    });

    const update = connection.queries.find((query) =>
      query.text.includes("update public.outreach_notes"));
    assert.ok(update);
    assert.match(update.text, /author_admin_id = \$2::uuid/);
    // Снятую второй раз не снимаем: иначе дата и автор снятия переписались бы задним числом.
    assert.match(update.text, /deleted_at is null/);
  });

  it("counts registrations waiting for a human across the whole base, not the page", async () => {
    const connection = new RecordingConnection();
    const repository = new PostgresAdminOutreachRepository(pool(connection));

    await repository.listSiteRegistrations({
      onlyNeedsAttention: false,
      page: 2,
      limit: 50
    });

    const list = connection.queries.find((query) =>
      query.text.includes("from public.site_registrations registration"));
    assert.ok(list);
    assert.deepEqual(list.values, [false, 50, 50]);
    // Счётчик «ждут разбора» считается отдельным запросом и без фильтров страницы: он
    // показывает, сколько их всего, а не сколько попало в текущие пятьдесят строк.
    const pending = connection.queries.find((query) =>
      query.text.includes("count(*)::text as total"));
    assert.ok(pending);
    assert.match(pending.text, /status <> 'registered'/);
    assert.deepEqual(pending.values, []);
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

  it("looks for a participation by phone too, not only by the link", async () => {
    // Связь outreach_contact_id проставляется только когда участника завели из карточки
    // кампании. У добавленных на вкладке мероприятия и у покупателей бота она пустая, и
    // проверка по одной связи разрешила бы стереть человека, который едет на пикник.
    const connection = new DeletableContactConnection();
    const repository = new PostgresAdminOutreachRepository(pool(connection));

    await repository.deletePerson({
      contactId: "00000000-0000-4000-8000-000000000301",
      reason: "дубль",
      actorAdminId: "00000000-0000-4000-8000-000000000001",
      auditId: "00000000-0000-4000-8000-000000000401",
      now: new Date("2026-08-13T12:00:00.000Z")
    });

    const check = connection.queries.find((query) =>
      query.text.includes("from public.event_participants")
    );
    assert.ok(check);
    assert.match(check.text, /outreach_contact_id = \$1::uuid/);
    assert.match(check.text, /phone_e164 = \$2::text/);
    assert.deepEqual(check.values, [
      "00000000-0000-4000-8000-000000000301",
      "+79991234567"
    ]);
  });

  it("refuses to delete a contact that belongs to a bot user", async () => {
    const connection = new DeletableContactConnection({ linkedUserId: "00000000-0000-4000-8000-000000000009" });
    const repository = new PostgresAdminOutreachRepository(pool(connection));

    const result = await repository.deletePerson({
      contactId: "00000000-0000-4000-8000-000000000301",
      reason: null,
      actorAdminId: "00000000-0000-4000-8000-000000000001",
      auditId: "00000000-0000-4000-8000-000000000401",
      now: new Date("2026-08-13T12:00:00.000Z")
    });

    assert.equal(result.deleted, false);
    assert.deepEqual(result.blockers, ["in_bot"]);
    // Ничего не стёрли и в журнал ничего не написали: отказ не событие.
    assert.equal(
      connection.queries.some((query) => query.text.startsWith("delete")),
      false
    );
    assert.equal(connection.queries.at(-1)?.text, "commit");
  });

  it("keeps the audit record of a deletion, since the contact row itself is gone", async () => {
    const connection = new DeletableContactConnection();
    const repository = new PostgresAdminOutreachRepository(pool(connection));

    const result = await repository.deletePerson({
      contactId: "00000000-0000-4000-8000-000000000301",
      reason: "загрузили мусором",
      actorAdminId: "00000000-0000-4000-8000-000000000001",
      auditId: "00000000-0000-4000-8000-000000000401",
      now: new Date("2026-08-13T12:00:00.000Z")
    });

    assert.equal(result.deleted, true);
    const audit = connection.queries.find((query) =>
      query.text.includes("insert into public.audit_log")
    );
    assert.ok(audit);
    assert.equal(audit.values[2], "outreach.contact.deleted");
    assert.equal(audit.values[4], "загрузили мусором");
    // Запись идёт после удаления — иначе транзакция откатила бы её вместе с отказом.
    const deleteIndex = connection.queries.findIndex((query) =>
      query.text.includes("delete from public.outreach_contacts")
    );
    const auditIndex = connection.queries.indexOf(audit);
    assert.ok(auditIndex > deleteIndex);
  });

  it("clears an identifier from the duplicate before giving it to the master", async () => {
    // Уникальный индекс проверяется на уровне запроса: одно значение не может принадлежать
    // обоим контактам даже на мгновение внутри транзакции.
    const connection = new MergeConnection();
    const repository = new PostgresAdminOutreachRepository(pool(connection));

    await repository.mergePeople({
      contactId: DUPLICATE_ID,
      targetContactId: MASTER_ID,
      reason: "один человек",
      actorAdminId: ADMIN_ID,
      auditId: AUDIT_ID,
      now: new Date("2026-08-14T12:00:00.000Z")
    });

    const clear = connection.queries.findIndex((query) =>
      query.text.includes("phone_e164 = null")
    );
    const set = connection.queries.findIndex((query) =>
      query.text.includes("phone_e164 = $2::text")
    );
    assert.ok(clear >= 0 && set >= 0);
    assert.ok(clear < set, "признак снимается раньше, чем ставится");
    assert.equal(connection.queries[clear]?.values[0], DUPLICATE_ID);
    assert.equal(connection.queries[set]?.values[0], MASTER_ID);
    assert.equal(connection.queries[set]?.values[1], "+79991234567");
  });

  it("moves only the campaigns the master is not already in", async () => {
    // Слить две строки участия в одну нельзя: к каждой привязаны свои звонки и стадии.
    const connection = new MergeConnection();
    const repository = new PostgresAdminOutreachRepository(pool(connection));

    await repository.mergePeople({
      contactId: DUPLICATE_ID,
      targetContactId: MASTER_ID,
      reason: null,
      actorAdminId: ADMIN_ID,
      auditId: AUDIT_ID,
      now: new Date("2026-08-14T12:00:00.000Z")
    });

    const move = connection.queries.find((query) =>
      query.text.includes("set contact_id = $2::uuid")
    );
    assert.ok(move);
    assert.match(move.text, /not exists/);
    assert.match(move.text, /other\.campaign_id = member\.campaign_id/);
  });

  it("refuses to merge a contact into one that is itself a duplicate", async () => {
    // Иначе получилась бы цепочка, ведущая в никуда.
    const connection = new MergeConnection({ masterMergedInto: OTHER_ID });
    const repository = new PostgresAdminOutreachRepository(pool(connection));

    const result = await repository.mergePeople({
      contactId: DUPLICATE_ID,
      targetContactId: MASTER_ID,
      reason: null,
      actorAdminId: ADMIN_ID,
      auditId: AUDIT_ID,
      now: new Date("2026-08-14T12:00:00.000Z")
    });

    assert.equal(result.merged, false);
    assert.equal(result.blocker, "target_already_merged");
    assert.equal(
      connection.queries.some((query) => query.text.includes("merged_into_contact_id = $2")),
      false,
      "ничего не тронули"
    );
  });

  it("follows the merge pointer when an import matches a duplicate", async () => {
    // После объединения у дубля остаются признаки, которых у главного не было. Без указателя
    // повторная загрузка положила бы человека на надгробие.
    const connection = new ImportLookupConnection();
    const repository = new PostgresAdminOutreachRepository(pool(connection));

    await repository.importContacts({
      campaignId: "00000000-0000-4000-8000-000000000102",
      assignedAdminId: ADMIN_ID,
      createdByAdminId: ADMIN_ID,
      rows: [{
        displayName: "Анна",
        phoneE164: "+79991234567",
        telegramUsername: null,
        telegramUsernameNormalized: null,
        maxIdentifier: null,
        maxIdentifierNormalized: null,
        email: null,
        emailNormalized: null,
        source: null,
        note: null,
        contactId: DUPLICATE_ID,
        campaignContactId: "00000000-0000-4000-8000-000000000501"
      }],
      skipAmbiguous: true,
      now: new Date("2026-08-14T12:00:00.000Z")
    });

    const lookup = connection.queries.find((query) =>
      query.text.includes("from public.outreach_contacts contact")
    );
    assert.ok(lookup);
    assert.match(
      lookup.text,
      /coalesce\(contact\.merged_into_contact_id, contact\.id\)/
    );
    // Два признака, ведущие на два дубля одного человека, спором уже не являются.
    assert.match(lookup.text, /select distinct/);
  });

  it("pulls questionnaire answers into the person card", async () => {
    // Анкета заполняется на вкладке мероприятия и висит на участнике. Без неё карточка не
    // отвечает на вопрос «что мы про человека знаем», и ради ответов приходится помнить, на
    // какое событие он ездил.
    const connection = new PersonCardConnection();
    const repository = new PostgresAdminOutreachRepository(pool(connection));

    await repository.getPerson(
      "00000000-0000-4000-8000-000000000301",
      "00000000-0000-4000-8000-000000000001"
    );

    const answers = connection.queries.find((query) =>
      query.text.includes("from public.event_participant_field_values")
    );
    assert.ok(answers, "карточка не спрашивает ответы анкеты");
    // Пустые ответы показывать нечего, и в карточку они не едут.
    assert.match(answers.text, /btrim\(value\.value_text\) <> ''/);
    // Один запрос на все участия, а не по одному на каждое мероприятие.
    assert.match(answers.text, /participant\.outreach_contact_id = any\(\$1::uuid\[\]\)/);
  });

  it("collects a person's history across campaigns, not within one", async () => {
    const connection = new PersonCardConnection();
    const repository = new PostgresAdminOutreachRepository(pool(connection));

    await repository.getPerson(
      "00000000-0000-4000-8000-000000000301",
      "00000000-0000-4000-8000-000000000001"
    );

    const activities = connection.queries.find((query) =>
      query.text.includes("from public.outreach_activities")
    );
    assert.ok(activities);
    // Ключевое отличие от карточки в кампании: отбор по человеку, а не по строке участия.
    // Людей может быть несколько — сам человек и сведённые в него дубли: их историю
    // переписать нельзя, журнал защищён от изменений, поэтому она собирается обходом.
    assert.match(activities.text, /where activity\.contact_id = any\(\$1::uuid\[\]\)/);
    const chain = connection.queries.find((query) =>
      query.text.includes("with recursive chain")
    );
    assert.ok(chain, "цепочка дублей собирается рекурсивным обходом");
  });
});

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const DUPLICATE_ID = "00000000-0000-4000-8000-000000000401";
const MASTER_ID = "00000000-0000-4000-8000-000000000402";
const OTHER_ID = "00000000-0000-4000-8000-000000000403";
const AUDIT_ID = "00000000-0000-4000-8000-000000000404";

interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

/**
 * Пара «дубль и главный» для объединения. У дубля есть телефон, у главного нет — значит
 * телефон должен переехать. Указатель на главного у самого главного задаёт тест.
 */
class MergeConnection implements SqlConnection {
  readonly queries: RecordedQuery[] = [];
  released = false;

  constructor(
    private readonly options: { readonly masterMergedInto?: string } = {}
  ) {}

  async query<TRow>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<SqlQueryResult<TRow>> {
    this.queries.push({ text, values });
    if (text.includes("for update") && text.includes("merged_into_contact_id")) {
      return {
        rows: [
          {
            id: DUPLICATE_ID,
            display_name: "Анна (дубль)",
            phone_e164: "+79991234567",
            telegram_username: null,
            telegram_username_normalized: null,
            max_identifier: null,
            max_identifier_normalized: null,
            email: null,
            email_normalized: null,
            source: "amoCRM",
            note: null,
            merged_into_contact_id: null
          },
          {
            id: MASTER_ID,
            display_name: "Анна",
            phone_e164: null,
            telegram_username: "anna",
            telegram_username_normalized: "anna",
            max_identifier: null,
            max_identifier_normalized: null,
            email: null,
            email_normalized: null,
            source: "Timepad",
            note: null,
            merged_into_contact_id: this.options.masterMergedInto ?? null
          }
        ] as TRow[],
        rowCount: 2
      };
    }
    return { rows: [], rowCount: 0 };
  }

  release(): void {
    this.released = true;
  }
}

/** Кампания находится, контакт по признакам — нет: важен только текст запроса поиска. */
class ImportLookupConnection implements SqlConnection {
  readonly queries: RecordedQuery[] = [];
  released = false;

  async query<TRow>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<SqlQueryResult<TRow>> {
    this.queries.push({ text, values });
    if (text.includes("from public.outreach_campaigns")) {
      return { rows: [{ id: values[0] } as TRow], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  release(): void {
    this.released = true;
  }
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
 * Контакт, который в принципе можно стереть: без звонков, без истории стадий и без участий.
 * Привязку к боту задаёт тест — она единственный блокирующий признак, который виден сразу
 * из самой строки контакта.
 */
class DeletableContactConnection implements SqlConnection {
  readonly queries: RecordedQuery[] = [];
  released = false;

  constructor(
    private readonly options: { readonly linkedUserId?: string } = {}
  ) {}

  async query<TRow>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<SqlQueryResult<TRow>> {
    this.queries.push({ text, values });
    if (text.includes("from public.outreach_contacts")) {
      return {
        rows: [{
          id: values[0],
          display_name: "Иван",
          phone_e164: "+79991234567",
          linked_user_id: this.options.linkedUserId ?? null
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

/**
 * Минимальная карточка: только сам контакт. Первый запрос карточки — контакт, и пустой ответ
 * на него означает «такого нет»; остальные запросы тогда не выполняются вовсе. Для проверок,
 * которые смотрят на сами запросы, контакт должен найтись, а данные не нужны.
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

/** Контакт кампании, который существует: без него запись касания молча ничего не делает. */
class CampaignContactConnection implements SqlConnection {
  readonly queries: RecordedQuery[] = [];
  released = false;

  async query<TRow>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<SqlQueryResult<TRow>> {
    this.queries.push({ text, values });
    if (text.includes("from public.outreach_campaign_contacts")) {
      return {
        rows: [{
          contact_id: "00000000-0000-4000-8000-000000000401",
          pipeline_stage: "dialogue",
          assigned_admin_id: "00000000-0000-4000-8000-000000000001"
        } as TRow],
        rowCount: 1
      };
    }
    if (text.includes("insert into public.outreach_activities")) {
      return {
        rows: [{ id: "00000000-0000-4000-8000-000000000301" } as TRow],
        rowCount: 1
      };
    }
    return { rows: [], rowCount: 0 };
  }

  release(): void {
    this.released = true;
  }
}

/**
 * Карточка человека целиком — с ботом, заказами и анкетами. Отвечает по узнаваемому куску
 * запроса: у карточки их полтора десятка, и расписывать порядок в каждом тесте бессмысленно.
 */
class RichPersonCardConnection implements SqlConnection {
  readonly queries: RecordedQuery[] = [];
  released = false;

  async query<TRow>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<SqlQueryResult<TRow>> {
    this.queries.push({ text, values });
    const rows = this.rowsFor(text) as TRow[];
    return { rows, rowCount: rows.length };
  }

  private rowsFor(text: string): unknown[] {
    if (text.includes("select linked_user_id")) {
      return [{ linked_user_id: "00000000-0000-4000-8000-000000000501" }];
    }
    if (text.includes("with recursive chain")) {
      return [
        { id: "00000000-0000-4000-8000-000000000401" },
        { id: "00000000-0000-4000-8000-000000000402" }
      ];
    }
    if (text.includes("from public.outreach_contacts contact")) {
      return [{
        contact_id: "00000000-0000-4000-8000-000000000401",
        display_name: "Анна",
        phone_e164: "+79991234567",
        telegram_username: null,
        max_identifier: null,
        email: null,
        source: "amoCRM",
        note: null,
        linked_user_id: null,
        archived_at: null,
        archived_reason: null,
        merged_into_contact_id: null,
        merged_into_display_name: null,
        created_by_name: "Ольга",
        created_at: "2026-07-01T10:00:00.000Z",
        updated_at: "2026-07-01T10:00:00.000Z"
      }];
    }
    if (text.includes("coalesce(sum(participant.amount_kopecks)")) {
      return [{ total: "30000" }];
    }
    if (text.includes("from public.orders orders")) {
      return [
        {
          id: "00000000-0000-4000-8000-000000000601",
          number: "BP-1",
          status: "paid",
          event_id: "00000000-0000-4000-8000-000000000701",
          event_title: "Пикник",
          total_kopecks: "120000",
          created_at: "2026-08-01T10:00:00.000Z",
          paid_at: "2026-08-01T11:00:00.000Z",
          excluded_at: null
        },
        {
          id: "00000000-0000-4000-8000-000000000602",
          number: "BP-2",
          status: "partially_refunded",
          event_id: "00000000-0000-4000-8000-000000000701",
          event_title: "Пикник",
          total_kopecks: "50000",
          created_at: "2026-08-01T10:00:00.000Z",
          paid_at: "2026-08-01T11:00:00.000Z",
          excluded_at: null
        },
        {
          id: "00000000-0000-4000-8000-000000000603",
          number: "BP-3",
          status: "paid",
          event_id: "00000000-0000-4000-8000-000000000701",
          event_title: "Пикник",
          total_kopecks: "999000",
          created_at: "2026-08-01T10:00:00.000Z",
          paid_at: "2026-08-01T11:00:00.000Z",
          excluded_at: "2026-08-02T10:00:00.000Z"
        },
        {
          id: "00000000-0000-4000-8000-000000000604",
          number: "BP-4",
          status: "refunded",
          event_id: "00000000-0000-4000-8000-000000000701",
          event_title: "Пикник",
          total_kopecks: "777000",
          created_at: "2026-08-01T10:00:00.000Z",
          paid_at: "2026-08-01T11:00:00.000Z",
          excluded_at: null
        }
      ];
    }
    if (text.includes("from public.event_order_field_values")) {
      return [
        {
          order_id: "00000000-0000-4000-8000-000000000601",
          event_id: "00000000-0000-4000-8000-000000000701",
          event_title: "Пикник",
          field_definition_id: "00000000-0000-4000-8000-000000000801",
          label: "Город",
          value_text: "Москва",
          updated_at: "2026-08-01T09:00:00.000Z"
        },
        {
          order_id: "00000000-0000-4000-8000-000000000601",
          event_id: "00000000-0000-4000-8000-000000000701",
          event_title: "Пикник",
          field_definition_id: "00000000-0000-4000-8000-000000000802",
          label: "Ниша",
          value_text: "Кофейни",
          updated_at: "2026-08-02T09:00:00.000Z"
        }
      ];
    }
    if (text.includes("from public.users users")) {
      return [{
        id: "00000000-0000-4000-8000-000000000501",
        registered_at: "2026-06-01T10:00:00.000Z",
        last_seen_at: null,
        is_blocked: false,
        phone_status: "verified",
        wallet_available_kopecks: "10000"
      }];
    }
    if (text.includes("from public.user_touchpoints")) {
      return [{
        channel: "telegram",
        source: "instagram",
        campaign: null,
        partner_code: null,
        occurred_at: "2026-06-01T10:00:00.000Z",
        is_first_touch: true
      }];
    }
    return [];
  }

  release(): void {
    this.released = true;
  }
}

/** Человек, который в базе есть: без него задача про него молча не создаётся. */
class ExistingContactConnection implements SqlConnection {
  readonly queries: RecordedQuery[] = [];
  released = false;

  async query<TRow>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<SqlQueryResult<TRow>> {
    this.queries.push({ text, values });
    if (text.includes("from public.outreach_contacts")) {
      return {
        rows: [{ id: "00000000-0000-4000-8000-000000000401" } as TRow],
        rowCount: 1
      };
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
