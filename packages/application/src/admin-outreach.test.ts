import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminRequestActor } from "@ticket-platform/contracts";
import {
  AdminOutreachService,
  computeTaskUrgency,
  type AdminOutreachRepository
} from "./admin-outreach.js";

describe("computeTaskUrgency", () => {
  const now = new Date("2026-07-30T12:00:00.000Z");

  it("buckets a past due time as overdue", () => {
    assert.equal(
      computeTaskUrgency(new Date("2026-07-30T09:00:00.000Z"), now),
      "overdue"
    );
  });

  it("buckets the same calendar day as today", () => {
    assert.equal(
      computeTaskUrgency(new Date("2026-07-30T20:00:00.000Z"), now),
      "today"
    );
  });

  it("buckets the next calendar day as tomorrow", () => {
    assert.equal(
      computeTaskUrgency(new Date("2026-07-31T08:00:00.000Z"), now),
      "tomorrow"
    );
  });

  it("buckets within a week as this_week and beyond as later", () => {
    assert.equal(
      computeTaskUrgency(new Date("2026-08-04T08:00:00.000Z"), now),
      "this_week"
    );
    assert.equal(
      computeTaskUrgency(new Date("2026-08-10T08:00:00.000Z"), now),
      "later"
    );
  });
});

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

  it("stores the event a campaign sells for, and null when there is none", async () => {
    const created: Parameters<AdminOutreachRepository["createCampaign"]>[0][] = [];
    const service = new AdminOutreachService(
      repository({
        async createCampaign(input) { created.push(input); },
        async getCampaign() {
          return {
            id: CAMPAIGN_ID,
            name: "Тест",
            description: null,
            status: "active",
            eventId: null,
            eventTitle: null,
            totalContacts: 0,
            untouchedContacts: 0,
            interestedContacts: 0,
            convertedContacts: 0,
            createdAt: now.toISOString(),
            completedAt: null
          };
        }
      }),
      { normalize: (value) => value },
      sequenceIds()
    );

    await service.createCampaign({
      actor: writeActor,
      name: "Пикник, холодная база",
      eventId: CAMPAIGN_ID,
      now
    });
    await service.createCampaign({ actor: writeActor, name: "Без события", now });

    assert.equal(created[0]?.eventId, CAMPAIGN_ID);
    assert.equal(created[1]?.eventId, null);
  });

  it("rejects a campaign pointed at something that is not an event id", async () => {
    const service = new AdminOutreachService(
      repository({}),
      { normalize: (value) => value },
      sequenceIds()
    );

    await assert.rejects(
      service.createCampaign({
        actor: writeActor,
        name: "Пикник",
        eventId: "не-uuid",
        now
      }),
      /invalid/
    );
  });

  it("tells the campaign apart from clearing its event link", async () => {
    const updates: Parameters<AdminOutreachRepository["updateCampaign"]>[0][] = [];
    const service = new AdminOutreachService(
      repository({
        async updateCampaign(input) {
          updates.push(input);
          return false;
        }
      }),
      { normalize: (value) => value },
      sequenceIds()
    );

    // Не трогаем привязку.
    await service.updateCampaign({
      actor: writeActor,
      campaignId: CAMPAIGN_ID,
      name: "Новое имя",
      now
    });
    // Снимаем привязку.
    await service.updateCampaign({
      actor: writeActor,
      campaignId: CAMPAIGN_ID,
      eventId: null,
      now
    });

    assert.equal("eventId" in (updates[0] ?? {}), false);
    assert.equal(updates[1]?.eventId, null);
  });

  it("requires a reason for a lost stage and creates a trimmed follow-up task", async () => {
    let received: Parameters<AdminOutreachRepository["createTask"]>[0] | undefined;
    const service = new AdminOutreachService(
      repository({
        async getPipelineColumnOutcome() { return "lost"; },
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
          return "updated";
        }
      }),
      { normalize: (value) => value },
      sequenceIds()
    );

    const result = await service.updatePipelineColumns({
      actor: writeActor,
      campaignId: CAMPAIGN_ID,
      columns: [
        { stage: "dialogue", label: "Обсуждаем", outcome: "open" },
        { stage: "new", label: " Новые лиды ", outcome: "open" },
        { stage: "won", label: "Успешно", outcome: "won" },
        { stage: "lost", label: "Закрыто", outcome: "lost" },
        { label: "Новая колонка", outcome: "open" }
      ],
      now
    });

    assert.equal(result.updated, true);
    assert.equal(received?.columns[0]?.stage, "dialogue");
    assert.equal(received?.columns[0]?.position, 1);
    assert.equal(received?.columns[1]?.label, "Новые лиды");
    assert.equal(received?.columns[1]?.position, 2);
    assert.equal(received?.columns[4]?.label, "Новая колонка");
    assert.match(received?.columns[4]?.stage ?? "", /^s_[a-z0-9]+$/);
  });

  it("rejects a duplicate lost-stage move without a reason via the outcome lookup", async () => {
    const service = new AdminOutreachService(
      repository({
        async getPipelineColumnOutcome() { return "lost"; }
      }),
      { normalize: (value) => value },
      sequenceIds()
    );

    await assert.rejects(
      service.updateContactStage({
        actor: writeActor,
        campaignContactId: CAMPAIGN_CONTACT_ID,
        stage: "closed_lost",
        now
      }),
      /lost reason/
    );
  });

  it("rejects moving a contact to a stage the campaign no longer has", async () => {
    const service = new AdminOutreachService(
      repository({
        async getPipelineColumnOutcome() { return null; }
      }),
      { normalize: (value) => value },
      sequenceIds()
    );

    await assert.rejects(
      service.updateContactStage({
        actor: writeActor,
        campaignContactId: CAMPAIGN_CONTACT_ID,
        stage: "deleted_stage",
        now
      }),
      /was not found/
    );
  });

  it("requires select options and rejects options on a non-select field", async () => {
    const service = new AdminOutreachService(
      repository({}),
      { normalize: (value) => value },
      sequenceIds()
    );

    await assert.rejects(
      service.createCustomFieldDefinition({
        actor: writeActor,
        label: "Источник",
        type: "select",
        options: [],
        now
      }),
      /options are invalid/
    );
    await assert.rejects(
      service.createCustomFieldDefinition({
        actor: writeActor,
        label: "Бюджет",
        type: "number",
        options: ["a"],
        now
      }),
      /only valid for a select field/
    );

    const created = await service.createCustomFieldDefinition({
      actor: writeActor,
      label: "Источник",
      type: "select",
      options: [" Instagram ", "Instagram", "Сайт"],
      now
    });
    assert.deepEqual(created.options, ["Instagram", "Сайт"]);
  });

  it("surfaces a friendly error when deleting a pipeline stage still in use", async () => {
    const service = new AdminOutreachService(
      repository({
        async updatePipelineColumns() { return "stage_in_use"; }
      }),
      { normalize: (value) => value },
      sequenceIds()
    );

    await assert.rejects(
      service.updatePipelineColumns({
        actor: writeActor,
        campaignId: CAMPAIGN_ID,
        columns: [{ stage: "new", label: "Новые", outcome: "open" }],
        now
      }),
      /still has contacts/
    );
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
    async updatePipelineColumns() { return "updated"; },
    async getPipelineColumnOutcome() { return "open"; },
    async listCustomFieldDefinitions() { return []; },
    async createCustomFieldDefinition(input) {
      return {
        id: input.id,
        campaignId: input.campaignId,
        key: input.key,
        label: input.label,
        type: input.type,
        options: input.options,
        position: 1
      };
    },
    async deleteCustomFieldDefinition() { return false; },
    async setCustomFieldValue() { return false; },
    async listTaskBoard() { return []; },
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
