import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GrantAdminRoleService,
  InvalidAdminRoleGrantInputError,
  type AdminRoleGrantRepository,
  type GrantAdminRoleOutcome,
  type GrantAdminRoleRecord
} from "./admin-role-grant.js";

function repositoryStub(
  outcome: GrantAdminRoleOutcome = { status: "granted", adminId: "admin-1" }
): {
  readonly repository: AdminRoleGrantRepository;
  readonly records: GrantAdminRoleRecord[];
} {
  const records: GrantAdminRoleRecord[] = [];
  return {
    records,
    repository: {
      grant(record) {
        records.push(record);
        return Promise.resolve(outcome);
      }
    }
  };
}

function serviceWith(repository: AdminRoleGrantRepository): GrantAdminRoleService {
  let counter = 0;
  return new GrantAdminRoleService(repository, {
    newId: () => `id-${++counter}`
  });
}

const occurredAt = new Date("2026-08-21T09:00:00.000Z");

const command = {
  authSubject: "  8f1c0a2e-0000-4000-8000-000000000001  ",
  email: "  Manager@Biz-Day.RU ",
  displayName: "  Мария Ильина  ",
  roleCode: " Sales_Manager ",
  grantedByAuthSubject: null,
  reason: "  Новый менеджер по продажам  ",
  occurredAt
};

test("нормализует ввод перед записью", async () => {
  const { repository, records } = repositoryStub();
  const result = await serviceWith(repository).grant(command);

  assert.deepEqual(result, { status: "granted", adminId: "admin-1" });
  const record = records[0];
  assert.ok(record);
  assert.equal(record.authSubject, "8f1c0a2e-0000-4000-8000-000000000001");
  // Почту приводим к нижнему регистру: в базе на неё есть ограничение, и запрос по ней
  // иначе не находит человека, заведённого с заглавными буквами.
  assert.equal(record.emailNormalized, "manager@biz-day.ru");
  assert.equal(record.displayName, "Мария Ильина");
  assert.equal(record.roleCode, "sales_manager");
  assert.equal(record.reason, "Новый менеджер по продажам");
  assert.equal(record.occurredAt, occurredAt);
});

test("повторную выдачу той же роли отдаёт как есть, а не как ошибку", async () => {
  const { repository } = repositoryStub({
    status: "already_granted",
    adminId: "admin-1"
  });
  const result = await serviceWith(repository).grant(command);

  assert.deepEqual(result, { status: "already_granted", adminId: "admin-1" });
});

test("причина обязательна: без неё выдача не попадёт в журнал осмысленной", async () => {
  const { repository, records } = repositoryStub();
  await assert.rejects(
    () => serviceWith(repository).grant({ ...command, reason: "   " }),
    InvalidAdminRoleGrantInputError
  );
  assert.equal(records.length, 0);
});

test("роль с пробелами и знаками до базы не доходит", async () => {
  const { repository, records } = repositoryStub();
  await assert.rejects(
    () => serviceWith(repository).grant({ ...command, roleCode: "Sales Manager" }),
    InvalidAdminRoleGrantInputError
  );
  assert.equal(records.length, 0);
});

test("почта без собаки не проходит", async () => {
  const { repository } = repositoryStub();
  await assert.rejects(
    () => serviceWith(repository).grant({ ...command, email: "manager" }),
    InvalidAdminRoleGrantInputError
  );
});

test("без почты и имени роль всё равно выдаётся", async () => {
  const { repository, records } = repositoryStub();
  await serviceWith(repository).grant({
    ...command,
    email: null,
    displayName: "  "
  });

  const record = records[0];
  assert.ok(record);
  assert.equal(record.emailNormalized, null);
  assert.equal(record.displayName, null);
});
