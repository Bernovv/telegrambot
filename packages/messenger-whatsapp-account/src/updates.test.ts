import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { incomingMessage, participantOf, type WhatsAppMessage } from "./updates.js";

function message(overrides: Partial<WhatsAppMessage> = {}): WhatsAppMessage {
  return {
    key: { id: "3EB0", remoteJid: "79001234567@s.whatsapp.net", fromMe: false },
    message: { conversation: "а с ребёнком можно?" },
    messageTimestamp: 1_787_000_000,
    pushName: "Надежда",
    ...overrides
  };
}

describe("incomingMessage", () => {
  it("берёт текст, номер и время", () => {
    const incoming = incomingMessage(message());

    assert.equal(incoming?.body, "а с ребёнком можно?");
    assert.equal(incoming?.chatJid, "79001234567@s.whatsapp.net");
    assert.equal(incoming?.sender.externalUserId, "79001234567");
    assert.equal(incoming?.sender.displayName, "Надежда");
    assert.deepEqual(incoming?.occurredAt, new Date(1_787_000_000_000));
  });

  it("своё исходящее не записывает второй раз", () => {
    // Оно уже записано в момент отправки, вместе с судьбой доставки. Сюда же попадает всё,
    // что менеджер отправит с самого телефона: связанное устройство видит и это.
    assert.equal(incomingMessage(message({ key: { id: "1", remoteJid: "7900@s.whatsapp.net", fromMe: true } })), null);
  });

  it("групповые чаты и статусы проходят мимо переписки", () => {
    for (const jid of ["120363@g.us", "status@broadcast", "12345@newsletter"]) {
      assert.equal(
        incomingMessage(message({ key: { id: "1", remoteJid: jid, fromMe: false } })),
        null,
        jid
      );
    }
  });

  it("реакция и удаление сообщения строк в ленте не заводят", () => {
    assert.equal(incomingMessage(message({ message: { reactionMessage: { text: "👍" } } })), null);
    assert.equal(
      incomingMessage(message({ message: { protocolMessage: { type: 0, key: { id: "3EB0" } } } })),
      null
    );
  });

  it("исчезающее сообщение разворачивается, а не теряется", () => {
    const incoming = incomingMessage(message({
      message: { ephemeralMessage: { message: { conversation: "перезвоните завтра" } } }
    }));

    assert.equal(incoming?.body, "перезвоните завтра");
  });

  it("подпись под фотографией — это текст реплики, а не пустота", () => {
    const incoming = incomingMessage(message({
      message: {
        imageMessage: {
          caption: "вот чек",
          mimetype: "image/jpeg",
          fileLength: 204_800
        }
      }
    }));

    assert.equal(incoming?.body, "вот чек");
    assert.deepEqual(incoming?.attachments, [{
      kind: "photo",
      fileName: null,
      mimeType: "image/jpeg",
      sizeBytes: 204_800,
      externalFileId: "wa:3EB0"
    }]);
  });

  it("голосовое отличается от присланной песни", () => {
    const voice = incomingMessage(message({
      message: { audioMessage: { ptt: true, mimetype: "audio/ogg" } }
    }));
    const audio = incomingMessage(message({
      message: { audioMessage: { mimetype: "audio/mpeg" } }
    }));

    assert.equal(voice?.attachments[0]?.kind, "voice");
    assert.equal(audio?.attachments[0]?.kind, "audio");
  });

  it("у геопозиции опознавателя файла нет: скачивать там нечего", () => {
    const incoming = incomingMessage(message({
      message: { locationMessage: { degreesLatitude: 59.9, degreesLongitude: 30.3 } }
    }));

    assert.equal(incoming?.attachments[0]?.kind, "location");
    assert.equal(incoming?.attachments[0]?.externalFileId, null);
  });

  it("правка приходит новой строкой со ссылкой на исходную", () => {
    const incoming = incomingMessage(message({
      key: { id: "3EB1", remoteJid: "79001234567@s.whatsapp.net", fromMe: false },
      message: {
        protocolMessage: {
          type: 14,
          key: { id: "3EB0" },
          editedMessage: { conversation: "а с двумя детьми можно?" }
        }
      }
    }));

    assert.equal(incoming?.body, "а с двумя детьми можно?");
    assert.equal(incoming?.messageId, "3EB1");
    assert.equal(incoming?.editsMessageId, "3EB0");
  });

  it("время в виде пары половин собирается обратно", () => {
    // Протобуф отдаёт 64-битные числа объектом; принять его за мусор значит поставить
    // реплике время «сейчас» и незаметно перепутать порядок ленты.
    const incoming = incomingMessage(message({ messageTimestamp: { low: 1_787_000_000, high: 0 } }));

    assert.deepEqual(incoming?.occurredAt, new Date(1_787_000_000_000));
  });
});

describe("participantOf", () => {
  it("скрытый идентификатор за телефон не выдаётся", () => {
    // Номер спрятан: адрес чата — не телефон. Приписка `lid:` не даст принять эти цифры за
    // номер и завести карточку, к которой потом приклеится посторонний.
    const participant = participantOf({
      key: { id: "1", remoteJid: "112233445566778899@lid", fromMe: false },
      pushName: "Аноним"
    });

    assert.equal(participant.externalUserId, "lid:112233445566778899");
  });

  it("если номер приехал отдельным полем — берём его", () => {
    const participant = participantOf({
      key: {
        id: "1",
        remoteJid: "112233445566778899@lid",
        fromMe: false,
        senderPn: "79001234567@s.whatsapp.net"
      },
      pushName: "Надежда"
    });

    assert.equal(participant.externalUserId, "79001234567");
  });

  it("номер устройства к номеру телефона не приписывается", () => {
    const participant = participantOf({
      key: { id: "1", remoteJid: "79001234567:12@s.whatsapp.net", fromMe: false }
    });

    assert.equal(participant.externalUserId, "79001234567");
  });
});
