import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  SqlConnection,
  SqlConnectionPool,
  SqlQueryResult
} from "./postgres.js";
import { PostgresFirstAdminBootstrapRepository } from "./admin-bootstrap-persistence.js";

describe("PostgresFirstAdminBootstrapRepository", () => {
  it("creates the first super administrator and audit row atomically", async () => {
    const connection = new RecordingConnection(false);
    const repository = new PostgresFirstAdminBootstrapRepository(pool(connection));

    assert.equal(await repository.tryBootstrap(record()), true);
    assert.deepEqual(connection.texts, [
      "begin",
      "select pg_advisory_xact_lock(hashtextextended('first-admin-bootstrap', 0))",
      "select exists(select 1 from public.admin_accounts) as exists",
      connection.texts[3],
      connection.texts[4],
      connection.texts[5],
      "commit"
    ]);
    assert.match(connection.texts[3] ?? "", /insert into public\.admin_accounts/);
    assert.match(connection.texts[4] ?? "", /insert into public\.admin_role_grants/);
    assert.match(connection.texts[5] ?? "", /insert into public\.audit_log/);
    assert.equal(connection.released, true);
  });

  it("does not create another bootstrap administrator", async () => {
    const connection = new RecordingConnection(true);
    const repository = new PostgresFirstAdminBootstrapRepository(pool(connection));

    assert.equal(await repository.tryBootstrap(record()), false);
    assert.equal(
      connection.texts.some((text) => text.includes("insert into public.admin_accounts")),
      false
    );
    assert.equal(connection.texts.at(-1), "commit");
  });

  it("rolls back all bootstrap records on failure", async () => {
    const connection = new RecordingConnection(false, "admin_role_grants");
    const repository = new PostgresFirstAdminBootstrapRepository(pool(connection));

    await assert.rejects(repository.tryBootstrap(record()), /fixture failure/);
    assert.equal(connection.texts.at(-1), "rollback");
    assert.equal(connection.released, true);
  });
});

class RecordingConnection implements SqlConnection {
  readonly texts: string[] = [];
  released = false;

  constructor(
    private readonly adminExists: boolean,
    private readonly failOn?: string
  ) {}

  async query<TRow>(text: string): Promise<SqlQueryResult<TRow>> {
    this.texts.push(text);

    if (this.failOn && text.includes(this.failOn)) {
      throw new Error("fixture failure");
    }
    if (text.includes("select exists")) {
      return {
        rows: [{ exists: this.adminExists }] as unknown as readonly TRow[],
        rowCount: 1
      };
    }

    return { rows: [], rowCount: 1 };
  }

  release(): void {
    this.released = true;
  }
}

function record() {
  return {
    adminId: "admin-id",
    roleGrantId: "grant-id",
    auditId: "audit-id",
    authSubject: "auth-subject",
    emailNormalized: "owner@example.com",
    displayName: "Owner",
    reason: "Initial reviewed administrator bootstrap",
    occurredAt: new Date("2026-07-23T12:00:00.000Z")
  };
}

function pool(connection: SqlConnection): SqlConnectionPool {
  return {
    async connect() {
      return connection;
    }
  };
}
