import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DomainEvent } from "@ticket-platform/domain";
import {
  AddUserCategoryService,
  RemoveUserCategoryService,
  RemoveUserStatusService,
  SetUserStatusService,
  UserStatusTransitionNotAllowedError,
  type ActiveUserCategoryAssignment,
  type ActiveUserStatusAssignment,
  type UserCategoryDefinition,
  type UserClassificationRepository,
  type UserStatusDefinition
} from "./user-classification.js";

describe("user classification services", () => {
  it("replaces only the active status in the same group and emits one event", async () => {
    const fixture = createFixture({
      statuses: [status("new"), status("interested")],
      activeStatuses: [{
        id: "assignment-old",
        statusId: statusId("new"),
        code: "new",
        exclusivityGroup: "lifecycle",
        allowedTransitionCodes: null
      }]
    });

    const result = await fixture.setStatus.execute(statusCommand("interested"));

    assert.equal(result.changed, true);
    assert.deepEqual(result.statusCodes, ["interested"]);
    assert.deepEqual(fixture.closedStatusIds, ["assignment-old"]);
    assert.equal(fixture.events[0]?.eventType, "UserStatusAssigned");
    assert.deepEqual(fixture.events[0]?.payload, {
      assignmentId: "generated-1",
      userId,
      code: "interested",
      source: "scenario",
      sourceReference: `${sourceReference}:status`,
      replacedCode: "new"
    });
  });

  it("is a successful no-op when the requested status is already active", async () => {
    const fixture = createFixture({
      statuses: [status("interested")],
      activeStatuses: [{
        id: "assignment-current",
        statusId: statusId("interested"),
        code: "interested",
        exclusivityGroup: "lifecycle",
        allowedTransitionCodes: null
      }]
    });

    const result = await fixture.setStatus.execute(statusCommand("interested"));

    assert.equal(result.changed, false);
    assert.equal(result.assignmentId, "assignment-current");
    assert.equal(fixture.events.length, 0);
    assert.equal(fixture.createdStatusCodes.length, 0);
  });

  it("enforces configured outgoing status transitions", async () => {
    const fixture = createFixture({
      statuses: [status("paid")],
      activeStatuses: [{
        id: "assignment-current",
        statusId: statusId("payment_pending"),
        code: "payment_pending",
        exclusivityGroup: "lifecycle",
        allowedTransitionCodes: ["interested"]
      }]
    });

    await assert.rejects(
      fixture.setStatus.execute(statusCommand("paid")),
      UserStatusTransitionNotAllowedError
    );
    assert.equal(fixture.closedStatusIds.length, 0);
    assert.equal(fixture.createdStatusCodes.length, 0);
  });

  it("adds a category once and preserves other active classification", async () => {
    const fixture = createFixture({
      categories: [category("vip")],
      activeStatuses: [{
        id: "assignment-status",
        statusId: statusId("paid"),
        code: "paid",
        exclusivityGroup: "lifecycle",
        allowedTransitionCodes: null
      }]
    });

    const first = await fixture.addCategory.execute(categoryCommand("vip"));
    const second = await fixture.addCategory.execute(categoryCommand("vip"));

    assert.equal(first.changed, true);
    assert.equal(second.changed, false);
    assert.deepEqual(second.statusCodes, ["paid"]);
    assert.deepEqual(second.categoryCodes, ["vip"]);
    assert.deepEqual(fixture.createdCategoryCodes, ["vip"]);
    assert.equal(fixture.events.length, 1);
    assert.equal(fixture.events[0]?.eventType, "UserCategoryAssigned");
  });

  it("closes manual status and category assignments without deleting history", async () => {
    const fixture = createFixture({
      statuses: [status("interested")],
      categories: [category("vip")],
      activeStatuses: [{
        id: "00000000-0000-4000-8000-000000000402",
        statusId: statusId("interested"),
        code: "interested",
        exclusivityGroup: "lifecycle",
        allowedTransitionCodes: null
      }],
      activeCategories: [{
        id: "00000000-0000-4000-8000-000000000401",
        categoryId: category("vip").id,
        code: "vip"
      }]
    });

    const removedStatus = await fixture.removeStatus.execute({
      ...statusCommand("interested"),
      sourceReference: `${sourceReference}:remove-status`
    });
    const removedCategory = await fixture.removeCategory.execute({
      userId,
      categoryCode: "vip",
      source: "scenario",
      sourceReference: `${sourceReference}:remove-category`,
      actorAdminId: null,
      reason: "Снятие по сценарию",
      assignedAt
    });

    assert.equal(removedStatus.changed, true);
    assert.deepEqual(removedCategory.categoryCodes, []);
    assert.deepEqual(
      fixture.events.map((event) => event.eventType),
      ["UserStatusRemoved", "UserCategoryRemoved"]
    );
  });
});

function createFixture(input: {
  readonly statuses?: readonly UserStatusDefinition[];
  readonly categories?: readonly UserCategoryDefinition[];
  readonly activeStatuses?: readonly ActiveUserStatusAssignment[];
  readonly activeCategories?: readonly ActiveUserCategoryAssignment[];
}) {
  const statuses = new Map(
    (input.statuses ?? []).map((definition) => [definition.code, definition])
  );
  const categories = new Map(
    (input.categories ?? []).map((definition) => [definition.code, definition])
  );
  const activeStatuses = [...(input.activeStatuses ?? [])];
  const activeCategories = [...(input.activeCategories ?? [])];
  const closedStatusIds: string[] = [];
  const createdStatusCodes: string[] = [];
  const createdCategoryCodes: string[] = [];
  const events: DomainEvent[] = [];
  let sequence = 0;

  const repository: UserClassificationRepository = {
    async lockUser() {
      return true;
    },
    async findStatusByCode(code) {
      return statuses.get(code) ?? null;
    },
    async findCategoryByCode(code) {
      return categories.get(code) ?? null;
    },
    async findActiveStatus(_userId, targetStatusId) {
      return activeStatuses.find(
        (assignment) => assignment.statusId === targetStatusId
      ) ?? null;
    },
    async findActiveStatusInGroup(_userId, group) {
      return activeStatuses.find(
        (assignment) => assignment.exclusivityGroup === group
      ) ?? null;
    },
    async closeStatusAssignment(close) {
      closedStatusIds.push(close.assignmentId);
      const index = activeStatuses.findIndex(
        (assignment) => assignment.id === close.assignmentId
      );
      if (index >= 0) {
        activeStatuses.splice(index, 1);
      }
    },
    async createStatusAssignment(create) {
      createdStatusCodes.push(create.status.code);
      activeStatuses.push({
        id: create.assignmentId,
        statusId: create.status.id,
        code: create.status.code,
        exclusivityGroup: create.status.exclusivityGroup,
        allowedTransitionCodes: create.status.allowedTransitionCodes
      });
    },
    async findActiveCategory(_userId, categoryId) {
      return activeCategories.find(
        (assignment) => assignment.categoryId === categoryId
      ) ?? null;
    },
    async createCategoryAssignment(create) {
      createdCategoryCodes.push(create.category.code);
      activeCategories.push({
        id: create.assignmentId,
        categoryId: create.category.id,
        code: create.category.code
      });
    },
    async closeCategoryAssignment(close) {
      const index = activeCategories.findIndex(
        (assignment) => assignment.id === close.assignmentId
      );
      if (index >= 0) {
        activeCategories.splice(index, 1);
      }
    },
    async getActiveSnapshot() {
      return {
        statusCodes: activeStatuses.map((assignment) => assignment.code).sort(),
        categoryCodes:
          activeCategories.map((assignment) => assignment.code).sort()
      };
    }
  };
  const outbox = { async append(event: DomainEvent) { events.push(event); } };
  const unitOfWork = { async transact<T>(work: () => Promise<T>) { return work(); } };
  const ids = {
    newId() {
      sequence += 1;
      return `generated-${sequence}`;
    }
  };
  return {
    setStatus: new SetUserStatusService(repository, outbox, unitOfWork, ids),
    addCategory: new AddUserCategoryService(repository, outbox, unitOfWork, ids),
    removeStatus: new RemoveUserStatusService(
      repository,
      outbox,
      unitOfWork,
      ids
    ),
    removeCategory: new RemoveUserCategoryService(
      repository,
      outbox,
      unitOfWork,
      ids
    ),
    closedStatusIds,
    createdStatusCodes,
    createdCategoryCodes,
    events
  };
}

function status(code: string): UserStatusDefinition {
  return {
    id: statusId(code),
    code,
    displayName: code,
    color: "#2563EB",
    exclusivityGroup: "lifecycle",
    allowedTransitionCodes: null,
    isActive: true
  };
}

function category(code: string): UserCategoryDefinition {
  return {
    id: "00000000-0000-4000-8000-000000000301",
    code,
    displayName: code,
    color: "#16A34A",
    isActive: true
  };
}

function statusId(code: string): string {
  const number = {
    new: "201",
    interested: "202",
    payment_pending: "203",
    paid: "204"
  }[code] ?? "299";
  return `00000000-0000-4000-8000-000000000${number}`;
}

function statusCommand(statusCode: string) {
  return {
    userId,
    statusCode,
    source: "scenario" as const,
    sourceReference: `${sourceReference}:status`,
    actorAdminId: null,
    reason: "Переход по сценарию",
    assignedAt
  };
}

function categoryCommand(categoryCode: string) {
  return {
    userId,
    categoryCode,
    source: "scenario" as const,
    sourceReference: `${sourceReference}:category`,
    actorAdminId: null,
    reason: "Категория по сценарию",
    assignedAt
  };
}

const userId = "00000000-0000-4000-8000-000000000101";
const sourceReference =
  "scenario:00000000-0000-4000-8000-000000000102:00000000-0000-4000-8000-000000000103";
const assignedAt = new Date("2026-07-28T18:00:00.000Z");
