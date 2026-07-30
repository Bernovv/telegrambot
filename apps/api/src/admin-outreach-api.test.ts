import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminPermission } from "@ticket-platform/contracts";
import type { FastifyInstance } from "fastify";
import { createApiApplication } from "./app.js";
import type { AdminOutreachHandler } from "./admin-outreach-api.js";

describe("administrator outreach HTTP contract", () => {
  it("requires outreach.write and creates a validated campaign", async () => {
    const permissions: AdminPermission[] = [];
    const requests: unknown[] = [];
    const app = await createApiApplication({
      appVersion: "test",
      bodyLimitBytes: 600_000,
      readiness,
      adminAuth: adminAuth(permissions),
      adminOutreach: handler({
        async createCampaign(input) {
          requests.push(input);
          return campaign;
        }
      })
    });
    await app.init();
    try {
      const response = await inject(app, {
        method: "POST",
        url: "/api/v1/outreach/campaigns",
        payload: { name: " Не оплатили ", description: "Июль" }
      });
      assert.equal(response.statusCode, 201);
      assert.deepEqual(permissions, ["outreach.write"]);
      assert.equal(
        (requests[0] as { readonly name: string }).name,
        "Не оплатили"
      );
    } finally {
      await app.close();
    }
  });

  it("delegates contact filters and rejects malformed activity input", async () => {
    const requests: unknown[] = [];
    const app = await createApiApplication({
      appVersion: "test",
      bodyLimitBytes: 600_000,
      readiness,
      adminAuth: adminAuth([]),
      adminOutreach: handler({
        async listContacts(input) {
          requests.push(input);
          return { items: [], total: 0, page: 2, limit: 50 };
        },
        async recordActivities() {
          throw new Error("Outreach activity result is invalid");
        }
      })
    });
    await app.init();
    try {
      const list = await inject(app, {
        method: "GET",
        url: `/api/v1/outreach/campaigns/${CAMPAIGN_ID}/contacts?status=callback&mine=true&page=2`
      });
      const invalid = await inject(app, {
        method: "POST",
        url: "/api/v1/outreach/campaign-contacts/activities",
        payload: {
          campaignContactIds: [
            "00000000-0000-4000-8000-000000000103"
          ],
          channel: "phone",
          result: "sent"
        }
      });
      assert.equal(list.statusCode, 200);
      assert.equal(invalid.statusCode, 400);
      assert.equal(requests.length, 1);
      assert.equal((requests[0] as { readonly mine: boolean }).mine, true);
    } finally {
      await app.close();
    }
  });

  it("validates lost-stage reasons and delegates a valid stage move", async () => {
    const requests: unknown[] = [];
    const app = await createApiApplication({
      appVersion: "test",
      bodyLimitBytes: 600_000,
      readiness,
      adminAuth: adminAuth([]),
      adminOutreach: handler({
        async updateContactStage(input) {
          requests.push(input);
          return { updated: true };
        }
      })
    });
    await app.init();
    try {
      const invalid = await inject(app, {
        method: "PATCH",
        url: `/api/v1/outreach/campaign-contacts/${CAMPAIGN_CONTACT_ID}/stage`,
        payload: { stage: "lost" }
      });
      const valid = await inject(app, {
        method: "PATCH",
        url: `/api/v1/outreach/campaign-contacts/${CAMPAIGN_CONTACT_ID}/stage`,
        payload: { stage: "lost", lostReason: "declined" }
      });
      assert.equal(invalid.statusCode, 400);
      assert.equal(valid.statusCode, 200);
      assert.equal(requests.length, 1);
      assert.equal(
        (requests[0] as { readonly lostReason: string }).lostReason,
        "declined"
      );
    } finally {
      await app.close();
    }
  });

  it("requires a contact identity for manual entry and delegates valid input", async () => {
    const requests: unknown[] = [];
    const app = await createApiApplication({
      appVersion: "test",
      bodyLimitBytes: 600_000,
      readiness,
      adminAuth: adminAuth([]),
      adminOutreach: handler({
        async createContact(input) {
          requests.push(input);
          return {
            received: 1,
            createdContacts: 1,
            updatedContacts: 0,
            addedToCampaign: 1,
            alreadyInCampaign: 0
          };
        }
      })
    });
    await app.init();
    try {
      const invalid = await inject(app, {
        method: "POST",
        url: `/api/v1/outreach/campaigns/${CAMPAIGN_ID}/contacts`,
        payload: { name: "Анна" }
      });
      const valid = await inject(app, {
        method: "POST",
        url: `/api/v1/outreach/campaigns/${CAMPAIGN_ID}/contacts`,
        payload: { name: "Анна", phone: "+79991234567" }
      });
      assert.equal(invalid.statusCode, 400);
      assert.equal(valid.statusCode, 201);
      assert.equal(requests.length, 1);
      assert.equal(
        (requests[0] as { readonly contact: { readonly phone: string } })
          .contact.phone,
        "+79991234567"
      );
    } finally {
      await app.close();
    }
  });
});

function handler(
  overrides: Partial<AdminOutreachHandler>
): AdminOutreachHandler {
  return {
    async listCampaigns() { return []; },
    async getCampaign() { return campaign; },
    async createCampaign() { return campaign; },
    async updateCampaign() { return campaign; },
    async listPipelineColumns() { return []; },
    async updatePipelineColumns() { return { updated: false }; },
    async listContacts() { return { items: [], total: 0, page: 1, limit: 50 }; },
    async getContact() { return null; },
    async importContacts() {
      return {
        received: 0,
        createdContacts: 0,
        updatedContacts: 0,
        addedToCampaign: 0,
        alreadyInCampaign: 0
      };
    },
    async createContact() {
      return {
        received: 1,
        createdContacts: 1,
        updatedContacts: 0,
        addedToCampaign: 1,
        alreadyInCampaign: 0
      };
    },
    async assignContacts() { return { updated: 0 }; },
    async recordActivities() { return { recorded: 0 }; },
    async updateContactStage() { return { updated: false }; },
    async createTask() { return { created: false }; },
    async completeTask() { return { completed: false }; },
    async listManagers() { return []; },
    async exportCampaign() { return null; },
    ...overrides
  };
}

function adminAuth(permissions: AdminPermission[]) {
  return {
    tokenVerifier: {
      async verify() {
        return {
          subject: "auth-1",
          assuranceLevel: "aal1" as const,
          issuedAt: new Date("2026-07-29T12:00:00.000Z")
        };
      }
    },
    authorizer: {
      async execute(_token: unknown, permission: AdminPermission) {
        permissions.push(permission);
        return {
          adminId: ADMIN_ID,
          authSubject: "auth-1",
          roleCodes: ["sales_manager"],
          permission
        };
      }
    }
  };
}

async function inject(
  app: Awaited<ReturnType<typeof createApiApplication>>,
  input: {
    readonly method: "GET" | "POST" | "PATCH";
    readonly url: string;
    readonly payload?: Record<string, unknown>;
  }
) {
  const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
  return await fastify.inject({
    method: input.method,
    url: input.url,
    headers: {
      authorization: "Bearer valid-token",
      ...(input.method !== "GET" ? { "content-type": "application/json" } : {})
    },
    ...(input.payload === undefined ? {} : { payload: input.payload })
  });
}

const ADMIN_ID = "00000000-0000-4000-8000-000000000101";
const CAMPAIGN_ID = "00000000-0000-4000-8000-000000000102";
const CAMPAIGN_CONTACT_ID = "00000000-0000-4000-8000-000000000103";
const campaign = {
  id: CAMPAIGN_ID,
  name: "Не оплатили",
  description: "Июль",
  status: "active" as const,
  totalContacts: 0,
  untouchedContacts: 0,
  interestedContacts: 0,
  convertedContacts: 0,
  createdAt: "2026-07-29T12:00:00.000Z",
  completedAt: null
};

const readiness = {
  async execute() {
    return {
      service: "api",
      status: "healthy" as const,
      version: "test",
      checkedAt: "2026-07-29T12:00:00.000Z",
      components: []
    };
  }
};
