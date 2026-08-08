"use client";

import { StatusPill } from "@/components/status-pill";
import {
  AdminApiError,
  cancelEventExpense,
  updateEventExpense
} from "@/lib/admin-api";
import { expenseStatusLabel, expenseStatusTone } from "@/lib/expense-format";
import {
  formatDateTime,
  formatKopecks,
  kopecksToRublesInput,
  rublesInputToKopecks
} from "@/lib/format";
import type {
  EventExpense,
  ExpenseCategory,
  Vendor
} from "@ticket-platform/contracts/admin-expenses";
import { Ban, Pencil, X } from "lucide-react";
import { type FormEvent, useState } from "react";

/**
 * Строка сметы: свёрнутая — что и на сколько, развёрнутая — правка.
 *
 * Каждая правка уходит с номером версии строки. Смету двое правят с разных экранов, и без
 * версии «последний выиграл» означал бы молча стёртую чужую сумму; сервер в таком случае
 * отвечает 409, и мы просим обновить страницу вместо того, чтобы записать поверх.
 */
export function ExpenseRowEditor({
  eventId,
  expense,
  categories,
  vendors,
  canManage,
  onChanged
}: {
  readonly eventId: string;
  readonly expense: EventExpense;
  readonly categories: readonly ExpenseCategory[];
  readonly vendors: readonly Vendor[];
  readonly canManage: boolean;
  readonly onChanged: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancelled = expense.status === "cancelled";

  async function save(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const data = new FormData(formEvent.currentTarget);
    const text = (name: string) => {
      const value = data.get(name);
      return typeof value === "string" ? value.trim() : "";
    };

    const actual = text("actual");
    const paidAt = text("paidAt");
    const status = text("status") as "planned" | "committed" | "paid";

    setSaving(true);
    setError(null);
    try {
      await updateEventExpense(eventId, {
        expenseId: expense.id,
        lockVersion: expense.lockVersion,
        categoryCode: text("categoryCode"),
        vendorId: text("vendorId") === "" ? null : text("vendorId"),
        title: text("title"),
        quantity: text("quantity") || "1",
        unit: text("unit"),
        plannedKopecks: rublesInputToKopecks(text("planned") || "0"),
        actualKopecks: actual === "" ? null : rublesInputToKopecks(actual),
        status,
        paidAt: paidAt === "" ? null : new Date(paidAt).toISOString(),
        paymentMethod: text("paymentMethod") === "" ? null : text("paymentMethod"),
        note: text("note")
      });
      await onChanged();
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof AdminApiError
        ? caught.message
        : "Не удалось сохранить строку.");
    } finally {
      setSaving(false);
    }
  }

  async function cancel() {
    const reason = window.prompt(
      `Почему отменяем «${expense.title}»? Причина останется в истории.`
    );
    if (!reason || reason.trim().length < 3) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await cancelEventExpense(eventId, {
        expenseId: expense.id,
        lockVersion: expense.lockVersion,
        reason: reason.trim()
      });
      await onChanged();
    } catch (caught) {
      setError(caught instanceof AdminApiError
        ? caught.message
        : "Не удалось отменить строку.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className={cancelled ? "expense-row expense-row-cancelled" : "expense-row"}>
      <div className="expense-row-head">
        <div className="expense-row-title">
          <div className="title-with-status">
            <strong>{expense.title}</strong>
            <StatusPill tone={expenseStatusTone(expense.status)}>
              {expenseStatusLabel(expense.status)}
            </StatusPill>
          </div>
          <span className="muted">
            {expense.categoryLabel}
            {expense.vendorName ? ` · ${expense.vendorName}` : ""}
            {expense.quantity !== "1"
              ? ` · ${expense.quantity} ${expense.unit}`.trimEnd()
              : ""}
          </span>
          {expense.cancelledReason ? (
            <span className="muted">
              Отменено {formatDateTime(expense.cancelledAt)}: {expense.cancelledReason}
            </span>
          ) : null}
          {expense.note ? <span className="muted">{expense.note}</span> : null}
        </div>

        <dl className="expense-row-money">
          <div>
            <dt>Смета</dt>
            <dd>{formatKopecks(expense.plannedKopecks)}</dd>
          </div>
          <div>
            <dt>Факт</dt>
            <dd>
              {expense.actualKopecks === null
                ? "—"
                : formatKopecks(expense.actualKopecks)}
            </dd>
          </div>
          <div>
            <dt>Оплачено</dt>
            <dd>{formatDateTime(expense.paidAt)}</dd>
          </div>
        </dl>

        {canManage && !cancelled ? (
          <div className="expense-row-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={saving}
              onClick={() => setOpen((current) => !current)}
            >
              {open ? <X size={15} /> : <Pencil size={15} />}
              {open ? "Свернуть" : "Править"}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={saving}
              onClick={() => void cancel()}
            >
              <Ban size={15} />
              Отменить
            </button>
          </div>
        ) : null}
      </div>

      {error ? <div className="accommodation-warning"><span>{error}</span></div> : null}

      {open ? (
        <form className="participant-form" onSubmit={(e) => void save(e)}>
          <label className="field">
            <span>Статья</span>
            <select name="categoryCode" defaultValue={expense.categoryCode}>
              {categories.map((category) => (
                <option key={category.code} value={category.code}>
                  {category.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Подрядчик</span>
            <select name="vendorId" defaultValue={expense.vendorId ?? ""}>
              <option value="">Не выбран</option>
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
              ))}
            </select>
          </label>
          <label className="field field-full">
            <span>Что именно</span>
            <input name="title" defaultValue={expense.title} required maxLength={200} />
          </label>
          <label className="field">
            <span>Количество</span>
            <input name="quantity" inputMode="decimal" defaultValue={expense.quantity} />
          </label>
          <label className="field">
            <span>Единица</span>
            <input name="unit" defaultValue={expense.unit} maxLength={40} />
          </label>
          <label className="field">
            <span>По смете, ₽</span>
            <input
              name="planned"
              inputMode="decimal"
              defaultValue={kopecksToRublesInput(expense.plannedKopecks)}
            />
          </label>
          <label className="field">
            <span>Факт, ₽</span>
            <input
              name="actual"
              inputMode="decimal"
              defaultValue={
                expense.actualKopecks === null
                  ? ""
                  : kopecksToRublesInput(expense.actualKopecks)
              }
            />
          </label>
          <label className="field">
            <span>Состояние</span>
            <select name="status" defaultValue={expense.status}>
              <option value="planned">В плане</option>
              <option value="committed">Договорились</option>
              <option value="paid">Оплачено</option>
            </select>
          </label>
          <label className="field">
            <span>Когда заплатили</span>
            <input
              name="paidAt"
              type="datetime-local"
              defaultValue={toLocalInput(expense.paidAt)}
            />
          </label>
          <label className="field">
            <span>Чем платили</span>
            <input
              name="paymentMethod"
              defaultValue={expense.paymentMethod ?? ""}
              maxLength={80}
              placeholder="Перевод"
            />
          </label>
          <label className="field field-full">
            <span>Заметка</span>
            <input name="note" defaultValue={expense.note} maxLength={1000} />
          </label>
          <p className="field-full muted">
            «Оплачено» требует и сумму факта, и дату — иначе строка выпадет из расходов и
            завысит прибыль.
          </p>
          <button className="primary-button" type="submit" disabled={saving}>
            {saving ? "Сохраняем…" : "Сохранить"}
          </button>
        </form>
      ) : null}
    </article>
  );
}

/** `datetime-local` не понимает ISO с зоной, а показать надо в том же поясе, где вводили. */
function toLocalInput(value: string | null): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
