import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TelegramUpdateController,
  formatKopecks,
  type TelegramContactUseCase,
  type TelegramOfferAcceptanceUseCase,
  type TelegramPaymentInitializationUseCase,
  type TelegramStartUseCase,
  type TelegramTicketListUseCase,
  type TelegramTicketRedeliveryUseCase
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
});

function controller(options: {
  readonly phoneRequired: boolean;
  readonly bonusCredited?: boolean;
  readonly contactAccepted?: boolean;
  readonly paymentsEnabled?: boolean;
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

  return new TelegramUpdateController(
    start,
    contact,
    offer,
    tickets,
    redelivery,
    options.paymentsEnabled ? payment : undefined
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
