"use client";

import { useEventWorkspace } from "@/components/event-workspace";
import { ExpenseRowEditor } from "@/components/expense-row-editor";
import { PageError, PageLoading } from "@/components/page-state";
import {
  AdminApiError,
  addEventExpense,
  addVendor,
  getEventExpenses
} from "@/lib/admin-api";
import { vendorKindLabel } from "@/lib/expense-format";
import { formatDateTime, formatKopecks, rublesInputToKopecks } from "@/lib/format";
import type {
  EventExpensesView,
  VendorKind
} from "@ticket-platform/contracts/admin-expenses";
import { CircleAlert, Plus, RefreshCw, Truck, X } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";

export default function EventExpensesPage() {
  const { event } = useEventWorkspace();
  const [view, setView] = useState<EventExpensesView | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [vendorOpen, setVendorOpen] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      setView(await getEventExpenses(event.id, signal));
    } catch (caught) {
      if (!signal?.aborted) {
        setError(caught instanceof AdminApiError
          ? caught.message
          : "Не удалось загрузить расходы.");
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [event.id]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function run(work: () => Promise<unknown>) {
    setMutating(true);
    setError(null);
    try {
      await work();
      await load();
      return true;
    } catch (caught) {
      setError(caught instanceof AdminApiError
        ? caught.message
        : "Не удалось сохранить изменение.");
      return false;
    } finally {
      setMutating(false);
    }
  }

  async function submitExpense(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const form = formEvent.currentTarget;
    const data = new FormData(form);
    const text = (name: string) => {
      const value = data.get(name);
      return typeof value === "string" ? value.trim() : "";
    };

    const planned = text("planned");
    const ok = await run(() => addEventExpense(event.id, {
      categoryCode: text("categoryCode"),
      title: text("title"),
      plannedKopecks: planned === "" ? "0" : rublesInputToKopecks(planned),
      ...(text("vendorId") ? { vendorId: text("vendorId") } : {}),
      ...(text("quantity") ? { quantity: text("quantity") } : {}),
      ...(text("unit") ? { unit: text("unit") } : {}),
      ...(text("note") ? { note: text("note") } : {})
    }));
    if (ok) {
      form.reset();
      setExpenseOpen(false);
    }
  }

  async function submitVendor(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const form = formEvent.currentTarget;
    const data = new FormData(form);
    const text = (name: string) => {
      const value = data.get(name);
      return typeof value === "string" ? value.trim() : "";
    };

    const ok = await run(() => addVendor({
      name: text("name"),
      kind: text("kind") as VendorKind,
      ...(text("contactName") ? { contactName: text("contactName") } : {}),
      ...(text("phone") ? { phone: text("phone") } : {}),
      ...(text("telegram") ? { telegram: text("telegram") } : {}),
      ...(text("note") ? { note: text("note") } : {})
    }));
    if (ok) {
      form.reset();
      setVendorOpen(false);
    }
  }

  if (loading && !view) {
    return <PageLoading label="Считаем расходы" />;
  }
  if (error && !view) {
    return <PageError message={error} retry={() => void load()} />;
  }
  if (!view) {
    return <PageError message="Расходы недоступны." retry={() => void load()} />;
  }

  const difference = BigInt(view.totals.actualKopecks) - BigInt(view.totals.plannedKopecks);
  const activeVendors = view.vendors.filter((vendor) => !vendor.isArchived);

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Расходы</p>
          <h1>Смета и факт</h1>
          <p>Посчитано {formatDateTime(view.calculatedAt)}</p>
        </div>
        <div className="heading-actions">
          <button
            className="icon-button bordered"
            type="button"
            title="Обновить"
            aria-label="Обновить"
            disabled={loading}
            onClick={() => void load()}
          >
            <RefreshCw size={18} />
          </button>
          {view.canManage ? (
            <>
              <button
                className="secondary-button"
                type="button"
                disabled={mutating}
                onClick={() => setVendorOpen((current) => !current)}
              >
                {vendorOpen ? <X size={16} /> : <Truck size={16} />}
                {vendorOpen ? "Отменить" : "Подрядчик"}
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={mutating}
                onClick={() => setExpenseOpen((current) => !current)}
              >
                {expenseOpen ? <X size={16} /> : <Plus size={16} />}
                {expenseOpen ? "Отменить" : "Добавить расход"}
              </button>
            </>
          ) : (
            <span className="readonly-badge">Только просмотр</span>
          )}
        </div>
      </div>

      {error ? <PageError message={error} retry={() => void load()} /> : null}

      <div className="metrics-strip">
        <div>
          <span>Смета</span>
          <strong>{formatKopecks(view.totals.plannedKopecks)}</strong>
          <small className="muted">запланировано</small>
        </div>
        <div>
          <span>Факт</span>
          <strong>{formatKopecks(view.totals.actualKopecks)}</strong>
          <small className="muted">
            {difference === 0n
              ? "сходится со сметой"
              : difference > 0n
                ? `перерасход ${formatKopecks(difference.toString())}`
                : `экономия ${formatKopecks((-difference).toString())}`}
          </small>
        </div>
        <div>
          <span>Строк без факта</span>
          <strong>{view.totals.openCount}</strong>
          <small className="muted">
            {view.totals.openCount === 0
              ? "расход посчитан целиком"
              : "пока их больше нуля, итог предварительный"}
          </small>
        </div>
        <div>
          <span>Отменено</span>
          <strong>{view.totals.cancelledCount}</strong>
          <small className="muted">видны, в суммы не идут</small>
        </div>
      </div>

      {view.totals.openCount > 0 ? (
        <div className="accommodation-note">
          <CircleAlert size={16} />
          <span>
            У <strong>{view.totals.openCount}</strong> строк факта ещё нет. Пока это так,
            прибыль и доли организаторов считаются от неполного расхода.
          </span>
        </div>
      ) : null}

      {vendorOpen ? (
        <section className="data-section">
          <div className="section-title-row">
            <div>
              <h2>Новый подрядчик</h2>
              <span>общий для всех мероприятий</span>
            </div>
          </div>
          <form className="participant-form" onSubmit={(e) => void submitVendor(e)}>
            <label className="field">
              <span>Название</span>
              <input name="name" required maxLength={200} autoFocus placeholder="Палатки Урала" />
            </label>
            <label className="field">
              <span>Чем занимается</span>
              <select name="kind" defaultValue="rent">
                <option value="rent">Аренда</option>
                <option value="catering">Питание</option>
                <option value="transport">Транспорт</option>
                <option value="venue">Площадка</option>
                <option value="staff">Персонал</option>
                <option value="other">Другое</option>
              </select>
            </label>
            <label className="field">
              <span>Контактное лицо</span>
              <input name="contactName" maxLength={200} />
            </label>
            <label className="field">
              <span>Телефон</span>
              <input name="phone" pattern="\+[1-9][0-9]{7,14}" placeholder="+79000000000" />
            </label>
            <label className="field">
              <span>Telegram</span>
              <input name="telegram" maxLength={100} placeholder="@palatki" />
            </label>
            <label className="field field-full">
              <span>Заметка</span>
              <input name="note" maxLength={1000} placeholder="Брали в 2025, привезли вовремя" />
            </label>
            <button className="primary-button" type="submit" disabled={mutating}>
              Завести
            </button>
          </form>
        </section>
      ) : null}

      {expenseOpen ? (
        <section className="data-section">
          <div className="section-title-row">
            <div>
              <h2>Новый расход</h2>
              <span>сначала смета, факт вносится потом</span>
            </div>
          </div>
          <form className="participant-form" onSubmit={(e) => void submitExpense(e)}>
            <label className="field">
              <span>Статья</span>
              <select name="categoryCode" defaultValue={view.categories[0]?.code ?? "other"}>
                {view.categories.map((category) => (
                  <option key={category.code} value={category.code}>
                    {category.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Подрядчик</span>
              <select name="vendorId" defaultValue="">
                <option value="">Не выбран</option>
                {activeVendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
                ))}
              </select>
            </label>
            <label className="field field-full">
              <span>Что именно</span>
              <input name="title" required maxLength={200} placeholder="Палатки трёхместные" />
            </label>
            <label className="field">
              <span>Количество</span>
              <input name="quantity" inputMode="decimal" defaultValue="1" />
            </label>
            <label className="field">
              <span>Единица</span>
              <input name="unit" maxLength={40} placeholder="шт" />
            </label>
            <label className="field">
              <span>По смете, ₽</span>
              <input name="planned" inputMode="decimal" required placeholder="30000" />
            </label>
            <label className="field field-full">
              <span>Заметка</span>
              <input name="note" maxLength={1000} />
            </label>
            <button className="primary-button" type="submit" disabled={mutating}>
              Добавить
            </button>
          </form>
        </section>
      ) : null}

      <section className="data-section">
        <div className="section-title-row">
          <div>
            <h2>По статьям</h2>
            <span>{view.byCategory.length} статей в работе</span>
          </div>
        </div>
        {view.byCategory.length === 0 ? (
          <p className="section-empty">Расходов пока нет.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Статья</th>
                  <th>Строк</th>
                  <th>Смета</th>
                  <th>Факт</th>
                  <th>Разница</th>
                </tr>
              </thead>
              <tbody>
                {view.byCategory.map((row) => {
                  const delta = BigInt(row.actualKopecks) - BigInt(row.plannedKopecks);
                  return (
                    <tr key={row.categoryCode}>
                      <td><strong>{row.categoryLabel}</strong></td>
                      <td>{row.count}</td>
                      <td className="money-cell">{formatKopecks(row.plannedKopecks)}</td>
                      <td className="money-cell">{formatKopecks(row.actualKopecks)}</td>
                      <td className="money-cell">
                        {delta === 0n ? "—" : formatKopecks(delta.toString())}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="data-section">
        <div className="section-title-row">
          <div>
            <h2>Все строки</h2>
            <span>{view.expenses.length} записей</span>
          </div>
        </div>
        {view.expenses.length === 0 ? (
          <div className="outreach-empty">
            <strong>Смета пока пустая</strong>
            <span>
              Заведите строки до мероприятия, а факт впишете по ходу. Оплаченную строку
              потом не удалить — только отменить с причиной.
            </span>
          </div>
        ) : (
          <div className="expense-list">
            {view.expenses.map((expense) => (
              <ExpenseRowEditor
                key={expense.id}
                eventId={event.id}
                expense={expense}
                categories={view.categories}
                vendors={activeVendors}
                canManage={view.canManage}
                onChanged={() => load()}
              />
            ))}
          </div>
        )}
      </section>

      <section className="data-section">
        <div className="section-title-row">
          <div>
            <h2>Подрядчики</h2>
            <span>общие для всех мероприятий</span>
          </div>
        </div>
        {view.vendors.length === 0 ? (
          <p className="section-empty">
            Подрядчиков пока нет. Заведите — и в следующий раз будет видно, у кого брали.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Название</th>
                  <th>Чем занимается</th>
                  <th>Контакты</th>
                  <th>Заказов</th>
                </tr>
              </thead>
              <tbody>
                {view.vendors.map((vendor) => (
                  <tr key={vendor.id}>
                    <td>
                      <div className="stacked-cell">
                        <strong>{vendor.name}</strong>
                        {vendor.note ? (
                          <span className="muted">{vendor.note}</span>
                        ) : null}
                      </div>
                    </td>
                    <td>{vendorKindLabel(vendor.kind)}</td>
                    <td>
                      <div className="stacked-cell">
                        <span>{vendor.contactName ?? "—"}</span>
                        <span className="muted">
                          {vendor.phone ?? ""}
                          {vendor.telegram ? ` · ${vendor.telegram}` : ""}
                        </span>
                      </div>
                    </td>
                    <td>{vendor.expenseCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
