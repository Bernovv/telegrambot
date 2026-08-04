import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADMIN_BROADCAST_AUDIENCE_LIMIT,
  ADMIN_BROADCAST_HISTORY_LIMIT,
  CountAdminBroadcastAudienceService,
  CreateAdminBroadcastService,
  ListAdminBroadcastsService
} from "./admin-broadcast.js";
import type { AdminBroadcastRepository, CreateAdminBroadcastInput } from "./admin-broadcast.js";
import type { AdminRequestActor } from "@ticket-platform/contracts";
import type { OutboxWriter, UnitOfWork } from "./identity.js";

describe("CreateAdminBroadcastService", () => {
  it("creates the campaign row and appends a single fan-out outbox event in one transaction", async () => {
    const created: (CreateAdminBroadcastInput & { readonly id: string })[] = [];
    const appended: unknown[] = [];
    const repository: AdminBroadcastRepository = {
      async createBroadcast(input) {
        created.push(input);
      },
      async imageExists() {
        return true;
      }
    };
    const service = new CreateAdminBroadcastService(
      repository,
      outboxWriter(appended),
      unitOfWork(),
      idGenerator()
    );

    const result = await service.execute({
      actor: broadcastActor(),
      messageText: "  Скоро старт!  ",
      targetEventId: "019c0123-4567-789a-bcde-f01234567801",
      targetOrderStatus: "paid",
      now: new Date("2026-07-27T10:00:00.000Z")
    });

    assert.equal(result.broadcastId, "id-1");
    assert.deepEqual(created, [{
      id: "id-1",
      createdByAdminId: "019c0123-4567-789a-bcde-f01234567800",
      messageText: "Скоро старт!",
      targetAudience: "orders",
      targetEventId: "019c0123-4567-789a-bcde-f01234567801",
      targetOrderStatus: "paid",
      button: null,
      imageId: null,
      isTest: false
    }]);
    assert.equal(appended.length, 1);
    assert.deepEqual(appended[0], {
      eventId: "id-2",
      aggregateType: "admin_broadcast",
      aggregateId: "id-1",
      eventType: "AdminBroadcastRequested",
      schemaVersion: 1,
      payload: { broadcastId: "id-1" },
      occurredAt: new Date("2026-07-27T10:00:00.000Z")
    });
  });

  it("allows a broadcast with no filters (targets every reachable user)", async () => {
    const created: (CreateAdminBroadcastInput & { readonly id: string })[] = [];
    const service = new CreateAdminBroadcastService(
      repositoryFor(created),
      outboxWriter([]),
      unitOfWork(),
      idGenerator()
    );

    await service.execute({
      actor: broadcastActor(),
      messageText: "Всем привет",
      now: new Date("2026-07-27T10:00:00.000Z")
    });

    assert.equal(created[0]?.targetEventId, null);
    assert.equal(created[0]?.targetOrderStatus, null);
  });

  it("rejects an actor without the broadcasts.send permission", async () => {
    const service = new CreateAdminBroadcastService(
      repositoryFor([]),
      outboxWriter([]),
      unitOfWork(),
      idGenerator()
    );

    await assert.rejects(
      () => service.execute({
        actor: { ...broadcastActor(), permission: "participants.export" as never },
        messageText: "Hello",
        now: new Date("2026-07-27T10:00:00.000Z")
      }),
      /broadcast permission is invalid/
    );
  });

  it("rejects an empty or too-long message", async () => {
    const service = new CreateAdminBroadcastService(
      repositoryFor([]),
      outboxWriter([]),
      unitOfWork(),
      idGenerator()
    );

    await assert.rejects(
      () => service.execute({ actor: broadcastActor(), messageText: "   ", now: new Date() }),
      /message text is invalid/
    );
    await assert.rejects(
      () => service.execute({
        actor: broadcastActor(),
        messageText: "x".repeat(3_501),
        now: new Date()
      }),
      /message text is invalid/
    );
  });

  it("rejects an invalid target order status", async () => {
    const service = new CreateAdminBroadcastService(
      repositoryFor([]),
      outboxWriter([]),
      unitOfWork(),
      idGenerator()
    );

    await assert.rejects(
      () => service.execute({
        actor: broadcastActor(),
        messageText: "Hello",
        targetOrderStatus: "shipped",
        now: new Date()
      }),
      /target order status is invalid/
    );
  });

  it("сохраняет пробный прогон отдельным признаком", async () => {
    const created: (CreateAdminBroadcastInput & { readonly id: string })[] = [];
    const service = new CreateAdminBroadcastService(
      repositoryFor(created),
      outboxWriter([]),
      unitOfWork(),
      idGenerator()
    );

    await service.execute({
      actor: broadcastActor(),
      messageText: "Проверка",
      isTest: true,
      now: new Date("2026-07-27T10:00:00.000Z")
    });

    assert.equal(created[0]?.isTest, true);
  });

  it("сохраняет кнопку и картинку, а текст мерит подписью к фото", async () => {
    const created: (CreateAdminBroadcastInput & { readonly id: string })[] = [];
    const service = new CreateAdminBroadcastService(
      repositoryFor(created),
      outboxWriter([]),
      unitOfWork(),
      idGenerator()
    );

    await service.execute({
      actor: broadcastActor(),
      messageText: "Успей купить",
      button: { text: "  Купить билет  ", url: "https://biz-day.ru/tariffs" },
      imageId: "019c0123-4567-789a-bcde-f01234567802",
      now: new Date("2026-07-27T10:00:00.000Z")
    });

    assert.deepEqual(created[0]?.button, {
      text: "Купить билет",
      url: "https://biz-day.ru/tariffs"
    });
    assert.equal(created[0]?.imageId, "019c0123-4567-789a-bcde-f01234567802");
  });

  it("с картинкой текст длиннее подписи не принимает, без неё — принимает", async () => {
    const created: (CreateAdminBroadcastInput & { readonly id: string })[] = [];
    const service = new CreateAdminBroadcastService(
      repositoryFor(created),
      outboxWriter([]),
      unitOfWork(),
      idGenerator()
    );
    const longText = "x".repeat(1_025);

    await assert.rejects(
      () => service.execute({
        actor: broadcastActor(),
        messageText: longText,
        imageId: "019c0123-4567-789a-bcde-f01234567802",
        now: new Date()
      }),
      /message text is invalid/
    );

    await service.execute({
      actor: broadcastActor(),
      messageText: longText,
      now: new Date()
    });
    assert.equal(created.length, 1);
  });

  it("не создаёт кампанию со ссылкой на несуществующую картинку", async () => {
    const service = new CreateAdminBroadcastService(
      repositoryFor([], false),
      outboxWriter([]),
      unitOfWork(),
      idGenerator()
    );

    await assert.rejects(
      () => service.execute({
        actor: broadcastActor(),
        messageText: "Привет",
        imageId: "019c0123-4567-789a-bcde-f01234567802",
        now: new Date()
      }),
      /Broadcast image was not found/
    );
  });

  it("отклоняет кнопку без https и без надписи", async () => {
    const service = new CreateAdminBroadcastService(
      repositoryFor([]),
      outboxWriter([]),
      unitOfWork(),
      idGenerator()
    );

    await assert.rejects(
      () => service.execute({
        actor: broadcastActor(),
        messageText: "Привет",
        button: { text: "Купить", url: "http://biz-day.ru" },
        now: new Date()
      }),
      /button URL is invalid/
    );
    await assert.rejects(
      () => service.execute({
        actor: broadcastActor(),
        messageText: "Привет",
        button: { text: "   ", url: "https://biz-day.ru" },
        now: new Date()
      }),
      /button text is invalid/
    );
  });

  it("не принимает фильтры по заказам вместе с аудиторией «все, кто открывал бота»", async () => {
    const service = new CreateAdminBroadcastService(
      repositoryFor([]),
      outboxWriter([]),
      unitOfWork(),
      idGenerator()
    );

    await assert.rejects(
      () => service.execute({
        actor: broadcastActor(),
        messageText: "Привет",
        targetAudience: "bot_users",
        targetOrderStatus: "paid",
        now: new Date()
      }),
      /does not accept order filters/
    );
  });
});

describe("ListAdminBroadcastsService", () => {
  it("отдаёт историю только с разрешением на рассылки", async () => {
    const service = new ListAdminBroadcastsService({
      async listBroadcasts(limit) {
        assert.equal(limit, ADMIN_BROADCAST_HISTORY_LIMIT);
        return [];
      }
    });

    assert.deepEqual(await service.execute({ actor: broadcastActor() }), { items: [] });
    await assert.rejects(
      () => service.execute({
        actor: { ...broadcastActor(), permission: "participants.export" as never }
      }),
      /broadcast permission is invalid/
    );
  });
});

describe("CountAdminBroadcastAudienceService", () => {
  it("возвращает число получателей по тем же фильтрам, что и отправка", async () => {
    const asked: unknown[] = [];
    const service = new CountAdminBroadcastAudienceService({
      async countAudience(input) {
        asked.push(input);
        return 137;
      }
    });

    const result = await service.execute({
      actor: broadcastActor(),
      targetEventId: "019c0123-4567-789a-bcde-f01234567801",
      targetOrderStatus: "paid"
    });

    assert.deepEqual(result, {
      recipientCount: 137,
      truncated: false,
      limit: ADMIN_BROADCAST_AUDIENCE_LIMIT
    });
    assert.deepEqual(asked, [{
      targetAudience: "orders",
      targetEventId: "019c0123-4567-789a-bcde-f01234567801",
      targetOrderStatus: "paid"
    }]);
  });

  it("предупреждает, что за один раз уйдёт не вся аудитория", async () => {
    const service = new CountAdminBroadcastAudienceService({
      async countAudience() {
        return ADMIN_BROADCAST_AUDIENCE_LIMIT + 1;
      }
    });

    const result = await service.execute({ actor: broadcastActor() });

    assert.equal(result.truncated, true);
  });

  it("не считает аудиторию без разрешения на рассылки", async () => {
    const service = new CountAdminBroadcastAudienceService({
      async countAudience() {
        throw new Error("не должно вызываться");
      }
    });

    await assert.rejects(
      () => service.execute({
        actor: { ...broadcastActor(), permission: "participants.export" as never }
      }),
      /broadcast permission is invalid/
    );
  });
});

function repositoryFor(
  created: (CreateAdminBroadcastInput & { readonly id: string })[],
  imageExists = true
): AdminBroadcastRepository {
  return {
    async createBroadcast(input) {
      created.push(input);
    },
    async imageExists() {
      return imageExists;
    }
  };
}

function outboxWriter(sink: unknown[]): OutboxWriter {
  return {
    async append(event) {
      sink.push(event);
    }
  };
}

function unitOfWork(): UnitOfWork {
  return {
    async transact(work) {
      return work();
    }
  };
}

function idGenerator() {
  let count = 0;
  return {
    newId() {
      count += 1;
      return `id-${count}`;
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
