import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  AdminPermission,
  AuthenticatorAssuranceLevel
} from "@ticket-platform/contracts";
import {
  AdminAuthenticationError,
  AdminMfaRequiredError,
  AdminPermissionDeniedError,
  AuthorizeAdminRequestService,
  type AdminAuthorizationOptions,
  type AdminPrincipal,
  type AdminPrincipalRepository
} from "./admin-authorization.js";

describe("AuthorizeAdminRequestService", () => {
  it("returns an actor for an active administrator with permission", async () => {
    const service = serviceFor(principal({
      permissions: ["users.read"],
      roleCodes: ["sales_manager"]
    }));

    const actor = await service.execute(token(), "users.read");

    assert.deepEqual(actor, {
      adminId: "admin-id",
      authSubject: "auth-subject",
      roleCodes: ["sales_manager"],
      permission: "users.read"
    });
  });

  it("denies missing, suspended, and locally revoked sessions", async () => {
    await assert.rejects(
      serviceFor(null).execute(token(), "users.read"),
      AdminAuthenticationError
    );
    await assert.rejects(
      serviceFor(principal({ status: "suspended" })).execute(token(), "users.read"),
      AdminAuthenticationError
    );
    await assert.rejects(
      serviceFor(principal({
        sessionsRevokedBefore: new Date("2026-07-23T10:00:00.000Z")
      })).execute(token(), "users.read"),
      AdminAuthenticationError
    );
  });

  it("denies permissions that were not granted", async () => {
    await assert.rejects(
      serviceFor(principal({ permissions: ["users.read"] }))
        .execute(token(), "users.write"),
      AdminPermissionDeniedError
    );
  });

  it("requires aal2 for MFA roles and sensitive permissions", async () => {
    await assert.rejects(
      serviceFor(principal({ requiresMfa: true }))
        .execute(token("aal1"), "users.read"),
      AdminMfaRequiredError
    );
    await assert.rejects(
      serviceFor(principal({ permissions: ["wallet.adjust"] }))
        .execute(token("aal1"), "wallet.adjust"),
      AdminMfaRequiredError
    );

    const actor = await serviceFor(principal({ permissions: ["wallet.adjust"] }))
      .execute(token("aal2"), "wallet.adjust");
    assert.equal(actor.permission, "wallet.adjust");
  });

  it("с выключенным вторым фактором пускает и роль с требованием, и денежные разрешения", async () => {
    const role = await serviceFor(
      principal({ requiresMfa: true }),
      { mfaRequired: false }
    ).execute(token("aal1"), "users.read");
    assert.equal(role.permission, "users.read");

    // Денежные разрешения снимаются вместе с остальными: панель, которая пускает в
    // заказы и отказывает в подтверждении оплаты, необъяснима для того, кто ей работает.
    const money = await serviceFor(
      principal({ permissions: ["wallet.adjust"] }),
      { mfaRequired: false }
    ).execute(token("aal1"), "wallet.adjust");
    assert.equal(money.permission, "wallet.adjust");
  });

  it("выключенный второй фактор не отменяет остальных проверок", async () => {
    await assert.rejects(
      serviceFor(principal({ status: "suspended" }), { mfaRequired: false })
        .execute(token("aal1"), "users.read"),
      AdminAuthenticationError
    );
    await assert.rejects(
      serviceFor(principal({ permissions: ["users.read"] }), { mfaRequired: false })
        .execute(token("aal1"), "users.write"),
      AdminPermissionDeniedError
    );
  });
});

function serviceFor(
  value: AdminPrincipal | null,
  options?: AdminAuthorizationOptions
) {
  const repository: AdminPrincipalRepository = {
    async findByAuthSubject() {
      return value;
    }
  };

  return options === undefined
    ? new AuthorizeAdminRequestService(repository)
    : new AuthorizeAdminRequestService(repository, options);
}

function principal(overrides: Partial<AdminPrincipal> = {}): AdminPrincipal {
  return {
    adminId: "admin-id",
    authSubject: "auth-subject",
    status: "active",
    roleCodes: ["content_manager"],
    permissions: ["users.read"] as readonly AdminPermission[],
    requiresMfa: false,
    sessionsRevokedBefore: null,
    ...overrides
  };
}

function token(assuranceLevel: AuthenticatorAssuranceLevel = "aal1") {
  return {
    subject: "auth-subject",
    assuranceLevel,
    issuedAt: new Date("2026-07-23T10:00:00.000Z")
  };
}
