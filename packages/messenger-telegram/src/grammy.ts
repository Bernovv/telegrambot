import type { ChannelIdentity } from "@ticket-platform/application";
import { Bot, InlineKeyboard, Keyboard } from "grammy";
import type { Logger } from "@ticket-platform/observability";
import {
  InvalidPhoneNumberError,
  decodeScenarioCallback,
  type ConversationController,
  type ConversationRecorder,
  type InlineButton,
  type ReplyModel
} from "@ticket-platform/messenger-core";
import {
  recordIncomingUpdate,
  recordOutgoingMessages
} from "./conversation-recording.js";

export type TelegramUpdate = Parameters<Bot["handleUpdate"]>[0];

export interface TelegramUpdateProcessor {
  handleUpdate(update: TelegramUpdate): Promise<void>;
}

export interface TelegramBotOptions {
  readonly rethrowUpdateErrors?: boolean;
  /** Optional reverse-proxy base URL in front of api.telegram.org (e.g. a
   * Cloudflare Worker), used where Telegram's API is blocked by the network. */
  readonly apiRoot?: string;
  /**
   * Куда писать переписку. Не задан — бот работает как раньше и ничего не сохраняет:
   * канал, поднятый без записи (тесты, локальный запуск), обязан оставаться рабочим.
   */
  readonly conversationRecorder?: ConversationRecorder;
}

export function createTelegramBot(
  token: string,
  controller: ConversationController,
  logger: Logger,
  options: TelegramBotOptions = {}
): Bot {
  const bot = new Bot(
    token,
    options.apiRoot ? { client: { apiRoot: options.apiRoot } } : undefined
  );

  const recorder = options.conversationRecorder;
  if (recorder) {
    // Первым в цепочке: разбор сообщения начинается после того, как оно записано.
    // Сегодня бот понимает команду, контакт и текст, а голосовое, фотография и всё
    // остальное проходят мимо и исчезают. Здесь они перестают исчезать.
    bot.on(["message", "edited_message"], async (ctx, next) => {
      await recordIncomingUpdate(recorder, ctx.update);
      await next();
    });
    recordOutgoingMessages(bot, recorder);
  }

  bot.command("start", async (ctx) => {
    const message = ctx.message;

    if (!ctx.from || !message || message.chat.type !== "private") {
      await ctx.reply("Откройте личный чат с ботом, чтобы продолжить.");
      return;
    }

    const replies = await controller.onStart({
      channel: "telegram",
      updateId: String(ctx.update.update_id),
      receivedAt: new Date(message.date * 1_000),
      startPayload: ctx.match || null,
      user: {
        externalUserId: String(ctx.from.id),
        username: ctx.from.username ?? null,
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name ?? null,
        languageCode: ctx.from.language_code ?? null
      }
    });

    await sendReplies(ctx.reply.bind(ctx), replies);
  });

  bot.on("message:contact", async (ctx) => {
    if (!ctx.from || ctx.chat.type !== "private") {
      await ctx.reply("Номер телефона можно отправить только в личном чате с ботом.");
      return;
    }

    try {
      const replies = await controller.onContact({
        channel: "telegram",
        updateId: String(ctx.update.update_id),
        senderExternalUserId: String(ctx.from.id),
        contact: {
          externalUserId: ctx.message.contact.user_id === undefined
            ? null
            : String(ctx.message.contact.user_id),
          phoneNumber: ctx.message.contact.phone_number
        },
        receivedAt: new Date(ctx.message.date * 1_000)
      });

      await sendReplies(ctx.reply.bind(ctx), replies);
    } catch (error) {
      if (error instanceof InvalidPhoneNumberError) {
        await ctx.reply("Не удалось распознать номер. Отправьте контакт кнопкой ниже.", {
          reply_markup: contactKeyboard()
        });
        return;
      }

      throw error;
    }
  });

  /**
   * Scenario-driven dialogs (per-event, admin-published) take priority when configured; otherwise
   * falls back to the hardcoded purchase flow (headcount, then optional child headcount).
   * Silent when neither has an active draft waiting -- see onScenarioInput/onQuantityText/
   * onChildQuantityText.
   */
  bot.on("message:text", async (ctx) => {
    if (!ctx.from || ctx.chat.type !== "private") {
      return;
    }

    const sender = telegramSender(ctx.from.id);

    const scenarioReplies = await controller.onScenarioInput({
      channel: "telegram",
      senderExternalUserId: sender.externalUserId,
      updateId: String(ctx.update.update_id),
      text: ctx.message.text,
      occurredAt: new Date(ctx.message.date * 1_000)
    });
    if (scenarioReplies.length > 0) {
      await sendReplies(ctx.reply.bind(ctx), scenarioReplies);
      return;
    }

    const quantityReplies = await controller.onQuantityText(sender, ctx.message.text, new Date());
    if (quantityReplies.length > 0) {
      await sendReplies(ctx.reply.bind(ctx), quantityReplies);
      return;
    }

    const childQuantityReplies = await controller.onChildQuantityText(
      sender,
      ctx.message.text,
      new Date()
    );
    if (childQuantityReplies.length > 0) {
      await sendReplies(ctx.reply.bind(ctx), childQuantityReplies);
    }
  });

  bot.callbackQuery(/^offer_accept:([A-Za-z0-9_-]{43})$/, async (ctx) => {
    const publicOrderToken = ctx.match[1];
    if (!publicOrderToken) {
      await ctx.answerCallbackQuery({ text: "Заказ не найден" });
      return;
    }

    const view = await controller.onOfferAcceptance({
      channel: "telegram",
      publicOrderToken,
      senderExternalUserId: String(ctx.from.id),
      updateId: String(ctx.update.update_id),
      callbackQueryId: ctx.callbackQuery.id,
      messageId: ctx.callbackQuery.message
        ? String(ctx.callbackQuery.message.message_id)
        : null,
      acceptedAt: new Date()
    });

    await ctx.answerCallbackQuery({ text: view.callbackText });
    if (view.replacementText) {
      const replyMarkup = view.inlineButtons
        ? inlineKeyboard(view.inlineButtons)
        : undefined;
      if (ctx.callbackQuery.message) {
        await ctx.editMessageText(view.replacementText, {
          ...(replyMarkup ? { reply_markup: replyMarkup } : {})
        });
      } else {
        await ctx.reply(view.replacementText, {
          ...(replyMarkup ? { reply_markup: replyMarkup } : {})
        });
      }
    }
    if (view.replies) {
      await sendReplies(ctx.reply.bind(ctx), view.replies);
    }
  });

  bot.callbackQuery(/^payment_init:([A-Za-z0-9_-]{43})$/, async (ctx) => {
    const publicOrderToken = ctx.match[1];
    if (
      !publicOrderToken
      || !ctx.callbackQuery.message
      || ctx.callbackQuery.message.chat.type !== "private"
    ) {
      await ctx.answerCallbackQuery({ text: "Оплата недоступна" });
      return;
    }

    const view = await controller.onPaymentInitialization({
      channel: "telegram",
      publicOrderToken,
      senderExternalUserId: String(ctx.from.id),
      updateId: String(ctx.update.update_id),
      requestedAt: new Date()
    });
    await ctx.answerCallbackQuery({ text: view.callbackText });
    if (view.replacementText) {
      await ctx.editMessageText(view.replacementText, {
        ...(view.inlineButtons
          ? { reply_markup: inlineKeyboard(view.inlineButtons) }
          : {})
      });
    }
  });

  bot.callbackQuery(
    /^scenario:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]{22}$/,
    async (ctx) => {
      const reference = decodeScenarioCallback(ctx.callbackQuery.data);
      if (
        !reference
        || !ctx.callbackQuery.message
        || ctx.callbackQuery.message.chat.type !== "private"
      ) {
        await ctx.answerCallbackQuery({ text: "Действие недоступно" });
        return;
      }
      const view = await controller.onScenarioTransition({
        channel: "telegram",
        sessionId: reference.sessionId,
        edgeId: reference.edgeId,
        senderExternalUserId: String(ctx.from.id),
        updateId: String(ctx.update.update_id),
        callbackQueryId: ctx.callbackQuery.id,
        occurredAt: new Date()
      });
      await ctx.answerCallbackQuery({ text: view.callbackText });
      await sendReplies(ctx.reply.bind(ctx), view.replies);
    }
  );

  bot.callbackQuery(["program", "pricing"], async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendReplies(ctx.reply.bind(ctx), controller.onProgramAndPricing());
  });

  bot.callbackQuery("faq", async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendReplies(ctx.reply.bind(ctx), controller.onFaq());
  });

  bot.callbackQuery("contact_us", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) {
      return;
    }
    await sendReplies(ctx.reply.bind(ctx), await controller.onContactUs(telegramSender(ctx.from.id)));
  });

  bot.callbackQuery("buy_ticket", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) {
      return;
    }
    await sendReplies(ctx.reply.bind(ctx), await controller.onBuyTicket(telegramSender(ctx.from.id)));
  });

  bot.callbackQuery("ticket_family", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) {
      return;
    }
    await sendReplies(
      ctx.reply.bind(ctx),
      await controller.onChooseFamilyTicket(telegramSender(ctx.from.id))
    );
  });

  bot.callbackQuery(["ticket_vip", "ticket_standard"], async (ctx) => {
    await ctx.answerCallbackQuery();
    const ticketType = ctx.callbackQuery.data === "ticket_vip" ? "adult_vip" : "adult_standard";
    const replies = await controller.onSelectTicketType(telegramSender(ctx.from.id), ticketType, new Date());
    await sendReplies(ctx.reply.bind(ctx), replies);
  });

  bot.callbackQuery(["ticket_family_vip", "ticket_family_standard"], async (ctx) => {
    await ctx.answerCallbackQuery();
    const ticketType = ctx.callbackQuery.data === "ticket_family_vip" ? "family_vip" : "family_standard";
    const replies = await controller.onSelectTicketType(telegramSender(ctx.from.id), ticketType, new Date());
    await sendReplies(ctx.reply.bind(ctx), replies);
  });

  bot.callbackQuery("add_child_ticket", async (ctx) => {
    await ctx.answerCallbackQuery();
    const replies = await controller.onAddChildTicketPrompt(telegramSender(ctx.from.id));
    await sendReplies(ctx.reply.bind(ctx), replies);
  });

  bot.callbackQuery("skip_child_ticket", async (ctx) => {
    await ctx.answerCallbackQuery();
    const replies = await controller.onSkipChildTicket(telegramSender(ctx.from.id), new Date());
    await sendReplies(ctx.reply.bind(ctx), replies);
  });

  bot.callbackQuery("partner_program", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) {
      return;
    }
    await sendReplies(
      ctx.reply.bind(ctx),
      await controller.onPartnerProgram(telegramSender(ctx.from.id))
    );
  });

  bot.callbackQuery("get_partner_link", async (ctx) => {
    await ctx.answerCallbackQuery();
    const replies = await controller.onGetPartnerLink(
      telegramSender(ctx.from.id),
      bot.botInfo?.username ?? null
    );
    await sendReplies(ctx.reply.bind(ctx), replies);
  });

  bot.callbackQuery("my_bonuses", async (ctx) => {
    await ctx.answerCallbackQuery();
    const replies = await controller.onMyBonuses(telegramSender(ctx.from.id));
    await sendReplies(ctx.reply.bind(ctx), replies);
  });

  bot.callbackQuery(["start", "back_to_program"], async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendReplies(ctx.reply.bind(ctx), controller.onMenu());
  });

  bot.callbackQuery(
    /^ticket_redeliver:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i,
    async (ctx) => {
      const ticketId = ctx.match[1];
      if (
        !ticketId
        || !ctx.callbackQuery.message
        || ctx.callbackQuery.message.chat.type !== "private"
      ) {
        await ctx.answerCallbackQuery({ text: "Билет недоступен" });
        return;
      }

      const view = await controller.onTicketRedelivery({
        channel: "telegram",
        ticketId,
        senderExternalUserId: String(ctx.from.id),
        updateId: String(ctx.update.update_id),
        requestedAt: new Date()
      });
      await ctx.answerCallbackQuery({ text: view.callbackText });
    }
  );

  bot.catch((error) => {
    logger.error("telegram update failed", {
      updateId: String(error.ctx.update.update_id),
      errorType: error.error instanceof Error ? error.error.name : "UnknownError",
      errorMessage: error.error instanceof Error ? error.error.message : String(error.error)
    });

    if (options.rethrowUpdateErrors) {
      throw error.error;
    }
  });

  return bot;
}

async function sendReplies(
  reply: (text: string, options?: Parameters<Bot["api"]["sendMessage"]>[2]) => Promise<unknown>,
  replies: readonly ReplyModel[]
): Promise<void> {
  for (const response of replies) {
    if (response.inlineButtons && response.inlineButtons.length > 0) {
      const keyboard = new InlineKeyboard();
      for (const button of response.inlineButtons) {
        if ("callbackData" in button) {
          keyboard.text(button.text, button.callbackData).row();
        } else {
          keyboard.url(button.text, button.url).row();
        }
      }
      await reply(response.text, { reply_markup: keyboard });
      continue;
    }

    if (response.keyboard === "request_contact") {
      await reply(response.text, { reply_markup: contactKeyboard() });
      continue;
    }

    if (response.keyboard === "remove") {
      await reply(response.text, { reply_markup: { remove_keyboard: true } });
      continue;
    }

    await reply(response.text);
  }
}

function inlineKeyboard(buttons: readonly InlineButton[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const button of buttons) {
    if ("callbackData" in button) {
      keyboard.text(button.text, button.callbackData).row();
    } else {
      keyboard.url(button.text, button.url).row();
    }
  }
  return keyboard;
}

function contactKeyboard(): Keyboard {
  return new Keyboard()
    .requestContact("Поделиться номером")
    .resized()
    .oneTime();
}

/**
 * Отправитель для служб приложения.
 *
 * Пара, а не один идентификатор: номер `777` в Telegram и `777` в MAX — разные люди, и
 * поиск по одному лишь внешнему номеру однажды соединил бы их в одного.
 */
function telegramSender(id: number): ChannelIdentity {
  return { channel: "telegram", externalUserId: String(id) };
}
