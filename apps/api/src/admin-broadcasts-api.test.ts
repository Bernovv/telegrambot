import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminPermission } from "@ticket-platform/contracts";
import type { FastifyInstance } from "fastify";
import { createApiApplication } from "./app.js";

describe("administrator broadcasts HTTP contract", () => {
  it("uses broadcasts.send and rejects unknown content fields", async () => {
    const permissions: AdminPermission[] = [];
    let received: unknown;
    let scheduleReceived: unknown;
    let testSendReceived: unknown;
    const controls: unknown[] = [];
    const app = await createApiApplication({
      appVersion: "test",
      bodyLimitBytes: 65_536,
      readiness,
      adminAuth: {
        tokenVerifier: {
          async verify() {
            return {
              subject: "auth-1",
              assuranceLevel: "aal1",
              issuedAt: new Date("2026-07-29T08:00:00.000Z")
            };
          }
        },
        authorizer: {
          async execute(_token, permission) {
            permissions.push(permission);
            return {
              adminId,
              authSubject: "auth-1",
              roleCodes: ["content_manager"],
              permission
            };
          }
        }
      },
      adminBroadcasts: {
        list: { async execute() { return []; } },
        get: { async execute() { return broadcast; } },
        create: {
          async execute(input) {
            received = input.request;
            return broadcast;
          }
        },
        updateDraft: { async execute() { return broadcast; } },
        publish: { async execute() { return broadcast; } },
        schedule: {
          async execute(input) {
            scheduleReceived = input.request;
            return broadcast;
          }
        },
        pause: { async execute(input) { controls.push(["pause", input.request]); return broadcast; } },
        resume: { async execute(input) { controls.push(["resume", input.request]); return broadcast; } },
        cancel: { async execute(input) { controls.push(["cancel", input.request]); return broadcast; } },
        requestTestSend: {
          async execute(input) {
            testSendReceived = input.request;
            return testDelivery;
          }
        }
      }
    });
    await app.init();
    try {
      const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
      const payload = {
        name: "Анонс встречи",
        audienceSnapshotId: snapshotId,
        content: {
          text: "Регистрация открыта",
          disableLinkPreview: false,
          personalization: { fallback: "участник" },
          media: {
            kind: "photo",
            url: "https://cdn.example.com/broadcasts/meeting.jpg"
          },
          buttons: [{
            label: "Открыть",
            url: "https://example.com/register"
          }]
        },
        reason: "Первый черновик"
      };
      const valid = await fastify.inject({
        method: "POST",
        url: "/api/v1/broadcasts",
        headers: { authorization: "Bearer valid" },
        payload
      });
      const invalid = await fastify.inject({
        method: "POST",
        url: "/api/v1/broadcasts",
        headers: { authorization: "Bearer valid" },
        payload: {
          ...payload,
          content: {
            ...payload.content,
            parseMode: "HTML"
          }
        }
      });
      const schedulePayload = {
        expectedLockVersion: 1,
        scheduledAt: "2030-07-30T10:00:00.000Z",
        timezone: "Europe/Moscow",
        ratePerSecond: 10,
        reason: "Запуск кампании"
      };
      const scheduled = await fastify.inject({
        method: "POST",
        url: `/api/v1/broadcasts/${broadcastId}/schedule`,
        headers: { authorization: "Bearer valid" },
        payload: schedulePayload
      });
      const controlPayload = {
        expectedLockVersion: 3,
        reason: "РЈРїСЂР°РІР»РµРЅРёРµ РєР°РјРїР°РЅРёРµР№"
      };
      const controlResponses = await Promise.all(
        ["pause", "resume", "cancel"].map((action) => fastify.inject({
          method: "POST",
          url: `/api/v1/broadcasts/${broadcastId}/${action}`,
          headers: { authorization: "Bearer valid" },
          payload: controlPayload
        }))
      );
      const testSendPayload = {
        expectedLockVersion: 1,
        recipientTelegramUserId: "123456789",
        reason: "Проверка перед публикацией"
      };
      const testSend = await fastify.inject({
        method: "POST",
        url: `/api/v1/broadcasts/${broadcastId}/test-send`,
        headers: { authorization: "Bearer valid" },
        payload: testSendPayload
      });

      assert.equal(valid.statusCode, 201);
      assert.equal(valid.json().id, broadcastId);
      assert.equal(invalid.statusCode, 400);
      assert.equal(scheduled.statusCode, 201);
      assert.equal(testSend.statusCode, 201);
      assert.equal(testSend.json().status, "queued");
      assert.deepEqual(controlResponses.map((response) => response.statusCode), [
        201,
        201,
        201
      ]);
      assert.deepEqual(permissions, [
        "broadcasts.send",
        "broadcasts.send",
        "broadcasts.send",
        "broadcasts.send",
        "broadcasts.send",
        "broadcasts.send",
        "broadcasts.send"
      ]);
      assert.deepEqual(received, payload);
      assert.deepEqual(scheduleReceived, schedulePayload);
      assert.deepEqual(controls, [
        ["pause", controlPayload],
        ["resume", controlPayload],
        ["cancel", controlPayload]
      ]);
      assert.deepEqual(testSendReceived, testSendPayload);
    } finally {
      await app.close();
    }
  });
});

const readiness = {
  async execute() {
    return {
      service: "api",
      status: "healthy" as const,
      version: "test",
      checkedAt: "2026-07-29T08:00:00.000Z",
      components: []
    };
  }
};

const adminId = "00000000-0000-4000-8000-000000000101";
const broadcastId = "00000000-0000-4000-8000-000000000801";
const versionId = "00000000-0000-4000-8000-000000000802";
const snapshotId = "00000000-0000-4000-8000-000000000804";
const testDeliveryId = "00000000-0000-4000-8000-000000000807";

const testDelivery = {
  id: testDeliveryId,
  broadcastVersionId: versionId,
  versionNumber: 1,
  recipientTelegramUserId: "123456789",
  status: "queued" as const,
  providerMessageId: null,
  errorCode: null,
  requestedAt: "2026-07-29T08:02:00.000Z",
  startedAt: null,
  finishedAt: null
};

const broadcast = {
  id: broadcastId,
  name: "Анонс встречи",
  lockVersion: 1,
  lifecycleStatus: "draft" as const,
  draft: {
    id: versionId,
    versionNumber: 1,
    status: "draft" as const,
    schemaVersion: 1 as const,
    name: "Анонс встречи",
    audienceSnapshot: {
      id: snapshotId,
      segmentId: "00000000-0000-4000-8000-000000000805",
      segmentVersionId: "00000000-0000-4000-8000-000000000806",
      segmentVersionNumber: 1,
      status: "ready" as const,
      totalCount: "42",
      requestedAt: "2026-07-29T08:00:00.000Z",
      completedAt: "2026-07-29T08:01:00.000Z"
    },
    content: {
      text: "Регистрация открыта",
      disableLinkPreview: true,
      buttons: [{
        label: "Открыть",
        url: "https://example.com/register"
      }]
    },
    createdAt: "2026-07-29T08:00:00.000Z",
    updatedAt: "2026-07-29T08:00:00.000Z",
    publishedAt: null
  },
  published: null,
  schedule: null,
  testDeliveries: [],
  updatedAt: "2026-07-29T08:00:00.000Z"
};
