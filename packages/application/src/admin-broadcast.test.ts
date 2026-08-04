import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADMIN_BROADCAST_AUDIENCE_LIMIT,
  CountAdminBroadcastAudienceService,
  CreateAdminBroadcastService
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
      targetEventId: "019c0123-4567-789a-bcde-f01234567801",
      targetOrderStatus: "paid",
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
      { async createBroadcast(input) { created.push(input); } },
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
      { async createBroadcast() {} },
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
      { async createBroadcast() {} },
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
      { async createBroadcast() {} },
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
      { async createBroadcast(input) { created.push(input); } },
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
