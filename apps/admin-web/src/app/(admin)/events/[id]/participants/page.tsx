"use client";

import { useEventWorkspace } from "@/components/event-workspace";
import { PageError, PageLoading } from "@/components/page-state";
import { ParticipantAddForm } from "@/components/participant-add-form";
import { ParticipantRowDrawer } from "@/components/participant-row-drawer";
import { ParticipantsImport } from "@/components/participants-import";
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
import {
  CircleAlert,
  ClipboardCheck,
  FileSpreadsheet,
  RefreshCw,
  Search,
  Send,
  Tent,
  UserPlus,
  PhoneCall,
  X
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

export default function EventParticipantsPage() {
  const { event } = useEventWorkspace();
  const [view, setView] = useState<EventParticipantsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ParticipantsFilter>(EMPTY_PARTICIPANTS_FILTER);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const offsite = event.format === "offsite";
  const isFree = event.isFree;
  const paid = !isFree;

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
  const openRow = openKey === null
    ? null
    : view.rows.find((row) => row.key === openKey) ?? null;

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Участники</p>
          <h1>{offsite ? "Кто едет" : "Кто придёт"}</h1>
          <p>
            {offsite
              ? "Покупатели бота и заведённые руками в одном списке. "
              : "Заявки с сайта и заведённые руками в одном списке. "}
            Посчитано {formatDateTime(view.calculatedAt)}
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
          {view.canManageParticipants ? (
            <>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setImportOpen((current) => !current)}
              >
                {importOpen ? <X size={16} /> : <FileSpreadsheet size={16} />}
                {importOpen ? "Свернуть" : "Загрузить таблицу"}
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => setAddOpen((current) => !current)}
              >
                {addOpen ? <X size={16} /> : <UserPlus size={16} />}
                {addOpen ? "Отменить" : "Добавить участника"}
              </button>
            </>
          ) : null}
          <ParticipantsExportButton eventId={event.id} eventSlug={event.slug} />
        </div>
      </div>

      {addOpen && view.canManageParticipants ? (
        <section className="data-section">
          <div className="section-title-row">
            <div>
              <h2>Новый участник</h2>
              <span>
                Тот, кто записался по телефону, в переписке или на сайте. В кампанию
                обзвона он попадёт сам.
              </span>
            </div>
          </div>
          <ParticipantAddForm
            eventId={event.id}
            format={event.format}
            isFree={event.isFree}
            onAdded={() => {
              setAddOpen(false);
              void load();
            }}
          />
        </section>
      ) : null}

      {importOpen ? (
        <ParticipantsImport
          eventId={event.id}
          onImported={() => load()}
          onClose={() => setImportOpen(false)}
        />
      ) : null}

      {error ? <PageError message={error} retry={() => void load()} /> : null}

      <div className="metrics-strip">
        <div>
          <span>Человек в списке</span>
          <strong>{view.totals.people}</strong>
          <small className="muted">
            {offsite
              ? `${view.totals.guests} гостей: ${view.totals.adults} взрослых, ${view.totals.children} детей`
              : `${view.totals.guests} гостей · ждём ${event.capacity}`}
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
          <small className="muted">
            {offsite ? "MAX, сайт, договорились напрямую" : "сайт, телефон, переписка"}
          </small>
        </div>
        {/* У бесплатной встречи денежная плитка всегда показывала ноль. Вместо неё —
            отметки явки: это то, ради чего в такой список и заглядывают. */}
        <div>
          <span>{isFree ? "Пришло" : "Собрано"}</span>
          <strong>
            {isFree
              ? `${view.attendance.attended} из ${view.attendance.registered}`
              : formatKopecks(view.totals.amountKopecks)}
          </strong>
          <small className="muted">
            {offsite ? `спальных мест ${view.totals.sleepingPlaces} · ` : ""}
            анкет {view.questionnaire.answered} из {view.questionnaire.people}
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
            <option value="timepad">Timepad</option>
            <option value="direct">Напрямую</option>
            <option value="other">Другое</option>
          </select>
        </label>
        {paid ? (
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
        ) : null}
        {offsite ? (
          <>
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
          </>
        ) : null}
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
            {/* Кампания у мероприятия своя, и участники попадают в неё сами. Ссылка нужна
                затем, что обзванивают людей именно там, а не в этом списке. */}
            {event.outreachCampaignId ? (
              <Link
                className="secondary-button"
                href={`/outreach/${event.outreachCampaignId}`}
              >
                <PhoneCall size={16} />
                Обзвон
              </Link>
            ) : null}
            {offsite ? (
              <Link className="secondary-button" href={`/events/${event.id}/accommodation`}>
                <Tent size={16} />
                Что везём
              </Link>
            ) : null}
          </div>
        </div>

        {view.rows.length === 0 ? (
          <div className="outreach-empty">
            <strong>Пока никого нет</strong>
            <span>
              {offsite
                ? "Здесь появятся покупатели бота, как только пройдёт первая оплата. Остальных заводят кнопкой «Добавить участника»."
                : "Заявки с сайта попадают сюда сами. Тех, кто записался по телефону или в переписке, заводят кнопкой «Добавить участника»."}
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
                {/* Столбцы про деньги и спальные места у бесплатной городской встречи
                    всегда пустые: показывать колонку прочерков незачем. */}
                <tr>
                  <th>Участник</th>
                  <th>Канал</th>
                  {paid ? <th>Тариф</th> : null}
                  <th>Гостей</th>
                  {offsite ? <th>Мест</th> : null}
                  {paid ? <th>Сумма</th> : null}
                  {paid ? <th>Оплачено</th> : null}
                  <th>Анкета</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <ParticipantRow
                    key={row.key}
                    row={row}
                    showSleeping={offsite}
                    showMoney={paid}
                    onOpen={() => setOpenKey(row.key)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {openRow ? (
        <ParticipantRowDrawer
          eventId={event.id}
          row={openRow}
          fields={view.fields}
          canManage={view.canManageParticipants}
          onClose={() => setOpenKey(null)}
          onSaved={() => load()}
        />
      ) : null}
    </>
  );
}

function ParticipantRow({
  row,
  showSleeping,
  showMoney,
  onOpen
}: Readonly<{
  row: EventParticipantRow;
  showSleeping: boolean;
  showMoney: boolean;
  onOpen: () => void;
}>) {
  const answered = row.customFields.some(
    (field) => field.value !== null && field.value !== ""
  );

  return (
    <tr>
      <td>
        <button className="outreach-contact-link" type="button" onClick={onOpen}>
          <strong>{row.displayName}</strong>
          <span>
            {row.phone ?? "телефон не указан"}
            {row.telegramUsername ? ` · @${row.telegramUsername}` : ""}
          </span>
        </button>
        {row.note ? <span className="muted">{row.note}</span> : null}
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
      {showMoney ? <td>{row.ticketTitle || "—"}</td> : null}
      <td>
        {row.adults + row.children}
        {row.children > 0 ? (
          <span className="muted"> · детей {row.children}</span>
        ) : null}
      </td>
      {showSleeping ? (
        <td>{row.sleepingPlaces > 0 ? row.sleepingPlaces : "—"}</td>
      ) : null}
      {showMoney ? (
        <td className="money-cell">
          {row.amountKopecks ? formatKopecks(row.amountKopecks) : "—"}
        </td>
      ) : null}
      {showMoney ? (
        <td>
          {row.paidAt ? formatDateTime(row.paidAt) : "—"}
          {row.paymentMethod ? (
            <span className="muted"> · {row.paymentMethod}</span>
          ) : null}
        </td>
      ) : null}
      <td>
        {answered ? (
          <span className="questionnaire-saved">
            <ClipboardCheck size={14} /> внесена
          </span>
        ) : (
          <span className="muted">—</span>
        )}
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
    case "timepad":
      return "Timepad";
    case "direct":
      return "Напрямую";
    default:
      return "Другое";
  }
}
