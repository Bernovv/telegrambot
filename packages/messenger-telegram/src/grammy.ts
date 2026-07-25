import { Bot, InlineKeyboard, Keyboard } from "grammy";
import type { Logger } from "@ticket-platform/observability";
import { InvalidPhoneNumberError } from "@ticket-platform/messenger-core";
import type {
  TelegramUpdateController,
  TelegramInlineButton,
  TelegramReplyModel
} from "./controller.js";

export type TelegramUpdate = Parameters<Bot["handleUpdate"]>[0];

export interface TelegramUpdateProcessor {
  handleUpdate(update: TelegramUpdate): Promise<void>;
}

export interface TelegramBotOptions {
  readonly rethrowUpdateErrors?: boolean;
}

export function createTelegramBot(
  token: string,
  controller: TelegramUpdateController,
  logger: Logger,
  options: TelegramBotOptions = {}
): Bot {
  const bot = new Bot(token);

  bot.command("start", async (ctx) => {
    const message = ctx.message;

    if (!ctx.from || !message || message.chat.type !== "private") {
      await ctx.reply("Откройте личный чат с ботом, чтобы продолжить.");
      return;
    }

    const replies = await controller.onStart({
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

  bot.command("tickets", async (ctx) => {
    if (!ctx.from || ctx.chat.type !== "private") {
      await ctx.reply("Билеты доступны только в личном чате с ботом.");
      return;
    }

    const replies = await controller.onTickets({
      senderExternalUserId: String(ctx.from.id)
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

  bot.callbackQuery(/^offer_accept:([A-Za-z0-9_-]{43})$/, async (ctx) => {
    const publicOrderToken = ctx.match[1];
    if (!publicOrderToken) {
      await ctx.answerCallbackQuery({ text: "Заказ не найден" });
      return;
    }

    const view = await controller.onOfferAcceptance({
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

  bot.callbackQuery("my_tickets", async (ctx) => {
    if (
      !ctx.callbackQuery.message
      || ctx.callbackQuery.message.chat.type !== "private"
    ) {
      await ctx.answerCallbackQuery({ text: "Откройте личный чат с ботом" });
      return;
    }

    const replies = await controller.onTickets({
      senderExternalUserId: String(ctx.from.id)
    });
    await ctx.answerCallbackQuery();
    await sendReplies(ctx.reply.bind(ctx), replies);
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
      errorType: error.error instanceof Error ? error.error.name : "UnknownError"
    });

    if (options.rethrowUpdateErrors) {
      throw error.error;
    }
  });

  return bot;
}

async function sendReplies(
  reply: (text: string, options?: Parameters<Bot["api"]["sendMessage"]>[2]) => Promise<unknown>,
  replies: readonly TelegramReplyModel[]
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

function inlineKeyboard(buttons: readonly TelegramInlineButton[]): InlineKeyboard {
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
