"use client";

import { useEventWorkspace } from "@/components/event-workspace";
import { PageError, PageLoading } from "@/components/page-state";
import { ParticipantsExportButton } from "@/components/participants-export-button";
import { AdminApiError, getEventParticipants } from "@/lib/admin-api";
import { formatDateTime, formatKopecks } from "@/lib/format";
import {
  EMPTY_PARTICIPANTS_FILTER,
  filterParticipants,
  ticketTitlesOf,
  type ParticipantsFilter
} from "@/lib/participants-filter";
import type {
  EventParticipantRow,
  EventParticipantsView,
  ParticipantChannel
} from "@ticket-platform/contracts/admin-participants";
import { CircleAlert, RefreshCw, Search, Send, Tent } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

export default function EventParticipantsPage() {
  const { event } = useEventWorkspace();
  const [view, setView] = useState<EventParticipantsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ParticipantsFilter>(EMPTY_PARTICIPANTS_FILTER);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      setView(await getEventParticipants(event.id, signal));
    } catch (caught) {
      if (!signal?.aborted) {
        setError(caught instanceof AdminApiError
          ? caught.message
          : "Не удалось загрузить список участников.");
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

  const rows = useMemo(
    () => (view ? filterParticipants(view.rows, filter) : []),
    [view, filter]
  );
  const titles = useMemo(() => (view ? ticketTitlesOf(view.rows) : []), [view]);

  if (loading && !view) {
    return <PageLoading label="Собираем список участников" />;
  }
  if (error && !view) {
    return <PageError message={error} retry={() => void load()} />;
  }
  if (!view) {
    return <PageError message="Список недоступен." retry={() => void load()} />;
  }

  const filtered = rows.length !== view.rows.length;

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Участники</p>
          <h1>Кто едет</h1>
          <p>
            Покупатели бота и заведённые руками в одном списке. Посчитано{" "}
            {formatDateTime(view.calculatedAt)}
          </p>
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

      <div className="metrics-strip">
        <div>
          <span>Человек в списке</span>
          <strong>{view.totals.people}</strong>
          <small className="muted">
            {view.totals.guests} гостей: {view.totals.adults} взрослых,{" "}
            {view.totals.children} детей
          </small>
        </div>
        <div>
          <span>Из бота</span>
          <strong>{view.totals.fromOrders}</strong>
          <small className="muted">гостей по оплаченным заказам</small>
        </div>
        <div>
          <span>Завели руками</span>
          <strong>{view.totals.fromManual}</strong>
          <small className="muted">MAX, сайт, договорились напрямую</small>
        </div>
        <div>
          <span>Собрано</span>
          <strong>{formatKopecks(view.totals.amountKopecks)}</strong>
          <small className="muted">
            спальных мест {view.totals.sleepingPlaces}
          </small>
        </div>
      </div>

      {view.excludedOrders > 0 ? (
        <div className="accommodation-note">
          <CircleAlert size={16} />
          <span>
            Заказов помечено тестовыми: <strong>{view.excludedOrders}</strong>. В списке их
            нет, из финансовой истории они не удалены.
          </span>
        </div>
      ) : null}

      <form className="participants-filter-bar" onSubmit={(e) => e.preventDefault()}>
        <label className="search-field">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            value={filter.search}
            placeholder="Имя, ник, телефон или номер заказа"
            aria-label="Поиск участников"
            onChange={(e) => setFilter({ ...filter, search: e.target.value })}
          />
        </label>
        <label className="select-field">
          <span>Канал</span>
          <select
            value={filter.channel}
            onChange={(e) => setFilter({
              ...filter,
              channel: e.target.value as ParticipantChannel | ""
            })}
          >
            <option value="">Все каналы</option>
            <option value="telegram">Telegram</option>
            <option value="max">MAX</option>
            <option value="site">Сайт</option>
            <option value="direct">Напрямую</option>
            <option value="other">Другое</option>
          </select>
        </label>
        <label className="select-field">
          <span>Тариф</span>
          <select
            value={filter.ticketTitle}
            onChange={(e) => setFilter({ ...filter, ticketTitle: e.target.value })}
          >
            <option value="">Все тарифы</option>
            {titles.map((title) => (
              <option key={title} value={title}>{title}</option>
            ))}
          </select>
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={filter.sleepingOnly}
            onChange={(e) => setFilter({ ...filter, sleepingOnly: e.target.checked })}
          />
          <span>С ночёвкой</span>
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={filter.withChildrenOnly}
            onChange={(e) => setFilter({
              ...filter,
              withChildrenOnly: e.target.checked
            })}
          />
          <span>С детьми</span>
        </label>
      </form>

      <section className="data-section">
        <div className="section-title-row">
          <div>
            <h2>Список</h2>
            <span>
              {filtered
                ? `${rows.length} из ${view.rows.length}`
                : `${view.rows.length} человек`}
            </span>
          </div>
          <div className="outreach-toolbar-actions">
            <Link className="secondary-button" href={`/events/${event.id}/accommodation`}>
              <Tent size={16} />
              Что везём
            </Link>
          </div>
        </div>

        {view.rows.length === 0 ? (
          <div className="outreach-empty">
            <strong>Пока никого нет</strong>
            <span>
              Здесь появятся покупатели бота, как только пройдёт первая оплата. Тех, кто
              купил не через бота, заводят на вкладке «Логистика».
            </span>
          </div>
        ) : rows.length === 0 ? (
          <div className="outreach-empty">
            <strong>Под фильтр никто не подходит</strong>
            <span>Смягчите условия или очистите строку поиска.</span>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Участник</th>
                  <th>Канал</th>
                  <th>Тариф</th>
                  <th>Гостей</th>
                  <th>Мест</th>
                  <th>Сумма</th>
                  <th>Оплачено</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <ParticipantRow key={row.key} row={row} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function ParticipantRow({ row }: Readonly<{ row: EventParticipantRow }>) {
  return (
    <tr>
      <td>
        <div className="stacked-cell">
          <strong>{row.displayName}</strong>
          <span className="muted">
            {row.phone ?? "телефон не указан"}
            {row.telegramUsername ? ` · @${row.telegramUsername}` : ""}
          </span>
          {row.note ? <span className="muted">{row.note}</span> : null}
        </div>
      </td>
      <td>
        <span className="channel-cell">
          {row.origin === "order" ? <Send size={13} aria-hidden="true" /> : null}
          {channelLabel(row.channel)}
        </span>
        {row.orderNumber ? (
          <span className="muted"> · {row.orderNumber}</span>
        ) : null}
      </td>
      <td>{row.ticketTitle || "—"}</td>
      <td>
        {row.adults + row.children}
        {row.children > 0 ? (
          <span className="muted"> · детей {row.children}</span>
        ) : null}
      </td>
      <td>{row.sleepingPlaces > 0 ? row.sleepingPlaces : "—"}</td>
      <td className="money-cell">
        {row.amountKopecks ? formatKopecks(row.amountKopecks) : "—"}
      </td>
      <td>
        {row.paidAt ? formatDateTime(row.paidAt) : "—"}
        {row.paymentMethod ? (
          <span className="muted"> · {row.paymentMethod}</span>
        ) : null}
      </td>
    </tr>
  );
}

function channelLabel(channel: ParticipantChannel): string {
  switch (channel) {
    case "telegram":
      return "Telegram";
    case "max":
      return "MAX";
    case "site":
      return "Сайт";
    case "direct":
      return "Напрямую";
    default:
      return "Другое";
  }
}
