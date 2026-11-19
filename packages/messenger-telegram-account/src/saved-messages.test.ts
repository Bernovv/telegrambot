import assert from "node:assert/strict";
import { test } from "node:test";
import { AccountBroadcastSendError } from "@ticket-platform/application";
import type { message as TdMessage, Update as TdUpdate } from "tdlib-types";
import {
  classifyTdlibSendError,
  createTdlibBroadcastSender,
  deletedSavedMessageIds,
  isNewSavedMessage,
  savedMessageOf
} from "./saved-messages.js";

const SELF = 7844497416;

/** Сообщение TDLib с теми полями, что важны разбору; остальное — шум. */
function message(content: unknown, overrides: Partial<TdMessage> = {}): TdMessage {
  return {
    _: "message",
    id: 1048576,
    chat_id: SELF,
    is_outgoing: true,
    date: 1_763_550_000,
    content,
    ...overrides
  } as unknown as TdMessage;
}

function file(id: number, size: number) {
  return { _: "file", id, size, expected_size: size };
}

test("кружок: длительность, превьюшка и файл с понятным именем", () => {
  const snapshot = savedMessageOf(message({
    _: "messageVideoNote",
    video_note: {
      _: "videoNote",
      duration: 42,
      length: 384,
      minithumbnail: { _: "minithumbnail", width: 40, height: 40, data: "AAAA" },
      video: file(55, 2_000_000)
    },
    is_viewed: false,
    is_secret: false
  }));

  assert.equal(snapshot.kind, "video_note");
  assert.equal(snapshot.durationSeconds, 42);
  assert.equal(snapshot.minithumbnailBase64, "AAAA");
  assert.equal(snapshot.externalFileId, "55");
  assert.equal(snapshot.fileName, "Кружок.mp4");
  assert.equal(snapshot.sizeBytes, 2_000_000);
  assert.equal(snapshot.externalMessageId, "1048576");
  assert.equal(snapshot.sentAt.getTime(), 1_763_550_000_000);
});

test("текст без файла, незнакомое — как «другое», а не потеря", () => {
  const text = savedMessageOf(message({
    _: "messageText",
    text: { _: "formattedText", text: "  Ждём вас во вторник  ", entities: [] }
  }));
  assert.equal(text.kind, "text");
  assert.equal(text.body, "Ждём вас во вторник");
  assert.equal(text.externalFileId, null);

  const poll = savedMessageOf(message({ _: "messagePoll" }));
  assert.equal(poll.kind, "other");
});

test("удаление из «Избранного» видно сразу, а выброс из памяти TDLib — нет", () => {
  const permanent = {
    _: "updateDeleteMessages",
    chat_id: SELF,
    message_ids: [1048576, 2097152],
    is_permanent: true,
    from_cache: false
  } as unknown as TdUpdate;
  assert.deepEqual(deletedSavedMessageIds(permanent, SELF), ["1048576", "2097152"]);

  const cache = { ...permanent, from_cache: true } as unknown as TdUpdate;
  assert.equal(deletedSavedMessageIds(cache, SELF), null);

  const other = { ...permanent, chat_id: 42 } as unknown as TdUpdate;
  assert.equal(deletedSavedMessageIds(other, SELF), null);
});

test("новое сообщение в «Избранном» узнаётся по номеру чата", () => {
  const saved = { _: "updateNewMessage", message: message({ _: "messageText" }) } as unknown as TdUpdate;
  assert.equal(isNewSavedMessage(saved, SELF), true);
  const foreign = {
    _: "updateNewMessage",
    message: message({ _: "messageText" }, { chat_id: 42 })
  } as unknown as TdUpdate;
  assert.equal(isNewSavedMessage(foreign, SELF), false);
});

test("ответы Telegram раскладываются по тому, что с ними делать", () => {
  assert.deepEqual(classifyTdlibSendError("Too Many Requests: retry after 37"), {
    kind: "flood",
    retryAfterSeconds: 37
  });
  assert.equal(classifyTdlibSendError("FLOOD_WAIT_120").retryAfterSeconds, 120);
  assert.equal(classifyTdlibSendError("Telegram отказался отправить: PEER_FLOOD").kind, "account");
  assert.equal(classifyTdlibSendError("USER_BANNED_IN_CHANNEL").kind, "account");
  // «restricted» есть и тут, но это приватность человека, а не ограничение аккаунта.
  assert.equal(classifyTdlibSendError("USER_PRIVACY_RESTRICTED").kind, "recipient");
  assert.equal(classifyTdlibSendError("Have no rights to send a message").kind, "recipient");
  assert.equal(classifyTdlibSendError("USER_IS_BLOCKED").kind, "recipient");
  assert.equal(classifyTdlibSendError("Message not found").kind, "source");
  assert.equal(classifyTdlibSendError("Request aborted").kind, "transient");
});

test("копия уходит одним запросом из «Избранного», по возрастанию номеров", async () => {
  const calls: Record<string, unknown>[] = [];
  const client = {
    invoke: async (request: Record<string, unknown>) => {
      calls.push(request);
      if (request._ === "forwardMessages") {
        return {
          _: "messages",
          total_count: 2,
          messages: [{ id: -1 }, { id: -2 }]
        };
      }
      return {};
    }
  };
  const confirmations = {
    confirm: async (_chatId: number, temporaryId: number) => String(9000 - temporaryId)
  };

  const sender = createTdlibBroadcastSender(client as never, confirmations, SELF);
  const result = await sender.copy({ externalChatId: "777", externalMessageIds: ["2097152", "1048576"] });

  const forward = calls.find((call) => call._ === "forwardMessages");
  assert.equal(forward?.chat_id, 777);
  assert.equal(forward?.from_chat_id, SELF);
  assert.equal(forward?.send_copy, true);
  assert.deepEqual(forward?.message_ids, [1048576, 2097152]);
  assert.deepEqual(result.providerMessageIds, ["9001", "9002"]);
});

test("отказ Telegram приходит разобранным", async () => {
  const client = {
    invoke: async (request: Record<string, unknown>) => {
      if (request._ === "forwardMessages") {
        return { _: "messages", total_count: 1, messages: [{ id: -1 }] };
      }
      return {};
    }
  };
  const confirmations = {
    confirm: async () => {
      throw new Error("Telegram отказался отправить: USER_PRIVACY_RESTRICTED");
    }
  };
  const sender = createTdlibBroadcastSender(client as never, confirmations, SELF);

  await assert.rejects(
    sender.copy({ externalChatId: "777", externalMessageIds: ["1048576"] }),
    (error: unknown) => error instanceof AccountBroadcastSendError && error.kind === "recipient"
  );
});

test("сообщение, которое нельзя скопировать, останавливает рассылку, а не человека", async () => {
  const client = {
    invoke: async (request: Record<string, unknown>) =>
      request._ === "forwardMessages" ? { _: "messages", total_count: 1, messages: [null] } : {}
  };
  const sender = createTdlibBroadcastSender(
    client as never,
    { confirm: async () => "1" },
    SELF
  );
  await assert.rejects(
    sender.copy({ externalChatId: "777", externalMessageIds: ["1048576"] }),
    (error: unknown) => error instanceof AccountBroadcastSendError && error.kind === "source"
  );
});
