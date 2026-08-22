import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConversationController, ReplyModel } from "@ticket-platform/messenger-core";
import { encodeScenarioCallback } from "@ticket-platform/messenger-core";
import type { MaxApi, MaxButton } from "./max-api.js";
import { createMaxUpdateProcessor } from "./updates.js";

const USER_ID = 777_001;
const SESSION_ID = "019c0123-4567-789a-bcde-f01234567801";
const EDGE_ID = "019c0123-4567-789a-bcde-f01234567802";

describe("приём обновлений MAX", () => {
  it("проводит запуск бота через общий разговорный слой с каналом max", async () => {
    const { api, controller, calls, sent } = harness();
    const processor = createMaxUpdateProcessor(api, controller, silentLogger());

    await processor.handleUpdate({
      update_type: "bot_started",
      timestamp: 1_766_000_000_000,
      user: { user_id: USER_ID, username: "owner", name: "Олег" },
      payload: "event_sreda__partner_partner42"
    });

    const start = calls.find((call) => call.name === "onStart");
    assert.equal(start?.arg.channel, "max");
    assert.equal(field(start, "user")?.["externalUserId"], String(USER_ID));
    // Диплинк у MAX приезжает полем самого обновления, а не внутри сообщения.
    assert.equal(start?.arg.startPayload, "event_sreda__partner_partner42");
    assert.equal(String(start?.arg.receivedAt), new Date(1_766_000_000_000).toString());
    assert.deepEqual(sent, [{ userId: String(USER_ID), text: "Привет", buttons: undefined }]);
  });

  it("переводит кнопки ответа во вложение MAX", async () => {
    const { api, controller, sent } = harness([{
      text: "Выберите тариф",
      inlineButtons: [
        { text: "VIP", callbackData: "ticket_vip" },
        { text: "Программа", url: "https://biz-day.ru" }
      ]
    }]);
    const processor = createMaxUpdateProcessor(api, controller, silentLogger());

    await processor.handleUpdate({
      update_type: "bot_started",
      user: { user_id: USER_ID }
    });

    assert.deepEqual(sent[0]?.buttons, [
      [{ type: "callback", text: "VIP", payload: "ticket_vip" }],
      [{ type: "link", text: "Программа", url: "https://biz-day.ru" }]
    ]);
  });

  it("просьбу поделиться номером превращает в кнопку контакта", async () => {
    const { api, controller, sent } = harness([
      { text: "Нужен номер", keyboard: "request_contact" }
    ]);
    const processor = createMaxUpdateProcessor(api, controller, silentLogger());

    await processor.handleUpdate({ update_type: "bot_started", user: { user_id: USER_ID } });

    assert.deepEqual(sent[0]?.buttons, [
      [{ type: "request_contact", text: "Поделиться номером" }]
    ]);
  });

  it("нажатие кнопки меню разбирается по тем же кодам, что в Telegram", async () => {
    const { api, controller, calls, answered } = harness();
    const processor = createMaxUpdateProcessor(api, controller, silentLogger());

    await processor.handleUpdate({
      update_type: "message_callback",
      user: { user_id: USER_ID },
      callback: { callback_id: "cb-1", payload: "buy_ticket" }
    });

    const call = calls.find((entry) => entry.name === "onBuyTicket");
    assert.deepEqual(call?.arg, { channel: "max", externalUserId: String(USER_ID) });
    // Без ответа на нажатие кнопка у человека «крутится» до таймаута.
    assert.deepEqual(answered, ["cb-1"]);
  });

  it("шаг сценария узнаётся по общему коду перехода", async () => {
    const { api, controller, calls } = harness();
    const processor = createMaxUpdateProcessor(api, controller, silentLogger());

    await processor.handleUpdate({
      update_type: "message_callback",
      user: { user_id: USER_ID },
      callback: {
        callback_id: "cb-2",
        payload: encodeScenarioCallback(SESSION_ID, EDGE_ID)
      }
    });

    const call = calls.find((entry) => entry.name === "onScenarioTransition");
    assert.equal(call?.arg.channel, "max");
    assert.equal(call?.arg.sessionId, SESSION_ID);
    assert.equal(call?.arg.edgeId, EDGE_ID);
    assert.equal(call?.arg.callbackQueryId, "cb-2");
  });

  it("отвечает на нажатие даже тогда, когда обработка сорвалась", async () => {
    const { api, controller, answered, state } = harness();
    state.failOn = "onBuyTicket";
    const processor = createMaxUpdateProcessor(api, controller, silentLogger());

    await processor.handleUpdate({
      update_type: "message_callback",
      user: { user_id: USER_ID },
      callback: { callback_id: "cb-3", payload: "buy_ticket" }
    });

    assert.deepEqual(answered, ["cb-3"]);
  });

  it("достаёт телефон из вложения контакта", async () => {
    const { api, controller, calls } = harness();
    const processor = createMaxUpdateProcessor(api, controller, silentLogger());

    await processor.handleUpdate({
      update_type: "message_created",
      message: {
        sender: { user_id: USER_ID },
        body: {
          mid: "mid-1",
          attachments: [{ type: "contact", payload: { tel: "+7 999 123-45-67" } }]
        }
      }
    });

    const call = calls.find((entry) => entry.name === "onContact");
    assert.equal(call?.arg.channel, "max");
    assert.equal(field(call, "contact")?.["phoneNumber"], "+7 999 123-45-67");
  });

  it("достаёт телефон из карточки vCard, когда номера отдельным полем нет", async () => {
    const { api, controller, calls } = harness();
    const processor = createMaxUpdateProcessor(api, controller, silentLogger());

    await processor.handleUpdate({
      update_type: "message_created",
      message: {
        sender: { user_id: USER_ID },
        body: {
          mid: "mid-2",
          attachments: [{
            type: "contact",
            payload: { vcf_info: "BEGIN:VCARD\nTEL;TYPE=CELL:+79991234567\nEND:VCARD" }
          }]
        }
      }
    });

    const call = calls.find((entry) => entry.name === "onContact");
    assert.equal(field(call, "contact")?.["phoneNumber"], "+79991234567");
  });

  it("текст сначала предлагает сценарию, потом покупке", async () => {
    // Пустые ответы: каждый слой говорит «это не ко мне», и текст доходит до последнего.
    const { api, controller, calls } = harness([]);
    const processor = createMaxUpdateProcessor(api, controller, silentLogger());

    await processor.handleUpdate({
      update_type: "message_created",
      message: { sender: { user_id: USER_ID }, body: { mid: "mid-3", text: " 3 " } }
    });

    const names = calls.map((entry) => entry.name);
    assert.deepEqual(names, ["onScenarioInput", "onQuantityText", "onChildQuantityText"]);
    const scenario = calls[0];
    assert.equal(scenario?.arg.text, "3");
  });

  it("команды текстом не проводит: запуск бота приходит своим типом", async () => {
    const { api, controller, calls } = harness();
    const processor = createMaxUpdateProcessor(api, controller, silentLogger());

    await processor.handleUpdate({
      update_type: "message_created",
      message: { sender: { user_id: USER_ID }, body: { mid: "mid-4", text: "/start" } }
    });

    assert.deepEqual(calls, []);
  });

  it("ключ обновления различает сообщение, нажатие и прочее", async () => {
    const { api, controller, calls } = harness();
    const processor = createMaxUpdateProcessor(api, controller, silentLogger());

    await processor.handleUpdate({
      update_type: "message_created",
      message: { sender: { user_id: USER_ID }, body: { mid: "mid-5", text: "3" } }
    });
    await processor.handleUpdate({
      update_type: "bot_started",
      timestamp: 1_766_000_000_000,
      user: { user_id: USER_ID }
    });

    assert.equal(calls[0]?.arg.updateId, "msg:mid-5");
    const start = calls.find((entry) => entry.name === "onStart");
    assert.equal(start?.arg.updateId, `bot_started:${USER_ID}:1766000000000`);
  });

  it("не роняет обработку: вебхук обязан ответить, иначе MAX шлёт обновление по кругу", async () => {
    const { api, controller, state } = harness();
    state.failOn = "onStart";
    const errors: string[] = [];
    const processor = createMaxUpdateProcessor(api, controller, {
      info() {},
      error(message) { errors.push(message); }
    });

    await processor.handleUpdate({ update_type: "bot_started", user: { user_id: USER_ID } });

    assert.deepEqual(errors, ["max update failed"]);
  });

  it("обновление без человека пропускает молча", async () => {
    const { api, controller, calls } = harness();
    const processor = createMaxUpdateProcessor(api, controller, silentLogger());

    await processor.handleUpdate({ update_type: "bot_started" });

    assert.deepEqual(calls, []);
  });
});

interface SentMessage {
  readonly userId: string;
  readonly text: string;
  readonly buttons: readonly (readonly MaxButton[])[] | undefined;
}

interface RecordedCall {
  readonly name: string;
  readonly arg: Record<string, never>;
}

/**
 * Поддельный разговорный слой.
 *
 * Записывает, что и с чем позвали, — проверяем мы именно это: транспорт обязан довезти до
 * общего слоя канал `max` и разобранные поля, а весь смысл разговора живёт уже там и
 * проверен его собственными тестами.
 */
function harness(replies: readonly ReplyModel[] = [{ text: "Привет" }]) {
  const sent: SentMessage[] = [];
  const answered: string[] = [];
  const calls: RecordedCall[] = [];
  const state: { failOn?: string } = {};

  const api = {
    async sendMessage(input: {
      userId: string;
      text: string;
      buttons?: readonly (readonly MaxButton[])[];
    }) {
      sent.push({ userId: input.userId, text: input.text, buttons: input.buttons });
      return { providerMessageId: `mid-${sent.length}` };
    },
    async answerCallback(input: { callbackId: string }) {
      answered.push(input.callbackId);
    }
  } as unknown as MaxApi;

  function record(name: string) {
    return (arg?: unknown) => {
      calls.push({ name, arg: (arg ?? {}) as Record<string, never> });
      if (state.failOn === name) {
        throw new Error(`${name} failed`);
      }
      return name === "onScenarioTransition"
        ? { callbackText: "ок", replies: [] }
        : replies;
    };
  }

  const names = [
    "onStart", "onContact", "onScenarioTransition", "onScenarioInput",
    "onQuantityText", "onChildQuantityText", "onProgramAndPricing", "onFaq",
    "onContactUs", "onBuyTicket", "onChooseFamilyTicket", "onSelectTicketType",
    "onAddChildTicketPrompt", "onSkipChildTicket", "onPartnerProgram",
    "onGetPartnerLink", "onMyBonuses", "onMenu"
  ];
  const controller = Object.fromEntries(
    names.map((name) => [name, record(name)])
  ) as unknown as ConversationController;

  return { api, controller, sent, answered, calls, state };
}

/** Вложенное поле записанного вызова: сам аргумент типизирован намеренно широко. */
function field(
  call: RecordedCall | undefined,
  name: string
): Record<string, unknown> | undefined {
  const value: unknown = call?.arg[name];
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function silentLogger() {
  return { info() {}, error() {} };
}
