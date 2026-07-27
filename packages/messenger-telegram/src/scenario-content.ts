import type { TelegramInlineButton, TelegramReplyModel } from "./controller.js";

/**
 * Static conversational content for the Business Picnic sales funnel (docs/bots/BOT_FLOWS.md).
 *
 * This mirrors the copy already shipped and running in the MAX bot
 * (max-bot/src/domain/messages.ts) so both channels show the same program, pricing, FAQ, and
 * partner-program text. Ticket type / quantity / child-ticket / offer screens here are rendered
 * from `TelegramPurchaseFlowService` results (Phase 2, packages/application/src/telegram-purchase-flow.ts)
 * — this module only builds the `TelegramReplyModel`, it holds no state of its own.
 */

/** Same Google Doc as DEFAULT_OFFER_SOURCE_URL (.env.example) and the catalog seed migration. */
const OFFER_URL =
  "https://docs.google.com/document/d/1rNFUhIlL2ZNp8dY9gOdycmYYXmlP3iJZpA7laW9HMBI/edit?tab=t.0";

const STANDARD_PRICES: readonly { readonly label: string; readonly pricePerPerson: number }[] = [
  { label: "1 билет", pricePerPerson: 2490 },
  { label: "3-4 билета", pricePerPerson: 1990 },
  { label: "5+ билетов", pricePerPerson: 1710 }
];

const VIP_PRICES: readonly { readonly label: string; readonly pricePerPerson: number }[] = [
  { label: "1 билет", pricePerPerson: 3990 },
  { label: "2 билета", pricePerPerson: 3745 },
  { label: "3 билета", pricePerPerson: 2830 },
  { label: "4 билета", pricePerPerson: 2750 },
  { label: "5+ билетов", pricePerPerson: 2600 }
];

const CHILD_TICKET_PRICE = 490;
const FAMILY_STANDARD_PRICE = 3990;
const FAMILY_VIP_PRICE = 6490;

export function mainMenuButtons(): readonly TelegramInlineButton[] {
  return [
    { text: "Программа", callbackData: "program" },
    { text: "Тарифы", callbackData: "pricing" },
    { text: "Купить билет", callbackData: "buy_ticket" },
    { text: "Партнёрская программа", callbackData: "partner_program" },
    { text: "Связаться с нами", callbackData: "contact_us" }
  ];
}

function afterProgramButtons(): readonly TelegramInlineButton[] {
  return [
    { text: "Купить билет", callbackData: "buy_ticket" },
    { text: "Частые вопросы", callbackData: "faq" },
    { text: "Связаться с нами", callbackData: "contact_us" },
    { text: "Назад", callbackData: "start" }
  ];
}

export function menuReply(): TelegramReplyModel {
  return {
    text: "Что подсказать?",
    inlineButtons: mainMenuButtons()
  };
}

export function programAndPricingReply(): TelegramReplyModel {
  const standardLines = STANDARD_PRICES
    .map((tier) => `${tier.label} — ${tier.pricePerPerson} ₽/чел`)
    .join("\n");
  const vipLines = VIP_PRICES
    .map((tier) => `${tier.label} — ${tier.pricePerPerson} ₽/чел`)
    .join("\n");

  return {
    text: [
      "Формат: 2 дня / 1 ночь на берегу Ладожского озера.",
      "",
      "В программе:",
      "— выступления экспертов",
      "— нетворкинг",
      "— бизнес-игры",
      "— баня",
      "— йога и мягкие телесные практики",
      "— вечер у костра",
      "— музыка, танцы и живое общение",
      "— питание и пространство для отдыха",
      "",
      "Стоимость участия указана за два дня. Питание включено во все билеты.",
      "",
      "Стандарт:",
      standardLines,
      `детский билет — ${CHILD_TICKET_PRICE} ₽`,
      `семейный (2 взрослых + ребёнок) — ${FAMILY_STANDARD_PRICE} ₽`,
      "",
      "Все включено:",
      vipLines,
      `семейный (2 взрослых + ребёнок) — ${FAMILY_VIP_PRICE} ₽`,
      "",
      "В тариф «Все включено» входит спальное место в палатке: палатка, пенка, спальный мешок."
    ].join("\n"),
    inlineButtons: afterProgramButtons()
  };
}

export function faqReply(): TelegramReplyModel {
  return {
    text: [
      "Частые вопросы:",
      "",
      "Мне подойдёт, если у меня ещё нет бизнеса?",
      "Да. Уикенд создан и для тех, кто только думает о своём деле, ищет направление, хочет понять свою экспертность или пока не знает, как упаковаться и начать проявляться.",
      "",
      "Это больше про отдых или про бизнес?",
      "Это соединение отдыха, окружения и работы над проектом без жёсткого давления. Будут выступления, нетворкинг, бизнес-игры, баня, вечер у костра и пространство для перезагрузки.",
      "",
      "Нужно ли заранее готовиться?",
      "Нет. Можно приехать без готового продукта, блога или большого опыта продаж.",
      "",
      "Что я получу после уикенда?",
      "Больше ясности в упаковке, контенте, продажах и следующем шаге, новые знакомства и ощущение опоры в своём проекте.",
      "",
      "Сколько человек будет на уикенде?",
      "Места продаём без жёсткого лимита, по максимуму. Если лимит изменится, сообщим отдельно.",
      "",
      "Что входит в стоимость участия?",
      "Участие в программе на два дня и питание. В тариф «Все включено» также входит спальное место в палатке: палатка, пенка и спальный мешок."
    ].join("\n"),
    inlineButtons: afterProgramButtons()
  };
}

export function contactUsReply(): TelegramReplyModel {
  return {
    text: "Напишите вопрос одним сообщением — мы читаем этот чат и ответим здесь как можно быстрее.",
    inlineButtons: [{ text: "Назад", callbackData: "start" }]
  };
}

export function chooseTicketReply(): TelegramReplyModel {
  return {
    text: "Выберите тип билета:",
    inlineButtons: [
      { text: "Все включено", callbackData: "ticket_vip" },
      { text: "Стандартный", callbackData: "ticket_standard" },
      { text: "Семейный", callbackData: "ticket_family" },
      { text: "Назад", callbackData: "start" }
    ]
  };
}

export function chooseFamilyTicketReply(): TelegramReplyModel {
  return {
    text: "Семейный тариф — 2 взрослых + ребёнок. Какой формат?",
    inlineButtons: [
      { text: "Все включено", callbackData: "ticket_family_vip" },
      { text: "Стандарт", callbackData: "ticket_family_standard" },
      { text: "Назад", callbackData: "buy_ticket" }
    ]
  };
}

export function enterQuantityReply(ticketLabel: string): TelegramReplyModel {
  return { text: `Тариф «${ticketLabel}». Сколько человек? Введите число.` };
}

export function invalidQuantityReply(): TelegramReplyModel {
  return {
    text: "Введите количество человек целым числом от 1 до 50.",
    inlineButtons: [{ text: "Назад", callbackData: "buy_ticket" }]
  };
}

export function orderInterimSummaryReply(ticketLabel: string, adultQuantity: number): TelegramReplyModel {
  return {
    text: [
      `Тариф «${ticketLabel}», взрослых билетов: ${adultQuantity}.`,
      "",
      `Добавить детский билет? ${CHILD_TICKET_PRICE} ₽ за ребёнка.`
    ].join("\n"),
    inlineButtons: [
      { text: "Добавить детский билет", callbackData: "add_child_ticket" },
      { text: "Без детского билета", callbackData: "skip_child_ticket" }
    ]
  };
}

export function enterChildQuantityReply(): TelegramReplyModel {
  return {
    text: "Сколько детских билетов? Введите число.",
    inlineButtons: [{ text: "Без детского билета", callbackData: "skip_child_ticket" }]
  };
}

export function invalidChildQuantityReply(): TelegramReplyModel {
  return { text: "Введите количество детских билетов целым числом от 0 до 50." };
}

export function catalogUnavailableReply(): TelegramReplyModel {
  return {
    text: "Онлайн-оформление сейчас недоступно. Напишите нам — оформим бронь вручную.",
    inlineButtons: [{ text: "Связаться с нами", callbackData: "contact_us" }]
  };
}

export function noActiveDraftReply(): TelegramReplyModel {
  return {
    text: "Начнём заново — выберите тип билета.",
    inlineButtons: [{ text: "Купить билет", callbackData: "buy_ticket" }]
  };
}

/**
 * Order summary + offer link, with the SAME `offer_accept:<token>` callback data the existing
 * grammy.ts handler already answers — Phase 2 does not add a new offer-acceptance path, it only
 * produces the token that flow expects.
 */
export function orderOfferStepReply(input: {
  readonly ticketLabel: string;
  readonly adultQuantity: number;
  readonly childQuantity: number;
  readonly totalKopecks: string;
  readonly publicToken: string;
}): TelegramReplyModel {
  const lines = [
    "Ваш заказ:",
    `Тариф: ${input.ticketLabel}`,
    `Взрослых билетов: ${input.adultQuantity}`
  ];
  if (input.childQuantity > 0) {
    lines.push(`Детских билетов: ${input.childQuantity}`);
  }
  lines.push(`Сумма: ${formatRubles(input.totalKopecks)} ₽`);
  lines.push("");
  lines.push("Перед оплатой нужно принять условия оферты:");
  lines.push(OFFER_URL);

  return {
    text: lines.join("\n"),
    inlineButtons: [
      { text: "Я соглашаюсь с условиями оферты", callbackData: `offer_accept:${input.publicToken}` }
    ]
  };
}

function formatRubles(kopecksText: string): string {
  const kopecks = BigInt(kopecksText);
  const rubles = kopecks / 100n;
  const remainder = kopecks % 100n;
  return remainder === 0n ? rubles.toString() : `${rubles},${remainder.toString().padStart(2, "0")}`;
}

export function partnerProgramReply(): TelegramReplyModel {
  return {
    text: [
      "Приглашайте друзей, коллег и свою аудиторию на Бизнес-Пикник.",
      "",
      "Мы закрепим за вами индивидуальную партнёрскую ссылку. Все переходы и покупки по ней будут привязаны к вам в базе.",
      "",
      "Вознаграждение — процент от суммы каждого оплаченного заказа приглашённых:",
      "1-9 оплативших приглашённых — 7%",
      "10-29 — 10%",
      "30+ — 15%",
      "",
      "Уровень считается по количеству уникальных приглашённых с хотя бы одним оплаченным заказом."
    ].join("\n"),
    inlineButtons: [
      { text: "Получить партнёрскую ссылку", callbackData: "get_partner_link" },
      { text: "Мои бонусы", callbackData: "my_bonuses" },
      { text: "Назад", callbackData: "start" }
    ]
  };
}

/** "Мои бонусы" — wallet balance and current referral tier (Phase 3, packages/application/src/referral-balance.ts). */
export function myBonusesReply(input: {
  readonly availableKopecks: string;
  readonly qualifyingReferrals: number;
  readonly tierNumber: number;
  readonly percentBasisPoints: number;
  readonly referralsToNextTier: number | null;
}): TelegramReplyModel {
  const lines = [
    `Баланс: ${formatRubles(input.availableKopecks)} ₽`,
    `Оплативших приглашённых: ${input.qualifyingReferrals}`,
    `Ваш текущий уровень: ${input.tierNumber} (${input.percentBasisPoints / 100}% с заказа)`
  ];
  if (input.referralsToNextTier !== null) {
    lines.push(`До следующего уровня: ${input.referralsToNextTier}`);
  }

  return {
    text: lines.join("\n"),
    inlineButtons: [{ text: "Назад", callbackData: "partner_program" }]
  };
}

export function myBonusesUnavailableReply(): TelegramReplyModel {
  return {
    text: "Сначала откройте меню командой /start.",
    inlineButtons: [{ text: "Назад", callbackData: "start" }]
  };
}

/**
 * The referrer's own Telegram numeric user ID doubles as the partner code. It is stable, already
 * unique per `messenger_identities` row, and requires no new column or migration: when someone
 * opens `t.me/<bot>?start=partner_<code>`, `parseStartPayload` (packages/domain/src/messenger.ts)
 * already extracts `partnerCode` and `HandleTelegramStartService` already records it as a
 * touchpoint. Resolving the code back to its owner (to credit a referral commission) is Phase 3
 * work — see packages/database messenger_identities lookup by (channel, external_user_id).
 */
/**
 * The 7-question participant questionnaire (Phase 4, docs/bots/BOT_FLOWS.md "После оплаты" →
 * "Анкета участника"). Question 1 ("Как вас зовут?") is asked in the intro push message sent by
 * the worker (packages/application/src/notification-delivery.ts formatQuestionnaireIntroMessage),
 * not here — everything after that is driven by TelegramQuestionnaireService results.
 */
export function askCityReply(): TelegramReplyModel {
  return { text: "Из какого вы города?" };
}

export function askNicheReply(): TelegramReplyModel {
  return { text: "Чем занимаетесь? Какая ниша?" };
}

export function askStageReply(): TelegramReplyModel {
  return {
    text: "На каком вы этапе?",
    inlineButtons: [
      { text: "Только собираю продукт", callbackData: "anketa_stage:only_building_product" },
      { text: "Уже есть продукт/услуга", callbackData: "anketa_stage:have_product_or_service" },
      { text: "Есть клиенты, хочу больше структуры", callbackData: "anketa_stage:have_clients_want_structure" },
      { text: "Хочу усилить продажи", callbackData: "anketa_stage:want_more_sales" },
      { text: "Хочу окружение и перезагрузку", callbackData: "anketa_stage:want_environment_reset" }
    ]
  };
}

export function askWishReply(): TelegramReplyModel {
  return { text: "С чем хотите уехать после пикника?" };
}

export function askFocusAreaReply(): TelegramReplyModel {
  return {
    text: "Что сейчас больше всего хочется прояснить?",
    inlineButtons: [
      { text: "Упаковка", callbackData: "anketa_focus:packaging" },
      { text: "Контент", callbackData: "anketa_focus:content" },
      { text: "Продажи", callbackData: "anketa_focus:sales" },
      { text: "Позиционирование", callbackData: "anketa_focus:positioning" },
      { text: "Энергия/ресурс", callbackData: "anketa_focus:energy_resource" },
      { text: "Окружение", callbackData: "anketa_focus:environment" }
    ]
  };
}

export function askJoinChatReply(): TelegramReplyModel {
  return {
    text: "Добавить вас в чат участников?",
    inlineButtons: [
      { text: "Да", callbackData: "anketa_join_chat:yes" },
      { text: "Нет", callbackData: "anketa_join_chat:no" }
    ]
  };
}

export function invalidQuestionnaireTextReply(): TelegramReplyModel {
  return { text: "Пожалуйста, ответьте текстом одним сообщением." };
}

export function questionnaireCompletedReply(joinChat: boolean): TelegramReplyModel {
  return {
    text: joinChat
      ? "Спасибо! Анкета сохранена — добавим вас в чат участников ближе к событию."
      : "Спасибо! Анкета сохранена.",
    inlineButtons: mainMenuButtons()
  };
}

export function questionnaireUnavailableReply(): TelegramReplyModel {
  return {
    text: "Анкета уже заполнена или недоступна.",
    inlineButtons: [{ text: "Назад", callbackData: "start" }]
  };
}

export function partnerLinkReply(externalUserId: string, botUsername: string | null): TelegramReplyModel {
  if (!botUsername) {
    return {
      text: "Бот пока не сообщил свой username — попробуйте ещё раз через пару минут."
    };
  }

  return {
    text: `Ваша партнёрская ссылка:\nhttps://t.me/${botUsername}?start=partner_${externalUserId}`,
    inlineButtons: [{ text: "Назад", callbackData: "start" }]
  };
}

