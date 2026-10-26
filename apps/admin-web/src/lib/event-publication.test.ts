import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminEventDetail } from "@ticket-platform/contracts/admin-events";
import { eventPublicationRequirements } from "./event-publication";

/** Только поля, которые смотрит проверка; остальное в карточке ей не нужно. */
function event(overrides: Partial<AdminEventDetail>): AdminEventDetail {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Мастер-класс Ивана Чурсина",
    startsAt: "2026-10-28T16:00:00.000Z",
    isFree: false,
    supportContact: null,
    products: [],
    publishedScenarioVersionId: null,
    offerRequired: false,
    activeOfferVersionId: null,
    ...overrides
  } as unknown as AdminEventDetail;
}

describe("что нужно мероприятию до публикации", () => {
  it("бесплатному хватает названия и даты", () => {
    // Сервер у бесплатного мероприятия больше ничего не требует. Панель требовала продукты,
    // цены, сценарий и контакт поддержки — и кнопка стояла серой у городской встречи.
    const requirements = eventPublicationRequirements(event({ isFree: true }));

    assert.ok(requirements.every((requirement) => requirement.ready));
    assert.equal(
      requirements.some((requirement) => requirement.label === "Активный продукт"),
      false
    );
  });

  it("бесплатному без даты публиковаться всё равно нельзя", () => {
    const requirements = eventPublicationRequirements(event({ isFree: true, startsAt: "" }));

    assert.equal(requirements.every((requirement) => requirement.ready), false);
  });

  it("платному по-прежнему нужны продукт, цена, сценарий и контакт поддержки", () => {
    const missing = eventPublicationRequirements(event({ isFree: false }))
      .filter((requirement) => !requirement.ready)
      .map((requirement) => requirement.label);

    assert.deepEqual(missing, [
      "Контакт поддержки",
      "Активный продукт",
      "Цена каждого активного продукта",
      "Опубликованный сценарий"
    ]);
  });
});
