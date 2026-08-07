import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TelegramUpdateController,
  formatKopecks,
  type TelegramContactUseCase,
  type TelegramOfferAcceptanceUseCase,
  type TelegramPaymentInitializationUseCase,
  type TelegramScenarioUseCases,
  type TelegramStartUseCase,
  type TelegramTicketListUseCase,
  type TelegramTicketRedeliveryUseCase,
  type TelegramPhoneAccessUseCase
} from "./controller.js";

describe("TelegramUpdateController", () => {
  it("shows the contact keyboard only when phone is required", async () => {
    const withPhoneRequest = controller({ phoneRequired: true });
    const withoutPhoneRequest = controller({ phoneRequired: false });

    const requested = await withPhoneRequest.onStart(startCommand());
    const skipped = await withoutPhoneRequest.onStart(startCommand());

    assert.equal(requested.length, 2);
    assert.equal(requested[1]?.keyboard, "request_contact");
    assert.equal(skipped.length, 1);
  });

  it("renders credited balance from integer kopecks", async () => {
    const instance = controller({ phoneRequired: true, bonusCredited: true });

    const replies = await instance.onContact(contactCommand());

    assert.match(replies[0]?.text ?? "", /100 ₽/);
    assert.equal(replies[0]?.keyboard, "remove");
    assert.equal(formatKopecks("12345"), "123,45");
  });

  it("asks again when a third-party contact is rejected", async () => {
    const instance = controller({ phoneRequired: true, contactAccepted: false });

    const replies = await instance.onContact(contactCommand());

    assert.equal(replies[0]?.keyboard, "request_contact");
  });

  it("renders a newly accepted offer without repeating message edits", async () => {
    const instance = controller({ phoneRequired: false });

    const accepted = await instance.onOfferAcceptance(offerCommand());
    const duplicate = await instance.onOfferAcceptance({
      ...offerCommand(),
      callbackQueryId: "duplicate"
    });

    assert.equal(accepted.callbackText, "Оферта принята");
    assert.match(accepted.replacementText ?? "", /К оплате: 2390 ₽/);
    assert.equal(duplicate.callbackText, "Оферта уже принята");
    assert.equal(duplicate.replacementText, undefined);
  });

  it("exposes payment callbacks only with the configured payment use case", async () => {
    const instance = controller({ phoneRequired: false, paymentsEnabled: true });

    const accepted = await instance.onOfferAcceptance(offerCommand());
    const payment = await instance.onPaymentInitialization({
      publicOrderToken: "a".repeat(43),
      senderExternalUserId: "777",
      updateId: "1004",
      requestedAt: new Date("2026-07-24T12:06:00.000Z")
    });

    assert.match(
      accepted.inlineButtons?.[0] && "callbackData" in accepted.inlineButtons[0]
        ? accepted.inlineButtons[0].callbackData
        : "",
      /^payment_init:/
    );
    assert.equal(payment.callbackText, "Платёж готов");
    assert.equal(
      payment.inlineButtons?.[0] && "url" in payment.inlineButtons[0]
        ? payment.inlineButtons[0].url
        : "",
      "https://securepay.tinkoff.ru/payment"
    );
  });

  it("renders owner tickets with redelivery only for an issued ticket", async () => {
    const instance = controller({ phoneRequired: false });

    const replies = await instance.onTickets({ senderExternalUserId: "777" });

    assert.equal(replies.length, 2);
    assert.match(replies[0]?.text ?? "", /Статус: действует/);
    const redeliveryButton = replies[0]?.inlineButtons?.[0];
    assert.match(
      redeliveryButton && "callbackData" in redeliveryButton
        ? redeliveryButton.callbackData
        : "",
      /^ticket_redeliver:/
    );
    assert.match(replies[1]?.text ?? "", /Статус: возвращён/);
    assert.equal(replies[1]?.inlineButtons, undefined);
    assert.deepEqual(await instance.onTicketRedelivery({
      ticketId: "019c0123-4567-789a-bcde-f0123456789a",
      senderExternalUserId: "777",
      updateId: "1004",
      requestedAt: new Date("2026-07-24T14:00:00.000Z")
    }), { callbackText: "Билет отправляется" });
  });

  it("renders scenario presentations and owner-bound transition callbacks", async () => {
    const instance = controller({
      phoneRequired: false,
      scenarioEnabled: true
    });

    const replies = await instance.onStart(startCommand());
    const button = replies[0]?.inlineButtons?.[0];
    const callbackData = button && "callbackData" in button
      ? button.callbackData
      : "";
    const transition = await instance.onScenarioTransition({
      sessionId,
      edgeId,
      senderExternalUserId: "777",
      updateId: "1005",
      callbackQueryId: "callback-scenario",
      occurredAt: new Date("2026-07-26T12:01:00.000Z")
    });

    assert.equal(replies[0]?.text, "Выберите действие");
    assert.match(callbackData, /^scenario:/);
    assert.ok(Buffer.byteLength(callbackData, "utf8") <= 64);
    assert.equal(transition.callbackText, "Готово");
    assert.deepEqual(transition.replies, [{ text: "Готово" }]);
  });

  it("renders validated scenario input and ignores text outside a scenario", async () => {
    const enabled = controller({
      phoneRequired: false,
      scenarioEnabled: true
    });
    const disabled = controller({ phoneRequired: false });

    const replies = await enabled.onScenarioInput({
      senderExternalUserId: "777",
      updateId: "1006",
      text: "3",
      occurredAt: new Date("2026-07-26T12:02:00.000Z")
    });

    assert.deepEqual(replies, [{ text: "Количество сохранено" }]);
    assert.deepEqual(await disabled.onScenarioInput({
      senderExternalUserId: "777",
      updateId: "1007",
      text: "hello",
      occurredAt: new Date("2026-07-26T12:03:00.000Z")
    }), []);
  });

  it("resumes the scenario after offer acceptance with a payment action", async () => {
    const instance = controller({
      phoneRequired: false,
      scenarioEnabled: true,
      paymentsEnabled: true
    });

    const view = await instance.onOfferAcceptance(offerCommand());

    assert.deepEqual(view.replies, [{
      text: "Заказ готов к оплате",
      inlineButtons: [{
        text: "Оплатить",
        callbackData: `payment_init:${"a".repeat(43)}`
      }]
    }]);
    assert.equal(view.inlineButtons, undefined);
  });
});

function controller(options: {
  readonly phoneRequired: boolean;
  readonly bonusCredited?: boolean;
  readonly contactAccepted?: boolean;
  readonly paymentsEnabled?: boolean;
  readonly scenarioEnabled?: boolean;
}): TelegramUpdateController {
  const start: TelegramStartUseCase = {
    async execute() {
      return {
        userId: "user-id",
        messengerIdentityId: "identity-id",
        isNewUser: false,
        phoneRequired: options.phoneRequired,
        selectedEventSlug: null
      };
    }
  };
  const contact: TelegramContactUseCase = {
    async execute() {
      if (options.contactAccepted === false) {
        return { accepted: false, reason: "third_party_contact" };
      }

      return {
        accepted: true,
        phoneNewlyVerified: true,
        bonusCredited: options.bonusCredited ?? false,
        bonusReason: options.bonusCredited ? "credited" : "campaign_inactive",
        bonusAmountKopecks: options.bonusCredited ? "10000" : "0",
        availableBalanceKopecks: options.bonusCredited ? "10000" : "0"
      };
    }
  };
  let offerAccepted = false;
  const offer: TelegramOfferAcceptanceUseCase = {
    async execute() {
      const newlyAccepted = !offerAccepted;
      offerAccepted = true;
      return {
        accepted: true,
        newlyAccepted,
        orderId: "order-1",
        orderNumber: "BP-000001",
        currency: "RUB",
        totalKopecks: "249000",
        walletAppliedKopecks: "10000",
        externalDueKopecks: "239000"
      };
    }
  };
  const tickets: TelegramTicketListUseCase = {
    async execute() {
      return {
        identityFound: true,
        tickets: [
          {
            ticketId: "019c0123-4567-789a-bcde-f0123456789a",
            ticketNumber: "BP-000001-T001",
            orderNumber: "BP-000001",
            eventTitle: "Business Picnic",
            status: "issued",
            issuedAt: "2026-07-24T12:00:00.000Z"
          },
          {
            ticketId: "019c0123-4567-789a-bcde-f0123456789b",
            ticketNumber: "BP-000001-T002",
            orderNumber: "BP-000001",
            eventTitle: "Business Picnic",
            status: "refunded",
            issuedAt: "2026-07-24T12:00:00.000Z"
          }
        ]
      };
    }
  };
  const redelivery: TelegramTicketRedeliveryUseCase = {
    async execute() {
      return {
        accepted: true,
        newlyRequested: true,
        ticketNumber: "BP-000001-T001"
      };
    }
  };
  const payment: TelegramPaymentInitializationUseCase = {
    async execute() {
      return {
        initialized: true,
        paymentUrl: "https://securepay.tinkoff.ru/payment",
        orderNumber: "BP-000001",
        amountKopecks: "239000",
        currency: "RUB"
      };
    }
  };
  const scenario: TelegramScenarioUseCases = {
    start: {
      async execute() {
        return {
          handled: true,
          duplicate: false,
          sessionId,
          status: "waiting_input",
          presentations: [{
            text: "Выберите действие",
            buttons: [{ text: "Завершить", edgeId }]
          }]
        };
      }
    },
    advance: {
      async execute() {
        return {
          accepted: true,
          duplicate: false,
          sessionId,
          status: "completed",
          presentations: [{ text: "Готово", buttons: [] }]
        };
      }
    },
    input: {
      async execute() {
        return {
          handled: true,
          accepted: true,
          duplicate: false,
          sessionId,
          status: "waiting_input",
          presentations: [{ text: "Количество сохранено", buttons: [] }]
        };
      }
    },
    offerAccepted: {
      async execute() {
        return {
          handled: true,
          duplicate: false,
          sessionId,
          status: "waiting_input",
          presentations: [{
            text: "Заказ готов к оплате",
            buttons: [{
              text: "Оплатить",
              callbackData: `payment_init:${"a".repeat(43)}`
            }]
          }]
        };
      }
    }
  };

  return new TelegramUpdateController(
    start,
    contact,
    offer,
    tickets,
    redelivery,
    options.paymentsEnabled ? payment : undefined,
    options.scenarioEnabled ? scenario : undefined
  );
}

function startCommand() {
  return {
    updateId: "1001",
    receivedAt: new Date("2026-07-22T08:00:00.000Z"),
    startPayload: null,
    user: { externalUserId: "777" }
  };
}

function contactCommand() {
  return {
    updateId: "1002",
    senderExternalUserId: "777",
    contact: { externalUserId: "777", phoneNumber: "+78005553535" },
    receivedAt: new Date("2026-07-22T08:01:00.000Z")
  };
}

function offerCommand() {
  return {
    publicOrderToken: "a".repeat(43),
    senderExternalUserId: "777",
    updateId: "1003",
    callbackQueryId: "callback-1",
    messageId: "42",
    acceptedAt: new Date("2026-07-24T12:05:00.000Z")
  };
}

describe("доступ к разделам без телефона", () => {
  // Правило заказчика: без номера открыты «Программа и тарифы» и FAQ, остальное закрыто.
  const locked = () => gated(false);
  const unlocked = () => gated(true);

  it("оставляет программу, тарифы и FAQ открытыми", async () => {
    const bot = locked();

    assert.notEqual(bot.onProgramAndPricing()[0]?.text, undefined);
    assert.notEqual(bot.onFaq()[0]?.text, undefined);
    assert.equal(bot.onProgramAndPricing()[0]?.keyboard, undefined);
    assert.equal(bot.onFaq()[0]?.keyboard, undefined);
  });

  it("закрывает покупку, партнёрку, бонусы и связь с менеджером", async () => {
    const bot = locked();

    for (const replies of [
      await bot.onBuyTicket("42"),
      await bot.onChooseFamilyTicket("42"),
      await bot.onPartnerProgram("42"),
      await bot.onGetPartnerLink("42", "businessProriv_bot"),
      await bot.onContactUs("42"),
      await bot.onMyBonuses("42")
    ]) {
      assert.equal(replies.length, 1);
      assert.equal(replies[0]?.keyboard, "request_contact");
      assert.match(replies[0]?.text ?? "", /поделитесь номером/);
    }
  });

  it("пропускает всё, когда номер известен", async () => {
    const bot = unlocked();

    const buy = await bot.onBuyTicket("42");
    const partner = await bot.onPartnerProgram("42");

    assert.notEqual(buy[0]?.keyboard, "request_contact");
    assert.notEqual(partner[0]?.keyboard, "request_contact");
  });

  it("не закрывает разделы, когда проверка не подключена", async () => {
    // Незаполненная зависимость не должна молча останавливать продажи.
    const bot = controller({ phoneRequired: false });

    const buy = await bot.onBuyTicket("42");

    assert.notEqual(buy[0]?.keyboard, "request_contact");
  });

  function gated(unlockedAccess: boolean): TelegramUpdateController {
    const access: TelegramPhoneAccessUseCase = {
      async execute() {
        return { unlocked: unlockedAccess };
      }
    };
    return new TelegramUpdateController(
      { async execute() { throw new Error("не используется"); } } as unknown as TelegramStartUseCase,
      { async execute() { throw new Error("не используется"); } } as unknown as TelegramContactUseCase,
      { async execute() { throw new Error("не используется"); } } as unknown as TelegramOfferAcceptanceUseCase,
      { async execute() { throw new Error("не используется"); } } as unknown as TelegramTicketListUseCase,
      { async execute() { throw new Error("не используется"); } } as unknown as TelegramTicketRedeliveryUseCase,
      undefined,
      undefined,
      undefined,
      undefined,
      access
    );
  }
});

const sessionId = "019c0123-4567-789a-bcde-f0123456789a";
const edgeId = "019c0123-4567-789a-bcde-f0123456789b";
