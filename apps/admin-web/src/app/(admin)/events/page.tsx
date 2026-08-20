"use client";

import { EmptyState, PageError, PageLoading } from "@/components/page-state";
import { StatusPill } from "@/components/status-pill";
import {
  AdminApiError,
  listEvents,
  type EventListFilters
} from "@/lib/admin-api";
import {
  eventStatusLabel,
  eventStatusTone,
  formatEventDateTime
} from "@/lib/format";
import type { CursorPage } from "@ticket-platform/contracts";
import {
  ADMIN_EVENT_STATUSES,
  type AdminEventStatus,
  type AdminEventSummary
} from "@ticket-platform/contracts/admin-events";
import {
  ArrowLeft,
  ArrowRight,
  Plus,
  RefreshCw,
  Search
} from "lucide-react";
import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useState } from "react";

export default function EventsPage() {
  const [page, setPage] = useState<CursorPage<AdminEventSummary> | null>(null);
  const [filters, setFilters] = useState<EventListFilters>({ limit: 25 });
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<readonly (string | null)[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      setPage(
        await listEvents(
          { ...filters, ...(cursor ? { cursor } : {}) },
          signal
        )
      );
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
    ) as AdminEventStatus | "";
    setFilters({
      limit: 25,
      ...(search ? { search } : {}),
      ...(status ? { status } : {})
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
          <p className="eyebrow">Каталог</p>
          <h1>Мероприятия</h1>
          <p>Расписание, емкость, продукты и состояние продаж.</p>
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
          <Link className="primary-button" href="/events/new">
            <Plus size={16} />
            Новый черновик
          </Link>
        </div>
      </div>

      <form className="filter-bar" onSubmit={applyFilters}>
        <label className="search-field">
          <Search size={17} aria-hidden="true" />
          <input
            name="search"
            type="search"
            defaultValue={filters.search ?? ""}
            placeholder="Название, slug или площадка"
            aria-label="Поиск мероприятий"
          />
        </label>
        <label className="select-field">
          <span>Статус</span>
          <select name="status" defaultValue={filters.status ?? ""}>
            <option value="">Все статусы</option>
            {ADMIN_EVENT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {eventStatusLabel(status)}
              </option>
            ))}
          </select>
        </label>
        <button className="primary-button" type="submit">
          <Search size={16} />
          Найти
        </button>
      </form>

      <section className="data-section" aria-label="Список мероприятий">
        <div className="section-title-row">
          <div>
            <h2>Каталог мероприятий</h2>
            <span>{page ? `${page.items.length} на странице` : "—"}</span>
          </div>
        </div>

        {loading && !page ? <PageLoading /> : null}
        {error ? <PageError message={error} retry={() => void load()} /> : null}
        {!error && page?.items.length === 0 ? (
          <EmptyState
            title="Мероприятия не найдены"
            description="Измените строку поиска или статус."
          />
        ) : null}
        {!error && page && page.items.length > 0 ? (
          <div className={loading ? "table-wrap table-refreshing" : "table-wrap"}>
            <table>
              <thead>
                <tr>
                  <th>Мероприятие</th>
                  <th>Дата</th>
                  <th>Статус</th>
                  <th>Места</th>
                  <th>Продукты</th>
                  <th>Заказы</th>
                  <th>Билеты</th>
                  <th><span className="sr-only">Открыть</span></th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="stacked-cell event-title-cell">
                        <strong>{item.title}</strong>
                        <span className="muted">
                          {item.format === "city" ? "Городская" : "Выездное"}
                          {item.isFree ? " · бесплатное" : ""}
                          {" · "}
                          {item.locationName ?? item.slug}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="stacked-cell">
                        <strong>
                          {formatEventDateTime(item.startsAt, item.timezone)}
                        </strong>
                        <span className="muted">{item.timezone}</span>
                      </div>
                    </td>
                    <td>
                      <StatusPill tone={eventStatusTone(item.status)}>
                        {eventStatusLabel(item.status)}
                      </StatusPill>
                    </td>
                    <td>
                      {item.consumedInventoryUnits + item.reservedInventoryUnits}
                      {" / "}
                      {item.capacity}
                    </td>
                    <td>{item.activeProductCount} / {item.productCount}</td>
                    <td>{item.paidOrderCount} / {item.orderCount}</td>
                    <td>{item.ticketCount}</td>
                    <td>
                      <Link
                        className="row-link"
                        href={`/events/${item.id}`}
                        aria-label={`Открыть мероприятие ${item.title}`}
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
