import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminBroadcast } from "@ticket-platform/contracts";
import {
  AdminBroadcastVersionConflictError,
  AdminBroadcastInvalidTransitionError,
  CancelAdminBroadcastService,
  CreateAdminBroadcastService,
  PauseAdminBroadcastService,
  PublishAdminBroadcastDraftService,
  ScheduleAdminBroadcastService,
  ResumeAdminBroadcastService,
  UpdateAdminBroadcastDraftService,
  InvalidAdminBroadcastError,
  type AdminBroadcastRepository
} from "./admin-broadcasts.js";

describe("administrator broadcast versions", () => {
  it("creates a normalized audited draft for a ready audience snapshot", async () => {
    let received: Parameters<AdminBroadcastRepository["create"]>[0] | undefined;
    const service = new CreateAdminBroadcastService(repository({
      async create(input) {
        received = input;
        return { status: "created", value: broadcast };
      }
    }), ids(broadcastId, versionId, auditId));

    const result = await service.execute({
      actor,
      request: {
        name: "  Анонс встречи  ",
        audienceSnapshotId: snapshotId,
        content: {
          text: "  Регистрация открыта  ",
          disableLinkPreview: false,
          personalization: { fallback: " участник " },
          media: {
            kind: "photo",
            url: " https://cdn.example.com/broadcasts/meeting.jpg "
          },
          buttons: [{
            label: "  Открыть  ",
            url: "https://example.com/register"
          }]
        },
        reason: "  Первый черновик  "
      },
      metadata
    });

    assert.equal(result.id, broadcastId);
    assert.equal(received?.name, "Анонс встречи");
    assert.deepEqual(received?.content, {
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
    });
    assert.equal(received?.audit.reason, "Первый черновик");
  });

  it("rejects unsafe photo URLs and oversized captions", async () => {
    const service = new CreateAdminBroadcastService(
      repository({}),
      ids(broadcastId, versionId, auditId)
    );
    for (const content of [
      {
        text: "Анонс",
        disableLinkPreview: false,
        personalization: { fallback: "гость" },
        media: { kind: "photo" as const, url: "http://example.com/photo.jpg" },
        buttons: []
      },
      {
        text: "а".repeat(1_001),
        disableLinkPreview: false,
        personalization: { fallback: "гость" },
        media: {
          kind: "photo" as const,
          url: "https://cdn.example.com/photo.jpg"
        },
        buttons: []
      }
    ]) {
      await assert.rejects(
        service.execute({
          actor,
          request: {
            name: "Анонс встречи",
            audienceSnapshotId: snapshotId,
            content,
            reason: "Проверка фото"
          },
          metadata
        }),
        InvalidAdminBroadcastError
      );
    }
  });

  it("publishes with a unique outbox event and exposes stale updates", async () => {
    let publicationEventId = "";
    const publish = new PublishAdminBroadcastDraftService(repository({
      async publishDraft(input) {
        publicationEventId = input.publicationEventId;
        return { status: "published", value: publishedBroadcast };
      }
    }), ids(eventId, auditId));

    const result = await publish.execute({
      actor,
      broadcastId,
      request: {
        expectedLockVersion: 1,
        reason: "Публикация"
      },
      metadata
    });

    assert.equal(publicationEventId, eventId);
    assert.equal(result.published?.versionNumber, 1);

    let scheduledInput:
      | Parameters<AdminBroadcastRepository["schedule"]>[0]
      | undefined;
    const schedule = new ScheduleAdminBroadcastService(repository({
      async schedule(input) {
        scheduledInput = input;
        return { status: "scheduled", value: scheduledBroadcast };
      }
    }), ids(eventId, auditId));
    const scheduled = await schedule.execute({
      actor,
      broadcastId,
      request: {
        expectedLockVersion: 2,
        scheduledAt: "2026-07-30T10:00:00.000Z",
        timezone: "Europe/Moscow",
        ratePerSecond: 10,
        reason: "Запуск кампании"
      },
      metadata
    });
    assert.equal(scheduled.lifecycleStatus, "scheduled");
    assert.equal(scheduledInput?.scheduleEventId, eventId);
    assert.equal(scheduledInput?.timezone, "Europe/Moscow");

    const update = new UpdateAdminBroadcastDraftService(repository({
      async saveDraft() {
        return { status: "version_conflict" };
      }
    }), ids(nextVersionId, auditId));
    await assert.rejects(
      update.execute({
        actor,
        broadcastId,
        request: {
          expectedLockVersion: 1,
          name: "Анонс встречи",
          audienceSnapshotId: snapshotId,
          content: draft.content,
          reason: "Конкурирующее изменение"
        },
        metadata
      }),
      AdminBroadcastVersionConflictError
    );
  });

  it("controls an active campaign with a reason and unique lifecycle event", async () => {
    const actions: string[] = [];
    const controlledRepository = repository({
      async control(input) {
        actions.push(input.action, input.lifecycleEventId, input.audit.reason);
        return {
          status: "controlled",
          value: {
            ...scheduledBroadcast,
            lifecycleStatus: input.action === "cancel"
              ? "cancelled"
              : input.action === "pause"
                ? "paused"
                : "sending"
          }
        };
      }
    });
    const request = {
      expectedLockVersion: 3,
      reason: "  Р РЈС‡РЅРѕРµ СѓРїСЂР°РІР»РµРЅРёРµ  "
    };

    await new PauseAdminBroadcastService(
      controlledRepository,
      ids(eventId, auditId)
    ).execute({ actor, broadcastId, request, metadata });
    await new ResumeAdminBroadcastService(
      controlledRepository,
      ids(eventId, auditId)
    ).execute({ actor, broadcastId, request, metadata });
    await new CancelAdminBroadcastService(
      controlledRepository,
      ids(eventId, auditId)
    ).execute({ actor, broadcastId, request, metadata });

    assert.deepEqual(actions, [
      "pause", eventId, "Р РЈС‡РЅРѕРµ СѓРїСЂР°РІР»РµРЅРёРµ",
      "resume", eventId, "Р РЈС‡РЅРѕРµ СѓРїСЂР°РІР»РµРЅРёРµ",
      "cancel", eventId, "Р РЈС‡РЅРѕРµ СѓРїСЂР°РІР»РµРЅРёРµ"
    ]);

    const invalid = new ResumeAdminBroadcastService(repository({
      async control() {
        return { status: "invalid_transition" };
      }
    }), ids(eventId, auditId));
    await assert.rejects(
      invalid.execute({ actor, broadcastId, request, metadata }),
      AdminBroadcastInvalidTransitionError
    );
  });
});

function repository(
  overrides: Partial<AdminBroadcastRepository>
): AdminBroadcastRepository {
  return {
    async list() {
      return [];
    },
    async get() {
      return null;
    },
    async create() {
      return { status: "created", value: broadcast };
    },
    async saveDraft() {
      return { status: "saved", value: broadcast };
    },
    async publishDraft() {
      return { status: "published", value: publishedBroadcast };
    },
    async schedule() {
      return { status: "scheduled", value: scheduledBroadcast };
    },
    async control() {
      return { status: "controlled", value: scheduledBroadcast };
    },
    ...overrides
  };
}

function ids(...values: string[]) {
  return { newId: () => values.shift() ?? auditId };
}

const broadcastId = "00000000-0000-4000-8000-000000000801";
const versionId = "00000000-0000-4000-8000-000000000802";
const nextVersionId = "00000000-0000-4000-8000-000000000803";
const snapshotId = "00000000-0000-4000-8000-000000000804";
const segmentId = "00000000-0000-4000-8000-000000000805";
const segmentVersionId = "00000000-0000-4000-8000-000000000806";
const auditId = "00000000-0000-4000-8000-000000000807";
const eventId = "00000000-0000-4000-8000-000000000808";

const snapshot = {
  id: snapshotId,
  segmentId,
  segmentVersionId,
  segmentVersionNumber: 1,
  status: "ready" as const,
  totalCount: "42",
  requestedAt: "2026-07-29T08:00:00.000Z",
  completedAt: "2026-07-29T08:01:00.000Z"
};

const draft = {
  id: versionId,
  versionNumber: 1,
  status: "draft" as const,
  schemaVersion: 1 as const,
  name: "Анонс встречи",
  audienceSnapshot: snapshot,
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
};

const broadcast: AdminBroadcast = {
  id: broadcastId,
  name: "Анонс встречи",
  lockVersion: 1,
  lifecycleStatus: "draft",
  draft,
  published: null,
  schedule: null,
  testDeliveries: [],
  updatedAt: "2026-07-29T08:00:00.000Z"
};

const publishedBroadcast: AdminBroadcast = {
  ...broadcast,
  lockVersion: 2,
  draft: null,
  published: {
    ...draft,
    status: "published",
    publishedAt: "2026-07-29T09:00:00.000Z"
  }
};

const scheduledBroadcast: AdminBroadcast = {
  ...publishedBroadcast,
  lockVersion: 3,
  lifecycleStatus: "scheduled",
  schedule: {
    scheduledVersionId: versionId,
    scheduledAt: "2026-07-30T10:00:00.000Z",
    timezone: "Europe/Moscow",
    ratePerSecond: 10,
    preparedAt: null,
    sendStartedAt: null,
    completedAt: null,
    pausedAt: null,
    cancelledAt: null,
    autoPauseReason: null,
    plannedRecipientCount: null,
    reachableRecipientCount: null,
    skippedRecipientCount: null,
    attemptedRecipientCount: "0",
    sentRecipientCount: "0",
    failedRecipientCount: "0"
  }
};

const actor = {
  adminId: "00000000-0000-4000-8000-000000000101",
  authSubject: "auth-1",
  roleCodes: ["content_manager"],
  permission: "broadcasts.send"
} as const;

const metadata = {
  requestId: "request-123",
  ipAddress: "127.0.0.1",
  userAgent: "test",
  occurredAt: new Date("2026-07-29T08:00:00.000Z")
};
