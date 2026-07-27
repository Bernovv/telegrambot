import assert from "node:assert/strict";
import test from "node:test";
import {
  participantsExportErrorMessage,
  readExportFilename
} from "./participants-export";

test("reads the server filename only when it is a plain quoted name", () => {
  assert.equal(
    readExportFilename(
      'attachment; filename="participants-2026-08-08.csv"',
      "fallback.csv"
    ),
    "participants-2026-08-08.csv"
  );
  assert.equal(readExportFilename(null, "fallback.csv"), "fallback.csv");
  assert.equal(
    readExportFilename("attachment; filename=unquoted.csv", "fallback.csv"),
    "fallback.csv"
  );
  assert.equal(
    readExportFilename(
      'attachment; filename="../../etc/passwd"',
      "fallback.csv"
    ),
    "fallback.csv"
  );
});

test("explains export failures in the administrator's own terms", async () => {
  assert.equal(
    await participantsExportErrorMessage(new Response("", { status: 403 })),
    "Для выгрузки участников требуется разрешение participants.export."
  );
  assert.equal(
    await participantsExportErrorMessage(new Response("", { status: 401 })),
    "Сессия истекла. Войдите заново."
  );
  assert.equal(
    await participantsExportErrorMessage(
      Response.json({ title: "Event was not found" }, { status: 404 })
    ),
    "Event was not found"
  );
  assert.equal(
    await participantsExportErrorMessage(new Response("boom", { status: 500 })),
    "Не удалось выгрузить участников."
  );
});
