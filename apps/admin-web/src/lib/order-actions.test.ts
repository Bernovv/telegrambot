import assert from "node:assert/strict";
import test from "node:test";
import { AdminApiError } from "./admin-api";
import {
  manualPaymentErrorMessage,
  refundErrorMessage,
  refundStatusNotice
} from "./order-actions";

test("never reports an in-flight refund as completed", () => {
  assert.equal(refundStatusNotice("succeeded"), "Возврат выполнен:");
  assert.equal(
    refundStatusNotice("review"),
    "Возврат требует ручной проверки в Т-Банке — деньги пока не ушли:"
  );
  for (const status of ["created", "submitted", "unknown"]) {
    assert.equal(
      refundStatusNotice(status),
      "Возврат отправлен в Т-Банк, ждём подтверждения:"
    );
  }
});

test("translates manual payment failures into operator instructions", () => {
  assert.equal(
    manualPaymentErrorMessage(new AdminApiError(403, "FORBIDDEN", "Forbidden")),
    "Для ручного подтверждения оплаты требуется разрешение orders.manual_paid."
  );
  assert.equal(
    manualPaymentErrorMessage(
      new AdminApiError(409, "ORDER_CONFLICT", "Conflict")
    ),
    "Заказ уже оплачен или изменён другим администратором. Обновите страницу."
  );
  assert.equal(
    manualPaymentErrorMessage(new TypeError("fetch failed")),
    "Сервис оплаты временно недоступен."
  );
});

test("translates refund failures into operator instructions", () => {
  assert.equal(
    refundErrorMessage(
      new AdminApiError(404, "REFUNDABLE_ORDER_NOT_FOUND", "not found")
    ),
    "Оплаченный платёж по этому заказу не найден — возвращать нечего."
  );
  assert.equal(
    refundErrorMessage(
      new AdminApiError(409, "FULL_REFUND_CONFLICT", "conflict")
    ),
    "Возврат по этому заказу уже выполняется или уже сделан. Обновите страницу."
  );
  assert.equal(
    refundErrorMessage(new AdminApiError(500, "BOOM", "Internal error")),
    "Internal error"
  );
});
