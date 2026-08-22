import assert from "node:assert/strict";
import { test } from "node:test";
import type { message as TdMessage, Update as TdUpdate } from "tdlib-types";
import { incomingPrivateMessage, participantOf, toIncomingMessage } from "./updates.js";

const SENDER = { externalUserId: "42", username: "ivan", displayName: "Иван" };

/**
 * Обновления TDLib описаны сотнями обязательных полей, из которых разбору важны единицы.
 * Собирать их целиком в каждом случае — это шум, за которым не видно проверяемого.
 */
function update(message: Partial<TdMessage>): TdUpdate {
  return {
    _: "updateNewMessage",
    message: {
      id: 100,
      chat_id: 42,
      is_outgoing: false,
      date: 1_770_000_000,
      sender_id: { _: "messageSenderUser", user_id: 42 },
      content: { _: "messageText", text: { _: "formattedText", text: "привет", entities: [] } },
      ...message
    }
  } as unknown as TdUpdate;
}

/**
 * Разбирает обновление и падает, если оно не подошло. В тестах перевода это правильное
 * поведение: молчаливый `null` превратил бы проверку текста в проверку ничего.
 */
function messageOf(value: TdUpdate): TdMessage {
  const incoming = incomingPrivateMessage(value);
  assert.notEqual(incoming, null, "обновление не признано входящим");

  return (incoming as { readonly message: TdMessage }).message;
}

test("личное входящее сообщение берётся в работу", () => {
  const incoming = incomingPrivateMessage(update({}));

  assert.notEqual(incoming, null);
  assert.equal(incoming?.senderUserId, 42);
});

// Групповое сообщение в карточке человека — это чужой разговор, попавший туда по
// недосмотру. У TDLib личный чат отличается знаком номера.
test("сообщение из группы пропускается", () => {
  assert.equal(incomingPrivateMessage(update({ chat_id: -1_001_234 })), null);
});

test("исходящее пропускается: его пишет отправка, а не приём", () => {
  assert.equal(incomingPrivateMessage(update({ is_outgoing: true })), null);
});

test("сообщение от имени канала пропускается: человека за ним нет", () => {
  const incoming = incomingPrivateMessage(
    update({ sender_id: { _: "messageSenderChat", chat_id: -100 } as TdMessage["sender_id"] })
  );

  assert.equal(incoming, null);
});

test("чужие обновления не трогаем", () => {
  assert.equal(incomingPrivateMessage({ _: "updateChatTitle" } as unknown as TdUpdate), null);
});

test("текст переносится в реплику с пометкой транспорта", () => {
  const recorded = toIncomingMessage(messageOf(update({})), SENDER, { raw: true });

  assert.equal(recorded.channel, "telegram");
  assert.equal(recorded.transport, "account");
  assert.equal(recorded.externalChatId, "42");
  assert.equal(recorded.externalMessageId, "100");
  assert.equal(recorded.body, "привет");
  assert.deepEqual(recorded.attachments, []);
  assert.equal(recorded.occurredAt.getTime(), 1_770_000_000_000);
  assert.deepEqual(recorded.payload, { raw: true });
});

test("у фотографии берётся самый крупный размер, подпись становится текстом", () => {
  const recorded = toIncomingMessage(messageOf(update({
    content: {
      _: "messagePhoto",
      caption: { _: "formattedText", text: "вот так", entities: [] },
      photo: {
        _: "photo",
        sizes: [
          { _: "photoSize", type: "s", photo: { _: "file", id: 11, size: 900, expected_size: 900 } },
          { _: "photoSize", type: "y", photo: { _: "file", id: 12, size: 90_000, expected_size: 90_000 } }
        ]
      }
    } as unknown as TdMessage["content"]
  })), SENDER, {});

  assert.equal(recorded.body, "вот так");
  assert.deepEqual(recorded.attachments, [{
    kind: "photo",
    fileName: null,
    mimeType: "image/jpeg",
    sizeBytes: 90_000,
    externalFileId: "12"
  }]);
});

test("голосовое приходит вложением, а не пустой строкой", () => {
  const recorded = toIncomingMessage(messageOf(update({
    content: {
      _: "messageVoiceNote",
      caption: { _: "formattedText", text: "", entities: [] },
      voice_note: {
        _: "voiceNote",
        duration: 3,
        mime_type: "audio/ogg",
        voice: { _: "file", id: 77, size: 0, expected_size: 4_200 }
      }
    } as unknown as TdMessage["content"]
  })), SENDER, {});

  assert.equal(recorded.body, null);
  assert.equal(recorded.attachments[0]?.kind, "voice");
  assert.equal(recorded.attachments[0]?.externalFileId, "77");
  // Размер берётся из ожидаемого, пока файл не скачан: у нескачанного `size` равен нулю.
  assert.equal(recorded.attachments[0]?.sizeBytes, 4_200);
});

test("документ приносит имя и тип файла", () => {
  const recorded = toIncomingMessage(messageOf(update({
    content: {
      _: "messageDocument",
      caption: { _: "formattedText", text: "договор", entities: [] },
      document: {
        _: "document",
        file_name: "dogovor.pdf",
        mime_type: "application/pdf",
        document: { _: "file", id: 5, size: 120_000, expected_size: 120_000 }
      }
    } as unknown as TdMessage["content"]
  })), SENDER, {});

  assert.equal(recorded.body, "договор");
  assert.deepEqual(recorded.attachments, [{
    kind: "document",
    fileName: "dogovor.pdf",
    mimeType: "application/pdf",
    sizeBytes: 120_000,
    externalFileId: "5"
  }]);
});

test("контакт становится строкой, которую можно прочитать глазами", () => {
  const recorded = toIncomingMessage(messageOf(update({
    content: {
      _: "messageContact",
      contact: {
        _: "contact",
        phone_number: "79001234567",
        first_name: "Пётр",
        last_name: "Смирнов",
        vcard: "",
        user_id: 0
      }
    } as unknown as TdMessage["content"]
  })), SENDER, {});

  assert.equal(recorded.body, "Пётр Смирнов, +79001234567");
  assert.equal(recorded.attachments[0]?.kind, "contact");
  assert.equal(recorded.attachments[0]?.externalFileId, null);
});

// Видов сообщений у Telegram больше сотни, и список растёт без предупреждения. Незнакомый
// не повод потерять строку: тело обновления лежит в payload, и в карточке видно, что
// человек что-то прислал.
test("незнакомый вид сообщения записывается пустой строкой, а не теряется", () => {
  const recorded = toIncomingMessage(messageOf(update({
    content: { _: "messagePoll" } as unknown as TdMessage["content"]
  })), SENDER, { kind: "опрос" });

  assert.equal(recorded.body, null);
  assert.deepEqual(recorded.attachments, []);
  assert.deepEqual(recorded.payload, { kind: "опрос" });
});

test("имя и ник собираются из того, что знает TDLib", () => {
  assert.deepEqual(
    participantOf({
      id: 7,
      first_name: "Анна",
      last_name: "",
      usernames: { active_usernames: ["anna_bp", "anna"] }
    }),
    { externalUserId: "7", username: "anna_bp", displayName: "Анна" }
  );
});

test("человек без ника и без фамилии всё равно опознаётся", () => {
  assert.deepEqual(
    participantOf({ id: 8, first_name: "", last_name: "", usernames: undefined }),
    { externalUserId: "8", username: null, displayName: null }
  );
});
