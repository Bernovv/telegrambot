import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminPermission, AdminRequestActor } from "@ticket-platform/contracts";
import {
  AdminStaffService,
  LastHeadError,
  type AdminStaffRepository,
  type StoredMentorSlot,
  type StoredStaffMember
} from "./admin-staff.js";

const HEAD_ID = "019c0123-4567-789a-bcde-f01234560001";
const MENTOR_ID = "019c0123-4567-789a-bcde-f01234560002";
const SLOT_ID = "019c0123-4567-789a-bcde-f01234560003";
const CONTACT_ID = "019c0123-4567-789a-bcde-f01234560004";
const NOW = new Date("2026-08-24T09:00:00.000Z");

describe("AdminStaffService.view", () => {
  it("раскладывает роли на три и оставляет прежние отдельной строкой", async () => {
    const service = build({
      members: [
        member({ adminId: HEAD_ID, roleCodes: ["head", "super_admin"] }),
        member({ adminId: MENTOR_ID, roleCodes: ["mentor"], freeSlots: 4 })
      ]
    });

    const view = await service.view({ actor: actor("team.read", HEAD_ID) });

    assert.deepEqual(view.members[0]?.roles, ["head"]);
    assert.deepEqual(view.members[0]?.legacyRoleCodes, ["super_admin"]);
    assert.deepEqual(view.members[1]?.roles, ["mentor"]);
    assert.equal(view.members[1]?.freeSlots, 4);
    assert.equal(view.viewerAdminId, HEAD_ID);
  });

  it("не пускает с чужим разрешением", async () => {
    const service = build({});
    await assert.rejects(
      service.view({ actor: actor("team.manage", HEAD_ID) }),
      /Administrator team permission is invalid/
    );
  });
});

describe("AdminStaffService.setRole", () => {
  it("выдаёт роль", async () => {
    const granted: string[] = [];
    const service = build({
      grantRole: async (input) => {
        granted.push(`${input.adminId}:${input.roleCode}`);
        return true;
      }
    });

    const result = await service.setRole({
      actor: actor("team.manage", HEAD_ID),
      adminId: MENTOR_ID,
      role: "mentor",
      granted: true
    });

    assert.equal(result.changed, true);
    assert.deepEqual(granted, [`${MENTOR_ID}:mentor`]);
  });

  // Иначе роли выдавать станет некому, и чинится это только руками в базе.
  it("не даёт снять роль с последнего руководителя", async () => {
    const service = build({
      members: [member({ adminId: HEAD_ID, roleCodes: ["head"] })]
    });

    await assert.rejects(
      service.setRole({
        actor: actor("team.manage", HEAD_ID),
        adminId: HEAD_ID,
        role: "head",
        granted: false
      }),
      LastHeadError
    );
  });

  it("снимает роль, когда руководитель не последний", async () => {
    const revoked: string[] = [];
    const service = build({
      members: [
        member({ adminId: HEAD_ID, roleCodes: ["head"] }),
        member({ adminId: MENTOR_ID, roleCodes: ["head"] })
      ],
      revokeRole: async (input) => {
        revoked.push(input.roleCode);
        return true;
      }
    });

    const result = await service.setRole({
      actor: actor("team.manage", HEAD_ID),
      adminId: MENTOR_ID,
      role: "head",
      granted: false
    });

    assert.equal(result.changed, true);
    assert.deepEqual(revoked, ["head"]);
  });
});

describe("AdminStaffService.createSlots", () => {
  // «По вторникам и четвергам в 15 и 18» — это четыре окошка на неделю, а не одно.
  it("разворачивает расписание в окошки по местным дням и часам", async () => {
    const created: Date[] = [];
    const service = build({
      createSlots: async (input) => {
        created.push(...input.slots.map((slot) => slot.startsAt));
        return input.slots.length;
      }
    });

    const result = await service.createSlots({
      actor: actor("mentor_slots.manage", HEAD_ID),
      mentorAdminId: MENTOR_ID,
      // Вторник 25 августа и четверг 27 августа 2026 года.
      fromDate: "2026-08-24",
      toDate: "2026-08-28",
      weekdays: [2, 4],
      hours: [15, 18]
    });

    assert.equal(result.created, 4);
    assert.equal(result.skipped, 0);
    // Пятнадцать часов по Москве — это двенадцать по Гринвичу.
    assert.deepEqual(
      created.map((date) => date.toISOString()),
      [
        "2026-08-25T12:00:00.000Z",
        "2026-08-25T15:00:00.000Z",
        "2026-08-27T12:00:00.000Z",
        "2026-08-27T15:00:00.000Z"
      ]
    );
  });

  // Повтор не отменяет всю пачку: расписание на месяц не должно ломаться из-за одного
  // часа, заведённого на прошлой неделе.
  it("считает пропущенными окошки, которые уже были", async () => {
    const service = build({ createSlots: async () => 1 });

    const result = await service.createSlots({
      actor: actor("mentor_slots.manage", HEAD_ID),
      mentorAdminId: MENTOR_ID,
      fromDate: "2026-08-24",
      toDate: "2026-08-28",
      weekdays: [2],
      hours: [15, 18]
    });

    assert.deepEqual(result, { created: 1, skipped: 1 });
  });

  it("отказывает, когда не выбраны ни дни, ни часы", async () => {
    const service = build({});
    await assert.rejects(
      service.createSlots({
        actor: actor("mentor_slots.manage", HEAD_ID),
        mentorAdminId: MENTOR_ID,
        fromDate: "2026-08-24",
        toDate: "2026-08-28",
        weekdays: [],
        hours: [15]
      }),
      /Mentor slot schedule is empty/
    );
  });
});

describe("AdminStaffService.bookSlot", () => {
  it("возвращает отказ, когда окошко успели занять", async () => {
    const service = build({ bookSlot: async () => "already_booked" });

    const outcome = await service.bookSlot({
      actor: actor("mentor_slots.book", HEAD_ID),
      slotId: SLOT_ID,
      contactId: CONTACT_ID
    });

    assert.equal(outcome, "already_booked");
  });

  it("требует разрешение на запись, а не на правку календаря", async () => {
    const service = build({});
    await assert.rejects(
      service.bookSlot({
        actor: actor("mentor_slots.manage", HEAD_ID),
        slotId: SLOT_ID,
        contactId: CONTACT_ID
      }),
      /Administrator team permission is invalid/
    );
  });
});

function build(overrides: Partial<AdminStaffRepository> & {
  readonly members?: readonly StoredStaffMember[];
}): AdminStaffService {
  const members = overrides.members ?? [];
  const repository: AdminStaffRepository = {
    listMembers: async () => members,
    hasPermission: async () => true,
    grantRole: async () => true,
    revokeRole: async () => true,
    listSlots: async () => [] as readonly StoredMentorSlot[],
    createSlots: async (input) => input.slots.length,
    cancelSlot: async () => true,
    bookSlot: async () => "booked",
    releaseSlot: async () => true,
    ...stripMembers(overrides)
  };
  return new AdminStaffService(repository, { now: () => NOW }, {
    newId: () => SLOT_ID
  });
}

function stripMembers(
  overrides: Partial<AdminStaffRepository> & {
    readonly members?: readonly StoredStaffMember[];
  }
): Partial<AdminStaffRepository> {
  const { members, ...rest } = overrides;
  void members;
  return rest;
}

function member(
  overrides: Partial<StoredStaffMember> & { readonly adminId: string }
): StoredStaffMember {
  return {
    displayName: "Человек",
    email: null,
    status: "active",
    roleCodes: [],
    freeSlots: 0,
    bookedSlots: 0,
    ...overrides
  };
}

function actor(permission: AdminPermission, adminId: string): AdminRequestActor {
  return {
    adminId,
    authSubject: "auth-subject",
    roleCodes: ["head"],
    permission
  };
}
