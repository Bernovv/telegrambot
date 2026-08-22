import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GetAdminOrderService,
  ListAdminOrdersService,
  ListAdminUsersService,
  type AdminOperationsRepository,
  type AdminUserSummary
} from "./admin-operations.js";

describe("administrator read operations", () => {
  it("normalizes user filters and emits an opaque next cursor", async () => {
    let received: Parameters<AdminOperationsRepository["listUsers"]>[0] | undefined;
    const repository = fixtureRepository({
      async listUsers(input) {
        received = input;
        return [userOne, userTwo];
      }
    });
    const service = new ListAdminUsersService(repository);

    const result = await service.execute({
      actor: usersActor,
      search: "  @Alice  ",
      blocked: false,
      limit: 1
    });

    assert.equal(received?.search, "@Alice");
    assert.equal(received?.limit, 2);
    assert.deepEqual(result.items, [userOne]);
    assert.match(result.nextCursor ?? "", /^[A-Za-z0-9_-]+$/);
  });

  it("decodes a cursor and validates order filters before persistence", async () => {
    let received: Parameters<AdminOperationsRepository["listOrders"]>[0] | undefined;
    const repository = fixtureRepository({
      async listUsers() {
        return [userOne, userTwo];
      },
      async listOrders(input) {
        received = input;
        return [];
      }
    });
    const users = new ListAdminUsersService(repository);
    const firstPage = await users.execute({
      actor: usersActor,
      limit: 1
    });
    assert.ok(firstPage.nextCursor);
    const orders = new ListAdminOrdersService(repository);

    await orders.execute({
      actor: ordersActor,
      status: "paid",
      userId: USER_ID,
      cursor: firstPage.nextCursor
    });

    assert.equal(received?.status, "paid");
    assert.equal(received?.userId, USER_ID);
    assert.equal(received?.cursor?.id, USER_ID);
    assert.equal(
      received?.cursor?.occurredAt.toISOString(),
      userOne.registeredAt
    );
  });

  it("rejects a foreign permission, malformed cursor, and malformed UUID", async () => {
    const repository = fixtureRepository();
    const users = new ListAdminUsersService(repository);
    const order = new GetAdminOrderService(repository);

    await assert.rejects(
      users.execute({ actor: ordersActor }),
      /permission/
    );
    await assert.rejects(
      users.execute({ actor: usersActor, cursor: "not-a-cursor" }),
      /cursor/
    );
    await assert.rejects(
      order.execute({ actor: ordersActor, orderId: "not-a-uuid" }),
      /lookup/
    );
  });
});

function fixtureRepository(
  overrides: Partial<AdminOperationsRepository> = {}
): AdminOperationsRepository {
  return {
    async listUsers() {
      return [];
    },
    async getUser() {
      return null;
    },
    async listOrders() {
      return [];
    },
    async getOrder() {
      return null;
    },
    ...overrides
  };
}

const USER_ID = "00000000-0000-4000-8000-000000000001";
const ADMIN_ID = "00000000-0000-4000-8000-000000000010";

const userOne: AdminUserSummary = {
  id: USER_ID,
  displayName: "Alice",
  telegramUsername: "alice",
  phone: "+79991234567",
  phoneStatus: "verified",
  isBlocked: false,
  registeredAt: "2026-07-25T14:00:00.000Z",
  lastSeenAt: "2026-07-25T14:30:00.000Z",
  orderCount: 2,
  paidOrderCount: 1,
  channels: ["telegram"],
  walletAvailableKopecks: "10000",
  walletHeldKopecks: "0"
};

const userTwo: AdminUserSummary = {
  ...userOne,
  id: "00000000-0000-4000-8000-000000000002",
  displayName: "Bob",
  registeredAt: "2026-07-25T13:00:00.000Z"
};

const usersActor = {
  adminId: ADMIN_ID,
  authSubject: "auth-1",
  roleCodes: ["sales_manager"],
  permission: "users.read" as const
};

const ordersActor = {
  ...usersActor,
  permission: "orders.read" as const
};
