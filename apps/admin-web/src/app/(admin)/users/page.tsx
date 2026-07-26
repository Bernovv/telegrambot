"use client";

import { EmptyState, PageError, PageLoading } from "@/components/page-state";
import { StatusPill } from "@/components/status-pill";
import {
  AdminApiError,
  listUsers,
  type UserListFilters
} from "@/lib/admin-api";
import {
  formatCompactDate,
  formatKopecks
} from "@/lib/format";
import type { AdminUserSummary, CursorPage } from "@ticket-platform/contracts";
import {
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  Search
} from "lucide-react";
import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useState } from "react";

export default function UsersPage() {
  const [page, setPage] = useState<CursorPage<AdminUserSummary> | null>(null);
  const [filters, setFilters] = useState<UserListFilters>({ limit: 25 });
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<readonly (string | null)[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const result = await listUsers(
        {
          ...filters,
          ...(cursor ? { cursor } : {})
        },
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
    const blockedValue = data.get("blocked");
    const search = typeof searchValue === "string" ? searchValue.trim() : "";
    const blocked = typeof blockedValue === "string" ? blockedValue : "";
    setFilters({
      limit: 25,
      ...(search ? { search } : {}),
      ...(blocked ? { blocked: blocked === "true" } : {})
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
          <p className="eyebrow">Операции</p>
          <h1>Пользователи</h1>
          <p>Идентификаторы, контакты, заказы и доступный баланс.</p>
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
            placeholder="Имя, username, Telegram ID или телефон"
            aria-label="Поиск пользователей"
          />
        </label>
        <label className="select-field">
          <span>Доступ</span>
          <select
            name="blocked"
            defaultValue={
              filters.blocked === undefined ? "" : String(filters.blocked)
            }
          >
            <option value="">Все</option>
            <option value="false">Активные</option>
            <option value="true">Заблокированные</option>
          </select>
        </label>
        <button className="primary-button" type="submit">
          <Search size={16} />
          Найти
        </button>
      </form>

      <section className="data-section" aria-label="Список пользователей">
        <div className="section-title-row">
          <div>
            <h2>База пользователей</h2>
            <span>{page ? `${page.items.length} на странице` : "—"}</span>
          </div>
        </div>

        {loading && !page ? <PageLoading /> : null}
        {error ? <PageError message={error} retry={() => void load()} /> : null}
        {!error && page?.items.length === 0 ? (
          <EmptyState
            title="Пользователи не найдены"
            description="Измените параметры поиска или фильтр доступа."
          />
        ) : null}
        {!error && page && page.items.length > 0 ? (
          <div className={loading ? "table-wrap table-refreshing" : "table-wrap"}>
            <table>
              <thead>
                <tr>
                  <th>Пользователь</th>
                  <th>Контакт</th>
                  <th>Заказы</th>
                  <th>Баланс</th>
                  <th>Регистрация</th>
                  <th><span className="sr-only">Открыть</span></th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <div className="primary-cell">
                        <span className="table-avatar" aria-hidden="true">
                          {(user.displayName ?? user.telegramUsername ?? "?")
                            .slice(0, 1)
                            .toUpperCase()}
                        </span>
                        <div>
                          <strong>{user.displayName ?? "Без имени"}</strong>
                          <span>
                            {user.telegramUsername
                              ? `@${user.telegramUsername}`
                              : user.id.slice(0, 8)}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="stacked-cell">
                        <span>{user.phoneMasked ?? "Не указан"}</span>
                        {user.isBlocked ? (
                          <StatusPill tone="danger">Заблокирован</StatusPill>
                        ) : (
                          <span className="muted">{user.phoneStatus}</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="stacked-cell">
                        <strong>{user.orderCount}</strong>
                        <span className="muted">
                          оплачено: {user.paidOrderCount}
                        </span>
                      </div>
                    </td>
                    <td className="money-cell">
                      {formatKopecks(user.walletAvailableKopecks)}
                    </td>
                    <td>{formatCompactDate(user.registeredAt)}</td>
                    <td>
                      <Link
                        className="row-link"
                        href={`/users/${user.id}`}
                        aria-label={`Открыть пользователя ${user.displayName ?? user.id}`}
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
