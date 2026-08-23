import assert from "node:assert/strict";
import { test } from "node:test";
import { MaxCommand, MaxOpcode, parseInboundFrame, type MaxInboundFrame } from "./protocol.js";
import {
  incomingMessage,
  participantOf,
  toIncomingMessage,
  type IncomingMaxMessage
} from "./updates.js";

const SELF = "1";
const SENDER = { externalUserId: "42", username: "ivan", displayName: "Иван" };

/**
 * Кадр с новым сообщением. Полей у MAX в нём десятки, разбору важны единицы — собирать
 * остальные в каждом случае значит спрятать проверяемое за шумом.
 */
function frame(message: Readonly<Record<string, unknown>> = {}): MaxInboundFrame {
  return {
    cmd: MaxCommand.event,
    opcode: MaxOpcode.notifyMessage,
    seq: 7,
    payload: {
      chatId: 555,
      message: {
        id: 100,
        sender: 42,
        text: "привет",
        time: 1_770_000_000_000,
        type: "TEXT",
        ...message
      }
    }
  };
}

/**
 * Разбирает кадр и падает, если он не подошёл. В тестах перевода это правильно: молчаливый
 * `null` превратил бы проверку текста в проверку ничего.
 */
function taken(value: MaxInboundFrame): IncomingMaxMessage {
  const incoming = incomingMessage(value, SELF);
  assert.notEqual(incoming, null, "кадр не признан входящим сообщением");

  return incoming as IncomingMaxMessage;
}

test("входящее сообщение берётся в работу", () => {
  const incoming = taken(frame());

  assert.equal(incoming.senderUserId, "42");
  assert.equal(incoming.chatId, "555");
});

// Исходящее пишется в момент отправки, вместе с судьбой доставки. Записать его ещё и здесь
// значило бы показать менеджеру его собственный ответ дважды.
test("своё же сообщение пропускается", () => {
  assert.equal(incomingMessage(frame({ sender: 1 }), SELF), null);
});

test("кадр без отправителя пропускается: человека за ним нет", () => {
  assert.equal(incomingMessage(frame({ sender: null }), SELF), null);
});

// Как MAX помечает свои уведомления, мы знать не можем: протокол не документирован.
// Отбор по типу кадра однажды уже съел сообщение клиента молча.
test("тип кадра на приём не влияет: важен только код операции", () => {
  const asRequest: MaxInboundFrame = { ...frame(), cmd: 0 };

  assert.equal(incomingMessage(asRequest, SELF)?.senderUserId, "42");
});

test("чужой код операции пропускается", () => {
  // Набор текста — тоже событие, и в переписке ему делать нечего.
  const typing: MaxInboundFrame = {
    cmd: MaxCommand.event,
    opcode: 129,
    payload: { chatId: 555 }
  };

  assert.equal(incomingMessage(typing, SELF), null);
});

test("текст, время и канал переводятся в реплику переписки", () => {
  const recorded = toIncomingMessage(taken(frame()), SENDER, { raw: true });

  assert.equal(recorded.channel, "max");
  assert.equal(recorded.transport, "account");
  assert.equal(recorded.externalChatId, "555");
  assert.equal(recorded.externalMessageId, "100");
  assert.equal(recorded.body, "привет");
  assert.equal(recorded.occurredAt.getTime(), 1_770_000_000_000);
  assert.deepEqual(recorded.payload, { raw: true });
});

test("картинка приходит вложением со ссылкой", () => {
  const incoming = taken(
    frame({ attaches: [{ _type: "PHOTO", baseUrl: "https://max.ru/i/1.jpg", width: 10 }] })
  );
  const recorded = toIncomingMessage(incoming, SENDER, {});

  assert.equal(recorded.attachments.length, 1);
  assert.equal(recorded.attachments[0]?.kind, "photo");
  assert.equal(recorded.attachments[0]?.externalFileId, "https://max.ru/i/1.jpg");
});

// У файла ссылки нет вовсе: её выдают по трём числам сразу, и живёт она недолго. Поэтому
// в опознавателе лежат все три, а ссылку загрузчик спросит в момент скачивания.
test("файл опознаётся чатом, сообщением и номером файла", () => {
  const incoming = taken(
    frame({ attaches: [{ _type: "FILE", fileId: 9, name: "программа.pdf", size: 2048 }] })
  );
  const recorded = toIncomingMessage(incoming, SENDER, {});

  assert.equal(recorded.attachments[0]?.kind, "document");
  assert.equal(recorded.attachments[0]?.fileName, "программа.pdf");
  assert.equal(recorded.attachments[0]?.sizeBytes, 2048);
  assert.equal(recorded.attachments[0]?.externalFileId, "max-file:555:100:9");
});

// Незнакомый вид вложения — не повод потерять строку: в карточке видно, что человек
// что-то прислал, а кадр целиком лежит в payload.
test("незнакомое вложение записывается как «другое»", () => {
  const incoming = taken(frame({ attaches: [{ _type: "POLL", id: 3 }] }));

  assert.equal(toIncomingMessage(incoming, SENDER, {}).attachments[0]?.kind, "other");
});

test("наша же клавиатура вложением не считается", () => {
  const incoming = taken(frame({ attaches: [{ _type: "INLINE_KEYBOARD", payload: {} }] }));

  assert.deepEqual(toIncomingMessage(incoming, SENDER, {}).attachments, []);
});

test("ник берётся из ссылки на профиль, имя — из имён", () => {
  const participant = participantOf({
    id: 42,
    link: "https://max.ru/ivanov",
    names: [{ name: "Иван Иванов", firstName: "Иван", lastName: "Иванов" }]
  });

  assert.deepEqual(participant, {
    externalUserId: "42",
    username: "ivanov",
    displayName: "Иван Иванов"
  });
});

test("профиль без ссылки остаётся без ника, а не с мусором", () => {
  const participant = participantOf({ id: 42, link: "", names: [] });

  assert.equal(participant.username, null);
  assert.equal(participant.displayName, null);
});

test("мусор на входе не роняет разбор кадра", () => {
  assert.equal(parseInboundFrame("не json"), null);
  assert.equal(parseInboundFrame("{\"opcode\":\"нет\"}"), null);
});
