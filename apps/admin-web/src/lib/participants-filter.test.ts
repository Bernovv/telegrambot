import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EventParticipantRow } from "@ticket-platform/contracts/admin-participants";
import {
  EMPTY_PARTICIPANTS_FILTER,
  filterParticipants,
  ticketTitlesOf
} from "./participants-filter.js";

describe("filterParticipants", () => {
  it("finds a person by the phone dictated with brackets and dashes", () => {
    const rows = [row({ phone: "+79001234567" }), row({ key: "b", phone: null })];

    const found = filterParticipants(rows, {
      ...EMPTY_PARTICIPANTS_FILTER,
      search: "(900) 123-45-67"
    });

    assert.deepEqual(found.map((item) => item.key), ["a"]);
  });

  it("does not match everyone on a one-digit search", () => {
    const rows = [row({ phone: "+79001234567" }), row({ key: "b", phone: "+79007654321" })];

    const found = filterParticipants(rows, {
      ...EMPTY_PARTICIPANTS_FILTER,
      search: "7"
    });

    assert.equal(found.length, 0);
  });

  it("searches the name, the nickname and the order number", () => {
    const rows = [
      row({ displayName: "Иван Петров" }),
      row({ key: "b", displayName: "Заказ BP-0042", orderNumber: "BP-0042" }),
      row({ key: "c", telegramUsername: "maria_bp" })
    ];

    const byName = filterParticipants(rows, { ...EMPTY_PARTICIPANTS_FILTER, search: "петров" });
    const byOrder = filterParticipants(rows, { ...EMPTY_PARTICIPANTS_FILTER, search: "bp-0042" });
    const byNick = filterParticipants(rows, { ...EMPTY_PARTICIPANTS_FILTER, search: "maria" });

    assert.deepEqual(byName.map((item) => item.key), ["a"]);
    assert.deepEqual(byOrder.map((item) => item.key), ["b"]);
    assert.deepEqual(byNick.map((item) => item.key), ["c"]);
  });

  it("combines the channel, tariff, sleeping and children filters", () => {
    const rows = [
      row({ channel: "telegram", ticketTitle: "Все включено", sleepingPlaces: 2, children: 1 }),
      row({ key: "b", channel: "max", ticketTitle: "Все включено", sleepingPlaces: 2, children: 1 }),
      row({ key: "c", channel: "telegram", ticketTitle: "Стандарт", sleepingPlaces: 0, children: 0 })
    ];

    const found = filterParticipants(rows, {
      search: "",
      channel: "telegram",
      ticketTitle: "Все включено",
      sleepingOnly: true,
      withChildrenOnly: true
    });

    assert.deepEqual(found.map((item) => item.key), ["a"]);
  });
});

describe("ticketTitlesOf", () => {
  it("lists each tariff once, alphabetically, skipping the blank ones", () => {
    const rows = [
      row({ ticketTitle: "Стандарт" }),
      row({ key: "b", ticketTitle: "Все включено" }),
      row({ key: "c", ticketTitle: "Стандарт" }),
      row({ key: "d", ticketTitle: "" })
    ];

    assert.deepEqual(ticketTitlesOf(rows), ["Все включено", "Стандарт"]);
  });
});

function row(overrides: Partial<EventParticipantRow>): EventParticipantRow {
  return {
    key: "a",
    origin: "order",
    orderId: "019c0123-4567-789a-bcde-f0123456789c",
    orderNumber: "BP-0001",
    participantId: null,
    channel: "telegram",
    displayName: "Иван",
    phone: "+79000000000",
    email: null,
    telegramUsername: null,
    ticketTitle: "Стандарт",
    adults: 1,
    children: 0,
    sleepingPlaces: 0,
    amountKopecks: "249000",
    paidAt: "2026-08-01T10:00:00.000Z",
    paymentMethod: null,
    note: "",
    customFields: [],
    ...overrides
  };
}
