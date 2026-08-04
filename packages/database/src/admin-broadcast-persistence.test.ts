import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CreateAdminBroadcastService, type IdGenerator } from "@ticket-platform/application";
import { createAdminBroadcastPersistence } from "./admin-broadcast-persistence.js";
import type { SqlConnection, SqlConnectionPool, SqlQueryResult } from "./postgres.js";
import type { AdminRequestActor } from "@ticket-platform/contracts";

interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

describe("PostgreSQL admin broadcast persistence", () => {
  it("inserts the campaign row and appends exactly one outbox event in the same transaction", async () => {
    const connection = new FakeConnection(() => affected());
    const idGenerator = sequenceIdGenerator(["broadcast-1", "outbox-1"]);
    const persistence = createAdminBroadcastPersistence(new FakePool(connection));
    const service = new CreateAdminBroadcastService(
      persistence.adminBroadcastRepository,
      persistence.outboxWriter,
      persistence.unitOfWork,
      idGenerator
    );

    const result = await service.execute({
      actor: broadcastActor(),
      messageText: "Скоро старт!",
      targetEventId: "019c0123-4567-789a-bcde-f01234567801",
      targetOrderStatus: "paid",
      now: new Date("2026-07-27T10:00:00.000Z")
    });

    assert.equal(result.broadcastId, "broadcast-1");
    assert.equal(connection.queries[0]?.text, "begin");
    const insert = findQuery(connection, "insert into public.admin_broadcasts");
    assert.deepEqual(insert.values, [
      "broadcast-1",
      "019c0123-4567-789a-bcde-f01234567800",
      "Скоро старт!",
      "orders",
      "019c0123-4567-789a-bcde-f01234567801",
      "paid",
      null,
      null,
      null,
      false
    ]);
    assert.equal(
      findQueries(connection, "insert into public.outbox_events").length,
      1
    );
    assert.ok(connection.queries.some((query) => query.text === "commit"));
  });

  it("считает аудиторию тем же запросом, что и отправка, и по тем же параметрам", async () => {
    const connection = new FakeConnection(() => ({
      rows: [{ recipient_count: "137" }],
      rowCount: 1
    }));
    const persistence = createAdminBroadcastPersistence(new FakePool(connection));

    const count = await persistence.adminBroadcastAudienceRepository.countAudience({
      targetAudience: "orders",
      targetEventId: "019c0123-4567-789a-bcde-f01234567801",
      targetOrderStatus: "paid"
    });

    assert.equal(count, 137);
    const select = findQuery(connection, "from public.orders o");
    assert.deepEqual(select.values, ["019c0123-4567-789a-bcde-f01234567801", "paid"]);
    // Тот же отбор, что при отправке: иначе показанное число разойдётся с реальностью.
    assert.match(select.text, /identity\.is_bot_blocked = false/);
    assert.match(select.text, /\$1::uuid is null or o\.event_id = \$1::uuid/);
    assert.match(select.text, /\$2::text is null or o\.status = \$2::text/);
  });

  it("пробная рассылка сохраняется с признаком и без фильтров", async () => {
    const connection = new FakeConnection(() => affected());
    const persistence = createAdminBroadcastPersistence(new FakePool(connection));
    const service = new CreateAdminBroadcastService(
      persistence.adminBroadcastRepository,
      persistence.outboxWriter,
      persistence.unitOfWork,
      sequenceIdGenerator(["broadcast-2", "outbox-2"])
    );

    await service.execute({
      actor: broadcastActor(),
      messageText: "Проверка перед отправкой",
      isTest: true,
      now: new Date("2026-07-27T10:00:00.000Z")
    });

    const insert = findQuery(connection, "insert into public.admin_broadcasts");
    assert.deepEqual(insert.values.slice(3), ["orders", null, null, null, null, null, true]);
  });

  it("для аудитории «все, кто открывал бота» считает по привязкам, а не по заказам", async () => {
    const connection = new FakeConnection(() => ({
      rows: [{ recipient_count: "812" }],
      rowCount: 1
    }));
    const persistence = createAdminBroadcastPersistence(new FakePool(connection));

    const count = await persistence.adminBroadcastAudienceRepository.countAudience({
      targetAudience: "bot_users",
      targetEventId: null,
      targetOrderStatus: null
    });

    assert.equal(count, 812);
    const select = findQuery(connection, "from public.users u");
    assert.doesNotMatch(select.text, /public\.orders/);
    assert.match(select.text, /u\.is_deleted = false/);
  });

  it("история отдаёт название мероприятия и автора, а не голые идентификаторы", async () => {
    const connection = new FakeConnection(() => ({
      rows: [{
        id: "broadcast-1",
        status: "completed",
        is_test: false,
        message_text: "Скоро старт!",
        target_audience: "orders",
        target_event_title: "Бизнес-Пикник",
        target_order_status: "paid",
        has_image: true,
        button_text: "Купить билет",
        created_by_admin_name: "Люба",
        recipient_count: 12,
        sent_count: 11,
        failed_count: 1,
        created_at: new Date("2026-08-01T10:00:00.000Z"),
        completed_at: new Date("2026-08-01T10:02:00.000Z")
      }],
      rowCount: 1
    }));
    const persistence = createAdminBroadcastPersistence(new FakePool(connection));

    const items = await persistence.adminBroadcastHistoryRepository.listBroadcasts(50);

    assert.deepEqual(items, [{
      id: "broadcast-1",
      status: "completed",
      isTest: false,
      messageText: "Скоро старт!",
      targetAudience: "orders",
      targetEventTitle: "Бизнес-Пикник",
      targetOrderStatus: "paid",
      hasImage: true,
      buttonText: "Купить билет",
      createdByAdminName: "Люба",
      recipientCount: 12,
      sentCount: 11,
      failedCount: 1,
      createdAt: "2026-08-01T10:00:00.000Z",
      completedAt: "2026-08-01T10:02:00.000Z"
    }]);
  });

  it("картинка ложится в базу байтами вместе с разобранными размерами", async () => {
    const connection = new FakeConnection(() => affected());
    const persistence = createAdminBroadcastPersistence(new FakePool(connection));

    await persistence.adminBroadcastImageRepository.storeImage({
      id: "image-1",
      uploadedByAdminId: "019c0123-4567-789a-bcde-f01234567800",
      mimeType: "image/jpeg",
      byteSize: 3,
      width: 800,
      height: 600,
      bytes: new Uint8Array([1, 2, 3])
    });

    const insert = findQuery(connection, "insert into public.admin_broadcast_images");
    assert.deepEqual(insert.values.slice(0, 6), [
      "image-1",
      "019c0123-4567-789a-bcde-f01234567800",
      "image/jpeg",
      3,
      800,
      600
    ]);
    assert.ok(Buffer.isBuffer(insert.values[6]));
  });
});

function findQuery(connection: FakeConnection, fragment: string): RecordedQuery {
  const query = connection.queries.find((candidate) => candidate.text.includes(fragment));
  assert.ok(query, `Expected query containing: ${fragment}`);
  return query;
}

function findQueries(connection: FakeConnection, fragment: string): RecordedQuery[] {
  return connection.queries.filter((candidate) => candidate.text.includes(fragment));
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
    private readonly respond: (text: string, values: readonly unknown[]) => SqlQueryResult<unknown>
  ) {}

  async query<TRow>(text: string, values: readonly unknown[] = []): Promise<SqlQueryResult<TRow>> {
    this.queries.push({ text, values });
    return this.respond(text, values) as SqlQueryResult<TRow>;
  }

  release(): void {}
}

function affected(): SqlQueryResult<never> {
  return { rows: [], rowCount: 1 };
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

function broadcastActor(): AdminRequestActor {
  return {
    adminId: "019c0123-4567-789a-bcde-f01234567800",
    authSubject: "admin@example.com",
    roleCodes: ["content_manager"],
    permission: "broadcasts.send"
  };
}
