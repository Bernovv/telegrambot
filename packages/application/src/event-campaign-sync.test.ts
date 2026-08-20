import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EVENT_CAMPAIGN_AUTOMATION_ADMIN_ID,
  SyncEventCampaignsBatchService,
  type PendingEventCampaign
} from "./event-campaign-sync.js";

describe("SyncEventCampaignsBatchService", () => {
  it("наполняет каждую отставшую кампанию и отмечает её сверенной", async () => {
    const state = importerState();
    const marked: string[] = [];
    const service = new SyncEventCampaignsBatchService(
      repository([campaign("c-1", "e-1"), campaign("c-2", "e-2")], marked),
      state.importer
    );

    const result = await service.execute({ at: AT, batchSize: 20 });

    assert.deepEqual(result, { campaigns: 2, added: 6, failed: 0 });
    assert.deepEqual(state.calls.map((call) => call.campaignId), ["c-1", "c-2"]);
    assert.deepEqual(marked, ["c-1", "c-2"]);
  });

  it("заводит контакты ничьими: ответственного назначает менеджер", async () => {
    const state = importerState();
    const service = new SyncEventCampaignsBatchService(
      repository([campaign("c-1", "e-1")], []),
      state.importer
    );

    await service.execute({ at: AT, batchSize: 20 });

    assert.equal(state.calls[0]?.assignedAdminId, null);
    assert.equal(
      state.calls[0]?.actor.adminId,
      EVENT_CAMPAIGN_AUTOMATION_ADMIN_ID
    );
    assert.equal(state.calls[0]?.actor.permission, "outreach.write");
  });

  it("отмечает сверку временем начала прохода, а не окончанием", async () => {
    const state = importerState();
    const marked: { readonly campaignId: string; readonly at: Date }[] = [];
    const service = new SyncEventCampaignsBatchService(
      {
        listPendingCampaigns: async () => [campaign("c-1", "e-1")],
        markSynced: async (input) => {
          marked.push(input);
        }
      },
      state.importer
    );

    await service.execute({ at: AT, batchSize: 20 });

    assert.equal(marked[0]?.at.toISOString(), AT.toISOString());
  });

  it("одна сломанная кампания не останавливает остальные и не получает отметку", async () => {
    const marked: string[] = [];
    const service = new SyncEventCampaignsBatchService(
      repository([campaign("c-1", "e-1"), campaign("c-2", "e-2")], marked),
      {
        importEventParticipants: async (input) => {
          if (input.campaignId === "c-1") {
            throw new Error("campaign is completed");
          }
          return { addedToCampaign: 2, alreadyInCampaign: 0, invalidRows: 0 };
        }
      }
    );

    const result = await service.execute({ at: AT, batchSize: 20 });

    assert.deepEqual(result, { campaigns: 2, added: 2, failed: 1 });
    assert.deepEqual(marked, ["c-2"]);
  });

  it("ничего не делает, когда отставших кампаний нет", async () => {
    const state = importerState();
    const service = new SyncEventCampaignsBatchService(
      repository([], []),
      state.importer
    );

    const result = await service.execute({ at: AT, batchSize: 20 });

    assert.deepEqual(result, { campaigns: 0, added: 0, failed: 0 });
    assert.equal(state.calls.length, 0);
  });
});

const AT = new Date("2026-08-20T10:00:00.000Z");

function campaign(campaignId: string, eventId: string): PendingEventCampaign {
  return { campaignId, eventId, eventTitle: `Встреча ${eventId}` };
}

function repository(
  pending: readonly PendingEventCampaign[],
  marked: string[]
) {
  return {
    listPendingCampaigns: async () => pending,
    markSynced: async (input: { readonly campaignId: string }) => {
      marked.push(input.campaignId);
    }
  };
}

function importerState() {
  const calls: {
    readonly campaignId: string;
    readonly assignedAdminId: string | null | undefined;
    readonly actor: { readonly adminId: string; readonly permission: string };
  }[] = [];
  return {
    calls,
    importer: {
      importEventParticipants: async (input: {
        readonly campaignId: string;
        readonly assignedAdminId?: string | null;
        readonly actor: { readonly adminId: string; readonly permission: string };
      }) => {
        calls.push({
          campaignId: input.campaignId,
          assignedAdminId: input.assignedAdminId,
          actor: input.actor
        });
        return { addedToCampaign: 3, alreadyInCampaign: 1, invalidRows: 0 };
      }
    }
  };
}
