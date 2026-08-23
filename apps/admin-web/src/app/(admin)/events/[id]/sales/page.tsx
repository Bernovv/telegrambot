"use client";

import { EmptyState, PageError, PageLoading } from "@/components/page-state";
import { StatusPill } from "@/components/status-pill";
import { AdminApiError, listOrders } from "@/lib/admin-api";
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
import { ArrowRight, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Продажи мероприятия.
 *
 * Бывшие «Заказы», но по одному событию. Общий список по всем мероприятиям убран
 * намеренно: вопрос «кто не оплатил» задают про конкретный выезд, а не про базу целиком.
 * Найти отдельный заказ по номеру или имени по-прежнему можно — поиском по ⌘K.
 *
 * Подтверждение оплаты руками и возврат живут в карточке заказа: это действия с деньгами,
 * и делать их из списка, где строки похожи друг на друга, — способ однажды подтвердить не ту.
 */

const PAGE_SIZE = 50;

export default function EventSalesPage() {
  const params = useParams<{ readonly id: string }>();
  const [page, setPage] = useState<CursorPage<AdminOrderSummary> | null>(null);
  const [status, setStatus] = useState<AdminOrderStatus | "">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const loaded = await listOrders(
        {
          eventId: params.id,
          limit: PAGE_SIZE,
          ...(status === "" ? {} : { status })
        },
        signal
      );
      if (!signal?.aborted) {
        setPage(loaded);
      }
    } catch (caught) {
      if (!signal?.aborted) {
        setError(caught instanceof AdminApiError
          ? caught.message
          : "Не удалось загрузить продажи.");
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [params.id, status]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, reloads]);

  const items = useMemo(() => page?.items ?? [], [page]);
  const paid = useMemo(
    () => items.filter((order) => order.status === "paid"),
    [items]
  );
  const collected = useMemo(
    () => paid.reduce((sum, order) => sum + Number(order.totalKopecks ?? 0), 0),
    [paid]
  );

  if (loading && page === null) {
    return <PageLoading label="Считаем продажи" />;
  }
  if (error && page === null) {
    return <PageError message={error} retry={() => setReloads((n) => n + 1)} />;
  }

  return (
    <>
      <div className="metrics-strip metrics-strip-3">
        <div>
          <span>Заказов{page?.nextCursor ? " на странице" : ""}</span>
          <strong>{items.length}</strong>
        </div>
        <div>
          <span>Оплачено</span>
          <strong>{paid.length}</strong>
        </div>
        <div>
          <span>Собрано</span>
          <strong>{formatKopecks(String(collected))}</strong>
        </div>
      </div>

      <section className="data-section">
      <div className="section-title-row">
        <div>
          <h2>Заказы</h2>
          <span>только по этому мероприятию</span>
        </div>
        <div className="section-tools">
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as AdminOrderStatus | "")}
          >
            <option value="">Все состояния</option>
            {ADMIN_ORDER_STATUSES.map((value) => (
              <option key={value} value={value}>{orderStatusLabel(value)}</option>
            ))}
          </select>
          <button
            className="icon-button"
            type="button"
            aria-label="Обновить"
            title="Обновить"
            onClick={() => setReloads((n) => n + 1)}
          >
            <RefreshCw size={17} />
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="Заказов пока нет"
          description={
            status === ""
              ? "Как только кто-то купит билет, заказ появится здесь."
              : "В этом состоянии заказов нет. Снимите отбор."
          }
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Заказ</th>
                <th>Покупатель</th>
                <th>Состояние</th>
                <th>Сумма</th>
                <th>Создан</th>
                <th><span className="sr-only">Открыть</span></th>
              </tr>
            </thead>
            <tbody>
              {items.map((order) => (
                <tr key={order.id}>
                  <td>{order.number}</td>
                  <td>
                    <div className="stacked-cell">
                      <strong>{order.userDisplayName ?? "Без имени"}</strong>
                      <span className="muted">
                        {order.ticketCount === 1
                          ? "1 билет"
                          : `${order.ticketCount} билета/ов`}
                      </span>
                    </div>
                  </td>
                  <td>
                    <StatusPill tone={orderStatusTone(order.status)}>
                      {orderStatusLabel(order.status)}
                    </StatusPill>
                  </td>
                  <td className="money-cell">{formatKopecks(order.totalKopecks)}</td>
                  <td>{formatCompactDate(order.createdAt)}</td>
                  <td>
                    <Link className="row-link" href={`/orders/${order.id}`}>
                      <ArrowRight size={16} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {page?.nextCursor ? (
        <p className="section-note">
          Показаны первые {PAGE_SIZE}. Отдельный заказ ищется поиском по ⌘K.
        </p>
      ) : null}
      </section>
    </>
  );
}
