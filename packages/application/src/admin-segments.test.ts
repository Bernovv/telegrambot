import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AdminSegmentClassificationUnavailableError,
  InvalidAdminSegmentPreviewError,
  PreviewAdminSegmentService,
  type AdminSegmentPreviewRepository
} from "./admin-segments.js";

describe("administrator segment preview", () => {
  it("normalizes bounded groups and delegates a read-only preview", async () => {
    let received: unknown;
    const service = new PreviewAdminSegmentService(repository({
      async preview(input) {
        received = input;
        return { totalCount: "2", sampleUsers: [] };
      }
    }));

    const result = await service.execute({
      actor,
      request: {
        operator: "and",
        groups: [{
          operator: "or",
          conditions: [{
            kind: "status",
            mode: "any",
            codes: ["paid", "paid", "interested"]
          }, {
            kind: "category",
            mode: "none",
            codes: ["vip"]
          }]
        }]
      }
    });

    assert.equal(result.totalCount, "2");
    assert.deepEqual(received, {
      operator: "and",
      groups: [{
        operator: "or",
        conditions: [{
          kind: "status",
          mode: "any",
          codes: ["interested", "paid"]
        }, {
          kind: "category",
          mode: "none",
          codes: ["vip"]
        }]
      }],
      sampleLimit: 20
    });
  });

  it("rejects inactive references and unbounded expressions", async () => {
    const unavailable = new PreviewAdminSegmentService(repository({
      async findUnavailableClassificationCodes() {
        return { statusCodes: ["retired"], categoryCodes: [] };
      }
    }));
    await assert.rejects(
      unavailable.execute({
        actor,
        request: {
          operator: "and",
          groups: [{
            operator: "and",
            conditions: [{
              kind: "status",
              mode: "all",
              codes: ["retired"]
            }]
          }]
        }
      }),
      AdminSegmentClassificationUnavailableError
    );

    const invalid = new PreviewAdminSegmentService(repository({}));
    await assert.rejects(
      invalid.execute({
        actor,
        request: { operator: "and", groups: [], sampleLimit: 20 }
      }),
      InvalidAdminSegmentPreviewError
    );
  });
});

function repository(
  overrides: Partial<AdminSegmentPreviewRepository>
): AdminSegmentPreviewRepository {
  return {
    async findUnavailableClassificationCodes() {
      return { statusCodes: [], categoryCodes: [] };
    },
    async preview() {
      return { totalCount: "0", sampleUsers: [] };
    },
    ...overrides
  };
}

const actor = {
  adminId: "00000000-0000-4000-8000-000000000101",
  authSubject: "auth-1",
  roleCodes: ["analyst"],
  permission: "users.read"
} as const;
