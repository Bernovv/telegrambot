import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AdminBootstrapAlreadyCompletedError,
  BootstrapFirstAdminService,
  InvalidAdminBootstrapInputError,
  type BootstrapAdminRecord,
  type FirstAdminBootstrapRepository
} from "./admin-bootstrap.js";

describe("BootstrapFirstAdminService", () => {
  it("normalizes and provisions one audited super administrator", async () => {
    let saved: BootstrapAdminRecord | undefined;
    const service = new BootstrapFirstAdminService(
      repository(async (record) => {
        saved = record;
        return true;
      }),
      ids(["admin-id", "grant-id", "audit-id"])
    );

    const result = await service.execute({
      authSubject: " auth-subject ",
      email: " OWNER@EXAMPLE.COM ",
      displayName: " Owner ",
      reason: "Initial reviewed administrator bootstrap",
      occurredAt: new Date("2026-07-23T12:00:00.000Z")
    });

    assert.deepEqual(result, { adminId: "admin-id" });
    assert.deepEqual(saved, {
      adminId: "admin-id",
      roleGrantId: "grant-id",
      auditId: "audit-id",
      authSubject: "auth-subject",
      emailNormalized: "owner@example.com",
      displayName: "Owner",
      reason: "Initial reviewed administrator bootstrap",
      occurredAt: new Date("2026-07-23T12:00:00.000Z")
    });
  });

  it("fails when bootstrap was already completed", async () => {
    const service = new BootstrapFirstAdminService(
      repository(async () => false),
      ids(["admin-id", "grant-id", "audit-id"])
    );

    await assert.rejects(
      service.execute(command()),
      AdminBootstrapAlreadyCompletedError
    );
  });

  it("rejects malformed bootstrap identity data", async () => {
    const service = new BootstrapFirstAdminService(
      repository(async () => true),
      ids(["admin-id", "grant-id", "audit-id"])
    );

    await assert.rejects(
      service.execute({ ...command(), email: "not-an-email" }),
      InvalidAdminBootstrapInputError
    );
  });
});

function command() {
  return {
    authSubject: "auth-subject",
    email: null,
    displayName: null,
    reason: "Initial reviewed administrator bootstrap",
    occurredAt: new Date("2026-07-23T12:00:00.000Z")
  };
}

function repository(
  tryBootstrap: FirstAdminBootstrapRepository["tryBootstrap"]
): FirstAdminBootstrapRepository {
  return { tryBootstrap };
}

function ids(values: readonly string[]) {
  let index = 0;

  return {
    newId() {
      const value = values[index++];
      assert.ok(value);
      return value;
    }
  };
}
