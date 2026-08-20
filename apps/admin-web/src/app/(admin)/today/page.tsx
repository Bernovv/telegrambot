"use client";

import { PageLoading } from "@/components/page-state";
import { StatusPill } from "@/components/status-pill";
import {
  AdminApiError,
  completeOutreachTask,
  listEvents,
  listOutreachImports,
  listOutreachTaskBoard,
  listSiteRegistrations
} from "@/lib/admin-api";
import { formatDateTime, formatEventDateTime } from "@/lib/format";
import type { AdminEventSummary } from "@ticket-platform/contracts/admin-events";
import type { OutreachTaskBoardItem } from "@ticket-platform/contracts/admin-outreach";
import {
  CalendarDays,
  Check,
  FileUp,
  Globe,
  ListChecks,
  RefreshCw
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface DayState {
  readonly tasks: readonly OutreachTaskBoardItem[];
  readonly registrationsToSort: number;
  readonly importRowsToSort: number;
  readonly events: readonly AdminEventSummary[];
}

const EMPTY: DayState = {
  tasks: [],
  registrationsToSort: 0,
  importRowsToSort: 0,
  events: []
};

export default function TodayPage() {
  const [day, setDay] = useState<DayState | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      // Каждый блок грузится сам по себе и сам по себе пропадает. У роли может не быть
      // прав на мероприятия или на базу; страница «мой день», падающая целиком из-за
      // одного отказа, была бы хуже, чем страница без одного блока.
      const [tasks, registrations, imports, events] = await Promise.all([
        listOutreachTaskBoard(true, signal).catch(() => []),
        listSiteRegistrations({ needsAttention: true, limit: 1 }, signal)
          .then((page) => page.needsAttention)
          .catch(() => 0),
        listOutreachImports(signal)
          .then((runs) => runs.reduce((sum, run) => sum + run.pendingRows, 0))
          .catch(() => 0),
        listEvents({ limit: 5 }, signal)
          .then((page) => page.items)
          .catch(() => [])
      ]);
      setDay({
        tasks,
        registrationsToSort: registrations,
        importRowsToSort: imports,
        events
      });
    } catch (caught) {
      if (!signal?.aborted) {
        setError(caught instanceof AdminApiError
          ? caught.message
          : "Не удалось собрать сводку.");
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

  async function complete(taskId: string) {
    setMutating(true);
    try {
      await completeOutreachTask(taskId);
      await load();
    } catch (caught) {
      setError(caught instanceof AdminApiError
        ? caught.message
        : "Не удалось отметить задачу выполненной.");
    } finally {
      setMutating(false);
    }
  }

  if (loading && !day) {
    return <PageLoading label="Собираем сводку" />;
  }

  const state = day ?? EMPTY;
  const overdue = state.tasks.filter((task) => task.urgency === "overdue");
  const today = state.tasks.filter((task) => task.urgency === "today");
  const doneToday = state.tasks.filter((task) => task.urgency === "completed");
  const now = state.tasks.length === 0 && state.registrationsToSort === 0
    && state.importRowsToSort === 0;

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Кабинет</p>
          <h1>Мой день</h1>
          <p>Что просит внимания прямо сейчас — по вам, а не по всей команде.</p>
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
        </div>
      </div>

      {error ? <div className="page-warning">{error}</div> : null}

      <div className="metrics-strip">
        <div>
          <span>Просрочено</span>
          <strong>{overdue.length}</strong>
        </div>
        <div>
          <span>На сегодня</span>
          <strong>{today.length}</strong>
        </div>
        <div>
          <span>Заявок с сайта ждёт</span>
          <strong>{state.registrationsToSort}</strong>
        </div>
        <div>
          <span>Строк импорта ждёт</span>
          <strong>{state.importRowsToSort}</strong>
        </div>
      </div>

      {now ? (
        <section className="data-section">
          <div className="section-title-row">
            <div>
              <h2>Пусто</h2>
              <span>Задач на вас нет, разбирать нечего</span>
            </div>
          </div>
          <p className="muted today-empty">
            Загляните в <Link href="/outreach">кампании</Link> — возможно, кому-то давно
            не звонили.
          </p>
        </section>
      ) : null}

      {overdue.length > 0 || today.length > 0 ? (
        <section className="data-section">
          <div className="section-title-row">
            <div>
              <h2>Мои задачи</h2>
              <span>{overdue.length + today.length}</span>
            </div>
            <Link className="offer-link-inline" href="/tasks">
              <ListChecks size={16} />
              Вся доска
            </Link>
          </div>
          <ul className="today-list">
            {[...overdue, ...today].map((task) => (
              <li key={task.id}>
                <div className="today-line">
                  <Link
                    href={task.campaignId
                      ? `/outreach/${task.campaignId}?contact=${task.campaignContactId}`
                      : `/base/${task.contactId}`}
                  >
                    <strong>{task.contactName ?? "Без имени"}</strong>
                  </Link>
                  <StatusPill tone={task.urgency === "overdue" ? "danger" : "warning"}>
                    {task.urgency === "overdue" ? "Просрочено" : "Сегодня"}
                  </StatusPill>
                  <span className="muted">{formatDateTime(task.dueAt)}</span>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="Отметить выполненной"
                    title="Отметить выполненной"
                    disabled={mutating}
                    onClick={() => void complete(task.id)}
                  >
                    <Check size={16} />
                  </button>
                </div>
                <p className="muted">
                  {[
                    task.text,
                    task.contactPhone,
                    task.campaignName ?? "без кампании"
                  ].filter(Boolean).join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {state.registrationsToSort > 0 || state.importRowsToSort > 0 ? (
        <section className="data-section">
          <div className="section-title-row">
            <div>
              <h2>Разобрать</h2>
              <span>Записи, которые сами никуда не денутся</span>
            </div>
          </div>
          <ul className="today-list">
            {state.registrationsToSort > 0 ? (
              <li>
                <div className="today-line">
                  <Globe size={16} />
                  <Link href="/registrations">
                    <strong>Заявки с сайта: {state.registrationsToSort}</strong>
                  </Link>
                </div>
                <p className="muted">
                  Человек оставил телефон, а в списке участников его нет.
                </p>
              </li>
            ) : null}
            {state.importRowsToSort > 0 ? (
              <li>
                <div className="today-line">
                  <FileUp size={16} />
                  <Link href="/base/imports">
                    <strong>Строк импорта: {state.importRowsToSort}</strong>
                  </Link>
                </div>
                <p className="muted">
                  Не разобрался телефон или признаки ведут на разных людей.
                </p>
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      {doneToday.length > 0 ? (
        <section className="data-section">
          <div className="section-title-row">
            <div>
              <h2>Сделано сегодня</h2>
              <span>{doneToday.length}</span>
            </div>
          </div>
          <ul className="today-list">
            {doneToday.map((task) => (
              <li key={task.id}>
                <div className="today-line">
                  <Check size={16} />
                  <span>{task.contactName ?? "Без имени"}</span>
                  <span className="muted">{task.text}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {state.events.length > 0 ? (
        <section className="data-section">
          <div className="section-title-row">
            <div>
              <h2>Ближайшие мероприятия</h2>
              <span>{state.events.length}</span>
            </div>
          </div>
          <ul className="today-list">
            {state.events.map((event) => (
              <li key={event.id}>
                <div className="today-line">
                  <CalendarDays size={16} />
                  <Link href={`/events/${event.id}`}>
                    <strong>{event.title}</strong>
                  </Link>
                  <span className="muted">
                    {formatEventDateTime(event.startsAt, event.timezone)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
