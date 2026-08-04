import assert from "node:assert/strict";
import test from "node:test";
import { AdminApiError } from "./admin-api";
import {
  audienceWarning,
  broadcastErrorMessage,
  describeAudience,
  recipientCountLabel
} from "./broadcast";
import type { AdminEventSummary } from "@ticket-platform/contracts/admin-events";

// describeAudience only ever reads id and title; the rest of the summary is irrelevant noise here.
const events = [
  { id: "00000000-0000-4000-8000-000000000101", title: "Бизнес-Пикник" }
] as unknown as readonly AdminEventSummary[];

test("spells out who receives the broadcast", () => {
  assert.equal(
    describeAudience("", "", events),
    "Получатели: все участники всех мероприятий, у кого есть хотя бы один заказ."
  );
  assert.equal(
    describeAudience("00000000-0000-4000-8000-000000000101", "paid", events),
    "Получатели: участники мероприятия «Бизнес-Пикник» с заказом в статусе «Оплачен»."
  );
  assert.equal(
    describeAudience("00000000-0000-4000-8000-000000000999", "", events),
    "Получатели: все участники всех мероприятий, у кого есть хотя бы один заказ."
  );
});

test("склоняет число получателей по-русски", () => {
  assert.equal(recipientCountLabel(1), "1 получатель");
  assert.equal(recipientCountLabel(2), "2 получателя");
  assert.equal(recipientCountLabel(5), "5 получателей");
  assert.equal(recipientCountLabel(11), "11 получателей");
  assert.equal(recipientCountLabel(21), "21 получатель");
  assert.equal(recipientCountLabel(112), "112 получателей");
  assert.equal(recipientCountLabel(0), "0 получателей");
});

test("предупреждает про пустую аудиторию и про обрезанную выборку", () => {
  assert.equal(audienceWarning(120, false, 5_000), null);
  assert.equal(
    audienceWarning(0, false, 5_000),
    "Под эти условия не попадает никто — сообщение никуда не уйдёт."
  );
  assert.equal(
    audienceWarning(5_400, true, 5_000),
    "Под условия попадает 5400 получателей, но за один раз уходит не больше 5000. Сузьте условия."
  );
});

test("names the missing permission instead of echoing the raw error", () => {
  assert.equal(
    broadcastErrorMessage(new AdminApiError(403, "FORBIDDEN", "Forbidden")),
    "Для отправки рассылок требуется разрешение broadcasts.send."
  );
  assert.equal(
    broadcastErrorMessage(
      new AdminApiError(400, "INVALID_BROADCAST_REQUEST", "Broadcast request is invalid")
    ),
    "Проверьте текст сообщения и выбранные условия."
  );
  assert.equal(
    broadcastErrorMessage(new Error("socket hang up")),
    "Сервис рассылок временно недоступен."
  );
});
