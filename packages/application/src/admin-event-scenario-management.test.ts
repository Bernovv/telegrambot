import assert from "node:assert/strict";
import test from "node:test";
import type { AdminRequestActor } from "@ticket-platform/contracts";
import type { ScenarioGraph } from "@ticket-platform/scenario-engine";
import {
  AdminScenarioValidationFailedError,
  PublishAdminEventScenarioVersionService,
  SaveAdminEventScenarioDraftService,
  type AdminEventScenarioManagementRepository
} from "./admin-event-scenario-management.js";

const eventId = "00000000-0000-4000-8000-000000000101";
const scenarioId = "00000000-0000-4000-8000-000000000102";
const versionId = "00000000-0000-4000-8000-000000000103";
const auditId = "00000000-0000-4000-8000-000000000104";
const startId = "00000000-0000-4000-8000-000000000105";
const offerId = "00000000-0000-4000-8000-000000000106";
const paymentId = "00000000-0000-4000-8000-000000000107";
const endId = "00000000-0000-4000-8000-000000000108";
const orderId = "00000000-0000-4000-8000-000000000109";
const productId = "00000000-0000-4000-8000-000000000110";

test("saves an invalid graph as a draft with validation issues", async () => {
  let receivedIssues = 0;
  const repository = stubRepository({
    async saveDraft(input) {
      receivedIssues = input.validationIssues.length;
      return { status: "saved", scenarioVersionId: versionId, lockVersion: 8 };
    }
  });
  const service = new SaveAdminEventScenarioDraftService(
    repository,
    sequenceIds(scenarioId, versionId, auditId)
  );

  const result = await service.execute({
    actor: actor("events.write"),
    eventId,
    expectedLockVersion: 7,
    scenario: {
      title: "Продажа билетов",
      ...invalidGraph()
    },
    reason: "Создан первый черновик",
    metadata: metadata()
  });

  assert.equal(result.lockVersion, 8);
  assert.equal(result.versionStatus, "draft");
  assert.ok(result.validationIssues.length > 0);
  assert.equal(receivedIssues, result.validationIssues.length);
});

test("publishes a valid draft after server-side validation", async () => {
  const repository = stubRepository({
    async loadDraft() {
      return { status: "ready", graph: validGraph() };
    },
    async publishDraft() {
      return { status: "published", lockVersion: 9 };
    }
  });
  const service = new PublishAdminEventScenarioVersionService(
    repository,
    sequenceIds(auditId)
  );

  const result = await service.execute({
    actor: actor("scenarios.publish"),
    eventId,
    scenarioVersionId: versionId,
    expectedLockVersion: 8,
    reason: "Сценарий проверен",
    metadata: metadata()
  });

  assert.equal(result.versionStatus, "published");
  assert.equal(result.lockVersion, 9);
  assert.deepEqual(result.validationIssues, []);
});

test("blocks publication when payment can start before offer", async () => {
  const repository = stubRepository({
    async loadDraft() {
      return { status: "ready", graph: invalidGraph() };
    }
  });
  const service = new PublishAdminEventScenarioVersionService(
    repository,
    sequenceIds(auditId)
  );

  await assert.rejects(
    service.execute({
      actor: actor("scenarios.publish"),
      eventId,
      scenarioVersionId: versionId,
      expectedLockVersion: 8,
      reason: "Попытка публикации",
      metadata: metadata()
    }),
    (error) =>
      error instanceof AdminScenarioValidationFailedError
      && error.issues.some((issue) => issue.code === "PAYMENT_BEFORE_OFFER")
  );
});

function validGraph(): ScenarioGraph {
  return {
    schemaVersion: 1,
    nodes: [
      node(startId, "start"),
      node(orderId, "order_start", {
        currency: "RUB",
        items: [{ productId, quantityContextKey: "quantity" }]
      }),
      node(offerId, "offer_acceptance"),
      node(paymentId, "payment_start"),
      node(endId, "end")
    ],
    edges: [
      edge("201", startId, orderId),
      edge("202", orderId, offerId),
      edge("203", offerId, paymentId),
      edge("204", paymentId, endId)
    ]
  };
}

function invalidGraph(): ScenarioGraph {
  return {
    schemaVersion: 1,
    nodes: [
      node(startId, "start"),
      node(paymentId, "payment_start"),
      node(endId, "end")
    ],
    edges: [
      edge("201", startId, paymentId),
      edge("202", paymentId, endId)
    ]
  };
}

function node(
  id: string,
  type: ScenarioGraph["nodes"][number]["type"],
  payload: Readonly<Record<string, unknown>> = {}
) {
  return { id, type, schemaVersion: 1, payload };
}

function edge(suffix: string, fromNodeId: string, toNodeId: string) {
  return {
    id: `00000000-0000-4000-8000-000000000${suffix}`,
    fromNodeId,
    toNodeId,
    label: null,
    priority: 0,
    condition: {}
  };
}

function actor(permission: AdminRequestActor["permission"]): AdminRequestActor {
  return {
    adminId: "00000000-0000-4000-8000-000000000001",
    authSubject: "subject",
    roleCodes: ["owner"],
    permission
  };
}

function metadata() {
  return {
    requestId: "request-123",
    ipAddress: null,
    userAgent: null,
    occurredAt: new Date("2026-07-26T09:00:00.000Z")
  };
}

function sequenceIds(...ids: string[]) {
  let index = 0;
  return {
    newId() {
      const id = ids[index];
      index += 1;
      if (!id) {
        throw new Error("Unexpected ID request");
      }
      return id;
    }
  };
}

function stubRepository(
  overrides: Partial<AdminEventScenarioManagementRepository>
): AdminEventScenarioManagementRepository {
  return {
    async saveDraft() {
      throw new Error("Unexpected saveDraft");
    },
    async loadDraft() {
      throw new Error("Unexpected loadDraft");
    },
    async publishDraft() {
      throw new Error("Unexpected publishDraft");
    },
    ...overrides
  };
}
