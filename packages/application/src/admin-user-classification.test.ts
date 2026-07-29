import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  AdminUserCategoryDefinition,
  AdminUserStatusDefinition
} from "@ticket-platform/contracts";
import {
  AdminUserClassificationCodeConflictError,
  AdminUserClassificationVersionConflictError,
  AssignAdminUserStatusService,
  CreateAdminUserCategoryService,
  CreateAdminUserStatusService,
  ListAdminUserClassificationService,
  UpdateAdminUserStatusService,
  type AdminUserClassificationRepository
} from "./admin-user-classification.js";

describe("administrator user classification services", () => {
  it("lists the catalog only with users.read", async () => {
    const fixture = createFixture();
    const result = await new ListAdminUserClassificationService(
      fixture.repository
    ).execute({ actor: actor("users.read") });

    assert.equal(result.statuses[0]?.code, "new");
    assert.throws(
      () => new ListAdminUserClassificationService(fixture.repository).execute({
        actor: actor("users.write")
      }),
      /mutation is invalid/
    );
  });

  it("creates normalized catalog entries with immutable codes and audit", async () => {
    const fixture = createFixture();
    const status = await new CreateAdminUserStatusService(
      fixture.repository,
      fixture.ids
    ).execute({
      actor: actor("users.write"),
      request: {
        code: "VIP_LEAD",
        displayName: "  VIP-лид  ",
        color: "#ca8a04",
        description: null,
        exclusivityGroup: " lifecycle ",
        allowedTransitionCodes: ["paid"],
        reason: "Новый этап продаж"
      },
      metadata
    });
    const category = await new CreateAdminUserCategoryService(
      fixture.repository,
      fixture.ids
    ).execute({
      actor: actor("users.write"),
      request: {
        code: "vip",
        displayName: "VIP",
        color: "#16a34a",
        description: "Приоритетный пользователь",
        reason: "Добавлен рабочий тег"
      },
      metadata
    });

    assert.equal(status.code, "vip_lead");
    assert.equal(status.color, "#CA8A04");
    assert.equal(status.exclusivityGroup, "lifecycle");
    assert.equal(category.code, "vip");
    assert.equal(fixture.createdStatuses.length, 1);
    assert.equal(fixture.createdCategories.length, 1);
  });

  it("maps repository conflicts without hiding optimistic locking", async () => {
    const duplicate = createFixture({ createStatus: "code_conflict" });
    await assert.rejects(
      new CreateAdminUserStatusService(
        duplicate.repository,
        duplicate.ids
      ).execute({
        actor: actor("users.write"),
        request: {
          code: "lead",
          displayName: "Лид",
          color: "#2563EB",
          description: null,
          exclusivityGroup: null,
          allowedTransitionCodes: null,
          reason: "Проверка конфликта"
        },
        metadata
      }),
      AdminUserClassificationCodeConflictError
    );

    const stale = createFixture({ updateStatus: "version_conflict" });
    await assert.rejects(
      new UpdateAdminUserStatusService(
        stale.repository,
        stale.ids
      ).execute({
        actor: actor("users.write"),
        statusId,
        request: {
          expectedLockVersion: 1,
          displayName: "Новый",
          color: "#64748B",
          description: null,
          exclusivityGroup: "lifecycle",
          allowedTransitionCodes: null,
          isActive: true,
          reason: "Проверка версии"
        },
        metadata
      }),
      AdminUserClassificationVersionConflictError
    );
  });

  it("builds an audited manual assignment command", async () => {
    let received: unknown;
    const service = new AssignAdminUserStatusService({
      async execute(command) {
        received = command;
        return {
          changed: true,
          assignmentId: statusId,
          statusCodes: ["interested"],
          categoryCodes: []
        };
      }
    }, { newId: () => auditId });

    const result = await service.execute({
      actor: actor("users.write"),
      userId: statusId,
      request: {
        code: "interested",
        reason: "Подтверждено оператором"
      },
      metadata
    });

    assert.equal(result.changed, true);
    assert.deepEqual(
      received,
      {
        userId: statusId,
        source: "manual",
        sourceReference: `manual:${auditId}`,
        actorAdminId: adminId,
        reason: "Подтверждено оператором",
        assignedAt: metadata.occurredAt,
        audit: {
          auditId,
          actorRole: "sales_manager",
          requestId: metadata.requestId,
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent
        },
        statusCode: "interested"
      }
    );
  });
});

function createFixture(options: {
  readonly createStatus?: "created" | "code_conflict" | "transition_not_found";
  readonly updateStatus?: "version_conflict";
} = {}) {
  const createdStatuses: AdminUserStatusDefinition[] = [];
  const createdCategories: AdminUserCategoryDefinition[] = [];
  let sequence = 0;
  const repository: AdminUserClassificationRepository = {
    async listCatalog() {
      return { statuses: [systemStatus], categories: [] };
    },
    async createStatus(input) {
      createdStatuses.push(input.status);
      return options.createStatus ?? "created";
    },
    async updateStatus(input) {
      if (options.updateStatus) {
        return { status: options.updateStatus };
      }
      return {
        status: "updated",
        value: {
          ...systemStatus,
          ...input.patch,
          lockVersion: input.expectedLockVersion + 1
        }
      };
    },
    async createCategory(input) {
      createdCategories.push(input.category);
      return "created";
    },
    async updateCategory(input) {
      return {
        status: "updated",
        value: {
          id: input.categoryId,
          code: "vip",
          isSystem: false,
          lockVersion: input.expectedLockVersion + 1,
          ...input.patch
        }
      };
    }
  };
  return {
    repository,
    ids: {
      newId() {
        sequence += 1;
        return sequence % 2 === 1 ? statusId : auditId;
      }
    },
    createdStatuses,
    createdCategories
  };
}

function actor(permission: "users.read" | "users.write") {
  return {
    adminId,
    authSubject: "auth-user-1",
    roleCodes: ["sales_manager"],
    permission
  } as const;
}

const adminId = "00000000-0000-4000-8000-000000000101";
const statusId = "00000000-0000-4000-8000-000000000102";
const auditId = "00000000-0000-4000-8000-000000000103";

const systemStatus: AdminUserStatusDefinition = {
  id: statusId,
  code: "new",
  displayName: "Новый",
  color: "#64748B",
  description: null,
  isSystem: true,
  exclusivityGroup: "lifecycle",
  allowedTransitionCodes: null,
  isActive: true,
  lockVersion: 1
};
const metadata = {
  requestId: "request-classification-1",
  ipAddress: "127.0.0.1",
  userAgent: "test",
  occurredAt: new Date("2026-07-28T19:00:00.000Z")
};
