import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  AcceptTelegramOfferCommand,
  HandleTelegramContactCommand,
  HandleTelegramStartCommand,
  ListTelegramTicketsCommand,
  RequestTelegramTicketRedeliveryCommand
} from "@ticket-platform/contracts";
import type { Logger } from "@ticket-platform/observability";
import type { Bot } from "grammy";
import {
  TelegramUpdateController,
  type TelegramContactUseCase,
  type TelegramOfferAcceptanceUseCase,
  type TelegramStartUseCase,
  type TelegramTicketListUseCase,
  type TelegramTicketRedeliveryUseCase
} from "./controller.js";
import { createTelegramBot } from "./grammy.js";

describe("grammY Telegram transport", () => {
  it("maps /start and owned contact fixtures into application commands", async () => {
    const startCommands: HandleTelegramStartCommand[] = [];
    const contactCommands: HandleTelegramContactCommand[] = [];
    const offerCommands: AcceptTelegramOfferCommand[] = [];
    const apiCalls: { readonly method: string; readonly payload: Record<string, unknown> }[] = [];
    const start: TelegramStartUseCase = {
      async execute(command) {
        startCommands.push(command);
        return {
          userId: "user-id",
          messengerIdentityId: "identity-id",
          isNewUser: true,
          phoneRequired: true,
          selectedEventSlug: "picnic"
        };
      }
    };
    const contact: TelegramContactUseCase = {
      async execute(command) {
        contactCommands.push(command);
        return {
          accepted: true,
          phoneNewlyVerified: true,
          bonusCredited: true,
          bonusReason: "credited",
          bonusAmountKopecks: "10000",
          availableBalanceKopecks: "10000"
        };
      }
    };
    const offer: TelegramOfferAcceptanceUseCase = {
      async execute(command) {
        offerCommands.push(command);
        return {
          accepted: true,
          newlyAccepted: true,
          orderId: "order-1",
          orderNumber: "BP-000001",
          currency: "RUB",
          totalKopecks: "249000",
          walletAppliedKopecks: "10000",
          externalDueKopecks: "239000"
        };
      }
    };
    const bot = createTelegramBot(
      "123456:test-token",
      new TelegramUpdateController(start, contact, offer, emptyTickets(), unavailableRedelivery()),
      silentLogger()
    );
    bot.botInfo = {
      id: 123456,
      is_bot: true,
      first_name: "Test Bot",
      username: "test_bot",
      can_join_groups: false,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: false,
      allows_users_to_create_topics: false,
      can_manage_bots: false,
      supports_join_request_queries: false
    };
    bot.api.config.use(async (_previous, method, payload) => {
      apiCalls.push({ method, payload: payload as Record<string, unknown> });
      return {
        ok: true,
        result: {
          message_id: apiCalls.length,
          date: 1_753_171_200,
          chat: { id: 777, type: "private", first_name: "Oleg" },
          text: String((payload as { text?: string }).text ?? "")
        }
      } as never;
    });

    await bot.handleUpdate(startFixture());
    await bot.handleUpdate(contactFixture());
    await bot.handleUpdate(offerAcceptanceFixture());

    assert.equal(startCommands[0]?.updateId, "1001");
    assert.equal(startCommands[0]?.startPayload, "event_picnic");
    assert.equal(startCommands[0]?.user.externalUserId, "777");
    assert.equal(contactCommands[0]?.updateId, "1002");
    assert.equal(contactCommands[0]?.senderExternalUserId, "777");
    assert.equal(contactCommands[0]?.contact.externalUserId, "777");
    assert.equal(offerCommands[0]?.publicOrderToken, "a".repeat(43));
    assert.equal(offerCommands[0]?.callbackQueryId, "callback-1");
    assert.equal(apiCalls.filter((call) => call.method === "sendMessage").length, 3);
    assert.equal(apiCalls.filter((call) => call.method === "answerCallbackQuery").length, 1);
    assert.equal(apiCalls.filter((call) => call.method === "editMessageText").length, 1);
  });

  it("maps ticket commands and owner-bound redelivery callbacks", async () => {
    const listCommands: ListTelegramTicketsCommand[] = [];
    const redeliveryCommands: RequestTelegramTicketRedeliveryCommand[] = [];
    const tickets: TelegramTicketListUseCase = {
      async execute(command) {
        listCommands.push(command);
        return {
          identityFound: true,
          tickets: [{
            ticketId,
            ticketNumber: "BP-000001-T001",
            orderNumber: "BP-000001",
            eventTitle: "Business Picnic",
            status: "issued",
            issuedAt: "2026-07-24T12:00:00.000Z"
          }]
        };
      }
    };
    const redelivery: TelegramTicketRedeliveryUseCase = {
      async execute(command) {
        redeliveryCommands.push(command);
        return {
          accepted: true,
          newlyRequested: true,
          ticketNumber: "BP-000001-T001"
        };
      }
    };
    const apiCalls: string[] = [];
    const bot = createTelegramBot(
      "123456:test-token",
      new TelegramUpdateController(
        passiveStart(),
        passiveContact(),
        passiveOffer(),
        tickets,
        redelivery
      ),
      silentLogger()
    );
    bot.botInfo = testBotInfo();
    bot.api.config.use(async (_previous, method, payload) => {
      apiCalls.push(method);
      return {
        ok: true,
        result: method === "answerCallbackQuery"
          ? true
          : {
              message_id: apiCalls.length,
              date: 1_753_171_200,
              chat: { id: 777, type: "private", first_name: "Oleg" },
              text: String((payload as { text?: string }).text ?? "")
            }
      } as never;
    });

    await bot.handleUpdate(ticketsCommandFixture());
    await bot.handleUpdate(myTicketsFixture());
    await bot.handleUpdate(ticketRedeliveryFixture());

    assert.deepEqual(listCommands, [
      { senderExternalUserId: "777" },
      { senderExternalUserId: "777" }
    ]);
    assert.equal(redeliveryCommands[0]?.ticketId, ticketId);
    assert.equal(redeliveryCommands[0]?.senderExternalUserId, "777");
    assert.equal(redeliveryCommands[0]?.updateId, "1006");
    assert.equal(apiCalls.filter((method) => method === "sendMessage").length, 2);
    assert.equal(apiCalls.filter((method) => method === "answerCallbackQuery").length, 2);
  });

  it("rethrows handler failures for retryable webhook delivery", async () => {
    const start: TelegramStartUseCase = {
      async execute() {
        throw new Error("database unavailable");
      }
    };
    const contact: TelegramContactUseCase = {
      async execute() {
        return { accepted: false, reason: "third_party_contact" };
      }
    };
    const offer: TelegramOfferAcceptanceUseCase = {
      async execute() {
        return { accepted: false, reason: "order_not_found" };
      }
    };
    const bot = createTelegramBot(
      "123456:test-token",
      new TelegramUpdateController(start, contact, offer, emptyTickets(), unavailableRedelivery()),
      silentLogger(),
      { rethrowUpdateErrors: true }
    );
    bot.botInfo = testBotInfo();

    await assert.rejects(() => bot.handleUpdate(startFixture()), /database unavailable/);
  });
});

function startFixture(): Parameters<Bot["handleUpdate"]>[0] {
  return {
    update_id: 1001,
    message: {
      message_id: 1,
      date: 1_753_171_200,
      from: { id: 777, is_bot: false, first_name: "Oleg", username: "owner", language_code: "ru" },
      chat: { id: 777, type: "private", first_name: "Oleg" },
      text: "/start event_picnic",
      entities: [{ offset: 0, length: 6, type: "bot_command" }]
    }
  };
}

function contactFixture(): Parameters<Bot["handleUpdate"]>[0] {
  return {
    update_id: 1002,
    message: {
      message_id: 2,
      date: 1_753_171_260,
      from: { id: 777, is_bot: false, first_name: "Oleg" },
      chat: { id: 777, type: "private", first_name: "Oleg" },
      contact: {
        phone_number: "+78005553535",
        first_name: "Oleg",
        user_id: 777
      }
    }
  };
}

function offerAcceptanceFixture(): Parameters<Bot["handleUpdate"]>[0] {
  return {
    update_id: 1003,
    callback_query: {
      id: "callback-1",
      from: { id: 777, is_bot: false, first_name: "Oleg" },
      chat_instance: "chat-instance",
      data: `offer_accept:${"a".repeat(43)}`,
      message: {
        message_id: 3,
        date: 1_753_171_300,
        chat: { id: 777, type: "private", first_name: "Oleg" },
        text: "Оферта"
      }
    }
  };
}

function ticketsCommandFixture(): Parameters<Bot["handleUpdate"]>[0] {
  return {
    update_id: 1004,
    message: {
      message_id: 4,
      date: 1_753_171_360,
      from: { id: 777, is_bot: false, first_name: "Oleg" },
      chat: { id: 777, type: "private", first_name: "Oleg" },
      text: "/tickets",
      entities: [{ offset: 0, length: 8, type: "bot_command" }]
    }
  };
}

function myTicketsFixture(): Parameters<Bot["handleUpdate"]>[0] {
  return callbackFixture(1005, "callback-tickets", "my_tickets");
}

function ticketRedeliveryFixture(): Parameters<Bot["handleUpdate"]>[0] {
  return callbackFixture(1006, "callback-redelivery", `ticket_redeliver:${ticketId}`);
}

function callbackFixture(
  updateId: number,
  callbackId: string,
  data: string
): Parameters<Bot["handleUpdate"]>[0] {
  return {
    update_id: updateId,
    callback_query: {
      id: callbackId,
      from: { id: 777, is_bot: false, first_name: "Oleg" },
      chat_instance: "chat-instance",
      data,
      message: {
        message_id: updateId,
        date: 1_753_171_400,
        chat: { id: 777, type: "private", first_name: "Oleg" },
        text: "Билеты"
      }
    }
  };
}

function passiveStart(): TelegramStartUseCase {
  return {
    async execute() {
      return {
        userId: "user-id",
        messengerIdentityId: "identity-id",
        isNewUser: false,
        phoneRequired: false,
        selectedEventSlug: null
      };
    }
  };
}

function passiveContact(): TelegramContactUseCase {
  return {
    async execute() {
      return { accepted: false, reason: "third_party_contact" };
    }
  };
}

function passiveOffer(): TelegramOfferAcceptanceUseCase {
  return {
    async execute() {
      return { accepted: false, reason: "order_not_found" };
    }
  };
}

function emptyTickets(): TelegramTicketListUseCase {
  return {
    async execute() {
      return { identityFound: true, tickets: [] };
    }
  };
}

function unavailableRedelivery(): TelegramTicketRedeliveryUseCase {
  return {
    async execute() {
      return { accepted: false, reason: "ticket_unavailable" };
    }
  };
}

function silentLogger(): Logger {
  return {
    info() {},
    error() {}
  };
}

function testBotInfo(): NonNullable<Bot["botInfo"]> {
  return {
    id: 123456,
    is_bot: true,
    first_name: "Test Bot",
    username: "test_bot",
    can_join_groups: false,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
    can_manage_bots: false,
    supports_join_request_queries: false
  };
}

const ticketId = "019c0123-4567-789a-bcde-f0123456789a";
