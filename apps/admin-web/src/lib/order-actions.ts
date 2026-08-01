import { AdminApiError } from "@/lib/admin-api";

// The provider answers asynchronously: only "succeeded" means the money already left the account,
// everything else is still in flight and gets confirmed later by the webhook or the reconciliation
// worker. Saying "возврат выполнен" too early is how an operator ends up refunding twice.
export function refundStatusNotice(status: string): string {
  if (status === "succeeded") {
    return "Возврат выполнен:";
  }
  if (status === "review") {
    return "Возврат требует ручной проверки в Т-Банке — деньги пока не ушли:";
  }
  return "Возврат отправлен в Т-Банк, ждём подтверждения:";
}

export function manualPaymentErrorMessage(error: unknown): string {
  if (!(error instanceof AdminApiError)) {
    return "Сервис оплаты временно недоступен.";
  }
  if (error.status === 403) {
    return "Для ручного подтверждения оплаты требуется разрешение orders.manual_paid.";
  }
  if (error.code === "INVALID_IDEMPOTENCY_KEY") {
    return "Не удалось сформировать ключ операции. Обновите страницу и попробуйте снова.";
  }
  if (error.code === "INVALID_MANUAL_PAYMENT_REQUEST") {
    return "Проверьте сумму, способ оплаты и внешний идентификатор.";
  }
  if (error.status === 409) {
    return "Заказ уже оплачен или изменён другим администратором. Обновите страницу.";
  }
  return error.message;
}

export function refundErrorMessage(error: unknown): string {
  if (!(error instanceof AdminApiError)) {
    return "Сервис возвратов временно недоступен.";
  }
  if (error.status === 403) {
    return "Для возврата требуется разрешение payments.refund.";
  }
  if (error.code === "REFUNDABLE_ORDER_NOT_FOUND") {
    return "Оплаченный платёж по этому заказу не найден — возвращать нечего.";
  }
  if (error.code === "FULL_REFUND_CONFLICT") {
    return "Возврат по этому заказу уже выполняется или уже сделан. Обновите страницу.";
  }
  if (error.code === "INVALID_FULL_REFUND_REQUEST") {
    return "Укажите причину возврата — не короче трёх символов.";
  }
  return error.message;
}
