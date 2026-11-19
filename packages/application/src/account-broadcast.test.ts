import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminRequestActor } from "@ticket-platform/contracts";
import {
  AccountBroadcastRequestError,
  AccountBroadcastSendError,
  AdminAccountBroadcastService,
  SendAccountBroadcastsService,
  broadcastFeedBody,
  parseTestRecipient,
  type AccountBroadcastQueue,
  type AccountBroadcastSendOptions,
  type AdminAccountBroadcastRepository,
  type ClaimedBroadcastPart,
  type ClaimedBroadcastRecipient
} from "./account-broadcast.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
// Полдень по Москве — внутри окна; полночь — вне.
const NOON = new Date("2026-11-19T09:00:00.000Z");
const MIDNIGHT = new Date("2026-11-19T21:30:00.000Z");

const OPTIONS: AccountBroadcastSendOptions = {
  enabled: true,
  pauseMinMs: 20_000,
  pauseMaxMs: 30_000,
  idlePollMs: 30_000,
  dailyLimit: 150,
  window: { startHour: 10, endHour: 21, timeZone: "Europe/Moscow" },
  maxAttempts: 3,
  retryDelayMs: 10 * MINUTE,
  leaseMs: 10 * MINUTE,
  accountPauseMs: 24 * HOUR
};

const ADMIN_ID = "00000000-0000-4000-8000-000000000010";
const ACTOR: AdminRequestActor = {
  adminId: ADMIN_ID,
  authSubject: "subject",
  roleCodes: ["super_admin"],
  permission: "broadcasts.send"
};

function part(overrides: Partial<ClaimedBroadcastPart> = {}): ClaimedBroadcastPart {
  return {
    savedMessageId: "00000000-0000-4000-8000-000000000101",
    externalMessageId: "1048576",
    kind: "video_note",
    body: null,
    durationSeconds: 42,
    deleted: false,
    storagePath: "2026/11/circle.mp4",
    fileName: "Кружок.mp4",
    mimeType: "video/mp4",
    sizeBytes: 2_000_000,
    sha256: "a".repeat(64),
    ...overrides
  };
}

function recipient(overrides: Partial<ClaimedBroadcastRecipient> = {}): ClaimedBroadcastRecipient {
  return {
    recipientId: "00000000-0000-4000-8000-000000000201",
    broadcastId: "00000000-0000-4000-8000-000000000301",
    isTest: false,
    contactId: "00000000-0000-4000-8000-000000000401",
    conversationId: "00000000-0000-4000-8000-000000000501",
    externalChatId: "777",
    attempts: 0,
    actorAdminId: ADMIN_ID,
    parts: [part(), part({
      savedMessageId: "00000000-0000-4000-8000-000000000102",
      externalMessageId: "2097152",
      kind: "text",
      body: "Ждём вас во вторник!",
      durationSeconds: null,
      storagePath: null,
      fileName: null,
      mimeType: null,
      sizeBytes: null,
      sha256: null
    })],
    ...overrides
  };
}

interface FakeQueue extends AccountBroadcastQueue {
  readonly calls: string[];
  readonly claims: { includeLive: boolean }[];
  readonly sent: Parameters<AccountBroadcastQueue["markSent"]>[0][];
  readonly released: Parameters<AccountBroadcastQueue["release"]>[0][];
  readonly paused: Parameters<AccountBroadcastQueue["pauseAll"]>[0][];
}

function fakeQueue(input: {
  readonly next?: ClaimedBroadcastRecipient | null;
  readonly sentToday?: number;
  readonly pause?: { until: Date; reason: string } | null;
} = {}): FakeQueue {
  const queue: FakeQueue = {
    calls: [],
    claims: [],
    sent: [],
    released: [],
    paused: [],
    async activePause() {
      return input.pause ?? null;
    },
    async countSentSince() {
      return input.sentToday ?? 0;
    },
    async claimNext(claim) {
      queue.claims.push({ includeLive: claim.includeLive });
      const next = input.next === undefined ? recipient() : input.next;
      // Боевого не отдаём, когда боевые запрещены, — как делает запрос в базе.
      if (next !== null && !next.isTest && !claim.includeLive) {
        return null;
      }
      return next;
    },
    async markSent(sent) {
      queue.calls.push("markSent");
      queue.sent.push(sent);
    },
    async markFailed() {
      queue.calls.push("markFailed");
    },
    async release(release) {
      queue.calls.push("release");
      queue.released.push(release);
    },
    async pauseAll(pause) {
      queue.calls.push("pauseAll");
      queue.paused.push(pause);
    },
    async stopBroadcast() {
      queue.calls.push("stopBroadcast");
    },
    async completeFinished() {
      queue.calls.push("completeFinished");
      return 0;
    }
  };
  return queue;
}

let idCounter = 0;
const ids = { newId: () => `00000000-0000-4000-8000-${String(++idCounter).padStart(12, "0")}` };

function service(queue: AccountBroadcastQueue, copy: () => Promise<{ providerMessageIds: string[] }>) {
  return new SendAccountBroadcastsService(queue, { copy }, ids, OPTIONS, () => 0.5);
}

describe("SendAccountBroadcastsService", () => {
  it("копирует части и пишет реплику с вложением кружка", async () => {
    const queue = fakeQueue();
    const copied: string[][] = [];
    const result = await new SendAccountBroadcastsService(
      queue,
      {
        copy: async (input) => {
          copied.push([...input.externalMessageIds]);
          return { providerMessageIds: ["9001", "9002"] };
        }
      },
      ids,
      OPTIONS,
      () => 0.5
    ).execute({ at: NOON });

    assert.equal(result.kind, "sent");
    assert.deepEqual(copied, [["1048576", "2097152"]]);
    assert.equal(queue.sent.length, 1);
    // Одно вложение — у кружка есть копия у нас, у текста файла нет.
    assert.equal(queue.sent[0]?.attachmentIds.length, 1);
    assert.equal(queue.sent[0]?.body, "Ждём вас во вторник!");
    // Пауза — посередине между 20 и 30 секундами при random = 0.5.
    assert.equal(result.nextRunAt.getTime() - NOON.getTime(), 25_000);
    assert.ok(queue.calls.includes("completeFinished"));
  });

  it("ночью боевых не берёт, а пробную берёт", async () => {
    const live = fakeQueue();
    const idle = await service(live, async () => ({ providerMessageIds: ["1"] }))
      .execute({ at: MIDNIGHT });
    assert.equal(idle.kind, "idle");
    assert.equal(idle.kind === "idle" ? idle.reason : null, "outside_window");
    assert.deepEqual(live.claims, [{ includeLive: false }]);

    const test = fakeQueue({ next: recipient({ isTest: true }) });
    const sent = await service(test, async () => ({ providerMessageIds: ["1"] }))
      .execute({ at: MIDNIGHT });
    assert.equal(sent.kind, "sent");
  });

  it("упёрлись в суточный потолок — ждём", async () => {
    const queue = fakeQueue({ sentToday: 150 });
    const result = await service(queue, async () => ({ providerMessageIds: ["1"] }))
      .execute({ at: NOON });
    assert.equal(result.kind === "idle" ? result.reason : result.kind, "daily_limit");
  });

  it("действующая пауза аккаунта — никого не берём", async () => {
    const until = new Date(NOON.getTime() + 10 * MINUTE);
    const queue = fakeQueue({ pause: { until, reason: "FLOOD_WAIT" } });
    const result = await service(queue, async () => ({ providerMessageIds: ["1"] }))
      .execute({ at: NOON });
    assert.equal(result.kind, "paused");
    assert.equal(queue.claims.length, 0);
    assert.equal(result.nextRunAt.getTime(), until.getTime());
  });

  it("FLOOD_WAIT ставит на паузу все рассылки и не тратит попытку человека", async () => {
    const queue = fakeQueue();
    const result = await service(queue, async () => {
      throw new AccountBroadcastSendError("flood", "Too Many Requests: retry after 120", 120);
    }).execute({ at: NOON });

    assert.equal(result.kind, "retry");
    assert.equal(queue.released[0]?.countAttempt, false);
    assert.equal(queue.paused[0]?.until.getTime(), NOON.getTime() + 125_000);
    assert.equal(result.nextRunAt.getTime(), NOON.getTime() + 125_000);
  });

  it("ограничение аккаунта — пауза на сутки и подсказка про @SpamBot", async () => {
    const queue = fakeQueue();
    await service(queue, async () => {
      throw new AccountBroadcastSendError("account", "PEER_FLOOD");
    }).execute({ at: NOON });

    assert.equal(queue.paused[0]?.until.getTime(), NOON.getTime() + 24 * HOUR);
    assert.match(queue.paused[0]?.reason ?? "", /@SpamBot/);
  });

  it("закрылся приватностью — не дошло насовсем, без повторов", async () => {
    const queue = fakeQueue();
    const result = await service(queue, async () => {
      throw new AccountBroadcastSendError("recipient", "USER_PRIVACY_RESTRICTED");
    }).execute({ at: NOON });
    assert.equal(result.kind, "failed");
    assert.deepEqual(queue.calls.filter((call) => call !== "completeFinished"), ["markFailed"]);
  });

  it("сеть моргнула — повтор с растущей паузой, потом отказ", async () => {
    const first = fakeQueue();
    const retry = await service(first, async () => {
      throw new Error("socket hang up");
    }).execute({ at: NOON });
    assert.equal(retry.kind, "retry");
    assert.equal(first.released[0]?.countAttempt, true);
    assert.equal(first.released[0]?.retryAt?.getTime(), NOON.getTime() + 10 * MINUTE);

    const last = fakeQueue({ next: recipient({ attempts: 2 }) });
    const failed = await service(last, async () => {
      throw new Error("socket hang up");
    }).execute({ at: NOON });
    assert.equal(failed.kind, "failed");
  });

  it("сообщение удалили из «Избранного» — рассылка встаёт, отправки нет", async () => {
    const queue = fakeQueue({ next: recipient({ parts: [part({ deleted: true })] }) });
    let copied = false;
    const result = await service(queue, async () => {
      copied = true;
      return { providerMessageIds: ["1"] };
    }).execute({ at: NOON });
    assert.equal(result.kind, "stopped");
    assert.equal(copied, false);
    assert.ok(queue.calls.includes("stopBroadcast"));
  });

  it("выключатель в .env — ничего не делаем", async () => {
    const queue = fakeQueue();
    const result = await new SendAccountBroadcastsService(
      queue,
      { copy: async () => ({ providerMessageIds: [] }) },
      ids,
      { ...OPTIONS, enabled: false }
    ).execute({ at: NOON });
    assert.equal(result.kind, "disabled");
    assert.equal(queue.claims.length, 0);
  });
});

describe("broadcastFeedBody", () => {
  it("медиа без нашей копии обозначает словом, текст оставляет как есть", () => {
    assert.equal(
      broadcastFeedBody([
        part({ storagePath: null }),
        part({ kind: "text", body: "Привет", storagePath: null, durationSeconds: null })
      ]),
      "[Кружок · 0:42]\n\nПривет"
    );
    assert.equal(broadcastFeedBody([part()]), null);
  });
});

describe("parseTestRecipient", () => {
  it("понимает ник, ссылку и российский телефон", () => {
    assert.deepEqual(parseTestRecipient("@Liubov_Test"), { username: "liubov_test", phoneE164: null });
    assert.deepEqual(parseTestRecipient("https://t.me/liubov_test"), {
      username: "liubov_test",
      phoneE164: null
    });
    assert.deepEqual(parseTestRecipient("8 (999) 123-45-67"), {
      username: null,
      phoneE164: "+79991234567"
    });
    assert.deepEqual(parseTestRecipient("+7 999 123 45 67"), {
      username: null,
      phoneE164: "+79991234567"
    });
    assert.throws(() => parseTestRecipient("кто-то"), AccountBroadcastRequestError);
  });
});

describe("AdminAccountBroadcastService", () => {
  const pace = {
    pauseMinSeconds: 20,
    pauseMaxSeconds: 30,
    dailyLimit: 150,
    windowStartHour: 10,
    windowEndHour: 21,
    timeZone: "Europe/Moscow"
  };

  function repository(
    overrides: Partial<AdminAccountBroadcastRepository> = {}
  ): AdminAccountBroadcastRepository {
    return {
      listSavedMessages: async () => ({ items: [], lastSyncedAt: null }),
      findSavedMessageFile: async () => null,
      eventExists: async () => true,
      countAudience: async () => ({
        participants: 100,
        reachable: 70,
        alreadyReceived: 5,
        notInTelegram: 20
      }),
      findTestRecipient: async () => null,
      createBroadcast: async () => ({ kind: "created", recipientCount: 65 }),
      listBroadcasts: async () => [],
      cancelBroadcast: async () => true,
      ...overrides
    };
  }

  const savedId = "00000000-0000-4000-8000-000000000101";

  it("считает, сколько уйдёт и сколько ещё не проверено", async () => {
    const result = await new AdminAccountBroadcastService(repository(), ids, pace).countAudience({
      actor: ACTOR,
      eventId: "00000000-0000-4000-8000-000000000901",
      savedMessageIds: [savedId]
    });
    assert.equal(result.willReceive, 65);
    assert.equal(result.notChecked, 10);
    assert.deepEqual(result.pace, pace);
  });

  it("требует ровно одно: мероприятие или пробного получателя", async () => {
    const broadcasts = new AdminAccountBroadcastService(repository(), ids, pace);
    await assert.rejects(
      broadcasts.create({ actor: ACTOR, savedMessageIds: [savedId], now: NOON }),
      AccountBroadcastRequestError
    );
    await assert.rejects(
      broadcasts.create({
        actor: ACTOR,
        savedMessageIds: [savedId],
        eventId: "00000000-0000-4000-8000-000000000901",
        testRecipient: "@liubov_test",
        now: NOON
      }),
      AccountBroadcastRequestError
    );
  });

  it("не пускает больше пяти сообщений и повторы", async () => {
    const broadcasts = new AdminAccountBroadcastService(repository(), ids, pace);
    await assert.rejects(
      broadcasts.create({
        actor: ACTOR,
        savedMessageIds: [savedId, savedId],
        eventId: "00000000-0000-4000-8000-000000000901",
        now: NOON
      }),
      AccountBroadcastRequestError
    );
  });

  it("пробная без переписки с аккаунтом — понятный отказ", async () => {
    const broadcasts = new AdminAccountBroadcastService(repository(), ids, pace);
    await assert.rejects(
      broadcasts.create({
        actor: ACTOR,
        savedMessageIds: [savedId],
        testRecipient: "@liubov_test",
        now: NOON
      }),
      (error: unknown) =>
        error instanceof AccountBroadcastRequestError && error.code === "test_recipient_not_found"
    );
  });

  it("вторая рассылка по тому же мероприятию, пока идёт первая, — отказ", async () => {
    const broadcasts = new AdminAccountBroadcastService(
      repository({ createBroadcast: async () => ({ kind: "already_sending" }) }),
      ids,
      pace
    );
    await assert.rejects(
      broadcasts.create({
        actor: ACTOR,
        savedMessageIds: [savedId],
        eventId: "00000000-0000-4000-8000-000000000901",
        now: NOON
      }),
      (error: unknown) =>
        error instanceof AccountBroadcastRequestError && error.code === "already_sending"
    );
  });

  it("без права на рассылки не пускает", async () => {
    const broadcasts = new AdminAccountBroadcastService(repository(), ids, pace);
    await assert.rejects(
      broadcasts.list({ actor: { ...ACTOR, permission: "events.read" } }),
      /permission is invalid/
    );
  });
});
