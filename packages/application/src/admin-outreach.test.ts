import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminRequestActor } from "@ticket-platform/contracts";
import {
  AdminOutreachService,
  type AdminOutreachRepository
} from "./admin-outreach.js";

describe("AdminOutreachService", () => {
  it("normalizes a bounded import and assigns it to the current manager", async () => {
    let received:
      Parameters<AdminOutreachRepository["importContacts"]>[0] | undefined;
    const service = new AdminOutreachService(
      repository({
        async importContacts(input) {
          received = input;
          return {
            received: input.rows.length,
            createdContacts: 1,
            updatedContacts: 0,
            addedToCampaign: 1,
            alreadyInCampaign: 0
          };
        }
      }),
      { normalize: () => "+79991234567" },
      sequenceIds()
    );

    const result = await service.importContacts({
      actor: writeActor,
      campaignId: CAMPAIGN_ID,
      rows: [{
        name: " Анна ",
        phone: "8 999 123-45-67",
        telegram: "@Anna_Test",
        source: " База 2025 "
      }],
      now
    });

    assert.equal(result.addedToCampaign, 1);
    assert.equal(received?.assignedAdminId, ADMIN_ID);
    assert.deepEqual(received?.rows[0], {
      displayName: "Анна",
      phoneE164: "+79991234567",
      telegramUsername: "Anna_Test",
      telegramUsernameNormalized: "anna_test",
      maxIdentifier: null,
      maxIdentifierNormalized: null,
      source: "База 2025",
      note: null,
      contactId: "00000000-0000-4000-8000-000000000201",
      campaignContactId: "00000000-0000-4000-8000-000000000202"
    });
  });

  it("records a manager-owned message batch and rejects impossible results", async () => {
    let received:
      Parameters<AdminOutreachRepository["recordActivities"]>[0] | undefined;
    const service = new AdminOutreachService(
      repository({
        async recordActivities(input) {
          received = input;
          return input.activities.length;
        }
      }),
      { normalize: (value) => value },
      sequenceIds()
    );

    const result = await service.recordActivities({
      actor: writeActor,
      campaignContactIds: [CAMPAIGN_CONTACT_ID, CAMPAIGN_CONTACT_ID_2],
      channel: "telegram",
      result: "sent",
      note: "Первая рассылка",
      now
    });

    assert.equal(result.recorded, 2);
    assert.equal(received?.actorAdminId, ADMIN_ID);
    assert.equal(received?.action, "message");
    assert.ok(received?.batchId);
    await assert.rejects(
      service.recordActivities({
        actor: writeActor,
        campaignContactIds: [CAMPAIGN_CONTACT_ID],
        channel: "phone",
        result: "sent",
        now
      }),
      /activity result/
    );
  });

  it("does not accept a read-scoped actor for mutations", async () => {
    const service = new AdminOutreachService(
      repository({}),
      { normalize: (value) => value },
      sequenceIds()
    );
    await assert.rejects(
      service.createCampaign({
        actor: { ...writeActor, permission: "outreach.read" },
        name: "Test",
        now
      }),
      /permission/
    );
  });

  it("requires a reason for a lost stage and creates a trimmed follow-up task", async () => {
    let received: Parameters<AdminOutreachRepository["createTask"]>[0] | undefined;
    const service = new AdminOutreachService(
      repository({
        async createTask(input) {
          received = input;
          return true;
        }
      }),
      { normalize: (value) => value },
      sequenceIds()
    );

    await assert.rejects(
      service.updateContactStage({
        actor: writeActor,
        campaignContactId: CAMPAIGN_CONTACT_ID,
        stage: "lost",
        now
      }),
      /lost reason/
    );
    const result = await service.createTask({
      actor: writeActor,
      campaignContactId: CAMPAIGN_CONTACT_ID,
      type: "call",
      text: "  Перезвонить после обеда  ",
      dueAt: new Date("2026-07-30T12:00:00.000Z"),
      now
    });

    assert.equal(result.created, true);
    assert.equal(received?.text, "Перезвонить после обеда");
    assert.equal(received?.assignedAdminId, null);
  });

  it("normalizes pipeline labels and derives positions from the submitted order", async () => {
    let received:
      Parameters<AdminOutreachRepository["updatePipelineColumns"]>[0] | undefined;
    const service = new AdminOutreachService(
      repository({
        async updatePipelineColumns(input) {
          received = input;
          return true;
        }
      }),
      { normalize: (value) => value },
      sequenceIds()
    );

    const result = await service.updatePipelineColumns({
      actor: writeActor,
      campaignId: CAMPAIGN_ID,
      columns: [
        { stage: "new", label: " Новые лиды ", position: 7 },
        { stage: "dialogue", label: "Обсуждаем", position: 1 },
        { stage: "first_contact", label: "Первый контакт", position: 2 },
        { stage: "follow_up", label: "Вернуться позже", position: 3 },
        { stage: "interested", label: "Готов купить", position: 4 },
        { stage: "won", label: "Успешно", position: 5 },
        { stage: "lost", label: "Закрыто", position: 6 }
      ],
      now
    });

    assert.equal(result.updated, true);
    assert.equal(received?.columns[0]?.label, "Новые лиды");
    assert.equal(received?.columns[0]?.position, 1);
    assert.equal(received?.columns[1]?.stage, "dialogue");
    assert.equal(received?.columns[1]?.position, 2);
  });
});

function repository(
  overrides: Partial<AdminOutreachRepository>
): AdminOutreachRepository {
  return {
    async listCampaigns() { return []; },
    async getCampaign() { return null; },
    async createCampaign() {},
    async updateCampaign() { return false; },
    async listPipelineColumns() { return []; },
    async updatePipelineColumns() { return false; },
    async listContacts() { return { items: [], total: 0, page: 1, limit: 50 }; },
    async getContact() { return null; },
    async importContacts(input) {
      return {
        received: input.rows.length,
        createdContacts: 0,
        updatedContacts: 0,
        addedToCampaign: 0,
        alreadyInCampaign: 0
      };
    },
    async assignContacts() { return 0; },
    async recordActivities() { return 0; },
    async updateContactStage() { return false; },
    async createTask() { return false; },
    async completeTask() { return false; },
    async listManagers() { return []; },
    async exportCampaignContacts() { return { campaign: null, rows: [] }; },
    ...overrides
  };
}

function sequenceIds() {
  let index = 0;
  const ids = [
    "00000000-0000-4000-8000-000000000201",
    "00000000-0000-4000-8000-000000000202",
    "00000000-0000-4000-8000-000000000203",
    "00000000-0000-4000-8000-000000000204",
    "00000000-0000-4000-8000-000000000205"
  ];
  return {
    newId() {
      const id = ids[index];
      index += 1;
      if (!id) {
        throw new Error("ID fixture exhausted");
      }
      return id;
    }
  };
}

const ADMIN_ID = "00000000-0000-4000-8000-000000000101";
const CAMPAIGN_ID = "00000000-0000-4000-8000-000000000102";
const CAMPAIGN_CONTACT_ID = "00000000-0000-4000-8000-000000000103";
const CAMPAIGN_CONTACT_ID_2 = "00000000-0000-4000-8000-000000000104";
const now = new Date("2026-07-29T12:00:00.000Z");

const writeActor: AdminRequestActor = {
  adminId: ADMIN_ID,
  authSubject: "auth-1",
  roleCodes: ["sales_manager"],
  permission: "outreach.write"
};
