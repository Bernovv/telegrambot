import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  startQuestionnaireDraft,
  TelegramQuestionnaireService,
  type QuestionnaireDraft,
  type QuestionnaireDraftRepository,
  type SaveQuestionnaireResponseInput
} from "./participant-questionnaire.js";
import type { TelegramUserResolver } from "./phone.js";

const now = new Date("2026-07-28T10:00:00.000Z");

describe("startQuestionnaireDraft", () => {
  it("initializes a fresh draft at the first question", async () => {
    const store = new Map<string, QuestionnaireDraft>();
    const repository = fakeDraftRepository(store);

    const result = await startQuestionnaireDraft(repository, {
      orderId: "order-1",
      userId: "user-1",
      eventId: "event-1",
      now
    });

    assert.deepEqual(result, { alreadyStarted: false });
    assert.deepEqual(store.get("user-1"), {
      orderId: "order-1",
      eventId: "event-1",
      step: "awaiting_name",
      name: null,
      city: null,
      niche: null,
      stage: null,
      wish: null,
      focusArea: null,
      startedAt: now.toISOString()
    });
  });

  it("does not overwrite an in-progress draft", async () => {
    const existing: QuestionnaireDraft = {
      orderId: "order-1",
      eventId: "event-1",
      step: "awaiting_city",
      name: "Аня",
      city: null,
      niche: null,
      stage: null,
      wish: null,
      focusArea: null,
      startedAt: now.toISOString()
    };
    const store = new Map([["user-1", existing]]);
    const repository = fakeDraftRepository(store);

    const result = await startQuestionnaireDraft(repository, {
      orderId: "order-2",
      userId: "user-1",
      eventId: "event-1",
      now
    });

    assert.deepEqual(result, { alreadyStarted: true });
    assert.deepEqual(store.get("user-1"), existing);
  });
});

describe("TelegramQuestionnaireService", () => {
  it("walks name -> city -> niche -> stage -> wish -> focus area -> join chat, saving the completed response", async () => {
    const store = new Map<string, QuestionnaireDraft>();
    const draftRepository = fakeDraftRepository(store);
    const saved: SaveQuestionnaireResponseInput[] = [];
    const service = new TelegramQuestionnaireService(
      draftRepository,
      { async saveResponse(input) { saved.push(input); } },
      fixedResolver("user-1")
    );

    await startQuestionnaireDraft(draftRepository, {
      orderId: "order-1",
      userId: "user-1",
      eventId: "event-1",
      now
    });

    assert.deepEqual(await service.handleText("999", "Аня", now), { kind: "ask_city" });
    assert.deepEqual(await service.handleText("999", "Санкт-Петербург", now), { kind: "ask_niche" });
    assert.deepEqual(await service.handleText("999", "Маркетинг для стоматологий", now), { kind: "ask_stage" });
    assert.deepEqual(
      await service.handleStageChoice("999", "have_clients_want_structure"),
      { kind: "ask_wish" }
    );
    assert.deepEqual(await service.handleText("999", "Найти партнёров", now), { kind: "ask_focus_area" });
    assert.deepEqual(await service.handleFocusAreaChoice("999", "positioning"), { kind: "ask_join_chat" });
    assert.deepEqual(await service.handleJoinChatChoice("999", true, now), { kind: "completed" });

    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0], {
      orderId: "order-1",
      userId: "user-1",
      eventId: "event-1",
      name: "Аня",
      city: "Санкт-Петербург",
      niche: "Маркетинг для стоматологий",
      stage: "have_clients_want_structure",
      wish: "Найти партнёров",
      focusArea: "positioning",
      joinChat: true,
      completedAt: now
    });
    assert.equal(store.has("user-1"), false);
  });

  it("reports no active draft once the questionnaire is already complete", async () => {
    const store = new Map<string, QuestionnaireDraft>();
    const draftRepository = fakeDraftRepository(store);
    const service = new TelegramQuestionnaireService(
      draftRepository,
      { async saveResponse() {} },
      fixedResolver("user-1")
    );

    const result = await service.handleText("999", "Аня", now);
    assert.deepEqual(result, { kind: "no_active_draft" });
  });

  it("rejects empty or over-length text without advancing the step", async () => {
    const store = new Map<string, QuestionnaireDraft>();
    const draftRepository = fakeDraftRepository(store);
    const service = new TelegramQuestionnaireService(
      draftRepository,
      { async saveResponse() {} },
      fixedResolver("user-1")
    );
    await startQuestionnaireDraft(draftRepository, {
      orderId: "order-1",
      userId: "user-1",
      eventId: "event-1",
      now
    });

    assert.deepEqual(await service.handleText("999", "   ", now), { kind: "invalid_text" });
    assert.deepEqual(await service.handleText("999", "a".repeat(201), now), { kind: "invalid_text" });
    assert.equal(store.get("user-1")?.step, "awaiting_name");
  });

  it("silently ignores stray free text during a button-only step", async () => {
    const store = new Map<string, QuestionnaireDraft>([[
      "user-1",
      {
        orderId: "order-1",
        eventId: "event-1",
        step: "awaiting_stage",
        name: "Аня",
        city: "СПб",
        niche: "Маркетинг",
        stage: null,
        wish: null,
        focusArea: null,
        startedAt: now.toISOString()
      }
    ]]);
    const draftRepository = fakeDraftRepository(store);
    const service = new TelegramQuestionnaireService(
      draftRepository,
      { async saveResponse() {} },
      fixedResolver("user-1")
    );

    const result = await service.handleText("999", "стоп", now);
    assert.deepEqual(result, { kind: "no_active_draft" });
    assert.equal(store.get("user-1")?.step, "awaiting_stage");
  });

  it("rejects a stage or focus-area choice made at the wrong step", async () => {
    const store = new Map<string, QuestionnaireDraft>();
    const draftRepository = fakeDraftRepository(store);
    const service = new TelegramQuestionnaireService(
      draftRepository,
      { async saveResponse() {} },
      fixedResolver("user-1")
    );
    await startQuestionnaireDraft(draftRepository, {
      orderId: "order-1",
      userId: "user-1",
      eventId: "event-1",
      now
    });

    assert.deepEqual(
      await service.handleStageChoice("999", "want_more_sales"),
      { kind: "no_active_draft" }
    );
    assert.deepEqual(
      await service.handleFocusAreaChoice("999", "content"),
      { kind: "no_active_draft" }
    );
    assert.deepEqual(await service.handleJoinChatChoice("999", true, now), { kind: "no_active_draft" });
  });
});

function fakeDraftRepository(store: Map<string, QuestionnaireDraft>): QuestionnaireDraftRepository {
  return {
    async getDraft(userId) {
      return store.get(userId) ?? null;
    },
    async setDraft(userId, draft) {
      store.set(userId, draft);
    },
    async clearDraft(userId) {
      store.delete(userId);
    }
  };
}

function fixedResolver(userId: string): TelegramUserResolver {
  return { async resolveUserId() { return userId; } };
}
