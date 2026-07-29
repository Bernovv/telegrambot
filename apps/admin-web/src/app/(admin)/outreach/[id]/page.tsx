"use client";

import { PageError, PageLoading } from "@/components/page-state";
import { StatusPill } from "@/components/status-pill";
import {
  AdminApiError,
  assignOutreachContacts,
  exportOutreachCampaign,
  getOutreachCampaign,
  getOutreachContact,
  importOutreachContacts,
  listOutreachContacts,
  listOutreachManagers,
  recordOutreachActivities,
  updateOutreachCampaign,
  type OutreachContactFilters
} from "@/lib/admin-api";
import { formatDateTime } from "@/lib/format";
import { parseOutreachCsv } from "@/lib/outreach-csv";
import type {
  OutreachCampaignContactDetail,
  OutreachCampaignContactPage,
  OutreachCampaignSummary,
  OutreachChannel,
  OutreachContactStatus,
  OutreachManager
} from "@ticket-platform/contracts/admin-outreach";
import {
  ArrowLeft,
  Check,
  Download,
  FileUp,
  MessageCircle,
  Phone,
  RefreshCw,
  Search,
  UserRoundCheck,
  X
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

interface ActionTarget {
  readonly ids: readonly string[];
  readonly channel: OutreachChannel;
}

export default function OutreachCampaignPage() {
  const { id } = useParams<{ id: string }>();
  const fileInput = useRef<HTMLInputElement>(null);
  const [campaign, setCampaign] = useState<OutreachCampaignSummary | null>(null);
  const [contacts, setContacts] = useState<OutreachCampaignContactPage | null>(null);
  const [managers, setManagers] = useState<readonly OutreachManager[]>([]);
  const [filters, setFilters] = useState<OutreachContactFilters>({ page: 1, limit: 50 });
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [action, setAction] = useState<ActionTarget | null>(null);
  const [detail, setDetail] = useState<OutreachCampaignContactDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const [campaignResult, contactResult, managerResult] = await Promise.all([
        getOutreachCampaign(id, signal),
        listOutreachContacts(id, filters, signal),
        listOutreachManagers(signal)
      ]);
      setCampaign(campaignResult);
      setContacts(contactResult);
      setManagers(managerResult);
      setSelected([]);
    } catch (caught) {
      if (!signal?.aborted) {
        setError(messageFor(caught, "Не удалось загрузить кампанию."));
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [filters, id]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const pageIds = useMemo(
    () => contacts?.items.map((contact) => contact.id) ?? [],
    [contacts]
  );
  const allSelected = pageIds.length > 0
    && pageIds.every((contactId) => selected.includes(contactId));

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const search = formText(data, "search").trim();
    const status = formText(data, "status") as OutreachContactStatus | "";
    const assignedAdminId = formText(data, "assignedAdminId");
    setFilters({
      page: 1,
      limit: 50,
      ...(search ? { search } : {}),
      ...(status ? { status } : {}),
      ...(assignedAdminId === "mine"
        ? { mine: true }
        : assignedAdminId
          ? { assignedAdminId }
          : {})
    });
  }

  function toggleAll() {
    setSelected(allSelected ? [] : pageIds);
  }

  function toggleOne(contactId: string) {
    setSelected((current) =>
      current.includes(contactId)
        ? current.filter((idValue) => idValue !== contactId)
        : [...current, contactId]
    );
  }

  async function submitActivity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action) {
      return;
    }
    const data = new FormData(event.currentTarget);
    const result = formText(data, "result") as Exclude<OutreachContactStatus, "new">;
    const note = formText(data, "note").trim();
    const nextContactValue = formText(data, "nextContactAt");
    setMutating(true);
    setError(null);
    try {
      const response = await recordOutreachActivities({
        campaignContactIds: action.ids,
        channel: action.channel,
        result,
        ...(note ? { note } : {}),
        ...(nextContactValue
          ? { nextContactAt: new Date(nextContactValue).toISOString() }
          : {})
      });
      setNotice(`Записано действий: ${response.recorded}`);
      setAction(null);
      await load();
    } catch (caught) {
      setError(messageFor(caught, "Не удалось записать действие."));
    } finally {
      setMutating(false);
    }
  }

  async function assign(event: ChangeEvent<HTMLSelectElement>) {
    const assignedAdminId = event.target.value;
    if (!assignedAdminId || selected.length === 0) {
      return;
    }
    setMutating(true);
    setError(null);
    try {
      const response = await assignOutreachContacts({
        campaignContactIds: selected,
        assignedAdminId
      });
      setNotice(`Назначено контактов: ${response.updated}`);
      await load();
    } catch (caught) {
      setError(messageFor(caught, "Не удалось назначить менеджера."));
    } finally {
      event.target.value = "";
      setMutating(false);
    }
  }

  async function importCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    if (file.size > 5_000_000) {
      setError("CSV-файл должен быть не больше 5 МБ.");
      return;
    }
    setMutating(true);
    setError(null);
    setNotice(null);
    try {
      const rows = parseOutreachCsv(await file.text());
      if (!window.confirm(`Добавить в кампанию ${rows.length} контактов?`)) {
        return;
      }
      let added = 0;
      let duplicates = 0;
      for (let offset = 0; offset < rows.length; offset += 150) {
        const result = await importOutreachContacts(id, {
          rows: rows.slice(offset, offset + 150)
        });
        added += result.addedToCampaign;
        duplicates += result.alreadyInCampaign;
      }
      setNotice(`Добавлено: ${added}. Уже были в кампании: ${duplicates}.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось импортировать CSV.");
    } finally {
      setMutating(false);
    }
  }

  async function downloadExport() {
    setMutating(true);
    setError(null);
    try {
      const result = await exportOutreachCampaign(id);
      const url = URL.createObjectURL(
        new Blob([result.csv], { type: "text/csv;charset=utf-8" })
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(messageFor(caught, "Не удалось подготовить экспорт."));
    } finally {
      setMutating(false);
    }
  }

  async function openDetail(contactId: string) {
    setMutating(true);
    setError(null);
    try {
      setDetail(await getOutreachContact(contactId));
    } catch (caught) {
      setError(messageFor(caught, "Не удалось открыть историю."));
    } finally {
      setMutating(false);
    }
  }

  async function completeCampaign() {
    if (!campaign || !window.confirm("Завершить кампанию? Импорт после этого будет закрыт.")) {
      return;
    }
    setMutating(true);
    try {
      setCampaign(await updateOutreachCampaign(id, { status: "completed" }));
      setNotice("Кампания завершена.");
    } catch (caught) {
      setError(messageFor(caught, "Не удалось завершить кампанию."));
    } finally {
      setMutating(false);
    }
  }

  if (loading && !campaign) {
    return <PageLoading label="Загружаем кампанию" />;
  }
  if (error && !campaign) {
    return <PageError message={error} retry={() => void load()} />;
  }
  if (!campaign) {
    return <PageError message="Кампания не найдена." retry={() => void load()} />;
  }

  const processed = campaign.totalContacts - campaign.untouchedContacts;

  return (
    <>
      <Link className="back-link" href="/outreach">
        <ArrowLeft size={16} />
        Работа с базой
      </Link>
      <div className="page-heading outreach-heading">
        <div>
          <p className="eyebrow">Кампания</p>
          <div className="title-with-status">
            <h1>{campaign.name}</h1>
            <StatusPill tone={campaign.status === "completed" ? "neutral" : "positive"}>
              {campaign.status === "completed" ? "Завершена" : "Активна"}
            </StatusPill>
          </div>
          <p>{campaign.description ?? "Без описания"}</p>
        </div>
        <div className="heading-actions">
          <button
            className="icon-button bordered"
            type="button"
            aria-label="Обновить"
            title="Обновить"
            disabled={loading || mutating}
            onClick={() => void load()}
          >
            <RefreshCw size={18} />
          </button>
          <input
            ref={fileInput}
            className="sr-only"
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => void importCsv(event)}
          />
          <button
            className="secondary-button"
            type="button"
            disabled={mutating || campaign.status === "completed"}
            onClick={() => fileInput.current?.click()}
          >
            <FileUp size={16} />
            Импорт CSV
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={mutating}
            onClick={() => void downloadExport()}
          >
            <Download size={16} />
            Экспорт
          </button>
          {campaign.status !== "completed" ? (
            <button
              className="secondary-button"
              type="button"
              disabled={mutating}
              onClick={() => void completeCampaign()}
            >
              <Check size={16} />
              Завершить
            </button>
          ) : null}
        </div>
      </div>

      <div className="metrics-strip">
        <div><span>Всего контактов</span><strong>{campaign.totalContacts}</strong></div>
        <div><span>Обработано</span><strong>{processed}</strong></div>
        <div><span>Заинтересованы</span><strong>{campaign.interestedContacts}</strong></div>
        <div><span>Оплатили / зарегистрировались</span><strong>{campaign.convertedContacts}</strong></div>
      </div>

      {notice ? <div className="outreach-notice">{notice}</div> : null}
      {error ? <PageError message={error} retry={() => void load()} /> : null}

      <form className="filter-bar outreach-filters" onSubmit={applyFilters}>
        <label className="search-field">
          <Search size={17} aria-hidden="true" />
          <input name="search" type="search" placeholder="Имя, телефон, Telegram или MAX" />
        </label>
        <label className="select-field">
          <span>Статус</span>
          <select name="status" defaultValue="">
            <option value="">Все</option>
            {OUTREACH_STATUSES.map((status) => (
              <option key={status} value={status}>{statusLabel(status)}</option>
            ))}
          </select>
        </label>
        <label className="select-field">
          <span>Ответственный</span>
          <select name="assignedAdminId" defaultValue="">
            <option value="">Все</option>
            <option value="mine">Только мои</option>
            {managers.map((manager) => (
              <option key={manager.id} value={manager.id}>{manager.displayName}</option>
            ))}
          </select>
        </label>
        <button className="primary-button" type="submit">
          <Search size={16} />
          Показать
        </button>
      </form>

      {selected.length > 0 ? (
        <div className="outreach-bulk-bar">
          <strong>Выбрано: {selected.length}</strong>
          <button
            className="secondary-button"
            type="button"
            disabled={mutating}
            onClick={() => setAction({ ids: selected, channel: "telegram" })}
          >
            <MessageCircle size={16} />
            Отметить сообщения
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={mutating}
            onClick={() => setAction({ ids: selected, channel: "phone" })}
          >
            <Phone size={16} />
            Отметить звонки
          </button>
          <label className="select-field outreach-assign">
            <span>Назначить менеджера</span>
            <select defaultValue="" onChange={(event) => void assign(event)} disabled={mutating}>
              <option value="">Выберите</option>
              {managers.map((manager) => (
                <option key={manager.id} value={manager.id}>{manager.displayName}</option>
              ))}
            </select>
          </label>
          <button className="icon-button" type="button" aria-label="Снять выделение" onClick={() => setSelected([])}>
            <X size={18} />
          </button>
        </div>
      ) : null}

      <section className="data-section" aria-label="Контакты кампании">
        <div className="section-title-row">
          <div>
            <h2>Контакты</h2>
            <span>{contacts ? `${contacts.total} в кампании` : "—"}</span>
          </div>
        </div>
        {loading && !contacts ? <PageLoading /> : null}
        {contacts?.items.length === 0 ? (
          <div className="outreach-empty">
            <strong>Контактов не найдено</strong>
            <span>Измените фильтры или импортируйте CSV.</span>
          </div>
        ) : null}
        {contacts && contacts.items.length > 0 ? (
          <div className={loading ? "table-wrap table-refreshing" : "table-wrap"}>
            <table className="outreach-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label="Выбрать всю страницу"
                    />
                  </th>
                  <th>Контакт</th>
                  <th>Ответственный</th>
                  <th>Последнее действие</th>
                  <th>Статус</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {contacts.items.map((contact) => (
                  <tr key={contact.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.includes(contact.id)}
                        onChange={() => toggleOne(contact.id)}
                        aria-label={`Выбрать ${contact.displayName ?? "контакт"}`}
                      />
                    </td>
                    <td>
                      <button
                        className="outreach-contact-link"
                        type="button"
                        onClick={() => void openDetail(contact.id)}
                      >
                        <strong>{contact.displayName ?? "Без имени"}</strong>
                        <span>{contact.phone ?? contact.telegramUsername ?? contact.maxIdentifier}</span>
                      </button>
                      {contact.linkedUserId ? (
                        <span className="outreach-linked">
                          <UserRoundCheck size={13} /> В боте
                        </span>
                      ) : null}
                    </td>
                    <td>{contact.assignedAdminName ?? "Не назначен"}</td>
                    <td>
                      {contact.lastActivityAt ? (
                        <div className="stacked-cell">
                          <strong>{contact.lastChannel ? channelLabel(contact.lastChannel) : "—"}</strong>
                          <span>{formatDateTime(contact.lastActivityAt)}</span>
                        </div>
                      ) : <span className="muted">Не обрабатывали</span>}
                    </td>
                    <td>
                      <StatusPill tone={statusTone(contact.status)}>
                        {statusLabel(contact.status)}
                      </StatusPill>
                    </td>
                    <td>
                      <div className="outreach-row-actions">
                        <button
                          type="button"
                          title="Отметить сообщение"
                          aria-label="Отметить сообщение"
                          onClick={() => setAction({ ids: [contact.id], channel: "telegram" })}
                        >
                          <MessageCircle size={16} />
                          Написал
                        </button>
                        <button
                          type="button"
                          title="Отметить звонок"
                          aria-label="Отметить звонок"
                          onClick={() => setAction({ ids: [contact.id], channel: "phone" })}
                        >
                          <Phone size={16} />
                          Позвонил
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <div className="pagination">
          <button
            className="secondary-button"
            type="button"
            disabled={(contacts?.page ?? 1) <= 1 || loading}
            onClick={() => setFilters((current) => ({ ...current, page: (current.page ?? 1) - 1 }))}
          >
            Назад
          </button>
          <span>Страница {contacts?.page ?? 1}</span>
          <button
            className="secondary-button"
            type="button"
            disabled={!contacts || contacts.page * contacts.limit >= contacts.total || loading}
            onClick={() => setFilters((current) => ({ ...current, page: (current.page ?? 1) + 1 }))}
          >
            Далее
          </button>
        </div>
      </section>

      {action ? (
        <div className="outreach-modal-backdrop" role="presentation">
          <section className="outreach-modal" role="dialog" aria-modal="true" aria-labelledby="activity-title">
            <div className="section-title-row">
              <div>
                <h2 id="activity-title">
                  {action.channel === "phone" ? "Результат звонка" : "Результат сообщения"}
                </h2>
                <span>Контактов: {action.ids.length}</span>
              </div>
              <button className="icon-button" type="button" aria-label="Закрыть" onClick={() => setAction(null)}>
                <X size={18} />
              </button>
            </div>
            <form className="outreach-action-form" onSubmit={(event) => void submitActivity(event)}>
              {action.channel !== "phone" ? (
                <label>
                  <span>Канал</span>
                  <select
                    value={action.channel}
                    onChange={(event) => setAction({ ...action, channel: event.target.value as OutreachChannel })}
                  >
                    <option value="telegram">Telegram</option>
                    <option value="max">MAX</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="sms">SMS</option>
                    <option value="other">Другое</option>
                  </select>
                </label>
              ) : null}
              <label>
                <span>Результат</span>
                <select name="result" required defaultValue={action.channel === "phone" ? "no_answer" : "sent"}>
                  {resultsFor(action.channel).map((result) => (
                    <option key={result} value={result}>{statusLabel(result)}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Перезвонить / связаться</span>
                <input name="nextContactAt" type="datetime-local" />
              </label>
              <label>
                <span>Комментарий</span>
                <textarea name="note" rows={3} maxLength={2000} />
              </label>
              <button className="primary-button" type="submit" disabled={mutating}>
                {mutating ? "Сохраняем…" : "Записать действие"}
              </button>
            </form>
          </section>
        </div>
      ) : null}

      {detail ? (
        <div className="outreach-drawer-backdrop" role="presentation" onMouseDown={() => setDetail(null)}>
          <aside className="outreach-drawer" onMouseDown={(event) => event.stopPropagation()}>
            <div className="section-title-row">
              <div>
                <h2>{detail.displayName ?? "Без имени"}</h2>
                <span>{detail.phone ?? detail.telegramUsername ?? detail.maxIdentifier}</span>
              </div>
              <button className="icon-button" type="button" aria-label="Закрыть" onClick={() => setDetail(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="outreach-contact-meta">
              <span>Ответственный</span><strong>{detail.assignedAdminName ?? "Не назначен"}</strong>
              <span>Источник</span><strong>{detail.source ?? "Не указан"}</strong>
              <span>Комментарий</span><strong>{detail.note ?? "Нет"}</strong>
              <span>Статус</span><strong>{statusLabel(detail.status)}</strong>
            </div>
            <div className="outreach-history">
              <h3>История касаний</h3>
              {detail.activities.length === 0 ? <p className="muted">Действий пока нет.</p> : null}
              {detail.activities.map((activity) => (
                <article key={activity.id}>
                  <div>
                    <strong>{statusLabel(activity.result)}</strong>
                    <span>{channelLabel(activity.channel)}</span>
                  </div>
                  <p>{activity.actorName} · {formatDateTime(activity.occurredAt)}</p>
                  {activity.note ? <small>{activity.note}</small> : null}
                </article>
              ))}
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}

function messageFor(error: unknown, fallback: string): string {
  return error instanceof AdminApiError ? error.message : fallback;
}

function resultsFor(
  channel: OutreachChannel
): readonly Exclude<OutreachContactStatus, "new">[] {
  return channel === "phone"
    ? ["no_answer", "answered", "callback", "interested", "declined", "converted", "invalid"]
    : ["sent", "answered", "callback", "interested", "declined", "converted", "invalid"];
}

function statusLabel(status: OutreachContactStatus): string {
  return {
    new: "Не обрабатывали",
    sent: "Отправлено",
    no_answer: "Не ответил",
    answered: "Ответил",
    callback: "Перезвонить",
    interested: "Заинтересован",
    declined: "Отказ",
    converted: "Оплатил",
    invalid: "Неверный контакт"
  }[status];
}

function channelLabel(channel: OutreachChannel): string {
  return {
    phone: "Звонок",
    telegram: "Telegram",
    max: "MAX",
    whatsapp: "WhatsApp",
    sms: "SMS",
    other: "Другое"
  }[channel];
}

function statusTone(
  status: OutreachContactStatus
): "positive" | "warning" | "neutral" | "danger" {
  if (status === "interested" || status === "converted") {
    return "positive";
  }
  if (status === "callback" || status === "answered") {
    return "warning";
  }
  if (status === "declined" || status === "invalid") {
    return "danger";
  }
  return "neutral";
}

const OUTREACH_STATUSES: readonly OutreachContactStatus[] = [
  "new",
  "sent",
  "no_answer",
  "answered",
  "callback",
  "interested",
  "declined",
  "converted",
  "invalid"
];

function formText(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}
