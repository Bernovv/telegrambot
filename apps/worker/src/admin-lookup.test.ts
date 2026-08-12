import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SqlConnection, SqlQueryResult } from "@ticket-platform/database";
import { resolveAdminId } from "./admin-lookup.js";

const WITH_EMAIL = {
  id: "019c0123-4567-789a-bcde-f0123456789c",
  email_normalized: "second@example.com",
  display_name: "Второй",
  roles: "sales_manager"
};
const WITHOUT_EMAIL = {
  id: "019c0123-4567-789a-bcde-f0123456789b",
  email_normalized: null,
  display_name: "Люба",
  roles: "super_admin"
};

describe("resolveAdminId", () => {
  it("finds an administrator by email, ignoring case and stray spaces", async () => {
    const id = await resolveAdminId(connection([WITH_EMAIL]), "  Second@Example.COM ");

    assert.equal(id, WITH_EMAIL.id);
  });

  // Почта в admin_accounts необязательна: учётку можно завести только с идентификатором
  // пользователя Supabase, и тогда искать по почте нечего.
  it("finds an administrator who has no email at all, by their id", async () => {
    const id = await resolveAdminId(
      connection([WITHOUT_EMAIL]),
      WITHOUT_EMAIL.id.toUpperCase()
    );

    assert.equal(id, WITHOUT_EMAIL.id);
  });

  it("shows who does exist instead of a bare «not found»", async () => {
    await assert.rejects(
      () => resolveAdminId(connection([WITHOUT_EMAIL, WITH_EMAIL]), "нет@такого.рф"),
      (error: Error) => {
        assert.match(error.message, /Активные администраторы/);
        assert.match(error.message, new RegExp(WITHOUT_EMAIL.id));
        assert.match(error.message, /почта не указана/);
        assert.match(error.message, /second@example\.com/);
        assert.match(error.message, /super_admin/);
        return true;
      }
    );
  });

  it("says plainly when the table has nobody active", async () => {
    await assert.rejects(
      () => resolveAdminId(connection([]), "кто@угодно.рф"),
      /активных администраторов в базе нет/
    );
  });
});

function connection(rows: readonly unknown[]): SqlConnection {
  return {
    async query<TRow>(): Promise<SqlQueryResult<TRow>> {
      return { rows: rows as readonly TRow[], rowCount: rows.length };
    },
    release() {
      // соединением здесь не владеем
    }
  };
}
