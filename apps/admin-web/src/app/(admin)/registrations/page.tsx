"use client";

import { EmptyState, PageError, PageLoading } from "@/components/page-state";
import { StatusPill } from "@/components/status-pill";
import { AdminApiError, listSiteRegistrations } from "@/lib/admin-api";
import { formatDateTime } from "@/lib/format";
import type {
  AdminSiteRegistration,
  AdminSiteRegistrationPage,
  AdminSiteRegistrationState
} from "@ticket-platform/contracts/site-registration";
import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

const STATE_LABELS: Record<AdminSiteRegistrationState, string> = {
  registered: "Записан",
  duplicate: "Уже был в списке",
  unassigned: "Встреча не нашлась"
};

const STATE_HINTS: Record<AdminSiteRegistrationState, string> = {
  registered: "Человек в списке участников встречи.",
  duplicate: "Этот телефон в списке встречи уже был — второй раз не заводили.",
  unassigned: "Ближайшей встречи со слагом «sreda…» не нашлось. Заявка ждёт разбора."
};

export default function SiteRegistrationsPage() {
  const [data, setData] = useState<AdminSiteRegistrationPage | null>(null);
  const [needsAttention, setNeedsAttention] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      setData(await listSiteRegistrations(
        { ...(needsAttention ? { needsAttention: true } : {}), page, limit: 50 },
        signal
      ));
    } catch (caught) {
      if (!signal?.aborted) {
        setError(caught instanceof AdminApiError
          ? caught.message
          : "Не удалось загрузить заявки.");
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [needsAttention, page]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Продажи</p>
          <h1>Заявки с сайта</h1>
          <p>
            Всё, что пришло с формы на сайте — включая те заявки, по которым участника
            не завели.
          </p>
        </div>
        <div className="heading-actions">
          <label className="outreach-mine-toggle">
            <input
              type="checkbox"
              checked={needsAttention}
              onChange={(event) => {
                setPage(1);
                setNeedsAttention(event.target.checked);
              }}
            />
            <span>Только требующие разбора</span>
          </label>
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
      </div>

      {/* Ради этой строки раздел и заведён: заявка, по которой никого не завели, раньше
          жила только в базе и в одном уведомлении в Telegram. */}
      {data && data.needsAttention > 0 && !needsAttention ? (
        <div className="page-warning">
          Ждут разбора: {data.needsAttention}. Человек оставил телефон, а в списке
          участников его нет.
        </div>
      ) : null}

      {loading && !data ? <PageLoading /> : null}
      {error ? <PageError message={error} retry={() => void load()} /> : null}
      {data && data.items.length === 0 && !loading ? (
        <EmptyState
          title={needsAttention ? "Всё разобрано" : "Заявок пока нет"}
          description={needsAttention
            ? "По каждой заявке с сайта человек попал в список участников."
            : "Как только с формы на сайте придёт заявка, она появится здесь."}
        />
      ) : null}

      {data && data.items.length > 0 ? (
        <>
          <div className={loading ? "table-wrap table-refreshing" : "table-wrap"}>
            <table>
              <thead>
                <tr>
                  <th>Человек</th>
                  <th>Телефон</th>
                  <th>Встреча</th>
                  <th>Что вышло</th>
                  <th>Страница</th>
                  <th>Пришла</th>
                  <th><span className="sr-only">Открыть</span></th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((registration) => (
                  <tr key={registration.id}>
                    <td><strong>{registration.displayName}</strong></td>
                    <td>{registration.phone}</td>
                    <td>
                      {registration.eventId ? (
                        <Link
                          className="offer-link-inline"
                          href={`/events/${registration.eventId}/participants`}
                        >
                          {registration.eventTitle}
                        </Link>
                      ) : (
                        <span className="muted">не определена</span>
                      )}
                    </td>
                    <td>
                      <div className="stacked-cell">
                        <StatusPill tone={toneFor(registration.state)}>
                          {STATE_LABELS[registration.state]}
                        </StatusPill>
                        <span className="muted">{STATE_HINTS[registration.state]}</span>
                      </div>
                    </td>
                    <td>{registration.page || <span className="muted">—</span>}</td>
                    <td>{formatDateTime(registration.createdAt)}</td>
                    <td>
                      {registration.contactId ? (
                        <Link
                          className="offer-link-inline"
                          href={`/base/${registration.contactId}`}
                        >
                          Карточка
                        </Link>
                      ) : (
                        <span className="muted">нет в базе</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <button
              className="secondary-button"
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((current) => current - 1)}
            >
              Назад
            </button>
            <span>Страница {data.page}</span>
            <button
              className="secondary-button"
              type="button"
              disabled={data.page * data.limit >= data.total || loading}
              onClick={() => setPage((current) => current + 1)}
            >
              Далее
            </button>
          </div>
        </>
      ) : null}
    </>
  );
}

function toneFor(
  state: AdminSiteRegistration["state"]
): "positive" | "warning" | "neutral" | "danger" {
  if (state === "registered") {
    return "positive";
  }
  return state === "unassigned" ? "danger" : "warning";
}
