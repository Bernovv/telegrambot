import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminPermission } from "@ticket-platform/contracts";
import { AdminEventVersionConflictError } from "@ticket-platform/application";
import type { FastifyInstance } from "fastify";
import { createApiApplication } from "./app.js";
import type { AdminEventsHandlers } from "./admin-events-api.js";

describe("administrator events HTTP contract", () => {
  it("requires events.read and delegates validated filters", async () => {
    const permissions: string[] = [];
    const requests: unknown[] = [];
    const app = await createApiApplication({
      appVersion: "test",
      bodyLimitBytes: 262_144,
      readiness,
      adminAuth: {
        tokenVerifier: {
          async verify() {
            return {
              subject: "auth-1",
              assuranceLevel: "aal1",
              issuedAt: new Date("2026-07-25T14:00:00.000Z")
            };
          }
        },
        authorizer: {
          async execute(_token, permission) {
            permissions.push(permission);
            return {
              adminId: ADMIN_ID,
              authSubject: "auth-1",
              roleCodes: ["content_manager"],
              permission
            };
          }
        }
      },
      adminEvents: handlers(requests)
    });
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const response = await fastify.inject({
        method: "GET",
        url: "/api/v1/events?search=picnic&status=published&limit=20",
        headers: { authorization: "Bearer valid-token" }
      });

      assert.equal(response.statusCode, 200);
      assert.deepEqual(permissions, ["events.read"]);
      assert.equal(
        (requests[0] as { readonly search?: string }).search,
        "picnic"
      );
      assert.equal(
        (requests[0] as { readonly status?: string }).status,
        "published"
      );
    } finally {
      await app.close();
    }
  });

  it("rejects unknown filters and invalid IDs before persistence", async () => {
    const requests: unknown[] = [];
    const app = await createApiApplication({
      appVersion: "test",
      bodyLimitBytes: 262_144,
      readiness,
      adminAuth: adminAuth(),
      adminEvents: handlers(requests)
    });
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const unknown = await fastify.inject({
        method: "GET",
        url: "/api/v1/events?includeSecrets=true",
        headers: { authorization: "Bearer valid-token" }
      });
      const invalidId = await fastify.inject({
        method: "GET",
        url: "/api/v1/events/not-a-uuid",
        headers: { authorization: "Bearer valid-token" }
      });

      assert.equal(unknown.statusCode, 400);
      assert.equal(invalidId.statusCode, 400);
      assert.equal(requests.length, 0);
    } finally {
      await app.close();
    }
  });

  it("returns 404 for a missing event and 401 without a token", async () => {
    const app = await createApiApplication({
      appVersion: "test",
      bodyLimitBytes: 262_144,
      readiness,
      adminAuth: adminAuth(),
      adminEvents: handlers([])
    });
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const missing = await fastify.inject({
        method: "GET",
        url: `/api/v1/events/${EVENT_ID}`,
        headers: { authorization: "Bearer valid-token" }
      });
      const unauthorized = await fastify.inject({
        method: "GET",
        url: "/api/v1/events"
      });

      assert.equal(missing.statusCode, 404);
      assert.equal(unauthorized.statusCode, 401);
    } finally {
      await app.close();
    }
  });

  it("requires events.write and creates a validated audited draft command", async () => {
    const permissions: string[] = [];
    const requests: unknown[] = [];
    const app = await createApiApplication({
      appVersion: "test",
      bodyLimitBytes: 262_144,
      readiness,
      adminAuth: {
        ...adminAuth(),
        authorizer: {
          async execute(_token, permission) {
            permissions.push(permission);
            return {
              adminId: ADMIN_ID,
              authSubject: "auth-1",
              roleCodes: ["content_manager"],
              permission
            };
          }
        }
      },
      adminEvents: handlers(requests)
    });
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const response = await fastify.inject({
        method: "POST",
        url: "/api/v1/events",
        headers: {
          authorization: "Bearer valid-token",
          "user-agent": "admin-web-test",
          "x-request-id": "request-event-create-1"
        },
        payload: { ...eventPayload, reason: "Initial draft" }
      });

      assert.equal(response.statusCode, 201);
      assert.deepEqual(permissions, ["events.write"]);
      const request = requests[0] as {
        readonly event: { readonly title: string };
        readonly reason: string;
        readonly metadata: {
          readonly userAgent: string | null;
          readonly requestId: string;
        };
      };
      assert.equal(request.event.title, "Business Picnic");
      assert.equal(request.reason, "Initial draft");
      assert.equal(request.metadata.userAgent, "admin-web-test");
      assert.equal(request.metadata.requestId, "request-event-create-1");
    } finally {
      await app.close();
    }
  });

  it("принимает формат и бесплатность, а без них считает мероприятие городским платным", async () => {
    const requests: unknown[] = [];
    const app = await createApiApplication({
      appVersion: "test",
      bodyLimitBytes: 262_144,
      readiness,
      adminAuth: adminAuth(),
      adminEvents: handlers(requests)
    });
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const explicit = await fastify.inject({
        method: "POST",
        url: "/api/v1/events",
        headers: { authorization: "Bearer valid-token" },
        payload: {
          ...eventPayload,
          format: "offsite",
          isFree: true,
          reason: "Выездное бесплатное"
        }
      });
      assert.equal(explicit.statusCode, 201);

      // Умолчание нужно старым клиентам: панель присылает поля всегда, но отказывать
      // из-за их отсутствия значит ломать заведение мероприятия на ровном месте.
      const implicit = await fastify.inject({
        method: "POST",
        url: "/api/v1/events",
        headers: { authorization: "Bearer valid-token" },
        payload: { ...eventPayload, reason: "Без формата" }
      });
      assert.equal(implicit.statusCode, 201);

      const rejected = await fastify.inject({
        method: "POST",
        url: "/api/v1/events",
        headers: { authorization: "Bearer valid-token" },
        payload: { ...eventPayload, format: "коворкинг", reason: "Чужой формат" }
      });
      assert.equal(rejected.statusCode, 400);

      const sent = requests as readonly {
        readonly event: { readonly format: string; readonly isFree: boolean };
      }[];
      assert.equal(sent.length, 2);
      assert.deepEqual(
        sent.map((request) => [request.event.format, request.event.isFree]),
        [["offsite", true], ["city", false]]
      );
    } finally {
      await app.close();
    }
  });

  it("validates updates and maps optimistic locking conflicts", async () => {
    const invalidRequests: unknown[] = [];
    const invalidApp = await createApiApplication({
      appVersion: "test",
      bodyLimitBytes: 262_144,
      readiness,
      adminAuth: adminAuth(),
      adminEvents: handlers(invalidRequests)
    });
    await invalidApp.init();
    try {
      const fastify =
        invalidApp.getHttpAdapter().getInstance() as FastifyInstance;
      const response = await fastify.inject({
        method: "PATCH",
        url: `/api/v1/events/${EVENT_ID}/general`,
        headers: { authorization: "Bearer valid-token" },
        payload: {
          ...eventPayload,
          expectedLockVersion: 0,
          reason: "Update"
        }
      });
      assert.equal(response.statusCode, 400);
      assert.equal(invalidRequests.length, 0);
    } finally {
      await invalidApp.close();
    }

    const conflictHandlers: AdminEventsHandlers = {
      ...handlers([]),
      updateEventGeneral: {
        async execute() {
          throw new AdminEventVersionConflictError();
        }
      }
    };
    const conflictApp = await createApiApplication({
      appVersion: "test",
      bodyLimitBytes: 262_144,
      readiness,
      adminAuth: adminAuth(),
      adminEvents: conflictHandlers
    });
    await conflictApp.init();
    try {
      const fastify =
        conflictApp.getHttpAdapter().getInstance() as FastifyInstance;
      const response = await fastify.inject({
        method: "PATCH",
        url: `/api/v1/events/${EVENT_ID}/general`,
        headers: { authorization: "Bearer valid-token" },
        payload: {
          ...eventPayload,
          expectedLockVersion: 2,
          reason: "Update schedule"
        }
      });
      assert.equal(response.statusCode, 409);
      assert.equal(response.json().code, "ADMIN_EVENT_VERSION_CONFLICT");
    } finally {
      await conflictApp.close();
    }
  });

  it("publishes an event only through the events.publish permission", async () => {
    const permissions: string[] = [];
    const requests: unknown[] = [];
    const app = await createApiApplication({
      appVersion: "test",
      bodyLimitBytes: 262_144,
      readiness,
      adminAuth: {
        ...adminAuth(),
        authorizer: {
          async execute(_token, permission) {
            permissions.push(permission);
            return {
              adminId: ADMIN_ID,
              authSubject: "auth-1",
              roleCodes: ["content_manager"],
              permission
            };
          }
        }
      },
      adminEvents: handlers(requests)
    });
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const response = await fastify.inject({
        method: "POST",
        url: `/api/v1/events/${EVENT_ID}/publish`,
        headers: {
          authorization: "Bearer valid-token",
          "x-request-id": "request-event-publish-1"
        },
        payload: {
          expectedLockVersion: 8,
          reason: "Каталог и сценарий проверены"
        }
      });

      assert.equal(response.statusCode, 200);
      assert.deepEqual(permissions, ["events.publish"]);
      const request = requests[0] as {
        readonly expectedLockVersion: number;
        readonly reason: string;
      };
      assert.equal(request.expectedLockVersion, 8);
      assert.equal(request.reason, "Каталог и сценарий проверены");
      assert.equal(response.json().status, "published");
    } finally {
      await app.close();
    }
  });

  it("validates and delegates product and simple pricing mutations", async () => {
    const requests: unknown[] = [];
    const app = await createApiApplication({
      appVersion: "test",
      bodyLimitBytes: 262_144,
      readiness,
      adminAuth: adminAuth(),
      adminEvents: handlers(requests)
    });
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const productResponse = await fastify.inject({
        method: "POST",
        url: `/api/v1/events/${EVENT_ID}/products`,
        headers: { authorization: "Bearer valid-token" },
        payload: {
          expectedLockVersion: 2,
          reason: "Add standard ticket",
          product: productPayload
        }
      });
      const pricingResponse = await fastify.inject({
        method: "POST",
        url: `/api/v1/events/${EVENT_ID}/products/${PRODUCT_ID}/pricing-rules`,
        headers: { authorization: "Bearer valid-token" },
        payload: {
          expectedLockVersion: 3,
          reason: "Add base price",
          pricingRule: pricingPayload
        }
      });

      assert.equal(productResponse.statusCode, 201);
      assert.equal(pricingResponse.statusCode, 201);
      assert.equal(
        (requests[0] as { readonly product: { readonly code: string } })
          .product.code,
        "adult_standard"
      );
      assert.equal(
        (
          requests[1] as {
            readonly pricingRule: { readonly unitPriceKopecks: string };
          }
        ).pricingRule.unitPriceKopecks,
        "249000"
      );
    } finally {
      await app.close();
    }
  });

  it("rejects unsupported pricing condition fields before application", async () => {
    const requests: unknown[] = [];
    const app = await createApiApplication({
      appVersion: "test",
      bodyLimitBytes: 262_144,
      readiness,
      adminAuth: adminAuth(),
      adminEvents: handlers(requests)
    });
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const response = await fastify.inject({
        method: "POST",
        url: `/api/v1/events/${EVENT_ID}/products/${PRODUCT_ID}/pricing-rules`,
        headers: { authorization: "Bearer valid-token" },
        payload: {
          expectedLockVersion: 3,
          reason: "Unsupported condition",
          pricingRule: {
            ...pricingPayload,
            conditions: { relatedProductType: "child" }
          }
        }
      });

      assert.equal(response.statusCode, 400);
      assert.equal(requests.length, 0);
    } finally {
      await app.close();
    }
  });

  it("validates and delegates content block mutations", async () => {
    const requests: unknown[] = [];
    const app = await createApiApplication({
      appVersion: "test",
      bodyLimitBytes: 262_144,
      readiness,
      adminAuth: adminAuth(),
      adminEvents: handlers(requests)
    });
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const created = await fastify.inject({
        method: "POST",
        url: `/api/v1/events/${EVENT_ID}/content-blocks`,
        headers: { authorization: "Bearer valid-token" },
        payload: {
          expectedLockVersion: 2,
          reason: "Add program",
          contentBlock: contentBlockPayload
        }
      });
      const updated = await fastify.inject({
        method: "PATCH",
        url: `/api/v1/events/${EVENT_ID}/content-blocks/${CONTENT_BLOCK_ID}`,
        headers: { authorization: "Bearer valid-token" },
        payload: {
          expectedLockVersion: 3,
          reason: "Hide program",
          contentBlock: { ...contentBlockPayload, isVisible: false }
        }
      });

      assert.equal(created.statusCode, 201);
      assert.equal(updated.statusCode, 200);
      assert.equal(
        (
          requests[0] as {
            readonly contentBlock: { readonly blockType: string };
          }
        ).contentBlock.blockType,
        "program"
      );
      assert.equal(
        (
          requests[1] as {
            readonly contentBlock: { readonly isVisible: boolean };
          }
        ).contentBlock.isVisible,
        false
      );
    } finally {
      await app.close();
    }
  });

  it("validates and delegates immutable offer publication and deactivation", async () => {
    const requests: unknown[] = [];
    const app = await createApiApplication({
      appVersion: "test",
      bodyLimitBytes: 262_144,
      readiness,
      adminAuth: adminAuth(),
      adminEvents: handlers(requests)
    });
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const published = await fastify.inject({
        method: "POST",
        url: `/api/v1/events/${EVENT_ID}/offer-versions`,
        headers: { authorization: "Bearer valid-token" },
        payload: {
          expectedLockVersion: 4,
          reason: "Publish approved legal text",
          offer: offerPayload
        }
      });
      const deactivated = await fastify.inject({
        method: "PATCH",
        url: `/api/v1/events/${EVENT_ID}/offer/deactivate`,
        headers: { authorization: "Bearer valid-token" },
        payload: {
          expectedLockVersion: 5,
          reason: "Temporarily withdraw the offer"
        }
      });

      assert.equal(published.statusCode, 201);
      assert.equal(deactivated.statusCode, 200);
      assert.equal(
        (
          requests[0] as {
            readonly offer: { readonly sourceType: string };
          }
        ).offer.sourceType,
        "google_docs"
      );
      assert.equal(
        (requests[1] as { readonly expectedLockVersion: number })
          .expectedLockVersion,
        5
      );
    } finally {
      await app.close();
    }
  });

  it("saves a scenario draft and publishes it with a separate permission", async () => {
    const requests: unknown[] = [];
    const app = await createApiApplication({
      appVersion: "test",
      bodyLimitBytes: 262_144,
      readiness,
      adminAuth: adminAuth(),
      adminEvents: handlers(requests)
    });
    await app.init();

    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const saved = await fastify.inject({
        method: "POST",
        url: `/api/v1/events/${EVENT_ID}/scenario-drafts`,
        headers: { authorization: "Bearer valid-token" },
        payload: {
          expectedLockVersion: 6,
          reason: "Создан сценарий продажи",
          scenario: scenarioPayload
        }
      });
      const published = await fastify.inject({
        method: "POST",
        url: `/api/v1/events/${EVENT_ID}/scenario-versions/${SCENARIO_VERSION_ID}/publish`,
        headers: { authorization: "Bearer valid-token" },
        payload: {
          expectedLockVersion: 7,
          reason: "Проверка сценария завершена"
        }
      });

      assert.equal(saved.statusCode, 201);
      assert.equal(published.statusCode, 200);
      assert.equal(
        (requests[0] as { readonly actor: { readonly permission: string } })
          .actor.permission,
        "events.write"
      );
      assert.equal(
        (requests[1] as { readonly actor: { readonly permission: string } })
          .actor.permission,
        "scenarios.publish"
      );
    } finally {
      await app.close();
    }
  });
});

function handlers(requests: unknown[]): AdminEventsHandlers {
  return {
    listEvents: {
      async execute(input) {
        requests.push(input);
        return { items: [], nextCursor: null };
      }
    },
    getEvent: {
      async execute(input) {
        requests.push(input);
        return null;
      }
    },
    createEvent: {
      async execute(input) {
        requests.push(input);
        return {
          eventId: EVENT_ID,
          status: "draft",
          lockVersion: 1,
          updatedAt: "2026-07-26T10:00:00.000Z"
        };
      }
    },
    updateEventGeneral: {
      async execute(input) {
        requests.push(input);
        return {
          eventId: EVENT_ID,
          status: "draft",
          lockVersion: 2,
          updatedAt: "2026-07-26T10:00:00.000Z"
        };
      }
    },
    publishEvent: {
      async execute(input) {
        requests.push(input);
        return {
          eventId: EVENT_ID,
          status: "published",
          lockVersion: 9,
          publishedAt: "2026-07-26T15:00:00.000Z"
        };
      }
    },
    createContentBlock: {
      async execute(input) {
        requests.push(input);
        return {
          eventId: EVENT_ID,
          resourceId: CONTENT_BLOCK_ID,
          status: "draft",
          lockVersion: 3,
          updatedAt: "2026-07-26T12:00:00.000Z"
        };
      }
    },
    updateContentBlock: {
      async execute(input) {
        requests.push(input);
        return {
          eventId: EVENT_ID,
          resourceId: CONTENT_BLOCK_ID,
          status: "draft",
          lockVersion: 4,
          updatedAt: "2026-07-26T12:00:00.000Z"
        };
      }
    },
    publishOfferVersion: {
      async execute(input) {
        requests.push(input);
        return {
          eventId: EVENT_ID,
          resourceId: OFFER_VERSION_ID,
          status: "draft",
          lockVersion: 5,
          updatedAt: "2026-07-26T13:00:00.000Z"
        };
      }
    },
    deactivateOffer: {
      async execute(input) {
        requests.push(input);
        return {
          eventId: EVENT_ID,
          resourceId: OFFER_VERSION_ID,
          status: "draft",
          lockVersion: 6,
          updatedAt: "2026-07-26T13:00:00.000Z"
        };
      }
    },
    saveScenarioDraft: {
      async execute(input) {
        requests.push(input);
        return {
          eventId: EVENT_ID,
          resourceId: SCENARIO_VERSION_ID,
          status: "draft",
          versionStatus: "draft",
          lockVersion: 7,
          validationIssues: [],
          updatedAt: "2026-07-26T14:00:00.000Z"
        };
      }
    },
    publishScenarioVersion: {
      async execute(input) {
        requests.push(input);
        return {
          eventId: EVENT_ID,
          resourceId: SCENARIO_VERSION_ID,
          status: "draft",
          versionStatus: "published",
          lockVersion: 8,
          validationIssues: [],
          updatedAt: "2026-07-26T14:00:00.000Z"
        };
      }
    },
    createProduct: {
      async execute(input) {
        requests.push(input);
        return {
          eventId: EVENT_ID,
          resourceId: PRODUCT_ID,
          status: "draft",
          lockVersion: 3,
          updatedAt: "2026-07-26T11:00:00.000Z"
        };
      }
    },
    updateProduct: {
      async execute(input) {
        requests.push(input);
        return {
          eventId: EVENT_ID,
          resourceId: PRODUCT_ID,
          status: "draft",
          lockVersion: 4,
          updatedAt: "2026-07-26T11:00:00.000Z"
        };
      }
    },
    createPricingRule: {
      async execute(input) {
        requests.push(input);
        return {
          eventId: EVENT_ID,
          resourceId: PRICING_RULE_ID,
          status: "draft",
          lockVersion: 4,
          updatedAt: "2026-07-26T11:00:00.000Z"
        };
      }
    },
    updatePricingRule: {
      async execute(input) {
        requests.push(input);
        return {
          eventId: EVENT_ID,
          resourceId: PRICING_RULE_ID,
          status: "draft",
          lockVersion: 5,
          updatedAt: "2026-07-26T11:00:00.000Z"
        };
      }
    }
  };
}

function adminAuth() {
  return {
    tokenVerifier: {
      async verify() {
        return {
          subject: "auth-1",
          assuranceLevel: "aal1" as const,
          issuedAt: new Date("2026-07-25T14:00:00.000Z")
        };
      }
    },
    authorizer: {
      async execute(_token: unknown, permission: AdminPermission) {
        return {
          adminId: ADMIN_ID,
          authSubject: "auth-1",
          roleCodes: ["content_manager"],
          permission
        };
      }
    }
  };
}

const readiness = {
  async execute() {
    return {
      service: "api",
      status: "healthy" as const,
      version: "test",
      checkedAt: "2026-07-25T14:00:00.000Z",
      components: []
    };
  }
};

const ADMIN_ID = "00000000-0000-4000-8000-000000000010";
const EVENT_ID = "00000000-0000-4000-8000-000000000101";
const PRODUCT_ID = "00000000-0000-4000-8000-000000000201";
const PRICING_RULE_ID = "00000000-0000-4000-8000-000000000301";
const CONTENT_BLOCK_ID = "00000000-0000-4000-8000-000000000401";
const OFFER_VERSION_ID = "00000000-0000-4000-8000-000000000601";
const SCENARIO_VERSION_ID = "00000000-0000-4000-8000-000000000701";
const eventPayload = {
  slug: "business-picnic",
  title: "Business Picnic",
  description: "Annual event",
  timezone: "Europe/Moscow",
  startsAt: "2026-08-20T08:00:00.000Z",
  endsAt: "2026-08-20T18:00:00.000Z",
  salesStartsAt: "2026-07-01T00:00:00.000Z",
  salesEndsAt: "2026-08-19T21:00:00.000Z",
  locationName: "Park",
  locationAddress: "Moscow",
  supportContact: "@support",
  capacity: 500,
  reservationTtlMinutes: 30,
  phoneRequiredForPurchase: true,
  offerRequired: true
};
const productPayload = {
  code: "adult_standard",
  productType: "adult_standard",
  title: "Standard",
  description: "Adult ticket",
  currency: "RUB",
  bundleComposition: [],
  inventoryUnitsPerItem: 1,
  capacity: 300,
  maximumQuantityPerOrder: 10,
  isActive: true,
  sortOrder: 0
};
const pricingPayload = {
  currency: "RUB",
  minimumQuantity: 1,
  maximumQuantity: 2,
  unitPriceKopecks: "249000",
  priority: 10,
  validFrom: "2026-07-01T00:00:00.000Z",
  validUntil: null,
  explanation: "Standard tier",
  isActive: true
};
const contentBlockPayload = {
  blockType: "program",
  title: "Программа",
  content: { items: [{ time: "12:00", title: "Открытие" }] },
  sortOrder: 20,
  isVisible: true
};
const offerPayload = {
  documentTitle: "Договор оферты",
  sourceType: "google_docs",
  sourceUrl: "https://docs.google.com/document/d/test",
  sourceRevisionId: "revision-7",
  displayTextSnapshot: "Согласованный юридический текст"
};
const scenarioPayload = {
  title: "Продажа билетов",
  schemaVersion: 1,
  nodes: [
    {
      id: "00000000-0000-4000-8000-000000000711",
      type: "start",
      schemaVersion: 1,
      payload: {}
    },
    {
      id: "00000000-0000-4000-8000-000000000712",
      type: "end",
      schemaVersion: 1,
      payload: {}
    }
  ],
  edges: [
    {
      id: "00000000-0000-4000-8000-000000000713",
      fromNodeId: "00000000-0000-4000-8000-000000000711",
      toNodeId: "00000000-0000-4000-8000-000000000712",
      label: null,
      priority: 0,
      condition: {}
    }
  ]
};
