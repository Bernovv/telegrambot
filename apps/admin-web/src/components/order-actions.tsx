"use client";

import {
  confirmManualPayment,
  newIdempotencyKey,
  requestFullRefund
} from "@/lib/admin-api";
import {
  manualPaymentErrorMessage,
  refundErrorMessage,
  refundStatusNotice
} from "@/lib/order-actions";
import {
  formatKopecks,
  kopecksToRublesInput,
  orderStatusLabel,
  rublesInputToKopecks
} from "@/lib/format";
import type {
  AdminManualPaymentMethod,
  AdminOrderDetail
} from "@ticket-platform/contracts";
import { BadgeCheck, LoaderCircle, RotateCcw, Wallet } from "lucide-react";
import { type FormEvent, useState } from "react";

type OpenForm = "manual-payment" | "refund" | null;

const MANUAL_PAYMENT_METHOD_LABELS: Record<AdminManualPaymentMethod, string> = {
  cash: "Наличные",
  bank_transfer: "Банковский перевод",
  other: "Другое"
};

// Mirrors the two backend guards exactly, so the operator never gets a button that is certain to
// fail: packages/domain/src/order.ts only allows `paid` from awaiting_payment and payment_processing,
// and tbank-refund-persistence.ts prepares a full refund only for an order that is still `paid`.
const PAYABLE_STATUSES = new Set(["awaiting_payment", "payment_processing"]);
const REFUNDABLE_STATUSES = new Set(["paid"]);

export function OrderActions({
  order,
  onSettled
}: {
  readonly order: AdminOrderDetail;
  readonly onSettled: () => Promise<void>;
}) {
  const [openForm, setOpenForm] = useState<OpenForm>(null);
  const [amount, setAmount] = useState(
    kopecksToRublesInput(order.externalDueKopecks)
  );
  const [method, setMethod] = useState<AdminManualPaymentMethod>("bank_transfer");
  const [externalReference, setExternalReference] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const payable = PAYABLE_STATUSES.has(order.status);
  const refundable = REFUNDABLE_STATUSES.has(order.status);

  function reset(next: OpenForm) {
    setOpenForm(next);
    setError(null);
    setNotice(null);
    setReason("");
    if (next === "manual-payment") {
      setAmount(kopecksToRublesInput(order.externalDueKopecks));
      setExternalReference("");
    }
  }

  async function submitManualPayment(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (busy) {
      return;
    }
    let amountKopecks: string;
    try {
      amountKopecks = rublesInputToKopecks(amount);
    } catch {
      setError("Введите сумму в рублях, например 2490 или 2490,50.");
      return;
    }
    if (BigInt(amountKopecks) <= 0n) {
      setError("Сумма должна быть больше нуля.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await confirmManualPayment(
        order.id,
        {
          amountKopecks,
          currency: order.currency,
          method,
          externalReference: externalReference.trim(),
          reason: reason.trim()
        },
        newIdempotencyKey("manual-payment")
      );
      setOpenForm(null);
      setNotice(
        result.created
          ? `Заказ отмечен оплаченным. Билетов выпущено: ${result.ticketCount}.`
          : "Заказ уже был отмечен оплаченным ранее — повторного списания не произошло."
      );
      await onSettled();
    } catch (caught) {
      setError(manualPaymentErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function submitRefund(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await requestFullRefund(
        order.id,
        { reason: reason.trim() },
        newIdempotencyKey("full-refund")
      );
      setOpenForm(null);
      setNotice(
        result.created
          ? `${refundStatusNotice(result.status)} ${formatKopecks(result.externalAmountKopecks)} на карту и ${formatKopecks(result.walletAmountKopecks)} на баланс.`
          : "Такой возврат уже был запрошен ранее — повторно деньги не отправлены."
      );
      await onSettled();
    } catch (caught) {
      setError(refundErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="detail-section order-actions">
      <div className="section-title-row">
        <div>
          <h2>Действия</h2>
          <span>Операции с деньгами журналируются в аудите</span>
        </div>
        <div className="heading-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={!payable || busy}
            onClick={() => reset(openForm === "manual-payment" ? null : "manual-payment")}
          >
            <Wallet size={16} />
            Отметить оплаченным
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={!refundable || busy}
            onClick={() => reset(openForm === "refund" ? null : "refund")}
          >
            <RotateCcw size={16} />
            Полный возврат
          </button>
        </div>
      </div>

      {!payable && !refundable ? (
        <p className="muted">
          Для заказа в статусе «{orderStatusLabel(order.status)}» операции
          с деньгами недоступны.
        </p>
      ) : null}

      {notice ? (
        <p className="order-actions-notice">
          <BadgeCheck size={16} />
          {notice}
        </p>
      ) : null}

      {openForm === "manual-payment" ? (
        <form
          className="order-action-form"
          onSubmit={(value) => void submitManualPayment(value)}
        >
          <p className="muted">
            Ручное подтверждение — для денег, полученных мимо Т-Банка: наличными
            или переводом. Заказ станет оплаченным, билеты выпустятся, бонус
            партнёру начислится.
          </p>
          <div className="order-action-grid">
            <label className="field">
              <span>Сумма, ₽</span>
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                required
                disabled={busy}
                onChange={(changeEvent) => setAmount(changeEvent.target.value)}
              />
            </label>
            <label className="field">
              <span>Способ</span>
              <select
                value={method}
                disabled={busy}
                onChange={(changeEvent) =>
                  setMethod(changeEvent.target.value as AdminManualPaymentMethod)}
              >
                {Object.entries(MANUAL_PAYMENT_METHOD_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="field field-wide">
              <span>Внешний идентификатор платежа</span>
              <input
                type="text"
                value={externalReference}
                placeholder="Номер платёжного поручения, чека или квитанции"
                minLength={1}
                maxLength={120}
                required
                disabled={busy}
                onChange={(changeEvent) =>
                  setExternalReference(changeEvent.target.value)}
              />
            </label>
            <label className="field field-full">
              <span>Причина</span>
              <input
                type="text"
                value={reason}
                placeholder="Например: оплата наличными на встрече 03.08"
                minLength={3}
                maxLength={500}
                required
                disabled={busy}
                onChange={(changeEvent) => setReason(changeEvent.target.value)}
              />
            </label>
          </div>
          {error ? <p className="form-error">{error}</p> : null}
          <div className="order-action-buttons">
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={() => setOpenForm(null)}
            >
              Отмена
            </button>
            <button
              className="primary-button"
              type="submit"
              disabled={busy || reason.trim().length < 3 || externalReference.trim().length === 0}
            >
              {busy ? <LoaderCircle className="spin" size={17} /> : <Wallet size={17} />}
              {busy ? "Подтверждаем..." : "Подтвердить оплату"}
            </button>
          </div>
        </form>
      ) : null}

      {openForm === "refund" ? (
        <form
          className="order-action-form"
          onSubmit={(value) => void submitRefund(value)}
        >
          <p className="muted">
            Вернётся вся сумма заказа: {formatKopecks(order.totalKopecks)} —
            {" "}
            {formatKopecks(order.externalDueKopecks)} на карту через Т-Банк и
            {" "}
            {formatKopecks(order.walletAppliedKopecks)} на баланс покупателя.
            Билеты аннулируются, когда Т-Банк подтвердит возврат. Действие
            необратимо.
          </p>
          <label className="field field-full">
            <span>Причина возврата</span>
            <input
              type="text"
              value={reason}
              placeholder="Например: покупатель отказался от участия"
              minLength={3}
              maxLength={500}
              required
              disabled={busy}
              onChange={(changeEvent) => setReason(changeEvent.target.value)}
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <div className="order-action-buttons">
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={() => setOpenForm(null)}
            >
              Отмена
            </button>
            <button
              className="primary-button order-action-danger"
              type="submit"
              disabled={busy || reason.trim().length < 3}
            >
              {busy ? <LoaderCircle className="spin" size={17} /> : <RotateCcw size={17} />}
              {busy ? "Отправляем..." : "Вернуть всю сумму"}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
