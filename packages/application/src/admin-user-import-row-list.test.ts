import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AdminUserImportRowsNotFoundError,
  InvalidAdminUserImportRowsRequestError,
  ListAdminUserImportRowsService
} from "./admin-user-import-row-list.js";

describe("ListAdminUserImportRowsService", () => {
  it("passes a bounded cursor to the repository", async () => {
    let received: unknown;
    const service = new ListAdminUserImportRowsService({
      async listRows(input) {
        received = input;
        return { rows: [], nextAfterRowNumber: null };
      }
    });

    const result = await service.execute({
      ...baseInput,
      afterRowNumber: 201,
      limit: 200
    });

    assert.deepEqual(received, {
      analysisId,
      afterRowNumber: 201,
      limit: 200
    });
    assert.equal(result.nextAfterRowNumber, null);
  });

  it("rejects oversized pages and maps an unknown analysis", async () => {
    const service = new ListAdminUserImportRowsService({
      async listRows() {
        return null;
      }
    });

    await assert.rejects(
      service.execute({ ...baseInput, afterRowNumber: 1, limit: 201 }),
      InvalidAdminUserImportRowsRequestError
    );
    await assert.rejects(
      service.execute({ ...baseInput, afterRowNumber: 1, limit: 100 }),
      AdminUserImportRowsNotFoundError
    );
  });
});

const analysisId = "00000000-0000-4000-8000-000000000903";
const baseInput = {
  actor: {
    adminId: "00000000-0000-4000-8000-000000000101",
    authSubject: "auth-1",
    roleCodes: ["technical_admin"],
    permission: "imports.execute" as const
  },
  analysisId
};
