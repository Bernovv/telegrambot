"use client";

import { OrderActions } from "@/components/order-actions";
import { PageError, PageLoading } from "@/components/page-state";
import { StatusPill } from "@/components/status-pill";
import {
  AdminApiError,
  cancelOrder,
  excludeOrderFromReports,
  getOrder,
  includeOrderInReports
} from "@/lib/admin-api";
import {
  formatDateTime,
  formatKopecks,
  orderStatusLabel,
  orderStatusTone
} from "@/lib/format";
import type { AdminOrderDetail } from "@ticket-platform/contracts";
import { ArrowLeft, Ban, Eye, EyeOff, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

// Совпадает с проверкой на сервере: платёж в пути и оплаченный заказ так не отменяют.
const CANCELLABLE_STATUSES = new Set([
  "draft",
  "awaiting_offer",
  "awaiting_payment"
]);

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<AdminOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hiding, setHiding] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      setOrder(await getOrder(id, signal));
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

  async function toggleHidden() {
    if (!order) {
      return;
    }
    let reason: string | null = null;
    if (!order.excludedAt) {
      reason = window.prompt(
        "Почему скрываем заказ? Причина сохранится в карточке."
      );
      if (!reason || reason.trim().length < 3) {
        return;
      }
    }
    setHiding(true);
    setError(null);
    try {
      await (order.excludedAt
        ? includeOrderInReports(order.id)
        : excludeOrderFromReports({ orderId: order.id, reason: reason as string }));
      await load();
    } catch (caught) {
      setError(
        caught instanceof AdminApiError
          ? caught.message
          : "Не удалось изменить видимость заказа."
      );
    } finally {
      setHiding(false);
    }
  }

  async function cancel() {
    if (!order) {
      return;
    }
    const reason = window.prompt(
      `Отменить заказ ${order.number}? Бронь мест снимется, бонусы вернутся покупателю. Укажите причину.`
    );
    if (!reason || reason.trim().length < 3) {
      return;
    }
    setCancelling(true);
    setError(null);
    try {
      await cancelOrder({ orderId: order.id, reason: reason.trim() });
      await load();
    } catch (caught) {
      setError(
        caught instanceof AdminApiError
          ? caught.message
          : "Не удалось отменить заказ."
      );
    } finally {
      setCancelling(false);
    }
  }

  if (loading && !order) {
    return <PageLoading label="Загружаем заказ" />;
  }
  if (error || !order) {
    return (
      <PageError
        message={error ?? "Заказ не найден."}
        retry={() => void load()}
      />
    );
  }

  return (
    <>
      <Link className="back-link" href="/orders">
        <ArrowLeft size={16} />
        Заказы
      </Link>
      <div className="detail-heading order-heading">
        <div>
          <p className="eyebrow">Заказ</p>
          <div className="title-with-status">
            <h1>{order.number}</h1>
            <StatusPill tone={orderStatusTone(order.status)}>
              {orderStatusLabel(order.status)}
            </StatusPill>
          </div>
          <p>{order.eventTitle}</p>
        </div>
        <Link className="secondary-button" href={`/users/${order.userId}`}>
          Покупатель
          <ExternalLink size={16} />
        </Link>
      </div>

      <div className="metrics-strip">
        <div>
          <span>Итого</span>
          <strong>{formatKopecks(order.totalKopecks)}</strong>
        </div>
        <div>
          <span>Баланс</span>
          <strong>{formatKopecks(order.walletAppliedKopecks)}</strong>
        </div>
        <div>
          <span>Внешняя оплата</span>
          <strong>{formatKopecks(order.externalDueKopecks)}</strong>
        </div>
        <div>
          <span>Создан</span>
          <strong>{formatDateTime(order.createdAt)}</strong>
        </div>
      </div>

      <OrderActions order={order} onSettled={() => load()} />

      {CANCELLABLE_STATUSES.has(order.status) ? (
        <div className="plan-banner">
          <div>
            <strong>Заказ не оплачен</strong>
            <span>
              Отмена снимет бронь мест и вернёт покупателю захолдированные бонусы.
              Оплаченный заказ так отменить нельзя — для него есть возврат.
            </span>
          </div>
          <button
            className="secondary-button"
            type="button"
            disabled={cancelling}
            onClick={() => void cancel()}
          >
            <Ban size={16} />
            Отменить заказ
          </button>
        </div>
      ) : null}

      <div className={order.excludedAt ? "plan-banner plan-banner-stale" : "plan-banner"}>
        <div>
          <strong>
            {order.excludedAt
              ? "Заказ скрыт из отчётов"
              : "Заказ учитывается в отчётах"}
          </strong>
          <span>
            {order.excludedAt
              ? order.excludedReason ?? "Причина не указана"
              : "Тестовые, ошибочные и брошенные заказы можно скрыть — из истории они не исчезнут."}
          </span>
        </div>
        <button
          className="secondary-button"
          type="button"
          disabled={hiding}
          onClick={() => void toggleHidden()}
        >
          {order.excludedAt ? <Eye size={16} /> : <EyeOff size={16} />}
          {order.excludedAt ? "Вернуть в отчёты" : "Скрыть из отчётов"}
        </button>
      </div>

      <section className="data-section">
        <div className="section-title-row">
          <div>
            <h2>Состав заказа</h2>
            <span>Snapshot версии {order.lockVersion}</span>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Позиция</th>
                <th>Количество</th>
                <th>Цена</th>
                <th>Сумма</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((item) => (
                <tr key={item.id}>
                  <td><strong>{item.title}</strong></td>
                  <td>{item.quantity}</td>
                  <td className="money-cell">
                    {formatKopecks(item.unitPriceKopecks)}
                  </td>
                  <td className="money-cell">
                    {formatKopecks(item.lineTotalKopecks)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="detail-grid">
        <section className="detail-section">
          <div className="section-title-row">
            <div>
              <h2>Платежи</h2>
              <span>{order.paymentAttempts.length}</span>
            </div>
          </div>
          <div className="activity-list">
            {order.paymentAttempts.length === 0 ? (
              <p className="muted">Попыток оплаты нет.</p>
            ) : order.paymentAttempts.map((payment) => (
              <div key={payment.id} className="activity-row">
                <span className="activity-dot" />
                <div>
                  <strong>
                    {payment.provider} · {formatKopecks(payment.amountKopecks)}
                  </strong>
                  <span>
                    {payment.providerStatus ?? payment.status}
                    {" · "}
                    {formatDateTime(payment.createdAt)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="detail-section">
          <div className="section-title-row">
            <div>
              <h2>Билеты</h2>
              <span>{order.tickets.length}</span>
            </div>
          </div>
          <div className="activity-list">
            {order.tickets.length === 0 ? (
              <p className="muted">Билеты не выпущены.</p>
            ) : order.tickets.map((ticket) => (
              <div key={ticket.id} className="activity-row">
                <span className="activity-dot activity-dot-green" />
                <div>
                  <strong>{ticket.number}</strong>
                  <span>
                    {ticket.status} · {formatDateTime(ticket.issuedAt)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="detail-section timeline-section">
        <div className="section-title-row">
          <div>
            <h2>История статусов</h2>
            <span>Append-only журнал</span>
          </div>
        </div>
        <div className="timeline">
          {order.history.map((entry, index) => (
            <div
              key={`${entry.occurredAt}:${entry.toStatus}:${index}`}
              className="timeline-entry"
            >
              <span className="timeline-marker" />
              <div>
                <div className="timeline-title">
                  <strong>{entry.toStatus}</strong>
                  <time>{formatDateTime(entry.occurredAt)}</time>
                </div>
                <p>{entry.reason}</p>
                <span>{entry.actorType}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
