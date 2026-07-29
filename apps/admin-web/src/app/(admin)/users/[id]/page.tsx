"use client";

import { PageError, PageLoading } from "@/components/page-state";
import { StatusPill } from "@/components/status-pill";
import {
  AdminApiError,
  assignUserCategory,
  assignUserStatus,
  getUser,
  getUserClassificationCatalog,
  removeUserCategory,
  removeUserStatus
} from "@/lib/admin-api";
import {
  formatCompactDate,
  formatDateTime,
  formatKopecks,
  orderStatusLabel,
  orderStatusTone
} from "@/lib/format";
import type { AdminUserDetail } from "@ticket-platform/contracts";
import type { AdminUserClassificationCatalog } from "@ticket-platform/contracts/admin-user-classification";
import { ArrowLeft, ExternalLink, Plus, WalletCards, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [user, setUser] = useState<AdminUserDetail | null>(null);
  const [catalog, setCatalog] =
    useState<AdminUserClassificationCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusCode, setStatusCode] = useState("");
  const [categoryCode, setCategoryCode] = useState("");
  const [classificationReason, setClassificationReason] = useState("");
  const [classificationBusy, setClassificationBusy] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const [nextUser, nextCatalog] = await Promise.all([
        getUser(id, signal),
        getUserClassificationCatalog(signal)
      ]);
      setUser(nextUser);
      setCatalog(nextCatalog);
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

  const mutateClassification = useCallback(async (
    work: () => Promise<unknown>
  ) => {
    if (classificationReason.trim().length < 3) {
      setError("Укажите причину изменения не короче трёх символов.");
      return;
    }
    setClassificationBusy(true);
    setError(null);
    try {
      await work();
      setClassificationReason("");
      await load();
    } catch (caught) {
      setError(
        caught instanceof AdminApiError
          ? caught.message
          : "Не удалось изменить классификацию."
      );
    } finally {
      setClassificationBusy(false);
    }
  }, [classificationReason, load]);

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
            <h2>Статусы и категории</h2>
            <span>{user.classificationHistory.length} записей истории</span>
          </div>
          <Link className="secondary-button compact-button" href="/classification">
            Справочники
          </Link>
        </div>
        <div className="classification-actions">
          <label>
            <span>Причина изменения</span>
            <input
              value={classificationReason}
              maxLength={500}
              onChange={(event) => setClassificationReason(event.target.value)}
              placeholder="Например: подтверждено оператором"
            />
          </label>
          <div>
            <select
              aria-label="Статус"
              value={statusCode}
              onChange={(event) => setStatusCode(event.target.value)}
            >
              <option value="">Выберите статус</option>
              {catalog?.statuses.filter((item) => item.isActive).map((item) => (
                <option key={item.id} value={item.code}>
                  {item.displayName}
                </option>
              ))}
            </select>
            <button
              className="icon-button"
              type="button"
              title="Назначить статус"
              disabled={!statusCode || classificationBusy}
              onClick={() => void mutateClassification(
                () => assignUserStatus(id, {
                  code: statusCode,
                  reason: classificationReason
                })
              )}
            >
              <Plus size={17} />
              <span className="sr-only">Назначить статус</span>
            </button>
          </div>
          <div>
            <select
              aria-label="Категория"
              value={categoryCode}
              onChange={(event) => setCategoryCode(event.target.value)}
            >
              <option value="">Выберите категорию</option>
              {catalog?.categories.filter((item) => item.isActive).map((item) => (
                <option key={item.id} value={item.code}>
                  {item.displayName}
                </option>
              ))}
            </select>
            <button
              className="icon-button"
              type="button"
              title="Добавить категорию"
              disabled={!categoryCode || classificationBusy}
              onClick={() => void mutateClassification(
                () => assignUserCategory(id, {
                  code: categoryCode,
                  reason: classificationReason
                })
              )}
            >
              <Plus size={17} />
              <span className="sr-only">Добавить категорию</span>
            </button>
          </div>
        </div>
        {user.activeStatuses.length === 0
          && user.activeCategories.length === 0 ? (
            <p className="section-empty">Активных назначений нет.</p>
          ) : (
            <div className="user-classification-summary">
              {user.activeStatuses.map((assignment) => (
                  <div key={`status:${assignment.code}:${assignment.assignedAt}`}>
                    <span
                      className="classification-swatch"
                      style={{ backgroundColor: assignment.color }}
                      aria-hidden="true"
                    />
                    <div>
                      <strong>{assignment.displayName}</strong>
                      <small>
                        {assignment.code} · {assignment.source} ·{" "}
                        {formatDateTime(assignment.assignedAt)}
                      </small>
                    </div>
                    <button
                      className="icon-button"
                      type="button"
                      title="Снять статус"
                      disabled={classificationBusy}
                      onClick={() => void mutateClassification(
                        () => removeUserStatus(id, assignment.code, {
                          reason: classificationReason
                        })
                      )}
                    >
                      <X size={16} />
                      <span className="sr-only">Снять статус</span>
                    </button>
                  </div>
              ))}
              {user.activeCategories.map((assignment) => (
                <div key={`category:${assignment.code}:${assignment.assignedAt}`}>
                  <span
                    className="classification-swatch"
                    style={{ backgroundColor: assignment.color }}
                    aria-hidden="true"
                  />
                  <div>
                    <strong>{assignment.displayName}</strong>
                    <small>
                      {assignment.code} · {assignment.source} ·{" "}
                      {formatDateTime(assignment.assignedAt)}
                    </small>
                  </div>
                  <button
                    className="icon-button"
                    type="button"
                    title="Снять категорию"
                    disabled={classificationBusy}
                    onClick={() => void mutateClassification(
                      () => removeUserCategory(id, assignment.code, {
                        reason: classificationReason
                      })
                    )}
                  >
                    <X size={16} />
                    <span className="sr-only">Снять категорию</span>
                  </button>
                </div>
              ))}
            </div>
          )}
      </section>

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
