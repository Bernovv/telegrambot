import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  EventParticipantRow,
  EventParticipantsView
} from "@ticket-platform/contracts";
import { buildEventReport } from "./admin-event-report.js";

describe("buildEventReport", () => {
  it("counts the same people the participants tab counts", () => {
    const report = build([
      row({ key: "order:1", origin: "order", attendedAt: "2026-08-21T18:00:00.000Z" }),
      row({ key: "manual:1", channel: "site" }),
      row({ key: "manual:2", channel: "site", attendedAt: "2026-08-21T18:05:00.000Z" })
    ], []);

    assert.equal(report.registered, 3);
    assert.equal(report.attended, 2);
  });

  it("splits by the marketing label and folds the same label written differently", () => {
    // «Instagram» и «instagram» — один канал. Развести их значило бы показать вдвое меньше
    // по каждому и заставить складывать глазами.
    const report = build([
      row({ key: "manual:1", attendedAt: "2026-08-21T18:00:00.000Z" }),
      row({ key: "manual:2" }),
      row({ key: "manual:3", attendedAt: "2026-08-21T18:00:00.000Z" })
    ], [
      { key: "manual:1", contactSource: "Instagram", contactedBefore: false },
      { key: "manual:2", contactSource: "instagram", contactedBefore: false },
      { key: "manual:3", contactSource: "Сайт", contactedBefore: false }
    ]);

    assert.deepEqual(report.byChannel, [
      { key: "Instagram", registered: 2, attended: 1 },
      { key: "Сайт", registered: 1, attended: 1 }
    ]);
  });

  it("keeps the unknown channel last however big it is", () => {
    const report = build([
      row({ key: "manual:1" }),
      row({ key: "manual:2" }),
      row({ key: "manual:3" })
    ], [
      { key: "manual:3", contactSource: "Рекомендация", contactedBefore: false }
    ]);

    // Разрез без метки ничего не объясняет: сверху должно стоять объясняющее, даже когда
    // безымянных больше.
    assert.deepEqual(report.byChannel.map((bucket) => bucket.key), ["Рекомендация", ""]);
  });

  it("treats a person we have no contact for as one we could not have called", () => {
    const report = build([
      row({ key: "manual:1" }),
      row({ key: "manual:2", attendedAt: "2026-08-21T18:00:00.000Z" })
    ], [
      { key: "manual:2", contactSource: null, contactedBefore: true }
    ]);

    assert.deepEqual(report.byOutreach, [
      { key: "called", registered: 1, attended: 1 },
      { key: "not_called", registered: 1, attended: 0 }
    ]);
  });

  it("labels a paid bot order as its own entry, not as a participant source", () => {
    const report = build([
      row({ key: "order:1", origin: "order", channel: "telegram" }),
      row({ key: "manual:1", channel: "direct" })
    ], []);

    assert.deepEqual(report.byEntry.map((bucket) => bucket.key).sort(), ["direct", "order"]);
  });
});

function build(
  rows: readonly EventParticipantRow[],
  attribution: readonly {
    readonly key: string;
    readonly contactSource: string | null;
    readonly contactedBefore: boolean;
  }[]
) {
  return buildEventReport({
    view: view(rows),
    attribution,
    siteRequests: { total: 4, duplicates: 1 },
    calculatedAt: new Date("2026-08-21T20:00:00.000Z")
  });
}

function view(rows: readonly EventParticipantRow[]): EventParticipantsView {
  return {
    eventId: "00000000-0000-4000-8000-000000000101",
    eventTitle: "Среда",
    calculatedAt: "2026-08-21T20:00:00.000Z",
    totals: {
      people: rows.length,
      adults: rows.length,
      children: 0,
      sleepingPlaces: 0,
      guests: rows.length,
      fromOrders: 0,
      fromManual: rows.length,
      amountKopecks: "0"
    },
    rows,
    excludedOrders: 0,
    fields: [],
    questionnaire: { people: rows.length, answered: 0 },
    attendance: {
      registered: rows.length,
      attended: rows.filter((row) => row.attendedAt !== null).length
    },
    canManageParticipants: true
  };
}

function row(
  overrides: Partial<EventParticipantRow> & { readonly key: string }
): EventParticipantRow {
  return {
    origin: "manual",
    orderId: null,
    orderNumber: null,
    participantId: "00000000-0000-4000-8000-000000000201",
    channel: "site",
    displayName: "Анна",
    phone: null,
    email: null,
    telegramUsername: null,
    ticketTitle: "",
    adults: 1,
    children: 0,
    sleepingPlaces: 0,
    amountKopecks: null,
    paidAt: null,
    paymentMethod: null,
    note: "",
    attendedAt: null,
    customFields: [],
    ...overrides
  };
}
