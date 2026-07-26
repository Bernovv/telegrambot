"use client";

import { PageError, PageLoading } from "@/components/page-state";
import { StatusPill } from "@/components/status-pill";
import { AdminApiError, getUser } from "@/lib/admin-api";
import {
  formatCompactDate,
  formatDateTime,
  formatKopecks,
  orderStatusLabel,
  orderStatusTone
} from "@/lib/format";
import type { AdminUserDetail } from "@ticket-platform/contracts";
import { ArrowLeft, ExternalLink, WalletCards } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [user, setUser] = useState<AdminUserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      setUser(await getUser(id, signal));
    } catch (caught) {
      if (!signal?.aborted) {
        setError(
          caught instanceof AdminApiError
            ? caught.message
            : "Сервис временно недоступен."
        );
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [id]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (loading && !user) {
    return <PageLoading label="Загружаем карточку пользователя" />;
  }
  if (error || !user) {
    return (
      <PageError
        message={error ?? "Пользователь не найден."}
        retry={() => void load()}
      />
    );
  }

  return (
    <>
      <Link className="back-link" href="/users">
        <ArrowLeft size={16} />
        Пользователи
      </Link>
      <div className="detail-heading">
        <div className="detail-avatar" aria-hidden="true">
          {(user.displayName ?? user.telegramUsername ?? "?")
            .slice(0, 1)
            .toUpperCase()}
        </div>
        <div>
          <div className="title-with-status">
            <h1>{user.displayName ?? "Без имени"}</h1>
            <StatusPill tone={user.isBlocked ? "danger" : "positive"}>
              {user.isBlocked ? "Заблокирован" : "Активен"}
            </StatusPill>
          </div>
          <p>
            {user.telegramUsername ? `@${user.telegramUsername}` : user.id}
          </p>
        </div>
      </div>

      <div className="metrics-strip">
        <div>
          <span>Доступный баланс</span>
          <strong>{formatKopecks(user.walletAvailableKopecks)}</strong>
        </div>
        <div>
          <span>Заказы</span>
          <strong>{user.orderCount}</strong>
        </div>
        <div>
          <span>Оплачено</span>
          <strong>{user.paidOrderCount}</strong>
        </div>
        <div>
          <span>Регистрация</span>
          <strong>{formatCompactDate(user.registeredAt)}</strong>
        </div>
      </div>

      <div className="detail-grid">
        <section className="detail-section">
          <div className="section-title-row">
            <div>
              <h2>Идентификаторы и контакты</h2>
              <span>Контактные данные маскированы</span>
            </div>
          </div>
          <div className="definition-list">
            {user.identities.map((identity) => (
              <div key={`${identity.channel}:${identity.externalUserId}`}>
                <span>{identity.channel}</span>
                <strong>
                  {identity.username
                    ? `@${identity.username}`
                    : identity.externalUserId}
                </strong>
                <small>Последняя активность: {formatDateTime(identity.lastSeenAt)}</small>
              </div>
            ))}
            {user.contacts.map((contact) => (
              <div key={`${contact.type}:${contact.valueMasked}`}>
                <span>{contact.type}</span>
                <strong>{contact.valueMasked}</strong>
                <small>{contact.verificationStatus}</small>
              </div>
            ))}
          </div>
        </section>

        <section className="detail-section">
          <div className="section-title-row">
            <div>
              <h2>Кошелёк</h2>
              <span>Только чтение</span>
            </div>
            <WalletCards size={20} />
          </div>
          <div className="definition-list">
            {user.walletAccounts.length === 0 ? (
              <p className="muted">Счета отсутствуют.</p>
            ) : user.walletAccounts.map((account) => (
              <div key={account.currency}>
                <span>{account.currency}</span>
                <strong>{formatKopecks(account.availableKopecks)}</strong>
                <small>
                  Удержано: {formatKopecks(account.heldKopecks)}
                </small>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="data-section">
        <div className="section-title-row">
          <div>
            <h2>Последние заказы</h2>
            <span>{user.recentOrders.length}</span>
          </div>
        </div>
        {user.recentOrders.length === 0 ? (
          <p className="section-empty">Заказов пока нет.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Заказ</th>
                  <th>Мероприятие</th>
                  <th>Статус</th>
                  <th>Сумма</th>
                  <th>Создан</th>
                  <th><span className="sr-only">Открыть</span></th>
                </tr>
              </thead>
              <tbody>
                {user.recentOrders.map((order) => (
                  <tr key={order.id}>
                    <td><strong>{order.number}</strong></td>
                    <td>{order.eventTitle}</td>
                    <td>
                      <StatusPill tone={orderStatusTone(order.status)}>
                        {orderStatusLabel(order.status)}
                      </StatusPill>
                    </td>
                    <td className="money-cell">
                      {formatKopecks(order.totalKopecks)}
                    </td>
                    <td>{formatCompactDate(order.createdAt)}</td>
                    <td>
                      <Link
                        className="row-link"
                        href={`/orders/${order.id}`}
                        aria-label={`Открыть заказ ${order.number}`}
                      >
                        <ExternalLink size={17} />
                      </Link>
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
