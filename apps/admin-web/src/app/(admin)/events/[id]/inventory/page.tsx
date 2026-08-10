"use client";

import { useEventWorkspace } from "@/components/event-workspace";
import { InventoryNeedRow } from "@/components/inventory-need-row";
import { PageError, PageLoading } from "@/components/page-state";
import {
  AdminApiError,
  addEventInventoryNeed,
  addInventoryItem,
  getEventInventory
} from "@/lib/admin-api";
import { formatDateTime } from "@/lib/format";
import type {
  EventInventoryView,
  InventoryCondition,
  InventorySource
} from "@ticket-platform/contracts/admin-inventory";
import { Boxes, CircleAlert, Package, Plus, RefreshCw, X } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";

export default function EventInventoryPage() {
  const { event } = useEventWorkspace();
  const [view, setView] = useState<EventInventoryView | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needOpen, setNeedOpen] = useState(false);
  const [itemOpen, setItemOpen] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      setView(await getEventInventory(event.id, signal));
    } catch (caught) {
      if (!signal?.aborted) {
        setError(caught instanceof AdminApiError
          ? caught.message
          : "Не удалось загрузить инвентарь.");
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

  async function submitNeed(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const form = formEvent.currentTarget;
    const data = new FormData(form);
    const text = (name: string) => {
      const value = data.get(name);
      return typeof value === "string" ? value.trim() : "";
    };

    const ok = await run(() => addEventInventoryNeed(event.id, {
      quantityNeeded: text("quantityNeeded") || "1",
      source: text("source") as InventorySource,
      ...(text("itemId") ? { itemId: text("itemId") } : {}),
      ...(text("title") ? { title: text("title") } : {}),
      ...(text("note") ? { note: text("note") } : {})
    }));
    if (ok) {
      form.reset();
      setNeedOpen(false);
    }
  }

  async function submitItem(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const form = formEvent.currentTarget;
    const data = new FormData(form);
    const text = (name: string) => {
      const value = data.get(name);
      return typeof value === "string" ? value.trim() : "";
    };

    const ok = await run(() => addInventoryItem({
      title: text("title"),
      categoryCode: text("categoryCode") || "equipment",
      ...(text("unit") ? { unit: text("unit") } : {}),
      ...(text("quantityOwned") ? { quantityOwned: text("quantityOwned") } : {}),
      ...(text("storageLocation") ? { storageLocation: text("storageLocation") } : {}),
      ...(text("condition") ? { condition: text("condition") as InventoryCondition } : {}),
      ...(text("note") ? { note: text("note") } : {})
    }));
    if (ok) {
      form.reset();
      setItemOpen(false);
    }
  }

  if (loading && !view) {
    return <PageLoading label="Открываем склад" />;
  }
  if (error && !view) {
    return <PageError message={error} retry={() => void load()} />;
  }
  if (!view) {
    return <PageError message="Инвентарь недоступен." retry={() => void load()} />;
  }

  const stockItems = view.items.filter((item) => !item.isArchived);

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Инвентарь</p>
          <h1>Что берём и что покупаем</h1>
          <p>
            Склад общий для всех мероприятий. Посчитано {formatDateTime(view.calculatedAt)}
          </p>
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
                onClick={() => setItemOpen((current) => !current)}
              >
                {itemOpen ? <X size={16} /> : <Boxes size={16} />}
                {itemOpen ? "Отменить" : "Позиция склада"}
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={mutating}
                onClick={() => setNeedOpen((current) => !current)}
              >
                {needOpen ? <X size={16} /> : <Plus size={16} />}
                {needOpen ? "Отменить" : "Добавить в погрузку"}
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
          <span>Позиций в погрузке</span>
          <strong>{view.totals.needCount}</strong>
          <small className="muted">
            загружено {view.totals.loaded} из {view.totals.needCount}
          </small>
        </div>
        <div>
          <span>Берём со склада</span>
          <strong>{view.totals.fromStock}</strong>
          <small className="muted">уже наше</small>
        </div>
        <div>
          <span>Надо купить</span>
          <strong>{view.totals.toBuy}</strong>
          <small className="muted">после покупки уедет на склад</small>
        </div>
        <div>
          <span>Арендуем</span>
          <strong>{view.totals.toRent}</strong>
          <small className="muted">вернуть после мероприятия</small>
        </div>
      </div>

      {view.totals.shortCount > 0 ? (
        <div className="accommodation-warning">
          <CircleAlert size={16} />
          <span>
            Позиций, которых на складе не хватает: <strong>{view.totals.shortCount}</strong>.
            Увидеть это надо сейчас, а не у машины — докупите или поменяйте источник на
            «купить» либо «арендовать».
          </span>
        </div>
      ) : null}

      {itemOpen ? (
        <section className="data-section">
          <div className="section-title-row">
            <div>
              <h2>Новая позиция склада</h2>
              <span>общая для всех мероприятий</span>
            </div>
          </div>
          <form className="participant-form" onSubmit={(e) => void submitItem(e)}>
            <label className="field field-full">
              <span>Название</span>
              <input name="title" required maxLength={200} autoFocus placeholder="Палатка трёхместная" />
            </label>
            <label className="field">
              <span>Статья</span>
              <select name="categoryCode" defaultValue="equipment">
                <option value="equipment">Оборудование и инвентарь</option>
                <option value="decor">Декор и оформление</option>
                <option value="food">Продукты и питание</option>
                <option value="transport">Транспорт</option>
                <option value="other">Прочее</option>
              </select>
            </label>
            <label className="field">
              <span>Единица</span>
              <input name="unit" maxLength={40} placeholder="шт" />
            </label>
            <label className="field">
              <span>Сколько есть</span>
              <input name="quantityOwned" inputMode="decimal" defaultValue="0" />
            </label>
            <label className="field">
              <span>Где лежит</span>
              <input name="storageLocation" maxLength={200} placeholder="гараж" />
            </label>
            <label className="field">
              <span>Состояние</span>
              <select name="condition" defaultValue="good">
                <option value="new">Новое</option>
                <option value="good">Хорошее</option>
                <option value="worn">Потрёпанное</option>
                <option value="broken">Сломано</option>
              </select>
            </label>
            <label className="field field-full">
              <span>Заметка</span>
              <input name="note" maxLength={1000} />
            </label>
            <button className="primary-button" type="submit" disabled={mutating}>
              Завести
            </button>
          </form>
        </section>
      ) : null}

      {needOpen ? (
        <section className="data-section">
          <div className="section-title-row">
            <div>
              <h2>Что нужно на мероприятие</h2>
              <span>со склада, купить или арендовать</span>
            </div>
          </div>
          <form className="participant-form" onSubmit={(e) => void submitNeed(e)}>
            <label className="field field-full">
              <span>Позиция со склада</span>
              <select name="itemId" defaultValue="">
                <option value="">Не со склада — впишу название</option>
                {stockItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title} · есть {item.quantityOwned} {item.unit}
                  </option>
                ))}
              </select>
            </label>
            <label className="field field-full">
              <span>Или название того, чего на складе нет</span>
              <input name="title" maxLength={200} placeholder="Гирлянда" />
            </label>
            <label className="field">
              <span>Сколько нужно</span>
              <input name="quantityNeeded" inputMode="decimal" defaultValue="1" required />
            </label>
            <label className="field">
              <span>Откуда берём</span>
              <select name="source" defaultValue="stock">
                <option value="stock">Со склада</option>
                <option value="buy">Купить</option>
                <option value="rent">Арендовать</option>
              </select>
            </label>
            <label className="field field-full">
              <span>Заметка</span>
              <input name="note" maxLength={500} />
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
            <h2>Список погрузки</h2>
            <span>{view.needs.length} позиций</span>
          </div>
        </div>
        {view.needs.length === 0 ? (
          <div className="outreach-empty">
            <strong>Список пока пуст</strong>
            <span>
              Добавьте то, что берёте с собой. Позиция-комплект развернётся сама: три
              трёхместные палатки — это ещё девять спальников и девять пенок.
            </span>
          </div>
        ) : (
          <div className="expense-list">
            {view.needs.map((need) => (
              <InventoryNeedRow
                key={need.id}
                eventId={event.id}
                need={need}
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
            <h2>Склад</h2>
            <span>{stockItems.length} позиций</span>
          </div>
        </div>
        {stockItems.length === 0 ? (
          <p className="section-empty">
            Склад пуст. Заведите то, что уже куплено, — в следующий раз это не придётся
            вспоминать.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Позиция</th>
                  <th>Статья</th>
                  <th>Есть</th>
                  <th>Где лежит</th>
                  <th>В комплекте</th>
                </tr>
              </thead>
              <tbody>
                {stockItems.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="stacked-cell">
                        <strong>{item.title}</strong>
                        <span className="muted">
                          {conditionLabel(item.condition)}
                          {item.note ? ` · ${item.note}` : ""}
                        </span>
                      </div>
                    </td>
                    <td>{item.categoryLabel}</td>
                    <td>{item.quantityOwned} {item.unit}</td>
                    <td>{item.storageLocation || "—"}</td>
                    <td>
                      {item.components.length === 0 ? (
                        <span className="muted">—</span>
                      ) : (
                        <span className="channel-cell">
                          <Package size={13} aria-hidden="true" />
                          {item.components
                            .map((c) => `${c.title} × ${c.quantityPerParent}`)
                            .join(", ")}
                        </span>
                      )}
                    </td>
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

function conditionLabel(condition: InventoryCondition): string {
  switch (condition) {
    case "new":
      return "новое";
    case "worn":
      return "потрёпанное";
    case "broken":
      return "сломано";
    default:
      return "хорошее";
  }
}
