import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextCallSlot } from "./call-window.js";

const MOSCOW = { startHour: 12, endHour: 19, timeZone: "Europe/Moscow" };

describe("окно обзвона", () => {
  it("до окна двигает срок на его начало в тот же день", () => {
    // 10:00 по Москве — это 07:00 UTC.
    const slot = nextCallSlot(new Date("2026-08-21T07:00:00.000Z"), MOSCOW);
    assert.equal(slot.toISOString(), "2026-08-21T09:00:00.000Z");
  });

  it("внутри окна звонить надо сейчас", () => {
    const now = new Date("2026-08-21T11:20:00.000Z");
    assert.equal(nextCallSlot(now, MOSCOW).toISOString(), now.toISOString());
  });

  it("после окна переносит на завтра", () => {
    // 21:00 по Москве.
    const slot = nextCallSlot(new Date("2026-08-21T18:00:00.000Z"), MOSCOW);
    assert.equal(slot.toISOString(), "2026-08-22T09:00:00.000Z");
  });

  it("ночная заявка достаётся сегодняшнему утру, а не вчерашнему", () => {
    // 01:30 по Москве 22 августа — это 22:30 UTC 21-го.
    const slot = nextCallSlot(new Date("2026-08-21T22:30:00.000Z"), MOSCOW);
    assert.equal(slot.toISOString(), "2026-08-22T09:00:00.000Z");
  });

  it("переносит через границу месяца", () => {
    const slot = nextCallSlot(new Date("2026-08-31T18:00:00.000Z"), MOSCOW);
    assert.equal(slot.toISOString(), "2026-09-01T09:00:00.000Z");
  });

  it("нераспознанный пояс не роняет заявку", () => {
    const now = new Date("2026-08-21T18:00:00.000Z");
    const slot = nextCallSlot(now, { ...MOSCOW, timeZone: "Nowhere/Nowhere" });
    assert.equal(slot.toISOString(), now.toISOString());
  });
});
