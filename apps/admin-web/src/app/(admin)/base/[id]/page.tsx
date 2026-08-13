"use client";

import { PageError, PageLoading } from "@/components/page-state";
import { StatusPill } from "@/components/status-pill";
import { AdminApiError, getOutreachPerson } from "@/lib/admin-api";
import { formatCompactDate, formatDateTime } from "@/lib/format";
import type { OutreachPersonCard } from "@ticket-platform/contracts/admin-outreach";
import {
  ArrowLeft,
  Bot,
  CalendarDays,
  Mail,
  MessageSquare,
  Phone,
  RefreshCw
} from "lucide-react";
import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";

const CHANNEL_LABELS: Record<string, string> = {
  phone: "Звонок",
  telegram: "Telegram",
  max: "MAX",
  whatsapp: "WhatsApp",
  sms: "SMS",
  other: "Другое"
};

const RESULT_LABELS: Record<string, string> = {
  sent: "Отправлено",
  no_answer: "Не ответил",
  answered: "Ответил",
  callback: "Перезвонить",
  interested: "Заинтересован",
  declined: "Отказ",
  converted: "Оплатил",
  invalid: "Неверный контакт"
};

export default function OutreachPersonPage(
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = use(params);
  const [person, setPerson] = useState<OutreachPersonCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      setPerson(await getOutreachPerson(id, signal));
    } catch (caught) {
      if (!signal?.aborted) {
        setError(caught instanceof AdminApiError
          ? caught.message
          : "Не удалось загрузить карточку.");
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

  if (loading && !person) {
    return <PageLoading />;
  }
  if (error) {
    return <PageError message={error} retry={() => void load()} />;
  }
  if (!person) {
    return null;
  }

  const activeCampaigns = person.campaigns.filter((item) => !item.removedAt);

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            <Link className="back-link" href="/base">
              <ArrowLeft size={14} />
              База контактов
            </Link>
          </p>
          <h1>{person.displayName ?? "Без имени"}</h1>
          <p>
            {activeCampaigns.length > 0
              ? `Сейчас в ${activeCampaigns.length} ${activeCampaigns.length === 1 ? "кампании" : "кампаниях"}`
              : "Ни в одной кампании не состоит"}
          </p>
        </div>
        <div className="heading-actions">
          {person.archivedAt ? (
            <StatusPill tone="neutral">В архиве</StatusPill>
          ) : null}
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

      <section className="data-section">
        <div className="section-title-row">
          <div><h2>Контакты</h2></div>
        </div>
        <dl className="person-identifiers">
          <div>
            <dt><Phone size={14} /> Телефон</dt>
            <dd>{person.phone ?? <span className="muted">не знаем</span>}</dd>
          </div>
          <div>
            <dt><MessageSquare size={14} /> Telegram</dt>
            <dd>
              {person.telegramUsername
                ? `@${person.telegramUsername}`
                : <span className="muted">не знаем</span>}
            </dd>
          </div>
          <div>
            <dt><MessageSquare size={14} /> MAX</dt>
            <dd>{person.maxIdentifier ?? <span className="muted">не знаем</span>}</dd>
          </div>
          <div>
            <dt><Mail size={14} /> Почта</dt>
            <dd>{person.email ?? <span className="muted">не знаем</span>}</dd>
          </div>
          <div>
            <dt><Bot size={14} /> В боте</dt>
            <dd>
              {person.linkedUserId ? (
                <Link href={`/users/${person.linkedUserId}`}>
                  Открыть пользователя
                </Link>
              ) : (
                <span className="muted">не заходил</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Источник</dt>
            <dd>{person.source ?? <span className="muted">неизвестен</span>}</dd>
          </div>
        </dl>
        {person.note ? <p className="person-note">{person.note}</p> : null}
        <p className="muted person-meta">
          В базе с {formatCompactDate(person.createdAt)}
          {person.updatedAt !== person.createdAt
            ? `, обновлён ${formatCompactDate(person.updatedAt)}`
            : ""}
        </p>
      </section>

      <section className="data-section">
        <div className="section-title-row">
          <div>
            <h2>Кампании</h2>
            <span>{person.campaigns.length}</span>
          </div>
        </div>
        {person.campaigns.length === 0 ? (
          <p className="muted">Человек ещё ни в одной кампании не участвовал.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Кампания</th>
                  <th>Стадия</th>
                  <th>Ответственный</th>
                  <th><span className="sr-only">Открыть</span></th>
                </tr>
              </thead>
              <tbody>
                {person.campaigns.map((membership) => (
                  <tr key={membership.campaignContactId}>
                    <td>
                      <div className="stacked-cell">
                        <strong>{membership.campaignName}</strong>
                        {membership.removedAt ? (
                          <span className="muted">убран из кампании</span>
                        ) : null}
                      </div>
                    </td>
                    <td>{membership.stageLabel}</td>
                    <td>
                      {membership.assignedAdminName ?? (
                        <span className="muted">не назначен</span>
                      )}
                    </td>
                    <td>
                      <Link
                        className="row-link"
                        href={`/outreach/${membership.campaignId}`}
                      >
                        Открыть
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {person.participations.length > 0 ? (
        <section className="data-section">
          <div className="section-title-row">
            <div>
              <h2>Мероприятия</h2>
              <span>{person.participations.length}</span>
            </div>
          </div>
          <ul className="person-events">
            {person.participations.map((participation) => (
              <li key={participation.participantId}>
                <CalendarDays size={15} />
                <Link href={`/events/${participation.eventId}/participants`}>
                  {participation.eventTitle}
                </Link>
                <span className="muted">
                  {participation.guests} чел.
                  {participation.sleepingPlaces > 0
                    ? `, мест: ${participation.sleepingPlaces}`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="data-section">
        <div className="section-title-row">
          <div>
            <h2>История</h2>
            <span>{person.activities.length}</span>
          </div>
          {/* Ради этой ленты карточка и заведена: раньше история резалась по кампаниям,
              и что человеку уже говорили, целиком не видел никто. */}
          <span className="muted">Звонки и сообщения из всех кампаний</span>
        </div>
        {person.activities.length === 0 ? (
          <p className="muted">С человеком ещё не связывались.</p>
        ) : (
          <ol className="person-timeline">
            {person.activities.map((activity) => (
              <li key={activity.id}>
                <div className="person-timeline-head">
                  <strong>{CHANNEL_LABELS[activity.channel] ?? activity.channel}</strong>
                  <StatusPill
                    tone={
                      activity.result === "converted" || activity.result === "interested"
                        ? "positive"
                        : activity.result === "declined" || activity.result === "invalid"
                          ? "danger"
                          : "neutral"
                    }
                  >
                    {RESULT_LABELS[activity.result] ?? activity.result}
                  </StatusPill>
                  <span className="muted">{formatDateTime(activity.occurredAt)}</span>
                </div>
                <div className="person-timeline-meta muted">
                  {activity.actorName} · {activity.campaignName}
                </div>
                {activity.note ? <p>{activity.note}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
