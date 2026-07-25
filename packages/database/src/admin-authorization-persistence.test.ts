import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  SqlConnection,
  SqlConnectionPool,
  SqlQueryResult
} from "./postgres.js";
import { PostgresAdminPrincipalRepository } from "./admin-authorization-persistence.js";

describe("PostgresAdminPrincipalRepository", () => {
  it("loads active role grants and drops unknown permissions", async () => {
    const connection = new StubConnection([{
      admin_id: "admin-id",
      auth_subject: "auth-subject",
      status: "active",
      role_codes: ["sales_manager", "financial_admin"],
      permission_codes: ["users.read", "wallet.adjust", "unknown.permission"],
      requires_mfa: true,
      sessions_revoked_before: null
    }]);
    const repository = new PostgresAdminPrincipalRepository(pool(connection));

    const principal = await repository.findByAuthSubject("auth-subject");

    assert.deepEqual(principal, {
      adminId: "admin-id",
      authSubject: "auth-subject",
      status: "active",
      roleCodes: ["financial_admin", "sales_manager"],
      permissions: ["users.read", "wallet.adjust"],
      requiresMfa: true,
      sessionsRevokedBefore: null
    });
    assert.deepEqual(connection.values, ["auth-subject"]);
    assert.match(connection.text, /grant_row\.revoked_at is null/);
    assert.equal(connection.released, true);
  });

  it("returns null when the auth subject is not provisioned", async () => {
    const connection = new StubConnection([]);
    const repository = new PostgresAdminPrincipalRepository(pool(connection));

    assert.equal(await repository.findByAuthSubject("missing"), null);
    assert.equal(connection.released, true);
  });
});

class StubConnection implements SqlConnection {
  text = "";
  values: readonly unknown[] = [];
  released = false;

  constructor(private readonly resultRows: readonly unknown[]) {}

  async query<TRow>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<SqlQueryResult<TRow>> {
    this.text = text;
    this.values = values;
    return {
      rows: this.resultRows as readonly TRow[],
      rowCount: this.resultRows.length
    };
  }

  release(): void {
    this.released = true;
  }
}

function pool(connection: SqlConnection): SqlConnectionPool {
  return {
    async connect() {
      return connection;
    }
  };
}
