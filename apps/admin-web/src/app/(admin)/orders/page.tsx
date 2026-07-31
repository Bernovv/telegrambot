"use client";

import { EmptyState, PageError, PageLoading } from "@/components/page-state";
import { StatusPill } from "@/components/status-pill";
import {
  AdminApiError,
  listOrders,
  type OrderListFilters
} from "@/lib/admin-api";
import {
  formatCompactDate,
  formatKopecks,
  orderStatusLabel,
  orderStatusTone
} from "@/lib/format";
import {
  ADMIN_ORDER_STATUSES,
  type AdminOrderStatus,
  type AdminOrderSummary,
  type CursorPage
} from "@ticket-platform/contracts";
import {
  ArrowLeft,
  ArrowRight,
  EyeOff,
  RefreshCw,
  Search
} from "lucide-react";
import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useState } from "react";

export default function OrdersPage() {
  const [page, setPage] = useState<CursorPage<AdminOrderSummary> | null>(null);
  const [filters, setFilters] = useState<OrderListFilters>({ limit: 25 });
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<readonly (string | null)[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const result = await listOrders(
        { ...filters, ...(cursor ? { cursor } : {}) },
        signal
      );
      setPage(result);
    } catch (caught) {
      if (signal?.aborted) {
        return;
      }
      setError(
        caught instanceof AdminApiError
          ? caught.message
          : "Сервис временно недоступен."
      );
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [cursor, filters]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const searchValue = data.get("search");
    const statusValue = data.get("status");
    const search = typeof searchValue === "string" ? searchValue.trim() : "";
    const status = (
      typeof statusValue === "string" ? statusValue : ""
    ) as AdminOrderStatus | "";
    const includeExcluded = data.get("includeExcluded") === "on";
    setFilters({
      limit: 25,
      ...(search ? { search } : {}),
      ...(status ? { status } : {}),
      ...(includeExcluded ? { includeExcluded } : {})
    });
    setCursor(null);
    setHistory([]);
  }

  function nextPage() {
    if (!page?.nextCursor) {
      return;
    }
    setHistory((current) => [...current, cursor]);
    setCursor(page.nextCursor);
  }

  function previousPage() {
    const previous = history.at(-1);
    if (previous === undefined) {
      return;
    }
    setHistory((current) => current.slice(0, -1));
    setCursor(previous);
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Продажи</p>
          <h1>Заказы</h1>
          <p>Оплаты, билеты и зафиксированные снимки заказов.</p>
        </div>
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
      </div>

      <form className="filter-bar" onSubmit={applyFilters}>
        <label className="search-field">
          <Search size={17} aria-hidden="true" />
          <input
            name="search"
            type="search"
            defaultValue={filters.search ?? ""}
            placeholder="Номер, имя, username или Telegram ID"
            aria-label="Поиск заказов"
          />
        </label>
        <label className="select-field">
          <span>Статус</span>
          <select name="status" defaultValue={filters.status ?? ""}>
            <option value="">Все статусы</option>
            {ADMIN_ORDER_STATUSES.map((status) => (
              <option key={status} value={status}>
                {orderStatusLabel(status)}
              </option>
            ))}
          </select>
        </label>
        <label className="check-field orders-hidden-toggle">
          <input
            type="checkbox"
            name="includeExcluded"
            defaultChecked={filters.includeExcluded === true}
          />
          <span>Показывать скрытые</span>
        </label>
        <button className="primary-button" type="submit">
          <Search size={16} />
          Найти
        </button>
      </form>

      <section className="data-section" aria-label="Список заказов">
        <div className="section-title-row">
          <div>
            <h2>Журнал заказов</h2>
            <span>{page ? `${page.items.length} на странице` : "—"}</span>
          </div>
        </div>

        {loading && !page ? <PageLoading /> : null}
        {error ? <PageError message={error} retry={() => void load()} /> : null}
        {!error && page?.items.length === 0 ? (
          <EmptyState
            title="Заказы не найдены"
            description="Измените строку поиска или статус."
          />
        ) : null}
        {!error && page && page.items.length > 0 ? (
          <div className={loading ? "table-wrap table-refreshing" : "table-wrap"}>
            <table>
              <thead>
                <tr>
                  <th>Заказ</th>
                  <th>Покупатель</th>
                  <th>Мероприятие</th>
                  <th>Статус</th>
                  <th>Сумма</th>
                  <th>Билеты</th>
                  <th>Создан</th>
                  <th><span className="sr-only">Открыть</span></th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <div className="stacked-cell">
                        <strong>{order.number}</strong>
                        {order.excludedAt ? (
                          <span className="order-hidden-badge">
                            <EyeOff size={12} />
                            Скрыт
                          </span>
                        ) : (
                          <span className="muted">{order.id.slice(0, 8)}</span>
                        )}
                      </div>
                    </td>
                    <td>{order.userDisplayName ?? "Без имени"}</td>
                    <td>{order.eventTitle}</td>
                    <td>
                      <StatusPill tone={orderStatusTone(order.status)}>
                        {orderStatusLabel(order.status)}
                      </StatusPill>
                    </td>
                    <td className="money-cell">
                      {formatKopecks(order.totalKopecks)}
                    </td>
                    <td>{order.ticketCount}</td>
                    <td>{formatCompactDate(order.createdAt)}</td>
                    <td>
                      <Link
                        className="row-link"
                        href={`/orders/${order.id}`}
                        aria-label={`Открыть заказ ${order.number}`}
                      >
                        <ArrowRight size={18} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <div className="pagination">
          <button
            className="secondary-button"
            type="button"
            disabled={history.length === 0 || loading}
            onClick={previousPage}
          >
            <ArrowLeft size={16} />
            Назад
          </button>
          <span>Страница {history.length + 1}</span>
          <button
            className="secondary-button"
            type="button"
            disabled={!page?.nextCursor || loading}
            onClick={nextPage}
          >
            Далее
            <ArrowRight size={16} />
          </button>
        </div>
      </section>
    </>
  );
}
