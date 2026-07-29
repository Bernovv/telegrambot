import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminSavedSegment } from "@ticket-platform/contracts";
import {
  AdminSavedSegmentVersionConflictError,
  CreateAdminSavedSegmentService,
  PublishAdminSavedSegmentService,
  UpdateAdminSavedSegmentDraftService,
  type AdminSavedSegmentRepository
} from "./admin-saved-segments.js";

describe("saved administrator segments", () => {
  it("creates a normalized audited draft with broadcasts.send", async () => {
    let received: unknown;
    const service = new CreateAdminSavedSegmentService(repository({
      async create(input) {
        received = input;
        return segment;
      }
    }), ids());

    const result = await service.execute({
      actor: writeActor,
      request: {
        name: "  Покупатели  ",
        description: "  Активная аудитория  ",
        expression: {
          operator: "and",
          groups: [{
            operator: "or",
            conditions: [{
              kind: "status",
              mode: "any",
              codes: ["paid", "paid", "interested"]
            }]
          }]
        },
        reason: "  Первый черновик  "
      },
      metadata
    });

    assert.equal(result.id, segmentId);
    assert.deepEqual(
      (received as { readonly expression: unknown }).expression,
      {
        operator: "and",
        groups: [{
          operator: "or",
          conditions: [{
            kind: "status",
            mode: "any",
            codes: ["interested", "paid"]
          }]
        }]
      }
    );
    assert.equal((received as { readonly name: string }).name, "Покупатели");
    assert.equal(
      (received as { readonly audit: { readonly reason: string } }).audit.reason,
      "Первый черновик"
    );
  });

  it("publishes the current draft and exposes optimistic conflicts", async () => {
    let publishedCodes: unknown;
    const publish = new PublishAdminSavedSegmentService(repository({
      async get() {
        return segment;
      },
      async publishDraft(input) {
        publishedCodes = {
          statusCodes: input.statusCodes,
          categoryCodes: input.categoryCodes
        };
        return { status: "published", value: publishedSegment };
      }
    }), ids());
    const result = await publish.execute({
      actor: writeActor,
      segmentId,
      request: { expectedLockVersion: 1, reason: "Публикация" },
      metadata
    });
    assert.equal(result.published?.versionNumber, 1);
    assert.deepEqual(publishedCodes, {
      statusCodes: ["paid"],
      categoryCodes: ["vip"]
    });

    const update = new UpdateAdminSavedSegmentDraftService(repository({
      async saveDraft() {
        return { status: "version_conflict" };
      }
    }), ids());
    await assert.rejects(
      update.execute({
        actor: writeActor,
        segmentId,
        request: {
          expectedLockVersion: 1,
          name: "Покупатели",
          expression,
          reason: "Конфликт"
        },
        metadata
      }),
      AdminSavedSegmentVersionConflictError
    );
  });
});

function repository(
  overrides: Partial<AdminSavedSegmentRepository>
): AdminSavedSegmentRepository {
  return {
    async list() {
      return [];
    },
    async get() {
      return null;
    },
    async findUnavailableClassificationCodes() {
      return { statusCodes: [], categoryCodes: [] };
    },
    async create() {
      return segment;
    },
    async saveDraft() {
      return { status: "saved", value: segment };
    },
    async publishDraft() {
      return { status: "published", value: publishedSegment };
    },
    ...overrides
  };
}

function ids() {
  const values = [segmentId, versionId, auditId];
  return { newId: () => values.shift() ?? auditId };
}

const segmentId = "00000000-0000-4000-8000-000000000501";
const versionId = "00000000-0000-4000-8000-000000000502";
const auditId = "00000000-0000-4000-8000-000000000503";

const expression = {
  operator: "and",
  groups: [{
    operator: "and",
    conditions: [{
      kind: "status",
      mode: "any",
      codes: ["paid"]
    }, {
      kind: "category",
      mode: "all",
      codes: ["vip"]
    }]
  }]
} as const;

const draft = {
  id: versionId,
  versionNumber: 1,
  status: "draft",
  schemaVersion: 1,
  name: "Покупатели",
  description: null,
  expression,
  createdAt: "2026-07-29T08:00:00.000Z",
  updatedAt: "2026-07-29T08:00:00.000Z",
  publishedAt: null
} as const;

const segment: AdminSavedSegment = {
  id: segmentId,
  name: "Покупатели",
  description: null,
  lockVersion: 1,
  draft,
  published: null,
  updatedAt: "2026-07-29T08:00:00.000Z"
};

const publishedSegment: AdminSavedSegment = {
  ...segment,
  lockVersion: 2,
  draft: null,
  published: {
    ...draft,
    status: "published",
    publishedAt: "2026-07-29T08:00:00.000Z"
  }
};

const writeActor = {
  adminId: "00000000-0000-4000-8000-000000000101",
  authSubject: "auth-1",
  roleCodes: ["content_manager"],
  permission: "broadcasts.send"
} as const;

const metadata = {
  requestId: "request-123",
  ipAddress: "127.0.0.1",
  userAgent: "test",
  occurredAt: new Date("2026-07-29T08:00:00.000Z")
};
