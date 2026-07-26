import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminRequestActor } from "@ticket-platform/contracts";
import {
  AdminEventContentBlockNotFoundError,
  AdminEventContentSortOrderConflictError,
  CreateAdminEventContentBlockService,
  UpdateAdminEventContentBlockService,
  type AdminEventContentManagementRepository
} from "./admin-event-content-management.js";
import { InvalidAdminEventMutationError } from "./admin-event-management.js";

describe("administrator event content management", () => {
  it("normalizes and creates a versioned JSON content block", async () => {
    const captured: unknown[] = [];
    const repository = repositoryStub();
    repository.createContentBlock = async (input) => {
      captured.push(input);
      return { status: "created", lockVersion: 4 };
    };
    const service = new CreateAdminEventContentBlockService(
      repository,
      idGenerator(CONTENT_BLOCK_ID, AUDIT_ID)
    );

    const result = await service.execute({
      actor,
      eventId: EVENT_ID,
      expectedLockVersion: 3,
      contentBlock: {
        blockType: "program",
        title: "  Программа  ",
        content: { items: [{ time: "12:00", title: "Открытие" }] },
        sortOrder: 20,
        isVisible: true
      },
      reason: "Добавить программу",
      metadata: command.metadata
    });

    assert.equal(result.resourceId, CONTENT_BLOCK_ID);
    assert.equal(result.lockVersion, 4);
    const capturedCommand = captured[0] as {
      readonly contentBlock: {
        readonly title: string;
        readonly contentSchemaVersion: number;
      };
    };
    assert.equal(capturedCommand.contentBlock.title, "Программа");
    assert.equal(capturedCommand.contentBlock.contentSchemaVersion, 1);
  });

  it("maps missing blocks and sort-order conflicts", async () => {
    const create = new CreateAdminEventContentBlockService(
      {
        ...repositoryStub(),
        async createContentBlock() {
          return { status: "sort_order_conflict" };
        }
      },
      idGenerator(CONTENT_BLOCK_ID, AUDIT_ID)
    );
    await assert.rejects(
      create.execute(command),
      AdminEventContentSortOrderConflictError
    );

    const update = new UpdateAdminEventContentBlockService(
      {
        ...repositoryStub(),
        async updateContentBlock() {
          return { status: "content_block_not_found" };
        }
      },
      idGenerator(AUDIT_ID)
    );
    await assert.rejects(
      update.execute({ ...command, contentBlockId: CONTENT_BLOCK_ID }),
      AdminEventContentBlockNotFoundError
    );
  });

  it("rejects non-JSON values and oversized nesting", async () => {
    const service = new CreateAdminEventContentBlockService(
      repositoryStub(),
      idGenerator(CONTENT_BLOCK_ID, AUDIT_ID)
    );
    await assert.rejects(
      service.execute({
        ...command,
        contentBlock: {
          ...command.contentBlock,
          content: { invalid: undefined }
        }
      }),
      InvalidAdminEventMutationError
    );
  });
});

function repositoryStub(): AdminEventContentManagementRepository {
  return {
    async createContentBlock() {
      return { status: "created", lockVersion: 2 };
    },
    async updateContentBlock() {
      return { status: "updated", lockVersion: 2 };
    }
  };
}

function idGenerator(...ids: string[]) {
  let index = 0;
  return {
    newId() {
      const id = ids[index];
      index += 1;
      assert.ok(id);
      return id;
    }
  };
}

const actor: AdminRequestActor = {
  adminId: "00000000-0000-4000-8000-000000000010",
  authSubject: "auth-1",
  roleCodes: ["content_manager"],
  permission: "events.write"
};

const command = {
  actor,
  eventId: "00000000-0000-4000-8000-000000000101",
  expectedLockVersion: 3,
  contentBlock: {
    blockType: "description" as const,
    title: null,
    content: { text: "Описание мероприятия" },
    sortOrder: 10,
    isVisible: true
  },
  reason: "Обновить контент",
  metadata: {
    requestId: "request-content-1",
    ipAddress: "127.0.0.1",
    userAgent: "admin-web-test",
    occurredAt: new Date("2026-07-26T12:00:00.000Z")
  }
};

const EVENT_ID = command.eventId;
const CONTENT_BLOCK_ID = "00000000-0000-4000-8000-000000000401";
const AUDIT_ID = "00000000-0000-4000-8000-000000000901";
