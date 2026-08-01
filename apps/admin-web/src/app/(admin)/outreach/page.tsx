"use client";

import { EmptyState, PageError, PageLoading } from "@/components/page-state";
import { StatusPill } from "@/components/status-pill";
import {
  AdminApiError,
  createOutreachCampaign,
  listEvents,
  listOutreachCampaigns
} from "@/lib/admin-api";
import { formatCompactDate } from "@/lib/format";
import type { AdminEventSummary } from "@ticket-platform/contracts/admin-events";
import type { OutreachCampaignSummary } from "@ticket-platform/contracts/admin-outreach";
import { ArrowRight, Plus, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useState } from "react";

export default function OutreachCampaignsPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<readonly OutreachCampaignSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [events, setEvents] = useState<readonly AdminEventSummary[]>([]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      setCampaigns(await listOutreachCampaigns(signal));
    } catch (caught) {
      if (!signal?.aborted) {
        setError(caught instanceof AdminApiError
          ? caught.message
          : "Не удалось загрузить кампании.");
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // Список мероприятий нужен только для выбора при создании кампании, поэтому грузим
  // молча: без него форма всё равно работает, просто без привязки.
  useEffect(() => {
    const controller = new AbortController();
    void listEvents({ limit: 50 }, controller.signal)
      .then((page) => setEvents(page.items))
      .catch(() => setEvents([]));
    return () => controller.abort();
  }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const nameValue = data.get("name");
    const descriptionValue = data.get("description");
    const eventValue = data.get("eventId");
    const eventId = typeof eventValue === "string" ? eventValue : "";
    const name = typeof nameValue === "string" ? nameValue.trim() : "";
    const description = typeof descriptionValue === "string"
      ? descriptionValue.trim()
      : "";
    if (!name) {
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const campaign = await createOutreachCampaign({
        name,
        ...(description ? { description } : {}),
        ...(eventId ? { eventId } : {})
      });
      router.push(`/outreach/${campaign.id}`);
    } catch (caught) {
      setError(caught instanceof AdminApiError
        ? caught.message
        : "Не удалось создать кампанию.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Продажи</p>
          <h1>Работа с базой</h1>
          <p>Звонки, сообщения и результаты работы менеджеров.</p>
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
          <button
            className="primary-button"
            type="button"
            onClick={() => setShowCreate(true)}
          >
            <Plus size={17} />
            Создать кампанию
          </button>
        </div>
      </div>

      {showCreate ? (
        <section className="data-section outreach-create">
          <div className="section-title-row">
            <div>
              <h2>Новая кампания</h2>
              <span>Например: «Не оплатили — август»</span>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label="Закрыть"
              onClick={() => setShowCreate(false)}
            >
              <X size={18} />
            </button>
          </div>
          <form className="outreach-create-form" onSubmit={(event) => void create(event)}>
            <label>
              <span>Название</span>
              <input name="name" required maxLength={200} autoFocus />
            </label>
            <label>
              <span>Описание</span>
              <textarea name="description" maxLength={2000} rows={3} />
            </label>
            <label>
              <span>Мероприятие</span>
              <select name="eventId" defaultValue="">
                <option value="">Без привязки</option>
                {events.map((event) => (
                  <option key={event.id} value={event.id}>{event.title}</option>
                ))}
              </select>
              <small className="muted">
                Оплатившие из этой кампании смогут попадать в участников мероприятия
                одной кнопкой.
              </small>
            </label>
            <button className="primary-button" type="submit" disabled={creating}>
              {creating ? "Создаём…" : "Создать и открыть"}
            </button>
          </form>
        </section>
      ) : null}

      {loading && campaigns.length === 0 ? <PageLoading /> : null}
      {error ? <PageError message={error} retry={() => void load()} /> : null}
      {!loading && !error && campaigns.length === 0 ? (
        <EmptyState
          title="Кампаний пока нет"
          description="Создайте первую кампанию и загрузите CSV с контактами."
        />
      ) : null}
      {!error && campaigns.length > 0 ? (
        <section className="data-section">
          <div className="section-title-row">
            <div>
              <h2>Кампании</h2>
              <span>{campaigns.length}</span>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Кампания</th>
                  <th>Мероприятие</th>
                  <th>Прогресс</th>
                  <th>Заинтересованы</th>
                  <th>Оплатили</th>
                  <th>Создана</th>
                  <th><span className="sr-only">Открыть</span></th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((campaign) => (
                  <tr key={campaign.id}>
                    <td>
                      <div className="stacked-cell">
                        <strong>{campaign.name}</strong>
                        <StatusPill tone={campaign.status === "completed" ? "neutral" : "positive"}>
                          {campaign.status === "completed" ? "Завершена" : "Активна"}
                        </StatusPill>
                      </div>
                    </td>
                    <td>
                      {campaign.eventTitle ?? <span className="muted">не привязана</span>}
                    </td>
                    <td>
                      <strong>{campaign.totalContacts - campaign.untouchedContacts}</strong>
                      <span className="muted"> из {campaign.totalContacts}</span>
                    </td>
                    <td>{campaign.interestedContacts}</td>
                    <td>{campaign.convertedContacts}</td>
                    <td>{formatCompactDate(campaign.createdAt)}</td>
                    <td>
                      <Link className="row-link" href={`/outreach/${campaign.id}`}>
                        <ArrowRight size={18} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
