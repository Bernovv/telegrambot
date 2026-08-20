import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addHoursIso,
  durationHours,
  isoToZoned,
  suggestSlug,
  zonedToIso
} from "./event-schedule";

describe("zonedToIso", () => {
  it("подставляет смещение часового пояса мероприятия", () => {
    assert.equal(
      zonedToIso({ date: "2026-08-26", time: "19:00" }, "Europe/Moscow"),
      "2026-08-26T19:00:00+03:00"
    );
  });

  it("считает смещение для летнего и зимнего времени по-разному", () => {
    assert.equal(
      zonedToIso({ date: "2026-07-01", time: "19:00" }, "Europe/Berlin"),
      "2026-07-01T19:00:00+02:00"
    );
    assert.equal(
      zonedToIso({ date: "2026-01-15", time: "19:00" }, "Europe/Berlin"),
      "2026-01-15T19:00:00+01:00"
    );
  });

  it("отказывается от пустых и неполных значений", () => {
    assert.equal(zonedToIso({ date: "", time: "19:00" }, "Europe/Moscow"), null);
    assert.equal(zonedToIso({ date: "2026-08-26", time: "" }, "Europe/Moscow"), null);
    assert.equal(
      zonedToIso({ date: "2026-08-26", time: "19:00" }, "Нет/Такого"),
      null
    );
  });
});

describe("addHoursIso", () => {
  it("прибавляет длительность и остаётся в поясе мероприятия", () => {
    assert.equal(
      addHoursIso("2026-08-26T19:00:00+03:00", 3, "Europe/Moscow"),
      "2026-08-26T22:00:00+03:00"
    );
  });

  it("переносит окончание на следующие сутки", () => {
    assert.equal(
      addHoursIso("2026-08-26T23:00:00+03:00", 3, "Europe/Moscow"),
      "2026-08-27T02:00:00+03:00"
    );
  });

  it("не принимает нулевую и отрицательную длительность", () => {
    assert.equal(addHoursIso("2026-08-26T19:00:00+03:00", 0, "Europe/Moscow"), null);
    assert.equal(addHoursIso("2026-08-26T19:00:00+03:00", -2, "Europe/Moscow"), null);
  });
});

describe("isoToZoned", () => {
  it("разбирает момент обратно в календарь и часы", () => {
    assert.deepEqual(isoToZoned("2026-08-26T19:00:00+03:00", "Europe/Moscow"), {
      date: "2026-08-26",
      time: "19:00"
    });
  });

  it("показывает время в поясе мероприятия, а не в поясе браузера", () => {
    assert.deepEqual(isoToZoned("2026-08-26T16:00:00Z", "Europe/Moscow"), {
      date: "2026-08-26",
      time: "19:00"
    });
  });

  it("на пустом значении отдаёт пустые поля", () => {
    assert.deepEqual(isoToZoned(null, "Europe/Moscow"), { date: "", time: "" });
  });
});

describe("durationHours", () => {
  it("считает длительность встречи", () => {
    assert.equal(
      durationHours("2026-08-26T19:00:00+03:00", "2026-08-26T22:00:00+03:00"),
      3
    );
  });

  it("возвращает пусто, если окончания нет или оно раньше начала", () => {
    assert.equal(durationHours("2026-08-26T19:00:00+03:00", null), null);
    assert.equal(
      durationHours("2026-08-26T19:00:00+03:00", "2026-08-26T18:00:00+03:00"),
      null
    );
  });
});

describe("suggestSlug", () => {
  it("переводит кириллицу и добавляет дату", () => {
    assert.equal(
      suggestSlug("Среда предпринимателя", "2026-08-26"),
      "sreda-predprinimatelya-2026-08-26"
    );
  });

  it("выбрасывает знаки препинания и повторные дефисы", () => {
    assert.equal(
      suggestSlug("Бизнес-Пикник: 2026!", "2026-08-08"),
      "biznes-piknik-2026-2026-08-08"
    );
  });

  it("обходится одной датой, когда из названия ничего не осталось", () => {
    assert.equal(suggestSlug("!!!", "2026-08-26"), "2026-08-26");
  });
});
