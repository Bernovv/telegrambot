"use client";

import { EmptyState, PageLoading } from "@/components/page-state";
import { StatusPill } from "@/components/status-pill";
import {
  listOrders,
  listOutreachPeople,
  listUsers
} from "@/lib/admin-api";
import {
  formatCompactDate,
  formatKopecks,
  orderStatusLabel,
  orderStatusTone
} from "@/lib/format";
import type {
  AdminOrderSummary,
  AdminUserSummary
} from "@ticket-platform/contracts";
import type { OutreachPerson } from "@ticket-platform/contracts/admin-outreach";
import { Search } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useState } from "react";

interface Results {
  readonly people: readonly OutreachPerson[];
  readonly users: readonly AdminUserSummary[];
  readonly orders: readonly AdminOrderSummary[];
}

const EMPTY: Results = { people: [], users: [], orders: [] };

export default function GlobalSearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setError("Нужно хотя бы два знака: обрывок имени, номера или номер заказа.");
      return;
    }
    setSearching(true);
    setError(null);
    try {
      // Три независимых запроса, и каждый волен не ответить: у роли может не быть прав на
      // заказы или пользователей. Тогда блок просто не показывается, а поиск по базе
      // работает — это лучше, чем пустая страница с ошибкой доступа.
      const [people, users, orders] = await Promise.all([
        listOutreachPeople({ search: trimmed, limit: 10 })
          .then((page) => page.items)
          .catch(() => []),
        listUsers({ search: trimmed, limit: 10 })
          .then((page) => page.items)
          .catch(() => []),
        listOrders({ search: trimmed, limit: 10 })
          .then((page) => page.items)
          .catch(() => [])
      ]);
      setResults({ people, users, orders });
    } finally {
      setSearching(false);
    }
  }

  const found = results ?? EMPTY;
  const total = found.people.length + found.users.length + found.orders.length;

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Кабинет</p>
          <h1>Поиск</h1>
          <p>
            По людям в базе, пользователям бота и заказам сразу — когда есть обрывок
            номера, а где он записан, неизвестно.
          </p>
        </div>
      </div>

      <form className="base-search global-search" onSubmit={(event) => void search(event)}>
        <label className="base-search-field">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Имя, телефон, Telegram, почта или номер заказа"
            maxLength={100}
            autoFocus
          />
        </label>
        <button className="primary-button" type="submit" disabled={searching}>
          {searching ? "Ищем…" : "Найти"}
        </button>
      </form>

      {error ? <div className="page-warning">{error}</div> : null}
      {searching && !results ? <PageLoading label="Ищем везде" /> : null}

      {results && total === 0 && !searching ? (
        <EmptyState
          title="Ничего не нашлось"
          description="Проверьте написание. Телефон ищется и по части номера."
        />
      ) : null}

      {found.people.length > 0 ? (
        <section className="data-section">
          <div className="section-title-row">
            <div>
              <h2>Люди в базе</h2>
              <span>{found.people.length}</span>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Человек</th>
                  <th>Телефон</th>
                  <th>Мессенджеры</th>
                  <th>Кампании</th>
                  <th><span className="sr-only">Открыть</span></th>
                </tr>
              </thead>
              <tbody>
                {found.people.map((person) => (
                  <tr key={person.contactId}>
                    <td><strong>{person.displayName ?? "Без имени"}</strong></td>
                    <td>{person.phone ?? <span className="muted">не знаем</span>}</td>
                    <td>
                      {[
                        person.telegramUsername ? `@${person.telegramUsername}` : null,
                        person.maxIdentifier
                      ].filter(Boolean).join(" · ") || <span className="muted">нет</span>}
                    </td>
                    <td>{person.campaignCount}</td>
                    <td>
                      <Link className="offer-link-inline" href={`/base/${person.contactId}`}>
                        Карточка
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {found.users.length > 0 ? (
        <section className="data-section">
          <div className="section-title-row">
            <div>
              <h2>Пользователи бота</h2>
              <span>{found.users.length}</span>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Пользователь</th>
                  <th>Телефон</th>
                  <th>Заказы</th>
                  <th>Регистрация</th>
                  <th><span className="sr-only">Открыть</span></th>
                </tr>
              </thead>
              <tbody>
                {found.users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <div className="stacked-cell">
                        <strong>{user.displayName ?? "Без имени"}</strong>
                        {user.telegramUsername ? (
                          <span className="muted">@{user.telegramUsername}</span>
                        ) : null}
                      </div>
                    </td>
                    <td>{user.phone ?? <span className="muted">не знаем</span>}</td>
                    <td>{user.paidOrderCount} из {user.orderCount}</td>
                    <td>{formatCompactDate(user.registeredAt)}</td>
                    <td>
                      <Link className="offer-link-inline" href={`/users/${user.id}`}>
                        Открыть
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {found.orders.length > 0 ? (
        <section className="data-section">
          <div className="section-title-row">
            <div>
              <h2>Заказы</h2>
              <span>{found.orders.length}</span>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Заказ</th>
                  <th>Покупатель</th>
                  <th>Мероприятие</th>
                  <th>Статус</th>
                  <th>Сумма</th>
                  <th><span className="sr-only">Открыть</span></th>
                </tr>
              </thead>
              <tbody>
                {found.orders.map((order) => (
                  <tr key={order.id}>
                    <td><strong>{order.number}</strong></td>
                    <td>{order.userDisplayName ?? <span className="muted">без имени</span>}</td>
                    <td>{order.eventTitle}</td>
                    <td>
                      <StatusPill tone={orderStatusTone(order.status)}>
                        {orderStatusLabel(order.status)}
                      </StatusPill>
                    </td>
                    <td className="money-cell">{formatKopecks(order.totalKopecks)}</td>
                    <td>
                      <Link className="offer-link-inline" href={`/orders/${order.id}`}>
                        Открыть
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
