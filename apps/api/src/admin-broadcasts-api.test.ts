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
          disableLinkPreview: true,
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

      assert.equal(valid.statusCode, 201);
      assert.equal(valid.json().id, broadcastId);
      assert.equal(invalid.statusCode, 400);
      assert.equal(scheduled.statusCode, 201);
      assert.deepEqual(permissions, [
        "broadcasts.send",
        "broadcasts.send",
        "broadcasts.send"
      ]);
      assert.deepEqual(received, payload);
      assert.deepEqual(scheduleReceived, schedulePayload);
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
  updatedAt: "2026-07-29T08:00:00.000Z"
};
