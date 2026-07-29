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
});

function repository(
  overrides: Partial<AdminOutreachRepository>
): AdminOutreachRepository {
  return {
    async listCampaigns() { return []; },
    async getCampaign() { return null; },
    async createCampaign() {},
    async updateCampaign() { return false; },
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
