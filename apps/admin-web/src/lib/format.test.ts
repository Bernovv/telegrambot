import assert from "node:assert/strict";
import test from "node:test";
import {
  eventStatusLabel,
  eventStatusTone,
  formatDateTime,
  formatEventDateTime,
  formatKopecks,
  kopecksToRublesInput,
  orderStatusLabel,
  orderStatusTone,
  rublesInputToKopecks
} from "./format";

test("formats kopecks without converting money to number", () => {
  assert.equal(formatKopecks("249000"), "2 490 ₽");
  assert.equal(formatKopecks("101"), "1,01 ₽");
  assert.equal(formatKopecks("-5050"), "-50,50 ₽");
  assert.equal(formatKopecks("invalid"), "—");
});

test("converts ruble form input with bigint-only arithmetic", () => {
  assert.equal(rublesInputToKopecks("2490"), "249000");
  assert.equal(rublesInputToKopecks("2490,5"), "249050");
  assert.equal(kopecksToRublesInput("249050"), "2490,50");
  assert.throws(() => rublesInputToKopecks("24.90.00"));
});

test("formats timestamps in the event operations timezone", () => {
  assert.match(
    formatDateTime("2026-07-25T18:30:00.000Z"),
    /25 июл\. 2026 г., 21:30/
  );
  assert.equal(formatDateTime("not-a-date"), "—");
});

test("maps order states to operator labels and tones", () => {
  assert.equal(orderStatusLabel("payment_processing"), "Платёж обрабатывается");
  assert.equal(orderStatusTone("paid"), "positive");
  assert.equal(orderStatusTone("expired"), "danger");
  assert.equal(orderStatusTone("awaiting_payment"), "warning");
});

test("formats event timestamps in their configured timezone", () => {
  assert.match(
    formatEventDateTime("2026-07-25T18:30:00.000Z", "Asia/Yekaterinburg"),
    /23:30/
  );
  assert.equal(formatEventDateTime("not-a-date", "UTC"), "—");
});

test("maps event states to operator labels and tones", () => {
  assert.equal(eventStatusLabel("sales_paused"), "Продажи приостановлены");
  assert.equal(eventStatusTone("published"), "positive");
  assert.equal(eventStatusTone("sold_out"), "warning");
  assert.equal(eventStatusTone("archived"), "danger");
});
