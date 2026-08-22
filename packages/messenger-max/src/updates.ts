import type { ChannelIdentity } from "@ticket-platform/application";
import {
  InvalidPhoneNumberError,
  decodeScenarioCallback,
  type ConversationController,
  type ConversationRecorder,
  type InlineButton,
  type ReplyModel
} from "@ticket-platform/messenger-core";
import {
  recordIncomingMaxUpdate,
  recordOutgoingMaxMessage
} from "./conversation-recording.js";
import type { Logger } from "@ticket-platform/observability";
import type { MaxApi, MaxButton } from "./max-api.js";

/**
 * Апдейты MAX и что с ними делать.
 *
 * Разговорный слой здесь не свой, а общий (`ConversationController` из `messenger-core`) —
 * тот же, что обслуживает Telegram. Это главное решение в пакете и оно не косметическое:
 * сценарий покупки, ограничение по телефону, партнёрская программа и бонусы у двух
 * мессенджеров одинаковые, и вторая их копия означала бы, что каждая правка делается дважды,
 * а расходиться они начнут на третьей.
 *
 * Своим у канала остаётся ровно то, что действительно своё: как приходит апдейт, как
 * выглядит кнопка и как отправляется ответ.
 *
 * Коды кнопок при этом совпадают с телеграмными намеренно (`buy_ticket`, `ticket_vip`,
 * `my_bonuses` и так далее): они живут в общем контенте, и человек, перешедший из одного
 * мессенджера в другой, попадает в тот же разговор.
 */

/** Обновление MAX в том виде, в каком оно приходит вебхуком. */
export interface MaxUpdate {
  readonly update_type?: string;
  readonly timestamp?: number;
  readonly user?: MaxUser;
  readonly chat_id?: number | string;
  readonly payload?: string;
  readonly callback?: {
    readonly callback_id?: string;
    readonly payload?: string;
    readonly user?: MaxUser;
  };
  readonly message?: {
    readonly sender?: MaxUser;
    readonly recipient?: { readonly user_id?: number | string; readonly chat_id?: number | string };
    readonly body?: {
      readonly mid?: string;
      readonly text?: string;
      readonly attachments?: readonly {
        readonly type?: string;
        readonly payload?: Readonly<Record<string, unknown>>;
      }[];
    };
  };
}

interface MaxUser {
  readonly user_id?: number | string;
  readonly username?: string | null;
  readonly name?: string | null;
}

export interface MaxUpdateProcessor {
  handleUpdate(update: MaxUpdate): Promise<void>;
}

export interface MaxBotOptions {
  /** Имя бота для партнёрской ссылки: у MAX диплинк строится по нему же. */
  readonly botUsername?: string | null;
  /** Пробрасывать ошибку обработки наружу. Нужно тестам и локальному запуску. */
  readonly rethrowUpdateErrors?: boolean;
  /**
   * Куда писать переписку. Не задан — канал работает как раньше и ничего не сохраняет.
   */
  readonly conversationRecorder?: ConversationRecorder;
}

export function createMaxUpdateProcessor(
  api: MaxApi,
  controller: ConversationController,
  logger: Logger,
  options: MaxBotOptions = {}
): MaxUpdateProcessor {
  return {
    async handleUpdate(update: MaxUpdate): Promise<void> {
      try {
        await route(api, controller, update, options);
        // Принятое обновление обязано оставлять след. Без него молчание в логах читается
        // и как «ничего не пришло», и как «пришло и ничего не сделали», — а это разные
        // беды с разным лечением.
        logger.info("max update handled", {
          updateType: update.update_type ?? "unknown"
        });
      } catch (error) {
        // Падать нельзя: вебхук-роут обязан ответить `200`, иначе MAX будет слать это
        // обновление по кругу. Ошибку записываем и живём дальше.
        logger.error("max update failed", {
          updateType: update.update_type ?? "unknown",
          errorType: error instanceof Error ? error.name : "UnknownError",
          errorMessage: error instanceof Error ? error.message : String(error)
        });
        if (options.rethrowUpdateErrors) {
          throw error;
        }
      }
    }
  };
}

async function route(
  api: MaxApi,
  controller: ConversationController,
  update: MaxUpdate,
  options: MaxBotOptions
): Promise<void> {
  const updateType = update.update_type ?? "";

  // Запись идёт до разбора и не зависит от того, знаком ли нам тип обновления. Разбор
  // ниже понимает три типа из растущего списка, и всё, что он пропускает, — это чей-то
  // вопрос, оставшийся без ответа и без следа.
  if (options.conversationRecorder) {
    await recordIncomingMaxUpdate(options.conversationRecorder, update);
  }

  if (updateType === "bot_started") {
    await handleStart(api, controller, update, options);
    return;
  }
  if (updateType === "message_callback") {
    await handleCallback(api, controller, update, options);
    return;
  }
  if (updateType === "message_created") {
    await handleMessage(api, controller, update, options);
  }
}

/**
 * Первый запуск бота или переход по диплинку.
 *
 * Полезная нагрузка диплинка в MAX приезжает полем `payload` самого обновления, а не внутри
 * сообщения, как в Telegram. Разбирает её тот же `parseStartPayload` в домене — правила
 * меток источника и партнёрского кода у каналов общие.
 */
async function handleStart(
  api: MaxApi,
  controller: ConversationController,
  update: MaxUpdate,
  options: MaxBotOptions
): Promise<void> {
  const user = update.user ?? update.message?.sender;
  const externalUserId = identifier(user?.user_id);
  if (externalUserId === null) {
    return;
  }

  const replies = await controller.onStart({
    channel: "max",
    updateId: updateId(update, externalUserId),
    receivedAt: receivedAt(update),
    startPayload: update.payload ?? null,
    user: {
      externalUserId,
      username: user?.username ?? null,
      firstName: user?.name ?? null,
      lastName: null,
      languageCode: null
    }
  });
  await sendReplies(api, externalUserId, replies, options.conversationRecorder);
}

/** Нажатие кнопки. Отвечаем на него всегда — иначе кнопка «крутится» до таймаута. */
async function handleCallback(
  api: MaxApi,
  controller: ConversationController,
  update: MaxUpdate,
  options: MaxBotOptions
): Promise<void> {
  const callbackId = update.callback?.callback_id ?? "";
  const payload = update.callback?.payload ?? "";
  const externalUserId = identifier(
    update.callback?.user?.user_id ?? update.user?.user_id ?? update.message?.sender?.user_id
  );
  if (externalUserId === null || callbackId === "") {
    return;
  }
  const sender: ChannelIdentity = { channel: "max", externalUserId };
  const now = receivedAt(update);

  try {
    const scenario = decodeScenarioCallback(payload);
    if (scenario) {
      const view = await controller.onScenarioTransition({
        channel: "max",
        sessionId: scenario.sessionId,
        edgeId: scenario.edgeId,
        senderExternalUserId: externalUserId,
        updateId: updateId(update, externalUserId),
        callbackQueryId: callbackId,
        occurredAt: now
      });
      await api.answerCallback({ callbackId, notification: view.callbackText });
      await sendReplies(api, externalUserId, view.replies, options.conversationRecorder);
      return;
    }

    const replies = await menuAction(controller, sender, payload, now, options);
    await api.answerCallback({ callbackId });
    await sendReplies(api, externalUserId, replies, options.conversationRecorder);
  } catch (error) {
    // Ответ на кнопку — не часть сценария, а обязанность перед человеком: без него
    // интерфейс висит. Поэтому он уходит и тогда, когда обработка сорвалась.
    await api.answerCallback({ callbackId }).catch(() => undefined);
    throw error;
  }
}

/** Меню и покупка: коды кнопок общие с Telegram, потому что контент общий. */
async function menuAction(
  controller: ConversationController,
  sender: ChannelIdentity,
  payload: string,
  now: Date,
  options: MaxBotOptions
): Promise<readonly ReplyModel[]> {
  switch (payload) {
    case "program":
    case "pricing":
      return controller.onProgramAndPricing();
    case "faq":
      return controller.onFaq();
    case "contact_us":
      return controller.onContactUs(sender);
    case "buy_ticket":
      return controller.onBuyTicket(sender);
    case "ticket_family":
      return controller.onChooseFamilyTicket(sender);
    case "ticket_vip":
      return controller.onSelectTicketType(sender, "adult_vip", now);
    case "ticket_standard":
      return controller.onSelectTicketType(sender, "adult_standard", now);
    case "ticket_family_vip":
      return controller.onSelectTicketType(sender, "family_vip", now);
    case "ticket_family_standard":
      return controller.onSelectTicketType(sender, "family_standard", now);
    case "add_child_ticket":
      return controller.onAddChildTicketPrompt(sender);
    case "skip_child_ticket":
      return controller.onSkipChildTicket(sender, now);
    case "partner_program":
      return controller.onPartnerProgram(sender);
    case "get_partner_link":
      return controller.onGetPartnerLink(sender, options.botUsername ?? null);
    case "my_bonuses":
      return controller.onMyBonuses(sender);
    case "start":
    case "back_to_program":
      return controller.onMenu();
    default:
      return [];
  }
}

/**
 * Текст и присланный контакт.
 *
 * Контакт в MAX приезжает вложением `contact` внутри сообщения, а не отдельным полем, как в
 * Telegram. Номер оттуда достаётся и нормализуется общим разбором: правило «что такое
 * телефон» одно на оба канала.
 */
async function handleMessage(
  api: MaxApi,
  controller: ConversationController,
  update: MaxUpdate,
  options: MaxBotOptions
): Promise<void> {
  const externalUserId = identifier(update.message?.sender?.user_id ?? update.user?.user_id);
  if (externalUserId === null) {
    return;
  }
  const sender: ChannelIdentity = { channel: "max", externalUserId };
  const now = receivedAt(update);

  const phone = contactPhone(update);
  if (phone !== null) {
    try {
      const replies = await controller.onContact({
        channel: "max",
        updateId: updateId(update, externalUserId),
        senderExternalUserId: externalUserId,
        contact: { externalUserId, phoneNumber: phone },
        receivedAt: now
      });
      await sendReplies(api, externalUserId, replies, options.conversationRecorder);
    } catch (error) {
      if (error instanceof InvalidPhoneNumberError) {
        await api.sendMessage({
          userId: externalUserId,
          text: "Не получилось разобрать номер. Пришлите его ещё раз кнопкой «Поделиться номером»."
        });
        return;
      }
      throw error;
    }
    return;
  }

  const text = (update.message?.body?.text ?? "").trim();

  // `/start` в уже открытом диалоге.
  //
  // Тип `bot_started` MAX присылает только при первом запуске бота. Тот, кто открывал его
  // раньше, набирает `/start` руками — и это приезжает обычным сообщением. Не обработать
  // его значит оставить без ответа всех, кто у нас уже был: именно так и вышло на первом
  // включении канала.
  if (/^\/start(?:\s|$)/.test(text)) {
    await handleStart(api, controller, update, options);
    return;
  }

  if (text === "" || text.startsWith("/")) {
    // Остальные команды бот не знает: у MAX для них нет отдельного типа, а придумывать
    // ответ на незнакомое — плодить впечатление, что команда что-то сделала.
    return;
  }

  const scenarioReplies = await controller.onScenarioInput({
    channel: "max",
    senderExternalUserId: externalUserId,
    updateId: updateId(update, externalUserId),
    text,
    occurredAt: now
  });
  if (scenarioReplies.length > 0) {
    await sendReplies(api, externalUserId, scenarioReplies, options.conversationRecorder);
    return;
  }

  const quantityReplies = await controller.onQuantityText(sender, text, now);
  if (quantityReplies.length > 0) {
    await sendReplies(api, externalUserId, quantityReplies, options.conversationRecorder);
    return;
  }

  const childQuantityReplies = await controller.onChildQuantityText(sender, text, now);
  if (childQuantityReplies.length > 0) {
    await sendReplies(api, externalUserId, childQuantityReplies, options.conversationRecorder);
  }
}

async function sendReplies(
  api: MaxApi,
  userId: string,
  replies: readonly ReplyModel[],
  recorder?: ConversationRecorder
): Promise<void> {
  for (const reply of replies) {
    const buttons = toButtons(reply);
    const sent = await api.sendMessage({
      userId,
      text: reply.text,
      ...(buttons ? { buttons } : {})
    });
    // Запись после отправки: в ленте оказывается только то, что человек получил. Запись
    // до отправки показала бы менеджеру сказанное, которого не было.
    if (recorder) {
      await recordOutgoingMaxMessage(recorder, {
        externalUserId: userId,
        text: reply.text,
        providerMessageId: sent.providerMessageId
      });
    }
  }
}

/**
 * Кнопки ответа в формате MAX.
 *
 * У MAX нет отдельной «клавиатуры под полем ввода», как у Telegram: и обычные действия, и
 * просьба поделиться контактом — это кнопки одного вложения. Поэтому `keyboard: "remove"`
 * здесь нечего убирать и превращается в отсутствие кнопок.
 */
function toButtons(reply: ReplyModel): readonly (readonly MaxButton[])[] | null {
  if (reply.inlineButtons && reply.inlineButtons.length > 0) {
    return reply.inlineButtons.map((button) => [toButton(button)]);
  }
  if (reply.keyboard === "request_contact") {
    return [[{ type: "request_contact", text: "Поделиться номером" }]];
  }
  return null;
}

function toButton(button: InlineButton): MaxButton {
  return "callbackData" in button
    ? { type: "callback", text: button.text, payload: button.callbackData }
    : { type: "link", text: button.text, url: button.url };
}

/** Телефон из вложения `contact`, если человек прислал его кнопкой. */
function contactPhone(update: MaxUpdate): string | null {
  const attachment = update.message?.body?.attachments?.find(
    (item) => item.type === "contact"
  );
  if (!attachment) {
    return null;
  }
  const payload = attachment.payload ?? {};
  const direct = payload["tel"] ?? payload["phone"] ?? payload["phone_number"];
  if (typeof direct === "string" && direct.trim() !== "") {
    return direct.trim();
  }
  // Запасной путь: MAX часто присылает не номер, а карточку vCard целиком.
  const vcf = payload["vcf_info"];
  return typeof vcf === "string" ? phoneFromVcf(vcf) : null;
}

function phoneFromVcf(vcf: string): string | null {
  const match = /TEL[^:]*:\s*([+\d][\d\s()-]{4,})/i.exec(vcf);
  const value = match?.[1]?.trim();
  return value === undefined || value === "" ? null : value;
}

/**
 * Номер обновления для ключа идемпотентности.
 *
 * У MAX своего номера апдейта нет — есть время и, у сообщений, идентификатор `mid`. Ключ
 * собирается из того, что действительно различает события: сообщение опознаётся по `mid`,
 * нажатие кнопки — по `callback_id`, остальное — по человеку и времени. Ключ живёт в своей
 * области `max_update`, поэтому с телеграмными номерами он не столкнётся.
 */
function updateId(update: MaxUpdate, externalUserId: string): string {
  const callbackId = update.callback?.callback_id;
  if (callbackId !== undefined && callbackId !== "") {
    return `cb:${callbackId}`;
  }
  const messageId = update.message?.body?.mid;
  if (messageId !== undefined && messageId !== "") {
    return `msg:${messageId}`;
  }
  return `${update.update_type ?? "update"}:${externalUserId}:${update.timestamp ?? 0}`;
}

function receivedAt(update: MaxUpdate): Date {
  // Время у MAX в миллисекундах, а не в секундах, как у Telegram.
  const timestamp = update.timestamp;
  return typeof timestamp === "number" && Number.isFinite(timestamp)
    ? new Date(timestamp)
    : new Date();
}

function identifier(value: number | string | undefined): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string" && value.trim() !== "") {
    return value.trim();
  }
  return null;
}
