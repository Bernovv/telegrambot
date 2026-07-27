"use client";

import { OrderActions } from "@/components/order-actions";
import { PageError, PageLoading } from "@/components/page-state";
import { StatusPill } from "@/components/status-pill";
import { AdminApiError, getOrder } from "@/lib/admin-api";
import {
  formatDateTime,
  formatKopecks,
  orderStatusLabel,
  orderStatusTone
} from "@/lib/format";
import type { AdminOrderDetail } from "@ticket-platform/contracts";
import { ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<AdminOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
