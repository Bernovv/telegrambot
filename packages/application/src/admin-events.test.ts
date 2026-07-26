import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminEventSummary } from "@ticket-platform/contracts";
import {
  GetAdminEventService,
  ListAdminEventsService,
  type AdminEventsRepository
} from "./admin-events.js";

describe("administrator event read operations", () => {
  it("normalizes filters and emits an opaque cursor", async () => {
    let received:
      Parameters<AdminEventsRepository["listEvents"]>[0] | undefined;
    const service = new ListAdminEventsService(repository({
      async listEvents(input) {
        received = input;
        return [eventOne, eventTwo];
      }
    }));

    const result = await service.execute({
      actor,
      search: "  Business Picnic  ",
      status: "published",
      limit: 1
    });

    assert.equal(received?.search, "Business Picnic");
    assert.equal(received?.status, "published");
    assert.equal(received?.limit, 2);
    assert.deepEqual(result.items, [eventOne]);
    assert.match(result.nextCursor ?? "", /^[A-Za-z0-9_-]+$/);
  });

  it("decodes the event cursor on the next page", async () => {
    let received:
      Parameters<AdminEventsRepository["listEvents"]>[0] | undefined;
    const fixture = repository({
      async listEvents(input) {
        received = input;
        return received.cursor ? [] : [eventOne, eventTwo];
      }
    });
    const service = new ListAdminEventsService(fixture);
    const first = await service.execute({ actor, limit: 1 });
    assert.ok(first.nextCursor);

    await service.execute({ actor, cursor: first.nextCursor });

    assert.equal(received?.cursor?.id, eventOne.id);
    assert.equal(
      received?.cursor?.occurredAt.toISOString(),
      eventOne.createdAt
    );
  });

  it("rejects foreign permission and malformed inputs", async () => {
    const fixture = repository();
    const list = new ListAdminEventsService(fixture);
    const get = new GetAdminEventService(fixture);

    await assert.rejects(
      list.execute({
        actor: { ...actor, permission: "orders.read" },
        status: "published"
      }),
      /permission/
    );
    await assert.rejects(
      list.execute({ actor, status: "unknown" }),
      /status/
    );
    await assert.rejects(
      list.execute({ actor, cursor: "not-a-cursor" }),
      /cursor/
    );
    await assert.rejects(
      get.execute({ actor, eventId: "not-a-uuid" }),
      /lookup/
    );
  });
});

function repository(
  overrides: Partial<AdminEventsRepository> = {}
): AdminEventsRepository {
  return {
    async listEvents() {
      return [];
    },
    async getEvent() {
      return null;
    },
    ...overrides
  };
}

const eventOne: AdminEventSummary = {
  id: "00000000-0000-4000-8000-000000000101",
  slug: "business-picnic",
  title: "Business Picnic",
  status: "published",
  timezone: "Europe/Moscow",
  startsAt: "2026-08-20T08:00:00.000Z",
  endsAt: "2026-08-20T18:00:00.000Z",
  salesStartsAt: "2026-07-01T00:00:00.000Z",
  salesEndsAt: "2026-08-19T21:00:00.000Z",
  locationName: "Park",
  capacity: 500,
  productCount: 3,
  activeProductCount: 3,
  orderCount: 120,
  paidOrderCount: 98,
  ticketCount: 180,
  reservedInventoryUnits: 15,
  consumedInventoryUnits: 180,
  createdAt: "2026-06-01T12:00:00.000Z",
  updatedAt: "2026-07-25T12:00:00.000Z"
};

const eventTwo: AdminEventSummary = {
  ...eventOne,
  id: "00000000-0000-4000-8000-000000000102",
  slug: "business-breakfast",
  title: "Business Breakfast",
  createdAt: "2026-05-01T12:00:00.000Z"
};

const actor = {
  adminId: "00000000-0000-4000-8000-000000000010",
  authSubject: "auth-1",
  roleCodes: ["content_manager"],
  permission: "events.read" as const
};
