import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  askCityReply,
  askFocusAreaReply,
  askJoinChatReply,
  askNicheReply,
  askStageReply,
  askWishReply,
  catalogUnavailableReply,
  chooseFamilyTicketReply,
  chooseTicketReply,
  contactUsReply,
  enterChildQuantityReply,
  enterQuantityReply,
  faqReply,
  invalidQuestionnaireTextReply,
  mainMenuButtons,
  menuReply,
  myBonusesReply,
  myBonusesUnavailableReply,
  noActiveDraftReply,
  orderInterimSummaryReply,
  orderOfferStepReply,
  partnerLinkReply,
  partnerProgramReply,
  programAndPricingReply,
  questionnaireCompletedReply,
  questionnaireUnavailableReply
} from "./scenario-content.js";

describe("scenario-content", () => {
  it("shows the five BOT_FLOWS.md main menu entries", () => {
    const buttons = mainMenuButtons();
    const labels = buttons.map((button) => button.text);

    assert.deepEqual(labels, [
      "Программа",
      "Тарифы",
      "Купить билет",
      "Партнёрская программа",
      "Связаться с нами"
    ]);
  });

  it("prices Standard and VIP tiers exactly as documented in BOT_FLOWS.md", () => {
    const { text } = programAndPricingReply();

    assert.match(text, /1 билет — 2490 ₽\/чел/);
    assert.match(text, /3-4 билета — 1990 ₽\/чел/);
    assert.match(text, /5\+ билетов — 1710 ₽\/чел/);
    assert.match(text, /детский билет — 490 ₽/);
    assert.match(text, /семейный \(2 взрослых \+ ребёнок\) — 3990 ₽/);

    assert.match(text, /1 билет — 3990 ₽\/чел/);
    assert.match(text, /2 билета — 3745 ₽\/чел/);
    assert.match(text, /3 билета — 2830 ₽\/чел/);
    assert.match(text, /4 билета — 2750 ₽\/чел/);
    assert.match(text, /5\+ билетов — 2600 ₽\/чел/);
    assert.match(text, /семейный \(2 взрослых \+ ребёнок\) — 6490 ₽/);
  });

  it("routes program, FAQ, and buy-ticket screens back to contact/menu, never a dead end", () => {
    for (const reply of [programAndPricingReply(), faqReply(), chooseTicketReply(), partnerProgramReply()]) {
      assert.ok(reply.inlineButtons && reply.inlineButtons.length > 0);
    }
  });

  it("offers Все включено / Стандартный / Семейный when buying a ticket", () => {
    const labels = chooseTicketReply().inlineButtons?.map((button) => button.text);
    assert.deepEqual(labels, ["Все включено", "Стандартный", "Семейный", "Назад"]);
  });

  it("asks Все включено or Стандарт for the family bundle", () => {
    const labels = chooseFamilyTicketReply().inlineButtons?.map((button) => button.text);
    assert.deepEqual(labels, ["Все включено", "Стандарт", "Назад"]);
  });

  it("names the chosen tariff when asking for a headcount", () => {
    assert.match(enterQuantityReply("Стандарт").text, /Тариф «Стандарт»/);
  });

  it("offers to add or skip a child ticket after the adult headcount is entered", () => {
    const reply = orderInterimSummaryReply("Стандарт", 3);
    assert.match(reply.text, /взрослых билетов: 3/);
    assert.deepEqual(reply.inlineButtons?.map((b) => b.text), ["Добавить детский билет", "Без детского билета"]);
  });

  it("не подставляет ссылку, если версия оферты не опубликована", () => {
    const reply = orderOfferStepReply({
      ticketLabel: "Стандарт",
      adultQuantity: 1,
      childQuantity: 0,
      totalKopecks: "249000",
      publicToken: "token-abc",
      offerUrl: null
    });

    assert.doesNotMatch(reply.text, /https:\/\//);
    assert.match(reply.text, /условия оферты/);
  });

  it("always offers a way to skip the child-ticket prompt", () => {
    assert.ok(enterChildQuantityReply().inlineButtons?.some((b) => b.text === "Без детского билета"));
  });

  it("shows the total, the offer link, and an offer_accept callback matching the existing grammy.ts handler", () => {
    const reply = orderOfferStepReply({
      ticketLabel: "Стандарт",
      adultQuantity: 3,
      childQuantity: 2,
      totalKopecks: "597000",
      publicToken: "token-abc",
      offerUrl: "https://max-bot.biz-day.ru/offer/business-picnic-2026-v1.pdf"
    });

    assert.match(reply.text, /Сумма: 5970 ₽/);
    assert.match(reply.text, /offer\/business-picnic-2026-v1\.pdf/);
    assert.deepEqual(reply.inlineButtons, [
      { text: "Я соглашаюсь с условиями оферты", callbackData: "offer_accept:token-abc" }
    ]);
  });

  it("never leaves the user stuck when the catalog is unavailable or the draft was lost", () => {
    assert.ok(catalogUnavailableReply().inlineButtons?.length);
    assert.ok(noActiveDraftReply().inlineButtons?.length);
  });

  it("builds a partner link from the referrer's own Telegram user ID, with no new storage", () => {
    const reply = partnerLinkReply("123456789", "business_proriv_bot");

    assert.equal(reply.text, "Ваша партнёрская ссылка 🔗\nhttps://t.me/business_proriv_bot?start=partner_123456789");
  });

  it("asks the user to try again later when the bot username is not yet known", () => {
    const reply = partnerLinkReply("123456789", null);

    assert.doesNotMatch(reply.text, /https:\/\//);
  });

  it("menu and contact-us replies always give the user a way back or forward", () => {
    assert.ok(menuReply().inlineButtons?.length);
    assert.ok(contactUsReply().inlineButtons?.length);
  });

  it("ведёт к менеджеру ссылкой и оставляет запасной путь текстом", () => {
    const reply = contactUsReply();
    const managerButton = reply.inlineButtons?.find((button) => button.text === "Написать менеджеру");

    assert.ok(managerButton && "url" in managerButton);
    assert.equal(managerButton.url, "tg://user?id=7490389949");
    // Ссылка по числовому ID срабатывает не у всех — настройки приватности адресата могут её
    // запретить. Поэтому в тексте обязательно остаётся вариант «спросить прямо здесь».
    assert.match(reply.text, /прямо здесь/);
  });

  it("states the actual 7/10/15% referral tiers and offers a bonus-balance screen", () => {
    const reply = partnerProgramReply();
    assert.match(reply.text, /7%/);
    assert.match(reply.text, /10%/);
    assert.match(reply.text, /15%/);
    assert.deepEqual(reply.inlineButtons?.map((b) => b.text), [
      "Получить партнёрскую ссылку",
      "Мои бонусы",
      "Назад"
    ]);
  });

  it("shows balance, qualifying referrals, and tier percent, with next-tier progress when not at the top", () => {
    const reply = myBonusesReply({
      availableKopecks: "139300",
      qualifyingReferrals: 12,
      tierNumber: 2,
      percentBasisPoints: 1000,
      referralsToNextTier: 18
    });

    assert.match(reply.text, /Баланс: 1393 ₽/);
    assert.match(reply.text, /Оплативших приглашённых: 12/);
    assert.match(reply.text, /уровень: 2 \(10% с заказа\)/);
    assert.match(reply.text, /До следующего уровня: 18/);
  });

  it("omits next-tier progress at the top tier", () => {
    const reply = myBonusesReply({
      availableKopecks: "0",
      qualifyingReferrals: 40,
      tierNumber: 3,
      percentBasisPoints: 1500,
      referralsToNextTier: null
    });

    assert.doesNotMatch(reply.text, /До следующего уровня/);
  });

  it("asks the user to /start first when bonuses cannot be looked up", () => {
    assert.ok(myBonusesUnavailableReply().inlineButtons?.length);
  });

  it("asks city, niche, and the post-event wish as free text, with no buttons", () => {
    assert.equal(askCityReply().inlineButtons, undefined);
    assert.equal(askNicheReply().inlineButtons, undefined);
    assert.equal(askWishReply().inlineButtons, undefined);
  });

  it("offers the five documented stages as buttons with the exact stage slugs", () => {
    const labels = askStageReply().inlineButtons?.map((b) => b.text);
    assert.deepEqual(labels, [
      "Только собираю продукт",
      "Уже есть продукт/услуга",
      "Есть клиенты, хочу больше структуры",
      "Хочу усилить продажи",
      "Хочу окружение и перезагрузку"
    ]);
    const callbacks = askStageReply().inlineButtons?.map((b) => ("callbackData" in b ? b.callbackData : ""));
    assert.deepEqual(callbacks, [
      "anketa_stage:only_building_product",
      "anketa_stage:have_product_or_service",
      "anketa_stage:have_clients_want_structure",
      "anketa_stage:want_more_sales",
      "anketa_stage:want_environment_reset"
    ]);
  });

  it("offers the six documented focus areas as buttons with the exact focus slugs", () => {
    const callbacks = askFocusAreaReply().inlineButtons?.map((b) => ("callbackData" in b ? b.callbackData : ""));
    assert.deepEqual(callbacks, [
      "anketa_focus:packaging",
      "anketa_focus:content",
      "anketa_focus:sales",
      "anketa_focus:positioning",
      "anketa_focus:energy_resource",
      "anketa_focus:environment"
    ]);
  });

  it("asks yes/no for joining the participant chat", () => {
    const callbacks = askJoinChatReply().inlineButtons?.map((b) => ("callbackData" in b ? b.callbackData : ""));
    assert.deepEqual(callbacks, ["anketa_join_chat:yes", "anketa_join_chat:no"]);
  });

  it("gives a way to try again when free text is invalid", () => {
    assert.ok(invalidQuestionnaireTextReply().text.length > 0);
  });

  it("thanks the user differently depending on whether they want the participant chat", () => {
    assert.match(questionnaireCompletedReply(true).text, /добавим вас в чат/);
    assert.doesNotMatch(questionnaireCompletedReply(false).text, /добавим вас в чат/);
    assert.deepEqual(questionnaireCompletedReply(true).inlineButtons, mainMenuButtons());
  });

  it("never leaves the user stuck when the questionnaire is unavailable", () => {
    assert.ok(questionnaireUnavailableReply().inlineButtons?.length);
  });
});
