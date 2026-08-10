"use client";

import { EventPublicationPanel } from "@/components/event-publication-panel";
import { useEventWorkspace } from "@/components/event-workspace";
import { PageError, PageLoading } from "@/components/page-state";
import { ParticipantsExportButton } from "@/components/participants-export-button";
import { AdminApiError, getEventOverview } from "@/lib/admin-api";
import { formatDateTime, formatEventDateTime, formatKopecks } from "@/lib/format";
import type { EventOverview } from "@ticket-platform/contracts/admin-overview";
import { Check, CircleAlert, ExternalLink, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

export default function EventOverviewPage() {
  const { event, reload } = useEventWorkspace();
  const [overview, setOverview] = useState<EventOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      setOverview(await getEventOverview(event.id, signal));
    } catch (caught) {
      if (!signal?.aborted) {
        setError(caught instanceof AdminApiError
          ? caught.message
          : "Не удалось собрать обзор.");
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [event.id]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (loading && !overview) {
    return <PageLoading label="Собираем обзор" />;
  }
  if (error && !overview) {
    return <PageError message={error} retry={() => void load()} />;
  }
  if (!overview) {
    return <PageError message="Обзор недоступен." retry={() => void load()} />;
  }

  const { money, people, readiness } = overview;
  const utilization = people.capacity > 0
    ? Math.min(100, Math.round((people.occupiedUnits / people.capacity) * 100))
    : 0;
  const profit = money === null ? 0n : BigInt(money.profitKopecks);

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Обзор</p>
          <h1>Как идёт мероприятие</h1>
          <p>Посчитано {formatDateTime(overview.calculatedAt)}</p>
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
          <ParticipantsExportButton eventId={event.id} eventSlug={event.slug} />
        </div>
      </div>

      {error ? <PageError message={error} retry={() => void load()} /> : null}

      <section className="data-section">
        <div className="section-title-row">
          <div>
            <h2>Готовность</h2>
            <span>{overview.readinessDone} из {readiness.length} пунктов</span>
          </div>
        </div>
        <div className="readiness-list">
          {readiness.map((item) => (
            <Link
              className={item.done ? "readiness-item readiness-done" : "readiness-item"}
              key={item.code}
              href={`/events/${event.id}${item.tab ? `/${item.tab}` : ""}`}
            >
              <span className="readiness-mark" aria-hidden="true">
                {item.done ? <Check size={15} /> : <CircleAlert size={15} />}
              </span>
              <span className="readiness-copy">
                <strong>{item.label}</strong>
                <small>{item.hint}</small>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="data-section">
        <div className="section-title-row">
          <div>
            <h2>Люди</h2>
            <span>{people.people} человек в списке</span>
          </div>
        </div>
        <div className="metrics-strip">
          <div>
            <span>Заполнено мест</span>
            <strong>{people.occupiedUnits} / {people.capacity}</strong>
            <div
              className="capacity-track"
              role="progressbar"
              aria-label="Заполнение емкости"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={utilization}
            >
              <span style={{ width: `${utilization}%` }} />
            </div>
          </div>
          <div>
            <span>Гостей</span>
            <strong>{people.guests}</strong>
            <small className="muted">
              {people.adults} взрослых, {people.children} детей
            </small>
          </div>
          <div>
            <span>Ночуют</span>
            <strong>{people.sleepingPlaces}</strong>
            <small className="muted">
              из бота {people.fromOrders}, руками {people.fromManual}
            </small>
          </div>
          <div>
            <span>Анкет внесено</span>
            <strong>
              {people.questionnaireAnswered} / {people.questionnairePeople}
            </strong>
            <small className="muted">
              <Link href={`/events/${event.id}/questionnaire`}>внести ещё</Link>
            </small>
          </div>
        </div>
      </section>

      {money ? (
        <section className="data-section">
          <div className="section-title-row">
            <div>
              <h2>Деньги</h2>
              <span>
                {money.preliminary ? "предварительно" : "расход посчитан целиком"}
              </span>
            </div>
          </div>

          {money.preliminary ? (
            <div className="accommodation-warning">
              <CircleAlert size={16} />
              <span>
                У <strong>{money.expensesWithoutActual}</strong> строк расхода нет факта —
                прибыль сейчас завышена, а доли вместе с ней.
              </span>
            </div>
          ) : null}

          <div className="metrics-strip">
            <div>
              <span>Выручка</span>
              <strong>{formatKopecks(money.revenueKopecks)}</strong>
              <small className="muted">
                бот {formatKopecks(money.revenueFromOrdersKopecks)}
                {" · руками "}
                {formatKopecks(money.revenueFromManualKopecks)}
              </small>
            </div>
            <div>
              <span>Расходы</span>
              <strong>{formatKopecks(money.expensesActualKopecks)}</strong>
              <small className="muted">
                по смете {formatKopecks(money.expensesPlannedKopecks)}
              </small>
            </div>
            <div>
              <span>Прибыль</span>
              <strong className={profit < 0n ? "money-negative" : undefined}>
                {formatKopecks(money.profitKopecks)}
              </strong>
              <small className="muted">выручка минус фактические расходы</small>
            </div>
            <div>
              <span>Не распределено</span>
              <strong>{formatKopecks(money.unallocatedKopecks)}</strong>
              <small className="muted">
                <Link href={`/events/${event.id}/team`}>раздать доли</Link>
              </small>
            </div>
          </div>

          {money.organizers.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Организатор</th>
                    <th>Доля</th>
                    <th>Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  {money.organizers.map((organizer) => (
                    <tr key={organizer.personName}>
                      <td><strong>{organizer.personName}</strong></td>
                      <td>{organizer.sharePercent} %</td>
                      <td
                        className={
                          BigInt(organizer.shareKopecks) < 0n
                            ? "money-cell money-negative"
                            : "money-cell"
                        }
                      >
                        {formatKopecks(organizer.shareKopecks)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="detail-grid">
        <section className="detail-section">
          <div className="section-title-row">
            <div>
              <h2>Основное</h2>
              <span>Версия {event.lockVersion}</span>
            </div>
          </div>
          <div className="definition-list">
            <div><span>Slug</span><strong>{event.slug}</strong></div>
            <div>
              <span>Период</span>
              <strong>{formatEventDateTime(event.startsAt, event.timezone)}</strong>
              <small>{formatEventDateTime(event.endsAt, event.timezone)}</small>
            </div>
            <div>
              <span>Продажи</span>
              <strong>{formatEventDateTime(event.salesStartsAt, event.timezone)}</strong>
              <small>{formatEventDateTime(event.salesEndsAt, event.timezone)}</small>
            </div>
            <div>
              <span>Адрес</span>
              <strong>{event.locationAddress ?? "—"}</strong>
              <small>{event.locationName ?? "—"}</small>
            </div>
            <div><span>Поддержка</span><strong>{event.supportContact ?? "—"}</strong></div>
            <div><span>Резерв</span><strong>{event.reservationTtlMinutes} мин.</strong></div>
          </div>
        </section>

        <section className="detail-section">
          <div className="section-title-row">
            <div>
              <h2>Публикация</h2>
              <span>{event.publishedAt ? "Публичная версия" : "Не опубликовано"}</span>
            </div>
          </div>
          <div className="definition-list">
            <div>
              <span>Оферта</span>
              <strong>{event.offerRequired ? "Обязательна" : "Не обязательна"}</strong>
            </div>
            <div>
              <span>Телефон</span>
              <strong>
                {event.phoneRequiredForPurchase ? "Обязателен" : "Не обязателен"}
              </strong>
            </div>
            <div>
              <span>Заказы</span>
              <strong>{event.paidOrderCount} / {event.orderCount}</strong>
              <small>оплачено из всех</small>
            </div>
            <div>
              <span>Опубликовано</span>
              <strong>{formatEventDateTime(event.publishedAt, event.timezone)}</strong>
            </div>
          </div>
          {event.activeOffer ? (
            <a
              className="offer-link"
              href={event.activeOffer.publicUrl}
              target="_blank"
              rel="noreferrer"
            >
              <span>
                <strong>{event.activeOffer.documentTitle}</strong>
                <small>Версия {event.activeOffer.versionNumber}</small>
              </span>
              <ExternalLink size={17} />
            </a>
          ) : null}
          {event.status === "draft" ? (
            <EventPublicationPanel event={event} onPublished={() => reload()} />
          ) : null}
        </section>
      </div>
    </>
  );
}
