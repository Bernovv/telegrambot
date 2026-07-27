import assert from "node:assert/strict";
import test from "node:test";
import { AdminApiError } from "./admin-api";
import { broadcastErrorMessage, describeAudience } from "./broadcast";
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
